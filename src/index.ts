import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import { Client as TwitterClient, auth } from 'twitter-api-sdk'
import { TwitterApi } from 'twitter-api-v2'

import * as types from './types'
import { ChatGPTAPIAccount, ChatGPTAPIPool } from './chatgpt-api-pool'
import config, { twitterBotUserId } from './config'
import { respondToNewMentions } from './respond-to-new-mentions'
import { maxTwitterId } from './twitter'
import {
  loadUserMentionCacheFromDiskByUserId,
  saveAllUserMentionCachesToDisk
} from './twitter-mentions'

async function main() {
  const dryRun = !!process.env.DRY_RUN
  const noCache = !!process.env.NO_CACHE
  const earlyExit = !!process.env.EARLY_EXIT
  const debugTweet = process.env.DEBUG_TWEET
  const defaultSinceMentionId = process.env.SINCE_ID
  const defaultRefreshToken = process.env.TWITTER_TOKEN
  const tweetMode: types.TweetMode =
    (process.env.TWEET_MODE as types.TweetMode) || 'image'
  const forceReply = !!process.env.FORCE_REPLY
  const resolveAllMentions = !!process.env.RESOLVE_ALL_MENTIONS
  const overrideMaxNumMentionsToProcess = parseInt(
    process.env.MAX_NUM_MENTIONS_TO_PROCESS,
    10
  )

  const chatgptAccountsRaw = process.env.CHATGPT_ACCOUNTS
  const chatgptAccounts: ChatGPTAPIAccount[] = chatgptAccountsRaw
    ? JSON.parse(chatgptAccountsRaw)
    : null

  const markdown = tweetMode === 'image' ? true : false
  let chatgpt: ChatGPTAPI

  if (chatgptAccounts?.length) {
    console.log(
      `Initializing ChatGPTAPIPool with ${chatgptAccounts.length} accounts`
    )

    chatgpt = new ChatGPTAPIPool(chatgptAccounts, {
      markdown
    })
  } else {
    console.log(`Initializing a single instance of ChatGPTAPI`)

    chatgpt = new ChatGPTAPI({
      sessionToken: process.env.SESSION_TOKEN!,
      markdown
    })
  }

  await loadUserMentionCacheFromDiskByUserId({ userId: twitterBotUserId })

  // for testing chatgpt
  // await chatgpt.ensureAuth()
  // const res = await chatgpt.sendMessage('this is a test')
  // console.log(res)
  // return

  const maxNumMentionsToProcess = isNaN(overrideMaxNumMentionsToProcess)
    ? 5
    : overrideMaxNumMentionsToProcess

  let sinceMentionId = resolveAllMentions
    ? undefined
    : defaultSinceMentionId || config.get('sinceMentionId')

  const refreshToken = defaultRefreshToken || config.get('refreshToken')
  // const accessToken = undefined // config.get('accessToken')
  // console.log(accessToken)

  const authToken = refreshToken ? { refresh_token: refreshToken } : undefined
  const authClient = new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    callback: 'http://127.0.0.1:3000/callback',
    scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
    token: authToken
  })

  async function refreshTwitterAuthToken() {
    // if (debugTweet) {
    //   console.log('skipping refresh of twitter access token due to DEBUG_TWEET')
    //   return
    // }

    console.log('refreshing twitter access token')
    try {
      const { token } = await authClient.refreshAccessToken()
      config.set('refreshToken', token.refresh_token)
      // config.set('accessToken', token.access_token)
      return token
    } catch (err) {
      console.error('unexpected error refreshing twitter access token', err)
      return null
    }
  }

  await refreshTwitterAuthToken()

  // Twitter API v2 using OAuth 2.0
  const twitter = new TwitterClient(authClient)

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

  const { data: user } = await twitter.users.findMyUser()
  if (!user?.id) {
    throw new Error('twitter error unable to fetch current user')
  }

  // console.log(user)
  // console.log(await twitterApi.currentUser())
  // return

  await chatgpt.ensureAuth()

  let interactions: types.ChatGPTInteraction[] = []
  let loopNum = 0
  let numErrors = 0
  do {
    try {
      console.log()
      const session = await respondToNewMentions({
        dryRun,
        noCache,
        earlyExit,
        forceReply,
        debugTweet,
        resolveAllMentions,
        chatgpt,
        twitter,
        twitterV1,
        sinceMentionId,
        maxNumMentionsToProcess,
        tweetMode
      })

      if (session.sinceMentionId) {
        sinceMentionId = maxTwitterId(sinceMentionId, session.sinceMentionId)

        if (!defaultSinceMentionId && !resolveAllMentions) {
          // Make sure it's in sync in case other processes are writing to the store
          // as well. Note: this still has a classic potential as a race condition,
          // but it's not enough to worry about for our use case.
          const recentSinceMentionId = config.get('sinceMentionId')
          sinceMentionId = maxTwitterId(sinceMentionId, recentSinceMentionId)

          if (sinceMentionId && !dryRun) {
            config.set('sinceMentionId', sinceMentionId)
          }
        }
      }

      if (earlyExit) {
        break
      }

      console.log(
        `processed ${session.interactions?.length ?? 0} interactions`,
        session.interactions
      )
      if (session.interactions?.length) {
        interactions = interactions.concat(session.interactions)
      }

      if (!noCache) {
        await saveAllUserMentionCachesToDisk()
      }

      if (debugTweet) {
        break
      }

      if (session.isExpiredAuth) {
        if (++numErrors > 10) {
          throw new Error(
            'ChatGPT auth expired error; unrecoverable. Please update SESSION_TOKEN'
          )
        } else {
          console.log(
            '\n\nChatGPT auth expired error; possibly unrecoverable. Please update SESSION_TOKEN\n\n'
          )
          console.error(
            '\n\nChatGPT auth expired error; possibly unrecoverable. Please update SESSION_TOKEN\n\n'
          )

          await delay(10000) // 10s
        }
      }

      if (session.isRateLimited || session.isRateLimitedTwitter) {
        console.log(
          `rate limited ${
            session.isRateLimited ? 'chatgpt' : 'twitter'
          }; sleeping...`
        )
        await delay(1 * 60 * 1000) // 1m

        if (session.isRateLimitedTwitter) {
          console.log('sleeping longer for twitter rate limit...')
          await delay(5 * 60 * 1000) // 5m
        }
      }

      const validSessionInteractions = session.interactions.filter(
        (interaction) =>
          !interaction.error && interaction.responseTweetIds?.length
      )

      if (!validSessionInteractions?.length) {
        console.log('sleeping...')
        // sleep if there were no mentions to process
        await delay(30000) // 30s
      } else {
        console.log('sleeping...')
        // still sleep if there are active mentions because of rate limits...
        await delay(2000)
      }

      ++loopNum

      if (session.isExpiredAuthTwitter || loopNum % 20 === 0) {
        await refreshTwitterAuthToken()
      }
    } catch (err) {
      console.error(
        'top-level error',
        err,
        err.error?.errors ? JSON.stringify(err.error.errors, null, 2) : ''
      )
      await delay(30000)
      await refreshTwitterAuthToken()
    }
  } while (true)

  return interactions
}

main()
  .then((res) => {
    if (res?.length) {
      console.log(res)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', JSON.stringify(err, null, 2))
    process.exit(1)
  })
