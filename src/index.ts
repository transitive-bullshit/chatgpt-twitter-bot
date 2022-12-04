import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import { Client, auth } from 'twitter-api-sdk'

import * as types from './types'
import config from './config'
import { respondToNewMentions } from './respond-to-new-mentions'

async function main() {
  const dryRun = !!process.env.DRY_RUN
  const earlyExit = !!process.env.EARLY_EXIT
  const headless = !!process.env.HEADLESS

  const chatgpt = new ChatGPTAPI({
    headless,
    markdown: false // TODO
  })
  const chatGptInitP = chatgpt.init({ auth: 'blocking' })

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
        chatgpt,
        twitter,
        user
      })

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

      if (session.isExpiredAuth) {
        await chatgpt.close()
        await refreshTwitterAuthToken()
        await chatgpt.init({ auth: 'blocking' })
      }

      if (session.isRateLimited) {
        console.log('chatgpt rate limited; sleeping...')
        await delay(30000)
        await delay(30000)
      }

      const validSessionInteractions = session.interactions.filter(
        (interaction) =>
          !interaction.error && interaction.responseTweetIds?.length
      )

      if (!validSessionInteractions?.length) {
        console.log('sleeping...')
        // sleep if there were no mentions to process
        await delay(30000)
      }

      if (++loopNum % 30 === 0) {
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
