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

function createTweetImpl(
  args: Parameters<types.TwitterClient['tweets']['createTweet']>[0],
  client: types.TwitterClient
) {
  return client.tweets.createTweet(args)
}
