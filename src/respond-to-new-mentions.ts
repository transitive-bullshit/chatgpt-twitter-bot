import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import { franc } from 'franc'
import { iso6393 } from 'iso-639-3'
import pMap from 'p-map'
import pTimeout, { TimeoutError } from 'p-timeout'
import rmfr from 'rmfr'
import urlRegex from 'url-regex'

import * as types from './types'
import {
  enableRedis,
  languageAllowList,
  languageDisallowList,
  tweetIgnoreList,
  twitterBotHandle,
  twitterBotHandleL
} from './config'
import { keyv } from './keyv'
import { renderResponse } from './render-response'
import {
  createTweet,
  createTwitterThreadForChatGPTResponse,
  maxTwitterId
} from './twitter'
import { getChatGPTResponse, getTweetsFromResponse, pick } from './utils'

/**
 * Fetches new unanswered mentions, resolves them via ChatGPT, and tweets response
 * threads for each one.
 */
export async function respondToNewMentions({
  dryRun,
  earlyExit,
  forceReply,
  debugTweet,
  chatgpt,
  twitter,
  twitterV1,
  user,
  sinceMentionId,
  tweetMode = 'image'
}: {
  dryRun: boolean
  earlyExit: boolean
  forceReply?: boolean
  debugTweet?: string
  chatgpt: ChatGPTAPI
  twitter: types.TwitterClient
  twitterV1: types.TwitterClientV1
  user: types.TwitterUser
  sinceMentionId?: string
  tweetMode?: types.TweetMode
}): Promise<types.ChatGPTSession> {
  console.log('fetching mentions since', sinceMentionId || 'forever')

  function updateSinceMentionId(tweetId: string) {
    if (dryRun || !tweetId) {
      return
    }

    sinceMentionId = maxTwitterId(sinceMentionId, tweetId)
  }

  let mentions = []
  let users = {}
  let tweets = {}

  if (debugTweet) {
    const ids = debugTweet.split(',').map((id) => id.trim())
    const res = await twitter.tweets.findTweetsById({
      ids: ids,
      expansions: ['author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
      'tweet.fields': [
        'created_at',
        'public_metrics',
        'conversation_id',
        'in_reply_to_user_id',
        'referenced_tweets'
      ],
      'user.fields': ['profile_image_url']
    })

    mentions = mentions.concat(res.data)

    if (res.includes?.users?.length) {
      for (const user of res.includes.users) {
        users[user.id] = user
      }
    }

    if (res.includes?.tweets?.length) {
      for (const tweet of res.includes.tweets) {
        tweets[tweet.id] = tweet
      }
    }
  } else {
    const mentionsQuery = twitter.tweets.usersIdMentions(user.id, {
      expansions: ['author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
      'tweet.fields': [
        'created_at',
        'public_metrics',
        'conversation_id',
        'in_reply_to_user_id',
        'referenced_tweets'
      ],
      'user.fields': ['profile_image_url'],
      max_results: 100,
      since_id: sinceMentionId
    })

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
  }

  const rUrl = urlRegex()

  // TODO: add unit tests for this
  function getPrompt(text?: string): string {
    // strip usernames
    let prompt = text
      .replace(twitterBotHandleL, '')
      .replace(twitterBotHandle, '')
      .trim()
      .replace(/^\s*@[a-zA-Z0-9_]+/g, '')
      .replace(/^\s*@[a-zA-Z0-9_]+/g, '')
      .replace(/^\s*@[a-zA-Z0-9_]+/g, '')
      .replace(/^\s*@[a-zA-Z0-9_]+/g, '')
      .replace(rUrl, '')
      .trim()
      .replace(/^,\s*/, '')
      .trim()

    // fix bug in plaintext version for code blocks
    prompt = prompt.replace('\n\nCopy code\n\n', '\n\n')

    return prompt
  }

  // TODO: add unit tests for this
  function getNumMentionsInText(
    text?: string,
    { isReply }: { isReply?: boolean } = {}
  ) {
    const prefixText = isReply
      ? (text.match(/^(\@[a-zA-Z0-9_]+\b\s*)+/g) || [])[0]
      : text
    if (!prefixText) {
      return {
        usernames: [],
        numMentions: 0
      }
    }

    const usernames = (prefixText.match(/\@[a-zA-Z0-9_]+\b/g) || []).map(
      (u: string) => u.trim().toLowerCase().replace(',', '')
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

  mentions = mentions
    .filter((mention) => {
      if (!mention) {
        return false
      }

      if (tweetIgnoreList.has(mention.id)) {
        return false
      }

      const text = mention.text
      mention.prompt = getPrompt(text)

      if (!mention.prompt) {
        return false
      }

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

      const { numMentions, usernames } = getNumMentionsInText(text)

      if (
        numMentions > 0 &&
        (usernames[usernames.length - 1] === twitterBotHandleL ||
          (numMentions === 1 && !isReply))
      ) {
        if (
          isReply &&
          repliedToTweet?.numMentions >= numMentions &&
          !forceReply
        ) {
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
    // only process a max of 5 mentions at a time (the oldest ones first)
    .reverse()

  if (!forceReply) {
    // Filter any mentions which we've already replied to
    mentions = (
      await pMap(
        mentions,
        async (mention) => {
          const res = await keyv.get(mention.id)
          if (res) {
            return null
          } else {
            return mention
          }
        },
        {
          concurrency: 8
        }
      )
    ).filter(Boolean)
  }

  mentions = mentions.slice(0, 5)

  console.log(
    `processing ${mentions.length} tweet mentions`,
    mentions.map((mention) => ({
      id: mention.id,
      text: mention.text,
      prompt: mention.prompt
    }))
  )

  const session: types.ChatGPTSession = {
    interactions: [],
    isRateLimited: false,
    isRateLimitedTwitter: false,
    isExpiredAuth: false,
    isExpiredAuthTwitter: false
  }

  if (earlyExit) {
    if (mentions.length > 0) {
      console.log('mentions', JSON.stringify(mentions, null, 2))
    }

    return session
  }

  // TODO: queue chat gpt requests one after another without waiting on twitter?
  // maybe not worth it since rate limiting on ChatGPT's side is a thing...
  const results = (
    await pMap(
      mentions,
      async (mention, index): Promise<types.ChatGPTInteraction> => {
        const { prompt, id: promptTweetId, author_id: promptUserId } = mention
        const promptUser = users[mention.author_id]
        const promptUsername = promptUser?.username

        const result: types.ChatGPTInteraction = {
          promptTweetId,
          promptUserId,
          promptUsername,
          prompt
        }

        if (session.isRateLimited) {
          result.error = 'ChatGPT rate limited'
          return result
        }

        if (session.isRateLimitedTwitter) {
          result.error = 'Twitter rate limited'
          return result
        }

        if (session.isExpiredAuth) {
          result.error = 'ChatGPT auth expired'
          return result
        }

        if (session.isExpiredAuthTwitter) {
          result.error = 'Twitter auth expired'
          return result
        }

        if (!prompt) {
          result.error = 'empty prompt'
          result.isErrorFinal = true
          return result
        }

        if (index > 0) {
          // slight slow down between ChatGPT requests
          await delay(1000)
        }

        let response: string
        try {
          // TODO: the `franc` module we're using for language detection doesn't
          // seem very accurate at inferrring english. It will often pick some
          // european dialect instead.
          const lang = franc(prompt, { minLength: 5 })

          if (!languageAllowList.has(lang)) {
            const entry = iso6393.find((i) => i.iso6393 === lang)
            const langName = entry?.name || lang || 'unknown'

            // Check for languages that we know will cause problems for our code
            // and degrace gracefully with an error message.
            if (tweetMode === 'thread' && languageDisallowList.has(lang)) {
              console.error()
              console.error('error: unsupported language detected in prompt', {
                lang,
                langName,
                prompt,
                promptTweetId
              })
              console.error()

              const mentionAuthorUsername = users[mention.author_id]?.username

              const tweets = dryRun
                ? []
                : await createTwitterThreadForChatGPTResponse({
                    mention,
                    twitter,
                    tweetTexts: [
                      `${
                        mentionAuthorUsername
                          ? `Hey @${mentionAuthorUsername}, we're sorry but `
                          : "We're sorry but "
                      }${
                        langName === 'unknown' ? 'your prompt' : langName
                      } is currently not supported by this chatbot. We apologize for the inconvenience and will be adding support for more languages soon.\n\nRef: ${promptTweetId}`
                    ]
                  })

              const responseTweetIds = tweets.map((tweet) => tweet.id)
              return {
                ...result,
                error: `Unsupported language "${langName}"`,
                isErrorFinal: true,
                responseTweetIds
              }
            } else if (!languageDisallowList.has(lang)) {
              console.warn()
              console.warn(
                'warning: unrecognized language detected in prompt',
                {
                  lang,
                  langName,
                  prompt,
                  promptTweetId
                }
              )
              console.warn()
            }
          }

          response = await getChatGPTResponse(prompt, {
            chatgpt,
            stripMentions: tweetMode === 'image' ? false : true
          })

          result.response = response
          const responseL = response.toLowerCase()
          if (responseL.includes('too many requests, please slow down')) {
            session.isRateLimited = true
            return null
          }

          if (
            responseL.includes('your authentication token has expired') ||
            responseL.includes('please try signing in again')
          ) {
            session.isExpiredAuth = true
            return null
          }

          if (tweetMode === 'thread') {
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

            result.responseTweetIds = tweets.map((tweet) => tweet.id)
          } else {
            const promptUser = users[mention.author_id]

            // render the response as an image
            const imageFilePath = await renderResponse({
              prompt,
              response,
              userImageUrl: promptUser?.profile_image_url,
              username: promptUser?.username
            })

            console.log(
              'prompt',
              `(${promptTweetId})`,
              prompt,
              '=>',
              imageFilePath,
              '\n' + response
            )

            const mediaId = dryRun
              ? null
              : await twitterV1.uploadMedia(imageFilePath, {
                  type: 'jpg',
                  mimeType: 'image/jpeg',
                  target: 'tweet'
                })

            const tweet = dryRun
              ? null
              : await createTweet(
                  {
                    // text: '',
                    reply: {
                      in_reply_to_tweet_id: promptTweetId
                    },
                    media: {
                      media_ids: [mediaId]
                    }
                  },
                  twitter
                )

            result.responseMediaId = mediaId
            result.responseTweetIds = [tweet?.id].filter(Boolean)

            // cleanup
            await rmfr(imageFilePath)
          }

          if (enableRedis && !dryRun) {
            await keyv.set(mention.id, result)
          }

          return result
        } catch (err: any) {
          let isFinal = !!err.isFinal

          if (err instanceof TimeoutError) {
            // TODO: for now, we won't worry about trying to deal with retrying timeouts
            isFinal = true

            // reset chatgpt auth
            session.isExpiredAuth = true

            try {
              if (!dryRun) {
                await createTwitterThreadForChatGPTResponse({
                  mention,
                  twitter,
                  tweetTexts: [
                    `Uh-oh ChatGPT timed out responding to your prompt. Sorry 😓\n\nRef: ${promptTweetId}`
                  ]
                })
              }
            } catch (err2) {
              // ignore
            }
          } else if (err instanceof types.ChatError) {
            if (err.type === 'twitter:auth') {
              // reset twitter auth
              session.isExpiredAuthTwitter = true
            } else if (err.type === 'twitter:rate-limit') {
              session.isRateLimitedTwitter = true
            }
          }

          return {
            ...result,
            error: err.toString(),
            isErrorFinal: !!isFinal
          }
        }
      },
      {
        concurrency: 1
      }
    )
  ).filter(Boolean)

  for (const res of results) {
    if (!res.error || res.isErrorFinal) {
      updateSinceMentionId(res.promptTweetId)
    }
  }

  session.interactions = results
  session.sinceMentionId = sinceMentionId

  return session
}
