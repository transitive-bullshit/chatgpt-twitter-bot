import pThrottle from 'p-throttle'

import * as types from './types'

// enforce twitter rate limit of 200 tweets per 15 minutes
const throttle = pThrottle({
  limit: 200,
  interval: 15 * 60 * 1000
})

export const createTweet = throttle(createTweetImpl)

async function createTweetImpl(
  args: Parameters<types.TwitterClient['tweets']['createTweet']>[0],
  client: types.TwitterClient
) {
  return client.tweets.createTweet(args)
}
