import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import pMap from 'p-map'
import { Client, auth } from 'twitter-api-sdk'

import * as types from './types'
import config, { enableRedis } from './config'
import { keyv } from './keyv'
import {
  createTwitterThreadForChatGPTResponse,
  getChatGPTResponse,
  getTweetsFromResponse
} from './utils'

/**
 * Fetches new unanswered mentions, resolves them via ChatGPT, and tweets response
 * threads for each one.
 */
async function respondToNewMentions({
  dryRun,
  earlyExit,
  chatgpt,
  twitter,
  user
}: {
  dryRun: boolean
  earlyExit: boolean
  chatgpt: ChatGPTAPI
  twitter: types.TwitterClient
  user: types.TwitterUser
}): Promise<types.ChatGPTInteraction[] | null> {
  // config.delete('sinceMentionId')
  let sinceMentionId = config.get('sinceMentionId')

  console.log('fetching mentions since', sinceMentionId || 'forever')

  function updateSinceMentionId(tweetId: string) {
    if (!tweetId) {
      return
    }

    if (!sinceMentionId) {
      sinceMentionId = tweetId
      return
    }

    if (sinceMentionId.length < tweetId.length) {
      sinceMentionId = tweetId
      return
    }

    if (sinceMentionId < tweetId) {
      sinceMentionId = tweetId
      return
    }
  }

  // debugging
  // const ids = [
  //   '1599156989900206080',
  //   '1599197568860585984',
  //   '1599197592596123648'
  // ]

  // const r = await twitter.tweets.findTweetsById({
  //   ids: ids,
  //   expansions: ['author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
  //   'tweet.fields': [
  //     'created_at',
  //     'public_metrics',
  //     'source',
  //     'conversation_id',
  //     'in_reply_to_user_id',
  //     'referenced_tweets'
  //   ]
  //   // since_id: sinceMentionId
  // })
  // console.log(JSON.stringify(r, null, 2))
  // return null

  const mentionsQuery = twitter.tweets.usersIdMentions(user.id, {
    expansions: ['author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
    'tweet.fields': [
      'created_at',
      'public_metrics',
      'source',
      'conversation_id',
      'in_reply_to_user_id',
      'referenced_tweets'
    ],
    max_results: 10,
    since_id: sinceMentionId
  })

  let mentions = []
  let users = {}

  for await (const page of mentionsQuery) {
    if (page.data?.length) {
      mentions = mentions.concat(page.data)
    }

    if (page.includes?.users?.length) {
      for (const user of page.includes.users) {
        users[user.id] = user
      }
    }
  }

  console.log(`processing ${mentions.length} tweet mentions`)
  if (earlyExit) {
    console.log(JSON.stringify(mentions, null, 2))
    return null
  }

  // TODO: queue chat gpt requests one after another without waiting on twitter
  const results = (
    await pMap(
      mentions,
      async (mention): Promise<types.ChatGPTInteraction> => {
        const { text } = mention
        const prompt = text?.replace(/@ChatGPTBot/g, '').trim()
        const promptTweetId = mention.id
        if (!prompt) {
          return { promptTweetId, prompt, error: 'empty prompt' }
        }

        let response: string
        try {
          response = await getChatGPTResponse(prompt, { chatgpt })

          // convert the response to tweet-sized chunks
          const tweetTexts = getTweetsFromResponse(response)

          console.log(
            'prompt',
            `(${promptTweetId})`,
            prompt,
            '=>',
            JSON.stringify(tweetTexts, null, 2)
          )

          const tweets = dryRun
            ? []
            : await createTwitterThreadForChatGPTResponse({
                mention,
                tweetTexts,
                twitter
              })

          const responseTweetIds = tweets.map((tweet) => tweet.id)
          const result = {
            promptTweetId,
            prompt,
            response,
            responseTweetIds
          }

          if (enableRedis && !dryRun) {
            await keyv.set(mention.id, result)
          }

          return result
        } catch (err: any) {
          return {
            promptTweetId,
            prompt,
            response,
            error: err.toString()
          }
        }
      },
      {
        concurrency: 1
      }
    )
  ).filter(Boolean)

  for (const res of results) {
    if (!dryRun && !res.error) {
      updateSinceMentionId(res.promptTweetId)
    }
  }

  if (sinceMentionId) {
    config.set('sinceMentionId', sinceMentionId)
  }

  return results
}

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

  console.log('refreshing twitter access token')
  const { token } = await authClient.refreshAccessToken()
  config.set('refreshToken', token.refresh_token)
  // console.debug(token)

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
    console.log()
    const newInteractions = await respondToNewMentions({
      dryRun,
      earlyExit,
      chatgpt,
      twitter,
      user
    })

    console.log(
      `processed ${newInteractions?.length ?? 0} interactions`,
      newInteractions
    )
    if (newInteractions?.length) {
      interactions = interactions.concat(newInteractions)
    }

    if (earlyExit) {
      break
    }

    if (!newInteractions?.length) {
      console.log('sleeping...')
      // sleep if there were no mentions to process
      await delay(10000)
    }

    if (++loopNum % 30 === 0) {
      console.log('refreshing twitter access token')
      const { token } = await authClient.refreshAccessToken()
      config.set('refreshToken', token.refresh_token)
    }
  } while (true)

  await chatgpt.close()
  return interactions
}

main()
  .then((res) => {
    console.log(res)
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', JSON.stringify(err, null, 2))
    process.exit(1)
  })
