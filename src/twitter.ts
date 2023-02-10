import pMemoize from 'p-memoize'
import pThrottle from 'p-throttle'

import * as types from './types'

// enforce twitter rate limit of 200 tweets per 15 minutes
const throttle1 = pThrottle({
  limit: 200,
  // interval: 15 * 60 * 1000
  interval: 30 * 60 * 1000
})

const throttle2 = pThrottle({
  limit: 1,
  interval: 5000,
  strict: true
})

export const createTweet = throttle1(throttle2(createTweetImpl))

async function createTweetImpl(
  body: Parameters<types.TwitterClient['tweets']['createTweet']>[0],
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
    const res = await twitter.tweets.createTweet(body)
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
      // user may have deleted the tweet we're trying to respond to
      const error = new types.ChatError(
        err.error?.detail || `error creating tweet: 403 forbidden`
      )
      error.isFinal = true
      error.type = 'twitter:forbidden'
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
 * JS comparator function for comparing two Tweet IDs.
 */
export function tweetIdComparator(a: string, b: string): number {
  if (a === b) {
    return 0
  }

  const max = maxTwitterId(a, b)
  if (max === a) {
    return 1
  } else {
    return -1
  }
}

/**
 * JS comparator function for comparing two tweet-like objects.
 */
export function tweetComparator(
  tweetA: { id: string },
  tweetB: { id: string }
): number {
  const a = tweetA.id
  const b = tweetB.id
  return tweetIdComparator(a, b)
}

const getUserByIdThrottle = pThrottle({
  limit: 1,
  interval: 1000,
  strict: true
})

export const getUserById = pMemoize(getUserByIdThrottle(getUserByIdImpl))

async function getUserByIdImpl(
  userId: string,
  {
    twitterV1
  }: {
    twitterV1: types.TwitterClientV1
  }
) {
  // const { data: user } = await twitter.users.findUserById(userId)
  // return user

  const res = await twitterV1.users({ user_id: userId })
  return res[0]
}

const getTweetsByIdsThrottle = pThrottle({
  limit: 1,
  interval: 1005,
  strict: true
})

export const getTweetsByIds = pMemoize(
  getTweetsByIdsThrottle(getTweetsByIdsImpl)
)

async function getTweetsByIdsImpl(
  tweetIds: string | string[],
  {
    twitterV1
  }: {
    twitterV1: types.TwitterClientV1
  }
) {
  return twitterV1.tweets(tweetIds)
}
