import pThrottle from 'p-throttle'
import { type Client } from 'twitter-api-sdk'

// enforce twitter rate limit of 200 tweets per 15 minutes
const throttle = pThrottle({
  limit: 200,
  interval: 15 * 60 * 1000
})

export const createTweet = throttle(createTweetImpl)

async function createTweetImpl(
  args: Parameters<Client['tweets']['createTweet']>[0],
  client: Client
) {
  return client.tweets.createTweet(args)
}
