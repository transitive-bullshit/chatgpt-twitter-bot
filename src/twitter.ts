import delay from 'delay'
// import fs from 'fs/promises'
import pMap from 'p-map'
import pThrottle from 'p-throttle'

import * as types from './types'

const userIdMentionsCache: types.TwitterUserIdMentionsCache = {}

// class TwitterUserMentionsCache {
//   userId: string

//   mentions: types.TweetMention[]
//   users: Record<string, Partial<types.TwitterUser>>
//   tweets: Record<string, types.TweetMention>

//   mentionsIndexById: Record<string, number>

//   minTweetId: string
//   maxTweetId: string

//   addResult(result: types.TweetMentionResult) {
//   }
// }

// enforce twitter rate limit of 200 tweets per 15 minutes
const throttle1 = pThrottle({
  limit: 200,
  interval: 15 * 60 * 1000
})

const throttle2 = pThrottle({
  limit: 1,
  interval: 1000,
  strict: true
})

export const createTweet = throttle1(throttle2(createTweetImpl))

async function createTweetImpl(
  args: Parameters<types.TwitterClient['tweets']['createTweet']>[0],
  {
    twitter,
    dryRun
  }: {
    twitter: types.TwitterClient
    dryRun?: boolean
  }
) {
  if (dryRun) return null

  try {
    const res = await twitter.tweets.createTweet(args)
    const tweet = res?.data

    if (tweet?.id) {
      return tweet
    } else {
      console.error('unknown error creating tweet', res)
      throw new Error('unknown error creating tweet: empty tweet id')
    }
  } catch (err) {
    console.error('error creating tweet', JSON.stringify(err, null, 2))

    if (err.status === 403) {
      const error = new types.ChatError(
        err.error?.detail || `error creating tweet: 403 forbidden`
      )
      error.isFinal = true
      error.type = 'twitter:duplicate'
      throw error
    } else if (err.status === 400) {
      if (
        /value passed for the token was invalid/i.test(
          err.error?.error_description
        )
      ) {
        const error = new types.ChatError(
          `error creating tweet: invalid auth token`
        )
        error.isFinal = false
        error.type = 'twitter:auth'
        throw error
      }
    } else if (err.status === 429) {
      const error = new types.ChatError(
        `error creating tweet: too many requests`
      )
      error.isFinal = false
      error.type = 'twitter:rate-limit'
      throw error
    } else if (err.status === 403) {
      const error = new types.ChatError(
        `error creating tweet: 403 forbidden (user may have deleted the tweet)`
      )
      error.isFinal = true
      error.type = 'twitter:forbidden'
      throw error
    }

    if (err.status >= 400 && err.status < 500) {
      const error = new types.ChatError(
        `error creating tweet: ${err.status} ${err.error?.description || ''}`
      )
      error.type = 'unknown'
      throw error
    }

    throw err
  }
}

/**
 * Returns the larger of two Twitter IDs, which is used in several places to
 * keep track of the most recent tweet we've seen or processed.
 */
export function maxTwitterId(tweetIdA?: string, tweetIdB?: string): string {
  if (!tweetIdA && !tweetIdB) {
    return null
  }

  if (!tweetIdA) {
    return tweetIdB
  }

  if (!tweetIdB) {
    return tweetIdA
  }

  if (tweetIdA.length < tweetIdB.length) {
    return tweetIdB
  } else if (tweetIdA.length > tweetIdB.length) {
    return tweetIdA
  }

  if (tweetIdA < tweetIdB) {
    return tweetIdB
  }

  return tweetIdA
}

/**
 * Returns the smaller of two Twitter IDs, which is used in several places to
 * keep track of the least recent tweet we've seen or processed.
 */
export function minTwitterId(tweetIdA?: string, tweetIdB?: string): string {
  if (!tweetIdA && !tweetIdB) {
    return null
  }

  if (!tweetIdA) {
    return tweetIdB
  }

  if (!tweetIdB) {
    return tweetIdA
  }

  if (tweetIdA.length < tweetIdB.length) {
    return tweetIdA
  } else if (tweetIdA.length > tweetIdB.length) {
    return tweetIdB
  }

  if (tweetIdA < tweetIdB) {
    return tweetIdA
  }

  return tweetIdB
}

