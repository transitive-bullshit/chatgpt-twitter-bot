import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import { Client, auth } from 'twitter-api-sdk'

import * as types from './types'
import config from './config'
import { respondToNewMentions } from './respond-to-new-mentions'
import { maxTwitterId } from './utils'

async function main() {
  const dryRun = !!process.env.DRY_RUN
  const earlyExit = !!process.env.EARLY_EXIT
  const headless = !!process.env.HEADLESS
  const debugTweet = process.env.DEBUG_TWEET
  const defaultSinceMentionId = process.env.SINCE_MENTION_ID

  const chatgpt = new ChatGPTAPI({
    headless,
    markdown: false // TODO
  })
  const chatGptInitP = chatgpt.init({ auth: 'blocking' })

  let sinceMentionId = defaultSinceMentionId || config.get('sinceMentionId')

  // const refreshToken = process.env.TWITTER_OAUTH_REFRESH_TOKEN || config.get('refreshToken')
  const refreshToken = config.get('refreshToken')
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
    return token
  }

  await refreshTwitterAuthToken()

  const twitter = new Client(authClient)
  const { data: user } = await twitter.users.findMyUser()
  await chatGptInitP

  if (!user?.id) {
    await chatgpt.close()
    throw new Error('twitter error unable to fetch current user')
  }

  let interactions: types.ChatGPTInteraction[] = []
  let loopNum = 0
  do {
    try {
      console.log()
      const session = await respondToNewMentions({
        dryRun,
        earlyExit,
        debugTweet,
        chatgpt,
        twitter,
        user,
        sinceMentionId
      })

      if (session.sinceMentionId) {
        sinceMentionId = maxTwitterId(sinceMentionId, session.sinceMentionId)

        // Make sure it's in sync in case other processes are writing to the store
        // as well. Note: this still has a classic potential as a race condition,
        // but it's not enough to worry about for our use case.
        const recentSinceMentionId = config.get('sinceMentionId')
        sinceMentionId = maxTwitterId(sinceMentionId, recentSinceMentionId)

        if (sinceMentionId && !dryRun) {
          config.set('sinceMentionId', sinceMentionId)
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

      if (debugTweet) {
        break
      }

      if (session.isExpiredAuth) {
        await chatgpt.close()
        await chatgpt.init({ auth: 'blocking' })
      }

      if (session.isRateLimited || session.isRateLimitedTwitter) {
        console.log(
          `rate limited ${
            session.isRateLimited ? 'chatgpt' : 'twitter'
          }; sleeping...`
        )
        await delay(30000)
        await delay(30000)

        if (session.isRateLimitedTwitter) {
          console.log('sleeping longer for twitter rate limit...')
          await delay(60000 * 15)
        }
      }

      const validSessionInteractions = session.interactions.filter(
        (interaction) =>
          !interaction.error && interaction.responseTweetIds?.length
      )

      if (!validSessionInteractions?.length) {
        console.log('sleeping...')
        // sleep if there were no mentions to process
        await delay(30000)
      } else {
        // still sleep if there are active mentions because of rate limits...
        await delay(15000)
      }

      ++loopNum

      if (session.isExpiredAuthTwitter || loopNum % 20 === 0) {
        await refreshTwitterAuthToken()
      }
    } catch (err) {
      console.warn('top-level error', err)
      await delay(30000)
      await refreshTwitterAuthToken()
    }
  } while (true)

  await chatgpt.close()
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
