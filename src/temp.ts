import { markdownToText } from 'chatgpt'
import stringify from 'fast-json-stable-stringify'
import pMap from 'p-map'
import { InterceptResolutionAction } from 'puppeteer'
import { Client as TwitterClient, auth } from 'twitter-api-sdk'
import { TweetV1, TwitterApi } from 'twitter-api-v2'

import * as types from './types'
import config, { redisNamespace, twitterBotUserId } from './config'
import { keyv, redis } from './keyv'
import { getTweetsByIds } from './twitter'
import { loadUserMentionCacheFromDiskByUserId } from './twitter-mentions'

async function main() {
  // await loadUserMentionCacheFromDiskByUserId({ userId: twitterBotUserId })

  // const refreshToken = config.get('refreshToken')

  // const authToken = refreshToken ? { refresh_token: refreshToken } : undefined
  // const authClient = new auth.OAuth2User({
  //   client_id: process.env.TWITTER_CLIENT_ID,
  //   client_secret: process.env.TWITTER_CLIENT_SECRET,
  //   callback: 'http://127.0.0.1:3000/callback',
  //   scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
  //   token: authToken
  // })

  // async function refreshTwitterAuthToken() {
  //   // if (debugTweet) {
  //   //   console.log('skipping refresh of twitter access token due to DEBUG_TWEET')
  //   //   return
  //   // }

  //   console.log('refreshing twitter access token')
  //   try {
  //     const { token } = await authClient.refreshAccessToken()
  //     config.set('refreshToken', token.refresh_token)
  //     // config.set('accessToken', token.access_token)
  //     return token
  //   } catch (err) {
  //     console.error('unexpected error refreshing twitter access token', err)
  //     return null
  //   }
  // }

  // await refreshTwitterAuthToken()

  // // Twitter API v2 using OAuth 2.0
  // const twitter = new TwitterClient(authClient)

  // Twitter API v1 using OAuth 1.1a?
  // NOTE: this is required only to upload media since that doesn't seeem to be
  // supported with the Twitter API v2
  const twitterApi = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET_KEY,
    accessToken: process.env.TWITTER_API_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_API_ACCESS_SECRET
  })
  const { v1: twitterV1 } = twitterApi

  console.log('fetching redis interactions')
  const keys = await redis.keys(`${redisNamespace}:*`)
  const records = await redis.mget(keys)
  const interactions: types.ChatGPTInteraction[] = records
    .map((r) => JSON.parse(r)?.value)
    .filter(Boolean)
    .filter(
      (interaction: types.ChatGPTInteraction) =>
        interaction.role === 'assistant' && !interaction.error
    )
  // console.log(interactions)

  // interactions.sort((a, b) => (b.numFollowers || 0) - (a.numFollowers || 0))
  // console.log(JSON.stringify(interactions.slice(0, 1000), null, 2))

  // update tweet stats in batches
  const batches: types.ChatGPTInteraction[][] = []
  const batchSize = 50
  const numBatches = Math.ceil(interactions.length / batchSize)
  for (let i = 0; i < numBatches; ++i) {
    const offset = i * batchSize
    batches.push(interactions.slice(offset, offset + batchSize))
  }

  console.log()
  console.log('processing', numBatches, 'batches')
  console.log()

  await pMap(
    batches,
    async (batch, index) => {
      try {
        const tweetIds = Array.from(
          new Set(
            batch
              .flatMap((interaction) => [
                interaction.promptTweetId,
                interaction.responseTweetIds[
                  interaction.responseTweetIds?.length - 1
                ]
              ])
              .filter(Boolean)
          )
        )

        console.log(`(batch ${index}/${numBatches})`, 'tweets', tweetIds.length)

        const tweets = await getTweetsByIds(tweetIds, { twitterV1 })
        const tweetsMap = tweets.reduce<Record<string, TweetV1>>(
          (acc, tweet) => ({ ...acc, [tweet.id_str]: tweet }),
          {}
        )

        // console.log('tweets', tweets.length)

        for (const interaction of batch) {
          // console.log(interaction)
          const original = stringify(interaction)

          if (interaction.role === 'assistant' && !interaction.error) {
            const promptTweetId = interaction.promptTweetId
            if (promptTweetId) {
              const tweet = tweetsMap[promptTweetId]
              if (tweet) {
                // console.log('prompt', tweet)
                interaction.promptLikes = tweet.favorite_count ?? 0
                interaction.promptRetweets = tweet.retweet_count ?? 0
                interaction.promptReplies = tweet.reply_count ?? 0
              }
            }

            const responseTweetId =
              interaction.responseTweetIds[
                interaction.responseTweetIds?.length - 1
              ]
            if (responseTweetId) {
              const tweet = tweetsMap[responseTweetId]
              if (tweet) {
                // console.log('response', tweet)
                interaction.responseLikes = tweet.favorite_count ?? 0
                interaction.responseRetweets = tweet.retweet_count ?? 0
                interaction.responseReplies = tweet.reply_count ?? 0

                const updated = stringify(interaction)
                if (original !== updated) {
                  console.log('update', interaction)
                  await keyv.set(promptTweetId, interaction)
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn(
          'error processing interactions',
          `(batch ${index}/${numBatches})`,
          err.toString()
        )
      }
    },
    {
      concurrency: 2
    }
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
