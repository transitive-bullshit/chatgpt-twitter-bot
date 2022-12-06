import pMap from 'p-map'
import pThrottle from 'p-throttle'

import * as types from './types'

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
  client: types.TwitterClient
) {
  try {
    const res = await client.tweets.createTweet(args)
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
 * Tweets each tweet in the response thread serially one after the other.
 */
export async function createTwitterThreadForChatGPTResponse({
  mention,
  tweetTexts,
  twitter
}: {
  mention?: any
  tweetTexts: string[]
  twitter?: types.TwitterClient
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
        const tweet = await createTweet(
          {
            text,
            reply
          },
          twitter
        )

        prevTweet = tweet
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
