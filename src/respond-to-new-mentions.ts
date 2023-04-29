import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import pMap from 'p-map'
import rmfr from 'rmfr'

import * as types from './types'
// import { ChatGPTUnofficialProxyAPIPool } from './chatgpt-proxy-api-pool'
import { enableRedis, twitterBotHandle, twitterBotUserId } from './config'
import { keyv } from './keyv'
import { getTweetMentionsBatch } from './mentions'
import { checkModeration } from './openai'
import { renderResponse } from './render-response'
import { createTweet, maxTwitterId, minTwitterId } from './twitter'
import { getChatGPTResponse, getTweetUrl, markdownToText, pick } from './utils'

/**
 * Fetches new unanswered mentions, resolves each of them via ChatGPT, and
 * tweets the responses.
 */
export async function respondToNewMentions({
  dryRun,
  noCache,
  earlyExit,
  forceReply,
  debugTweet,
  resolveAllMentions,
  maxNumMentionsToProcess,
  chatgpt,
  twitter,
  twitterV1,
  sinceMentionId
}: {
  dryRun: boolean
  noCache: boolean
  earlyExit: boolean
  forceReply?: boolean
  debugTweet?: string
  resolveAllMentions?: boolean
  maxNumMentionsToProcess?: number
  chatgpt: ChatGPTAPI
  twitter: types.TwitterClient
  twitterV1: types.TwitterClientV1
  sinceMentionId?: string
}): Promise<types.ChatGPTSession> {
  console.log('respond to new mentions since', sinceMentionId || 'forever')

  // Fetch the mentions to process in this batch
  const batch = await getTweetMentionsBatch({
    noCache,
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
    batch.mentions.map((mention) =>
      pick(
        mention,
        'id',
        'text',
        'prompt',
        'promptUrl',
        'isReply',
        'numFollowers',
        'priorityScore'
      )
    )
  )
  console.log()

  const session: types.ChatGPTSession = {
    interactions: [],
    isRateLimited: false,
    isRateLimitedTwitter: false,
    isExpiredAuth: false,
    isExpiredAuthTwitter: false,
    hasAllOpenAIAccountsExpired: false,
    hasNetworkError: false
  }

  if (earlyExit) {
    if (batch.mentions.length > 0) {
      console.log('mentions', JSON.stringify(batch.mentions, null, 2))
    }

    return session
  }

  // const isChatGPTAccountPool = chatgpt instanceof ChatGPTUnofficialProxyAPIPool
  // const concurrency = isChatGPTAccountPool ? 4 : 1

  const results = (
    await pMap(
      batch.mentions,
      async (mention, index): Promise<types.ChatGPTInteraction> => {
        const { prompt, id: promptTweetId, author_id: promptUserId } = mention
        const promptUser = batch.users[mention.author_id]
        const promptUsername = promptUser?.username

        let result: types.ChatGPTInteraction = {
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
          isReply: mention.isReply,
          model: mention.isGPT4 ? 'gpt-4' : 'gpt-3.5-turbo'
        }

        if (session.hasNetworkError) {
          result.error = 'network error'
          return result
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

        if (session.hasAllOpenAIAccountsExpired) {
          result.error = 'All ChatGPT accounts expired'
          return result
        }

        if (!prompt) {
          result.error = 'empty prompt'
          result.isErrorFinal = true
          return result
        }

        // if (index > 0) {
        //   // slight slow down between ChatGPT requests
        //   console.log('pausing for chatgpt...')
        //   await delay(6000)
        // }

        try {
          // Double-check that the tweet still exists before asking ChatGPT to
          // resolve it's response
          try {
            const promptTweet = await twitter.tweets.findTweetById(
              promptTweetId
            )

            if (!promptTweet?.data) {
              const error = new types.ChatError(
                `Tweet not found (possibly deleted): ${promptTweetId}`
              )
              error.type = 'twitter:forbidden'
              error.isFinal = true
              throw error
            }
          } catch (err) {
            const reason = err.toString()
            const reasonL = reason.toLowerCase()
            if (
              reasonL.includes('fetcherror') ||
              reasonL.includes('enotfound')
            ) {
              const error = new types.ChatError(err.toString())
              error.type = 'network'
              error.isFinal = false
              session.hasNetworkError = true
              throw error
            } else {
              const error = new types.ChatError(err.toString())
              error.type = 'twitter:forbidden'
              error.isFinal = true
              throw error
            }
          }

          const prevResult: types.ChatGPTInteraction = await keyv.get(
            promptTweetId
          )

          if (prevResult?.response) {
            result = {
              ...prevResult,
              ...result
            }

            console.log('resuming', {
              ...pick(
                mention,
                'id',
                'text',
                'prompt',
                'promptUrl',
                'isReply',
                'numFollowers',
                'priorityScore'
              ),
              ...pick(result, 'response', 'error', 'model')
            })
          } else {
            console.log(
              'processing',
              pick(
                mention,
                'id',
                'text',
                'prompt',
                'promptUrl',
                'isReply',
                'numFollowers',
                'priorityScore',
                'isGPT4'
              )
            )

            const promptModerationResult = await checkModeration(prompt)
            if (promptModerationResult.flagged) {
              const reason = Object.keys(promptModerationResult.categories)
                .filter((key) => promptModerationResult.categories[key])
                .join(', ')
              const error = new types.ChatError(
                `prompt flagged for moderation: ${reason}`
              )
              error.type = 'openai:prompt:moderation'
              error.isFinal = true
              result.isErrorFinal = true
              console.error(error.toString(), promptModerationResult)
              throw error
            }

            const repliedToTweetRef = mention.referenced_tweets?.find(
              (t) => t.type === 'replied_to'
            )
            const repliedToTweet = repliedToTweetRef
              ? batch.tweets[repliedToTweetRef.id]
              : null

            if (
              repliedToTweet &&
              repliedToTweet.author_id === twitterBotUserId
            ) {
              const prevInteraction: types.ChatGPTInteraction = await keyv.get(
                repliedToTweet.id
              )

              if (prevInteraction && !prevInteraction.error) {
                console.log('prevInteraction', prevInteraction)

                // prevInteraction.role should equal 'assistant'
                result.chatgptConversationId =
                  prevInteraction.chatgptConversationId
                result.chatgptParentMessageId = prevInteraction.chatgptMessageId
                result.chatgptAccountId = prevInteraction.chatgptAccountId
              }
            }

            const chatgptResponse = await getChatGPTResponse(prompt, {
              chatgpt,
              stripMentions: false,
              conversationId: result.chatgptConversationId,
              parentMessageId: result.chatgptParentMessageId,
              accountId: result.chatgptAccountId,
              model: result.model
            })

            // console.log('chatgptResponse', chatgptResponse)
            const response = chatgptResponse.response
            result.response = response
            result.chatgptConversationId = chatgptResponse.conversationId
            result.chatgptMessageId = chatgptResponse.messageId
            result.chatgptParentMessageId = chatgptResponse.parentMessageId
            result.chatgptAccountId = chatgptResponse.accountId

            const responseModerationResult = await checkModeration(response)
            if (responseModerationResult.flagged) {
              const reason = Object.keys(responseModerationResult.categories)
                .filter((key) => responseModerationResult.categories[key])
                .join(', ')
              const error = new types.ChatError(
                `response flagged for moderation: ${reason}`
              )
              error.type = 'openai:response:moderation'
              error.isFinal = true
              result.isErrorFinal = true
              console.error(error.toString(), responseModerationResult)
              throw error
            }
          }

          if (!result.responseMediaId) {
            // Render the response as an image
            const imageFilePath = await renderResponse({
              prompt,
              response: result.response,
              userImageUrl: promptUser?.profile_image_url,
              username: promptUsername,
              model: result.model !== 'gpt-3.5-turbo' ? result.model : undefined
            })

            console.log('prompt => image', {
              promptTweetId,
              prompt,
              imageFilePath,
              response: result.response,
              model: result.model
            })

            const mediaId = dryRun
              ? null
              : await twitterV1.uploadMedia(imageFilePath, {
                  type: 'jpg',
                  mimeType: 'image/jpeg',
                  target: 'tweet'
                })

            result.responseMediaId = mediaId

            // Cleanup
            await rmfr(imageFilePath)

            if (mediaId) {
              console.log('twitter media', mediaId)

              try {
                // TODO
                const text = markdownToText(result.response)
                  ?.trim()
                  .slice(0, 1000)
                  .trim()

                if (text) {
                  await twitterV1.createMediaMetadata(mediaId, {
                    alt_text: {
                      text
                    }
                  })
                }
              } catch (err) {
                console.warn(
                  'twitter error posting alt text for media',
                  mediaId,
                  err
                )
              }
            }
          }

          const tweet = await createTweet(
            {
              // text: '',
              media: {
                media_ids: [result.responseMediaId]
              },
              reply: {
                in_reply_to_tweet_id: promptTweetId
              }
            },
            { twitter, dryRun }
          )

          result.responseTweetIds = [tweet?.id].filter(Boolean)

          let responseLastTweetId: string
          if (result.responseTweetIds?.length) {
            responseLastTweetId =
              result.responseTweetIds[result.responseTweetIds.length - 1]

            result.responseUrl = getTweetUrl({
              username: twitterBotHandle.replace('@', ''),
              id: responseLastTweetId
            })
          }

          // Remove any previous error processing this request
          delete result.error

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
          let isFinal = !!err.isFinal || result.isErrorFinal

          if (err.name === 'TimeoutError') {
            if (!mention.numFollowers || mention.numFollowers < 4000) {
              // TODO: for now, we won't worry about trying to deal with retrying timeouts
              isFinal = true

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
                  `warning: twitter error responding to tweet after ${err.name}`,
                  err2.toString()
                )
              }
            }
          } else if (err instanceof types.ChatError) {
            if (err.type === 'twitter:auth') {
              // Reset twitter auth
              session.isExpiredAuthTwitter = true
            } else if (err.type === 'twitter:rate-limit') {
              session.isRateLimitedTwitter = true
            } else if (err.type === 'chatgpt:pool:timeout') {
              // Ignore because that account will be taken out of the pool and
              // put on cooldown
            } else if (err.type === 'chatgpt:pool:unavailable') {
              // Ignore because that account will be taken out of the pool and
              // put on cooldown
            } else if (err.type === 'chatgpt:pool:rate-limit') {
              // That account will be taken out of the pool and put on cooldown, but
              // for a hard 429, let's still rate limit ourselves to avoid IP bans.
              // session.isRateLimited = true
            } else if (err.type === 'chatgpt:pool:account-not-found') {
              console.error(err.toString())

              try {
                if (!dryRun) {
                  const tweet = await createTweet(
                    {
                      text: `Uh-oh ChatGPTBot ran into an unexpected error responding to your conversation. Sorry 😓\n\nRef: ${promptTweetId}`,
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
                  `warning: twitter error responding to tweet after ChatGPT account not found error`,
                  err2.toString()
                )
              }
            } else if (err.type === 'chatgpt:pool:account-on-cooldown') {
              console.error(err.toString())
            } else if (err.type === 'network') {
              session.hasNetworkError = true
            } else if (err.type === 'chatgpt:pool:no-accounts') {
              session.hasAllOpenAIAccountsExpired = true
            } else if (err.type === 'openai:response:moderation') {
              try {
                if (!dryRun) {
                  const tweet = await createTweet(
                    {
                      text: `Uh-oh ChatGPT's response may have violated OpenAI's policies. ${err.toString()}\n\nRef: ${promptTweetId}`,
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
                  `warning: twitter error responding to tweet after ${err.type} error`,
                  err2.toString()
                )
              }
            } else if (err.type === 'openai:prompt:moderation') {
              try {
                if (!dryRun) {
                  const tweet = await createTweet(
                    {
                      text: `Uh-oh your tweet may violate OpenAI's policies. ${err.toString()}\n\nRef: ${promptTweetId}`,
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
                  `warning: twitter error responding to tweet after ${err.type} error`,
                  err2.toString()
                )
              }
            }
          } else if (
            err.toString().toLowerCase() === 'error: ChatGPT error 429'
          ) {
            console.log('\nchatgpt rate limit\n')
            session.isRateLimited = true
          } else if (
            err.toString().toLowerCase() === 'error: ChatGPT error 503' ||
            err.toString().toLowerCase() === 'error: ChatGPT error 502'
          ) {
            if (!mention.numFollowers || mention.numFollowers < 4000) {
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
          } else {
            console.error('unknown error', err)
          }

          if (err.accountId) {
            result.chatgptAccountId = err.accountId
          }

          result.error = err.toString() || 'unknown error'
          if (/error creating tweet: 400/i.test(result.error)) {
            isFinal = true
          }

          result.isErrorFinal = !!isFinal

          console.log('interaction error', result)
          console.log()

          if (enableRedis && !dryRun) {
            // Store errors so we don't try to re-process them
            await keyv.set(promptTweetId, { ...result, role: 'user' })
          }

          return result
        }
      },
      {
        concurrency: 2
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
    // Rollback to the earliest tweet which wasn't processed successfully
    batch.sinceMentionId = minTwitterId(
      batch.minSinceMentionId,
      batch.sinceMentionId
    )
  }

  session.interactions = results
  session.sinceMentionId = batch.sinceMentionId

  return session
}
