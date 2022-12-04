import { ChatGPTAPI } from 'chatgpt'
import Conf from 'conf'
import dotenv from 'dotenv-safe'
import pMap from 'p-map'
import { Client, auth } from 'twitter-api-sdk'

import * as types from './types'
import { createTweet } from './twitter'
import { getTweetsFromResponse } from './utils'

dotenv.config()

export const config = new Conf<types.Config>({
  defaults: { refreshToken: process.env.TWITTER_OAUTH_REFRESH_TOKEN }
})

async function main() {
  const refreshToken = config.get('refreshToken')
  const authToken = refreshToken ? { refresh_token: refreshToken } : undefined
  const authClient = new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    callback: 'http://127.0.0.1:3000/callback',
    scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
    token: authToken
  })

  console.log('refreshing access token')
  const { token } = await authClient.refreshAccessToken()
  config.set('refreshToken', token.refresh_token)
  // console.debug(token)

  const twitter = new Client(authClient)
  const { data: user } = await twitter.users.findMyUser()
  if (!user?.id) {
    throw new Error('twitter error unable to fetch current user')
  }

  const chatgpt = new ChatGPTAPI({
    markdown: false // TODO
  })
  await chatgpt.init({ auth: 'blocking' })

  config.delete('sinceMentionId') // TODO

  let sinceMentionId = config.get('sinceMentionId')

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

  console.log('get tweet mentions')
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
    max_results: 100,
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

  console.log('tweet mentions', mentions.length)
  const results = (
    await pMap(
      mentions,
      async (mention): Promise<types.ChatGPTResponse> => {
        const { text } = mention
        const prompt = text.replace(/@ChatGPTBot/g, '').trim()
        if (!prompt) {
          return { promptTweetId: mention.id, prompt, error: 'invalid tweet' }
        }

        try {
          let response: string

          try {
            // response = await chatgpt.sendMessage(prompt)
            response =
              "Well, you know, the Dude, he's, uh, he's one to talk about the meaning of life, man. I mean, he's one to philosophize, you know? But, like, you know, when it comes down to it, man, it's all just, like, you know, your own personal opinion, man. I mean, like, you know, some people say it's to seek happiness and fulfillment, you know, to find love and meaning in the things you do, to make the world a better place, you know? But, like, the Dude, he's just out there, you know, taking it easy, enjoying the ride, you know? So, I guess, you know, the meaning of life, it's just, like, whatever you want it to be, man."

            // response = 'Jazz is a genre of music that originated in the African American communities of the United States in the late 19th and early 20th centuries. It is a complex and diverse style of music that incorporates elements of blues, ragtime, and European harmony, among other influences. Jazz is known for its improvisational nature, where musicians often play off of each other and create melodies and solos in real-time. This spontaneity and creativity is part of what makes jazz so appealing to many people. Additionally, jazz has a rich history and cultural significance, with many famous and influential musicians, such as Louis Armstrong and Miles Davis, helping to shape the genre and make it what it is today.\n\nThis is a test.'
          } catch (err: any) {
            console.error('ChatGPT error', {
              tweet: mention,
              error: err
            })

            return {
              promptTweetId: mention.id,
              prompt,
              error: `ChatGPT error: ${err.toString()}`
            }
          }

          response = response?.trim()
          if (!response) {
            return {
              promptTweetId: mention.id,
              prompt,
              error: `ChatGPT received an empty response`
            }
          }

          // convert the response to tweet-sized chunks
          const tweetTexts = getTweetsFromResponse(response)

          console.log('prompt', prompt, '=>', tweetTexts)
          console.log(JSON.stringify(tweetTexts, null, 2))

          let prevTweet = mention
          const tweets = (
            await pMap(
              tweetTexts,
              async (text) => {
                try {
                  const reply = prevTweet?.id
                    ? {
                        in_reply_to_tweet_id: prevTweet.id
                      }
                    : undefined

                  const res = await createTweet(
                    {
                      text,
                      reply
                    },
                    twitter
                  )

                  const tweet = res.data

                  if (tweet?.id) {
                    prevTweet = tweet

                    console.log(
                      'tweet response',
                      JSON.stringify(tweet, null, 2)
                    )

                    return tweet
                  } else {
                    console.error('unknown error creating tweet', res, { text })
                    return null
                  }
                } catch (err) {
                  console.error(
                    'error creating tweet',
                    JSON.stringify(err, null, 2)
                  )
                  return null
                }
              },
              {
                // This has to be set to 1 because each tweet in the thread replies
                // the to tweet before it
                concurrency: 1
              }
            )
          ).filter(Boolean)

          return {
            promptTweetId: mention.id,
            prompt,
            response,
            responseTweetIds: tweets.map((tweet) => tweet.id)
          }
        } catch (err: any) {
          console.error('response error', {
            tweet: mention,
            error: err
          })

          return {
            promptTweetId: mention.id,
            prompt,
            error: `Response error: ${err.toString()}`
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

  await chatgpt.close()

  return results
}

main()
  .then((res) => {
    console.log(res)
  })
  .catch((err) => {
    console.error('error', JSON.stringify(err, null, 2))
  })
