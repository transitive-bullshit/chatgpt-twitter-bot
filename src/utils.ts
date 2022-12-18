import type { ChatGPTAPIBrowser, ChatResponse } from 'chatgpt'
import winkNLPModel from 'wink-eng-lite-web-model'
import winkNLP from 'wink-nlp'

import * as types from './types'
import { ChatGPTAPIPool } from './chatgpt-api-pool'

const nlp = winkNLP(winkNLPModel)

/**
 * Asks ChatGPT for a response to a prompt
 */
export async function getChatGPTResponse(
  prompt: string,
  {
    chatgpt,
    conversationId,
    parentMessageId,
    chatgptAccountId,
    stripMentions = false,
    timeoutMs = 3 * 60 * 1000 // 3 minutes
  }: {
    chatgpt: ChatGPTAPIBrowser
    conversationId?: string
    parentMessageId?: string
    chatgptAccountId?: string
    stripMentions?: boolean
    timeoutMs?: number
  }
): Promise<types.ChatGPTResponse> {
  let response: string
  let messageId: string
  let accountId: string

  do {
    const origConversationId = conversationId

    const onProgress = (partialResponse: ChatResponse) => {
      response = partialResponse?.response
    }

    try {
      console.log('chatgpt.sendMessage', prompt, {
        conversationId,
        parentMessageId
      })

      if (chatgpt instanceof ChatGPTAPIPool) {
        const res = await chatgpt.sendMessageToAccount(prompt, {
          timeoutMs,
          conversationId,
          parentMessageId,
          accountId: chatgptAccountId,
          onProgress
        })

        accountId = res.accountId
        response = res.response
        conversationId = res.conversationId
        messageId = res.messageId
      } else {
        const res = await chatgpt.sendMessage(prompt, {
          timeoutMs,
          conversationId,
          parentMessageId,
          onProgress
        })

        response = res.response
        conversationId = res.conversationId
        messageId = res.messageId
      }

      break
    } catch (err: any) {
      console.error('ChatGPT error', {
        prompt,
        error: err,
        response,
        conversationId,
        messageId
      })

      if (
        (response &&
          err.toString().toLowerCase() === 'error: typeerror: terminated') ||
        err.toString().toLowerCase() === 'typeerror: terminated'
      ) {
        console.warn('using potentially partial response')
        break
      }

      if (
        (err.toString().toLowerCase() === 'error: chatgptapi error 404' ||
          err.type === 'chatgpt:pool:account-not-found' ||
          err.statusCode === 404) &&
        origConversationId
      ) {
        // This can happen if we're accidentally trying to use a different
        // OpenAI account to respond to an existing conversation.. so we punt
        // and erase the conversation context and retry
        conversationId = undefined
        parentMessageId = undefined
        continue
      }

      throw err
    }
  } while (true)

  response = response?.trim()
  if (stripMentions) {
    response = stripAtMentions(response)?.trim()
  }

  if (!response) {
    throw new Error(`ChatGPT received an empty response`)
  }

  return {
    response,
    messageId,
    conversationId,
    accountId
  }
}

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
    let sentences = doc.sentences().out()
    for (let i = 0; i < sentences.length - 1; ++i) {
      const s0 = sentences[i]
      const s1 = sentences[i + 1]
      if (s0.endsWith('.') && /^(js|ts|jsx|tsx)\b/.test(s1)) {
        sentences[0] = `${s0}${s1}`
        sentences.splice(i + 1, 1)
      }
    }
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
  // console.log(tweetDrafts.length, JSON.stringify(tweetDrafts, null, 2))

  const tweets = tweetDrafts.map((draft, index) => {
    if (tweetDrafts.length > 1) {
      return `${index + 1}/${tweetDrafts.length} ${draft}`
    } else {
      return draft
    }
  })

  return tweets
}

function stripAtMentions(text?: string) {
  return text?.replaceAll(/\b\@([a-zA-Z0-9_]+\b)/g, '$1')
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

export function getTweetUrl({
  username,
  id
}: {
  username?: string
  id?: string
}): string {
  if (username && id) {
    return `https://twitter.com/${username}/status/${id}`
  }
}
