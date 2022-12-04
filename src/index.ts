import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import pMap from 'p-map'
import { Client, auth } from 'twitter-api-sdk'
import urlRegex from 'url-regex'

import * as types from './types'
import config, {
  enableRedis,
  twitterBotHandle,
  twitterBotHandleL
} from './config'
import { keyv } from './keyv'
import {
  createTwitterThreadForChatGPTResponse,
  getChatGPTResponse,
  getTweetsFromResponse,
  pick
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
    if (dryRun || !tweetId) {
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
      'conversation_id',
      'in_reply_to_user_id',
      'referenced_tweets'
    ],
    max_results: 100,
    since_id: sinceMentionId
  })

  let mentions = []
  let users = {}
  let tweets = {}

  for await (const page of mentionsQuery) {
    if (page.data?.length) {
      mentions = mentions.concat(page.data)
    }

    if (page.includes?.users?.length) {
      for (const user of page.includes.users) {
        users[user.id] = user
      }
    }

    if (page.includes?.tweets?.length) {
      for (const tweet of page.includes.tweets) {
        tweets[tweet.id] = tweet
      }
    }
  }

  const rUrl = urlRegex()

  function getPrompt(text?: string): string {
    // strip usernames
    let prompt = text
      .replace(twitterBotHandleL, '')
      .replace(twitterBotHandle, '')
      .replace(/^ *@[a-zA-Z0-9_]+/g, '')
      .replace(/^ *@[a-zA-Z0-9_]+/g, '')
      .replace(/^ *@[a-zA-Z0-9_]+/g, '')
      .replace(/^ *@[a-zA-Z0-9_]+/g, '')
      .replace(rUrl, '')
      .trim()

    // fix bug in plaintext version for code blocks
    prompt = prompt.replace('\n\nCopy code\n\n', '\n\n')

    return prompt
  }

  function getNumMentionsInText(
    text?: string,
    { isReply }: { isReply?: boolean } = {}
  ) {
    const prefixText = isReply
      ? (text.match(/^(\@[a-zA-Z0-9_]+\s+)+/g) || [])[0]
      : text
    if (!prefixText) {
      return {
        usernames: [],
        numMentions: 0
      }
    }

    const usernames = (prefixText.match(/\@[a-zA-Z0-9_]+\s/g) || []).map(
      (u: string) => u.trim().toLowerCase()
    )
    let numMentions = 0

    for (const username of usernames) {
      if (username === twitterBotHandleL) {
        numMentions++
      }
    }

    return {
      numMentions,
      usernames
    }
  }

  mentions = mentions.filter((mention) => {
    const text = mention.text
    const repliedToTweetRef = mention.referenced_tweets?.find(
      (t) => t.type === 'replied_to'
    )
    const isReply = !!repliedToTweetRef
    const repliedToTweet = repliedToTweetRef
      ? tweets[repliedToTweetRef.id]
      : null
    if (repliedToTweet) {
      repliedToTweet.prompt = getPrompt(repliedToTweet.text)
      const subMentions = getNumMentionsInText(repliedToTweet.text, {
        isReply: !!repliedToTweet.referenced_tweets?.find(
          (t) => t.type === 'replied_to'
        )
      })
      repliedToTweet.numMentions = subMentions.numMentions
    }

    mention.prompt = getPrompt(text)

    if (!mention.prompt) {
      return false
    }

    const { numMentions, usernames } = getNumMentionsInText(text)

    if (
      numMentions > 0 &&
      usernames[usernames.length - 1] === twitterBotHandleL
    ) {
      if (isReply && repliedToTweet.numMentions >= numMentions) {
        console.log('ignoring mention 0', mention, {
          repliedToTweet,
          numMentions
        })

        updateSinceMentionId(mention.id)
        return false
      } else if (numMentions === 1) {
        if (isReply && mention.in_reply_to_user_id === user.id) {
          console.log('ignoring mention 1', mention, {
            numMentions
          })

          updateSinceMentionId(mention.id)
          return false
        }
      }
    } else {
      console.log('ignoring mention 2', pick(mention, 'text', 'id'), {
        numMentions
      })

      updateSinceMentionId(mention.id)
      return false
    }

    console.log(JSON.stringify(mention, null, 2), {
      numMentions,
      repliedToTweet
    })
    // console.log(pick(mention, 'id', 'text', 'prompt'), { numMentions })
    return true
  })

  console.log(
    `processing ${mentions.length} tweet mentions`,
    mentions.map((mention) => ({
      id: mention.id,
      text: mention.text,
      prompt: mention.prompt
    }))
  )

  if (earlyExit) {
    if (mentions.length > 0) {
      console.log('mentions', JSON.stringify(mentions, null, 2))
    }
    return null
  }

  // TODO: queue chat gpt requests one after another without waiting on twitter
  const results = (
    await pMap(
      mentions,
      async (mention): Promise<types.ChatGPTInteraction> => {
        const { text, prompt, id: promptTweetId } = mention
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
    if (!res.error) {
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
      const newInteractions = await respondToNewMentions({
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
        `processed ${newInteractions?.length ?? 0} interactions`,
        newInteractions
      )
      if (newInteractions?.length) {
        interactions = interactions.concat(newInteractions)
      }

      if (!newInteractions?.length) {
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