/**
 * Tweets each tweet in the response thread serially one after the other.
 */
export async function createTwitterThreadForChatGPTResponse({
  mention,
  tweetTexts,
  twitter,
  dryRun
}: {
  mention?: any
  tweetTexts: string[]
  twitter?: types.TwitterClient
  dryRun?: boolean
}): Promise<types.CreatedTweet[]> {
  let prevTweet = mention

  const tweets = (
    await pMap(
      tweetTexts,
      async (text): Promise<types.CreatedTweet> => {
        const reply = prevTweet?.id
          ? {
              in_reply_to_tweet_id: prevTweet.id
            }
          : undefined

        // Note: this call is rate-limited on our side
        const tweet = await createTweet({ text, reply }, { twitter, dryRun })

        if (tweet) {
          prevTweet = tweet
        }

        console.log('tweet response', JSON.stringify(tweet, null, 2))
        return tweet
      },
      {
        // This has to be set to 1 because each tweet in the thread replies
        // the to tweet before it
        concurrency: 1
      }
    )
  ).filter(Boolean)

  return tweets
}

export async function getTwitterUserIdMentions(
  userId: string,
  opts: types.TwitterUserIdMentionsQueryOptions,
  {
    twitter,
    noCache = false,
    resolveAllMentions
  }: {
    twitter: types.TwitterClient
    noCache?: boolean
    resolveAllMentions?: boolean
  }
): Promise<types.TweetMentionResult> {
  const originalSinceMentionId = opts.since_id

  let result: types.TweetMentionResult = {
    mentions: [],
    users: {},
    tweets: {},
    sinceMentionId: originalSinceMentionId
  }

  if (!userIdMentionsCache[userId]) {
    userIdMentionsCache[userId] = {}
  }

  let lastSinceMentionId = result.sinceMentionId

  do {
    let numMentionsInQuery = 0
    let numPagesInQuery = 0
    let isCachedResult = false

    if (!noCache) {
      const cachedResult = userIdMentionsCache[userId][originalSinceMentionId]
      if (cachedResult) {
        numMentionsInQuery = cachedResult.mentions.length
        result.mentions = result.mentions.concat(cachedResult.mentions)
        result.users = {
          ...cachedResult.users,
          ...result.users
        }
        result.tweets = {
          ...cachedResult.tweets,
          ...result.tweets
        }
        result.sinceMentionId = maxTwitterId(
          result.sinceMentionId,
          cachedResult.sinceMentionId
        )

        console.log('twitter.tweets.userIdMentions cache hit', {
          sinceMentionId: originalSinceMentionId,
          numMentions: result.mentions.length
        })

        isCachedResult = true
      }
    }

    if (!isCachedResult) {
      console.log('twitter.tweets.usersIdMentions', {
        sinceMentionId: result.sinceMentionId
      })
      const mentionsQuery = twitter.tweets.usersIdMentions(userId, {
        ...opts,
        since_id: result.sinceMentionId
      })

      for await (const page of mentionsQuery) {
        numPagesInQuery++

        if (page.data?.length) {
          numMentionsInQuery += page.data?.length
          result.mentions = result.mentions.concat(page.data)

          for (const mention of page.data) {
            result.sinceMentionId = maxTwitterId(
              result.sinceMentionId,
              mention.id
            )
          }
        }

        if (page.includes?.users?.length) {
          for (const user of page.includes.users) {
            result.users[user.id] = user
          }
        }

        if (page.includes?.tweets?.length) {
          for (const tweet of page.includes.tweets) {
            result.tweets[tweet.id] = tweet
          }
        }
      }

      console.log({ numMentionsInQuery, numPagesInQuery })
      if (!numMentionsInQuery || !resolveAllMentions) {
      }
    }

    if (
      !numMentionsInQuery ||
      !resolveAllMentions ||
      result.sinceMentionId === lastSinceMentionId
    ) {
      break
    }

    lastSinceMentionId = result.sinceMentionId
    console.log('pausing for twitter...')
    await delay(6000)
  } while (true)

  userIdMentionsCache[userId][originalSinceMentionId] = result
  return result
}
