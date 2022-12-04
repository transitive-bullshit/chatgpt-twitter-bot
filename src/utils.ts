import { type ChatGPTAPI } from 'chatgpt'
import pMap from 'p-map'
import winkNLPModel from 'wink-eng-lite-web-model'
import winkNLP from 'wink-nlp'

import * as types from './types'
import { createTweet } from './twitter'

const nlp = winkNLP(winkNLPModel)

/**
 * Converts a ChatGPT response string to an array of tweet-sized strings.
 */
export function getTweetsFromResponse(response: string): string[] {
  const paragraphs = response
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)

  // const sentences = paragraphs.map((p) => p.sentences().out())
  let tweetDrafts = []
  const maxTweetLength = 250
  let currentTweet = ''

  for (const paragraph of paragraphs) {
    const doc = nlp.readDoc(paragraph)
    const sentences = doc.sentences().out()
    // console.log(JSON.stringify(sentences, null, 2))

    for (let sentence of sentences) {
      do {
        if (currentTweet.length > 200) {
          tweetDrafts.push(currentTweet)
          currentTweet = ''
        }

        const tweet = currentTweet ? `${currentTweet}\n\n${sentence}` : sentence

        if (tweet.length > maxTweetLength) {
          const tokens = sentence.split(' ')
          let partialTweet = currentTweet ? `${currentTweet}\n\n` : ''
          let partialNextSentence = ''
          let isNext = false

          for (const token of tokens) {
            const temp = `${partialTweet}${token} `
            if (!isNext && temp.length < maxTweetLength) {
              partialTweet = temp
            } else {
              isNext = true
              partialNextSentence = `${partialNextSentence}${token} `
            }
          }

          if (partialTweet.length > maxTweetLength) {
            console.error(
              'error: unexptected tweet length too long',
              partialTweet
            )
          }

          tweetDrafts.push(partialTweet.trim() + '...')
          currentTweet = ''
          sentence = partialNextSentence
        } else {
          currentTweet = tweet.trim()
          break
        }
      } while (sentence.trim().length)
    }
  }

  if (currentTweet) {
    tweetDrafts.push(currentTweet.trim())
    currentTweet = null
  }

  tweetDrafts = tweetDrafts.map((t) => t.trim()).filter(Boolean)
  console.log(tweetDrafts.length, JSON.stringify(tweetDrafts, null, 2))

  const tweets = tweetDrafts.map((draft, index) => {
    if (tweetDrafts.length > 1) {
      return `${index + 1}/${tweetDrafts.length} ${draft}`
    } else {
      return draft
    }
  })

  return tweets
}

/**
 * Asks ChatGPT for a response to a prompt
 */
export async function getChatGPTResponse(
  prompt: string,
  {
    chatgpt
  }: {
    chatgpt: ChatGPTAPI
  }
): Promise<string> {
  let response: string

  try {
    response = await chatgpt.sendMessage(prompt)
  } catch (err: any) {
    console.error('ChatGPT error', {
      tweet: prompt,
      error: err
    })

    throw new Error(`ChatGPT error: ${err.toString()}`)
  }

  response = response?.trim()
  if (!response) {
    throw new Error(`ChatGPT received an empty response`)
  }

  return response
}

/**
 * Tweets each tweet in the response thread serially one after the other.
 */
export async function createTwitterThreadForChatGPTResponse({
  mention,
  tweetTexts,
  twitter
}: {
  mention?: any
  tweetTexts: string[]
  twitter?: types.TwitterClient
}): Promise<types.CreatedTweet[]> {
  let prevTweet = mention

  const tweets = (
    await pMap(
      tweetTexts,
      async (text): Promise<types.CreatedTweet> => {
        try {
          const reply = prevTweet?.id
            ? {
                in_reply_to_tweet_id: prevTweet.id
              }
            : undefined

          // Note: this call is rate-limited on our side
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

            console.log('tweet response', JSON.stringify(tweet, null, 2))

            return tweet
          } else {
            console.error('unknown error creating tweet', res, { text })
            return null
          }
        } catch (err) {
          console.error('error creating tweet', JSON.stringify(err, null, 2))

          if (err.status === 403) {
            const error = new types.ChatError(
              err.error?.detail || `error creating tweet: 403 forbidden`
            )
            error.isFinal = true
            throw error
          }

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

  return tweets
}

export function pick<T extends object>(obj: T, ...keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => key in obj).map((key) => [key, obj[key]])
  ) as T
}

export function omit<T extends object>(obj: T, ...keys: string[]) {
  return Object.fromEntries<T>(
    Object.entries(obj).filter(([key]) => !keys.includes(key))
  ) as T
}
