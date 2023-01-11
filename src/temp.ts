import { markdownToText } from 'chatgpt'
import pMap from 'p-map'
import { Client as TwitterClient, auth } from 'twitter-api-sdk'
import { TwitterApi } from 'twitter-api-v2'

import * as types from './types'
import config, { redisNamespace, twitterBotUserId } from './config'
import { redis } from './keyv'
import { loadUserMentionCacheFromDiskByUserId } from './twitter-mentions'

async function main() {
  // await loadUserMentionCacheFromDiskByUserId({ userId: twitterBotUserId })

  const refreshToken =
    process.env.TWITTER_OAUTH_REFRESH_TOKEN || config.get('refreshToken')
  // const refreshToken = config.get('refreshToken')
  const authToken = refreshToken ? { refresh_token: refreshToken } : undefined
  const authClient = new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    callback: 'http://127.0.0.1:3000/callback',
    scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
    token: authToken
  })

  async function refreshTwitterAuthToken() {
    console.log('refreshing twitter access token')
    const { token } = await authClient.refreshAccessToken()
    config.set('refreshToken', token.refresh_token)
    console.log('twitter access token', token)
    return token
  }

  await refreshTwitterAuthToken()

  // const twitter = new TwitterClient(authClient)

  // Twitter API v1 using OAuth 1.1a?
  // NOTE: this is required only to upload media since that doesn't seeem to be
  // supported with the Twitter API v2
  // const twitterApi = new TwitterApi({
  //   appKey: process.env.TWITTER_API_KEY,
  //   appSecret: process.env.TWITTER_API_SECRET_KEY,
  //   accessToken: process.env.TWITTER_API_ACCESS_TOKEN,
  //   accessSecret: process.env.TWITTER_API_ACCESS_SECRET
  // })
  // const { v1: twitterV1 } = twitterApi

  // // const text = 'foo...'
  // // const mediaId = await twitterV1.uploadMedia('media/demo.jpg', {
  // //   type: 'jpg',
  // //   mimeType: 'image/jpeg',
  // //   target: 'tweet'
  // // })
  // // const res = await twitterV1.createMediaMetadata(mediaId, {
  // //   alt_text: {
  // //     text: (text + text + text + text + text + text).slice(0, 1000)
  // //   }
  // // })
  // // console.log(res)
  // // return res

  // console.log('iterating')
  // const keys = await redis.keys(`${redisNamespace}:*`)
  // const records = await redis.mget(keys)
  // const records2 = records.map((r) => JSON.parse(r))
  // await pMap(
  //   records2.slice(500, 505),
  //   async (record) => {
  //     try {
  //       const interaction: types.ChatGPTInteraction = record.value
  //       if (interaction.role === 'assistant' && !interaction.error) {
  //         const mediaId = interaction.responseMediaId
  //         const response = interaction.response

  //         if (mediaId && response) {
  //           const text = markdownToText(response)
  //           console.log(interaction.responseUrl, mediaId, text)
  //           // await twitterV1.createMediaMetadata(mediaId, {
  //           //   alt_text: {
  //           //     text
  //           //   }
  //           // })
  //         }
  //       }
  //     } catch (err) {
  //       console.warn('error creating media metadata', err.toString())
  //     }
  //   },
  //   {
  //     concurrency: 1
  //   }
  // )

  // const { data: user } = await twitter.users.findUserByUsername('Yaviendil', {
  // const { data: user } = await twitter.users.findMyUser({
  //   'user.fields': [
  //     'entities',
  //     'description',
  //     'profile_image_url',
  //     'protected',
  //     'public_metrics'
  //   ]
  // })

  // if (!user?.id) {
  //   throw new Error('twitter error unable to fetch current user')
  // }

  // console.log(user)

  // const d = await twitter.tweets.usersIdTweets(user.id)
  // console.log(d)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
