import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import { franc } from 'franc'
import { iso6393 } from 'iso-639-3'
import pMap from 'p-map'
import rmfr from 'rmfr'

import * as types from './types'
import {
  enableRedis,
  languageAllowList,
  languageDisallowList,
  twitterBotHandle,
  twitterBotUserId
} from './config'
import { keyv } from './keyv'
import { getTweetMentionsBatch } from './mentions'
import { renderResponse } from './render-response'
import {
  createTweet,
  createTwitterThreadForChatGPTResponse,
  maxTwitterId,
  minTwitterId
} from './twitter'
import { getChatGPTResponse, getTweetUrl, getTweetsFromResponse } from './utils'

/**
 * Fetches new unanswered mentions, resolves them via ChatGPT, and tweets response
 * threads for each one.
 */
export async function respondToNewMentions({
  dryRun,
  earlyExit,
  forceReply,
  debugTweet,
  resolveAllMentions,
  maxNumMentionsToProcess,
  chatgpt,
  twitter,
  twitterV1,
  sinceMentionId,
  tweetMode = 'image'
}: {
  dryRun: boolean
  earlyExit: boolean
  forceReply?: boolean
  debugTweet?: string
  resolveAllMentions?: boolean
  maxNumMentionsToProcess?: number
  chatgpt: ChatGPTAPI
  twitter: types.TwitterClient
  twitterV1: types.TwitterClientV1
  sinceMentionId?: string
  tweetMode?: types.TweetMode
}): Promise<types.ChatGPTSession> {
  console.log('respond to new mentions since', sinceMentionId || 'forever')

  // Resolve mentions to process in this batch
  const batch = await getTweetMentionsBatch({
    forceReply,
    debugTweet,
    resolveAllMentions,
    maxNumMentionsToProcess,
    twitter,
    sinceMentionId
  })

  console.log(
    `processing ${batch.mentions.length} tweet mentions`,
    { numMentionsPostponed: batch.numMentionsPostponed },
    batch.mentions.map((mention) => ({
      id: mention.id,
      text: mention.text,
      prompt: mention.prompt,
      promptUrl: mention.promptUrl,
      isReply: mention.isReply,
      numFollowers: mention.numFollowers,
      priorityScore: mention.priorityScore
    }))
  )
  console.log()

  const session: types.ChatGPTSession = {
    interactions: [],
    isRateLimited: false,
    isRateLimitedTwitter: false,
    isExpiredAuth: false,
    isExpiredAuthTwitter: false
  }

  if (earlyExit) {
    if (batch.mentions.length > 0) {
      console.log('mentions', JSON.stringify(batch.mentions, null, 2))
    }

    return session
  }

  const results = (
    await pMap(
      batch.mentions,
      async (mention, index): Promise<types.ChatGPTInteraction> => {
        const { prompt, id: promptTweetId, author_id: promptUserId } = mention
        const promptUser = batch.users[mention.author_id]
        const promptUsername = promptUser?.username

        const result: types.ChatGPTInteraction = {
          promptTweetId,
          promptUserId,
          promptUsername,
          prompt,
          promptUrl: getTweetUrl({
            username: promptUsername,
            id: promptTweetId
          }),
          priorityScore: mention.priorityScore,
          numFollowers: mention.numFollowers,
          isReply: mention.isReply
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
          console.log('pausing for chatgpt...')
          await delay(3000)
        }

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

              const tweets = await createTwitterThreadForChatGPTResponse({
                mention,
                twitter,
                tweetTexts: [
                  `${
                    promptUsername
                      ? `Hey @${promptUsername}, we're sorry but `
                      : "We're sorry but "
                  }${
                    langName === 'unknown' ? 'your prompt' : langName
                  } is currently not supported by this chatbot. We apologize for the inconvenience and will be adding support for more languages soon.\n\nRef: ${promptTweetId}`
                ],
                dryRun
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

          console.log('processing', {
            id: mention.id,
            text: mention.text,
            prompt: mention.prompt,
            promptUrl: mention.promptUrl,
            isReply: mention.isReply,
            numFollowers: mention.numFollowers,
            priorityScore: mention.priorityScore
          })

          const repliedToTweetRef = mention.referenced_tweets?.find(
            (t) => t.type === 'replied_to'
          )
          const repliedToTweet = repliedToTweetRef
            ? batch.tweets[repliedToTweetRef.id]
            : null

          if (repliedToTweet && repliedToTweet.author_id === twitterBotUserId) {
            const prevInteraction: types.ChatGPTInteraction = await keyv.get(
              repliedToTweet.id
            )

            if (prevInteraction) {
              console.log('prevInteraction', prevInteraction)

              // prevInteraction.role should equal 'assistant'
              result.chatgptConversationId =
                prevInteraction.chatgptConversationId
              result.chatgptParentMessageId = prevInteraction.chatgptMessageId
            }
          }

          const chatgptResponse = await getChatGPTResponse(prompt, {
            chatgpt,
            stripMentions: tweetMode === 'image' ? false : true,
            conversationId: result.chatgptConversationId,
            parentMessageId: result.chatgptParentMessageId
          })

          // console.log('chatgptResponse', chatgptResponse)
          const response = chatgptResponse.response
          result.response = response
          result.chatgptConversationId = chatgptResponse.conversationId
          result.chatgptMessageId = chatgptResponse.messageId

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
            // Convert the response to tweet-sized chunks
            const tweetTexts = getTweetsFromResponse(response)

            console.log('prompt => thread', {
              promptTweetId,
              prompt,
              response,
              tweetTexts
            })

            const tweets = await createTwitterThreadForChatGPTResponse({
              mention,
              tweetTexts,
              twitter,
              dryRun
            })

            result.responseTweetIds = tweets.map((tweet) => tweet.id)
          } else {
            // Render the response as an image
            const imageFilePath = await renderResponse({
              prompt,
              response,
              userImageUrl: promptUser?.profile_image_url,
              username: promptUsername
            })

            console.log('prompt => image', {
              promptTweetId,
              prompt,
              imageFilePath,
              response
            })

            const mediaId = dryRun
              ? null
              : await twitterV1.uploadMedia(imageFilePath, {
                  type: 'jpg',
                  mimeType: 'image/jpeg',
                  target: 'tweet'
                })

            const tweet = await createTweet(
              {
                // text: '',
                media: {
                  media_ids: [mediaId]
                },
                reply: {
                  in_reply_to_tweet_id: promptTweetId
                }
              },
              { twitter, dryRun }
            )

            result.responseMediaId = mediaId
            result.responseTweetIds = [tweet?.id].filter(Boolean)

            // Cleanup
            await rmfr(imageFilePath)
          }

          let responseLastTweetId: string
          if (result.responseTweetIds?.length) {
            responseLastTweetId =
              result.responseTweetIds[result.responseTweetIds.length - 1]

            result.responseUrl = getTweetUrl({
              username: twitterBotHandle.replace('@', ''),
              id: responseLastTweetId
            })
          }

          console.log('interaction', result)
          console.log()

          if (enableRedis && !dryRun) {
            await keyv.set(promptTweetId, { ...result, role: 'user' })

            if (responseLastTweetId) {
              await keyv.set(responseLastTweetId, {
                ...result,
                role: 'assistant'
              })
            }
          }

          return result
        } catch (err: any) {
          let isFinal = !!err.isFinal

          if (err.name === 'TimeoutError') {
            // TODO: for now, we won't worry about trying to deal with retrying timeouts
            isFinal = true

            // reset chatgpt auth
            // session.isExpiredAuth = true

            try {
              if (!dryRun) {
                const tweet = await createTweet(
                  {
                    text: `Uh-oh ChatGPT timed out responding to your prompt. Sorry 😓\n\nRef: ${promptTweetId}`,
                    reply: {
                      in_reply_to_tweet_id: promptTweetId
                    }
                  },
                  {
                    twitter,
                    dryRun
                  }
                )

                result.responseTweetIds = [tweet?.id].filter(Boolean)
              }
            } catch (err2) {
              console.warn(
                `warning: twitter error responding to tweet after ChatGPT timeout`,
                err2.toString()
              )
            }

            await delay(10000)
          } else if (err instanceof types.ChatError) {
            if (err.type === 'twitter:auth') {
              // Reset twitter auth
              session.isExpiredAuthTwitter = true
            } else if (err.type === 'twitter:rate-limit') {
              session.isRateLimitedTwitter = true
            }
          } else if (
            err.toString().toLowerCase() === 'error: chatgptapi error 429'
          ) {
            console.log('\nchatgpt rate limit\n')
            session.isRateLimited = true
          } else if (
            err.toString().toLowerCase() === 'error: chatgptapi error 503' ||
            err.toString().toLowerCase() === 'error: chatgptapi error 502'
          ) {
            // TODO: for now, we won't worry about trying to deal with retrying these requests
            isFinal = true

            try {
              if (!dryRun) {
                const tweet = await createTweet(
                  {
                    text: `Uh-oh ChatGPT's servers are overwhelmed and responded with: "${err.toString()}". Sorry 😓\n\nRef: ${promptTweetId}`,
                    reply: {
                      in_reply_to_tweet_id: promptTweetId
                    }
                  },
                  {
                    twitter,
                    dryRun
                  }
                )

                result.responseTweetIds = [tweet?.id].filter(Boolean)
              }
            } catch (err2) {
              // ignore follow-up errors
              console.warn(
                `warning: twitter error responding to tweet after ChatGPT error`,
                err.toString,
                err2.toString()
              )
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
      batch.sinceMentionId = maxTwitterId(
        batch.sinceMentionId,
        res.promptTweetId
      )
    } else {
      batch.minSinceMentionId = minTwitterId(
        batch.minSinceMentionId,
        res.promptTweetId
      )
    }
  }

  if (batch.minSinceMentionId) {
    // follback to the earliest tweet which wasn't processed successfully
    sinceMentionId = minTwitterId(batch.minSinceMentionId, sinceMentionId)
  }

  session.interactions = results
  session.sinceMentionId = sinceMentionId

  return session
}
