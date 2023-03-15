import fs from 'node:fs/promises'

import type { ChatGPTAPI, ChatMessage } from 'chatgpt'
import fastJsonStableStringify from 'fast-json-stable-stringify'
import pMemoize from 'p-memoize'
import QuickLRU from 'quick-lru'
import { remark } from 'remark'
import stripMarkdown from 'strip-markdown'

import * as types from './types'
import { ChatGPTUnofficialProxyAPIPool } from './chatgpt-proxy-api-pool'

const chatgptMessageCache = new QuickLRU<string, ChatMessage>({
  maxSize: 10000
})

const sendChatGPTMessage = pMemoize(sendChatGPTMessageImpl, {
  cache: chatgptMessageCache,
  cacheKey: (args) => fastJsonStableStringify(args[0])
})

async function sendChatGPTMessageImpl(
  {
    prompt,
    timeoutMs,
    conversationId,
    parentMessageId,
    model
  }: {
    prompt: string
    conversationId?: string
    parentMessageId?: string
    timeoutMs?: number
    model?: string
  },
  {
    chatgpt
  }: {
    chatgpt: ChatGPTAPI
  }
) {
  return chatgpt.sendMessage(prompt, {
    timeoutMs,
    // conversationId,
    parentMessageId,
    completionParams: model
      ? {
          model
        }
      : undefined
  })
}

/**
 * Asks ChatGPT for a response to a prompt
 */
export async function getChatGPTResponse(
  prompt: string,
  {
    chatgpt,
    conversationId,
    parentMessageId,
    accountId,
    stripMentions = false,
    timeoutMs = 3 * 60 * 1000, // 3 minutes
    model
  }: {
    chatgpt: ChatGPTAPI
    conversationId?: string
    parentMessageId?: string
    accountId?: string
    stripMentions?: boolean
    timeoutMs?: number
    model?: string
  }
): Promise<types.ChatGPTResponse> {
  let response: string
  let messageId: string

  const isChatGPTAccountPool = chatgpt instanceof ChatGPTUnofficialProxyAPIPool

  try {
    console.log('chatgpt.sendMessage', prompt, {
      conversationId,
      parentMessageId,
      accountId
    })

    if (isChatGPTAccountPool) {
      if (parentMessageId?.startsWith('cmpl')) {
        conversationId = undefined
        parentMessageId = undefined
        accountId = undefined
      }

      const res = await chatgpt.sendMessageToAccount(prompt, {
        timeoutMs,
        conversationId,
        parentMessageId,
        accountId
        // model // TODO
      })

      response = res.text
      conversationId = res.conversationId
      messageId = res.id
      parentMessageId = res.parentMessageId
      accountId = res.accountId
    } else {
      // TODO: random personalities encoded as accountId...
      // const promptPrefix = `You are ChatGPT, a large language model trained by OpenAI. You answer concisely and creatively to tweets on twitter. You are eager to please, friendly, enthusiastic, and very passionate. You like to use emoji, but not for lists. If you are generating a list, do not have too many items. Keep the number of items short.`

      if (!parentMessageId?.startsWith('chatcmpl')) {
        conversationId = undefined
        parentMessageId = undefined
        accountId = undefined
      }

      const res = await sendChatGPTMessage(
        {
          prompt,
          timeoutMs,
          conversationId,
          parentMessageId,
          model
        },
        {
          chatgpt
        }
      )

      response = res.text
      conversationId = res.conversationId
      messageId = res.id
      parentMessageId = res.parentMessageId
    }
  } catch (err: any) {
    console.error('ChatGPT error', {
      prompt,
      error: err,
      response,
      conversationId,
      messageId,
      accountId,
      model
    })
    throw err
  }

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
    parentMessageId,
    accountId
  }
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

export async function saveJsonFile(
  filePath: string,
  json: any,
  { pretty = true }: { pretty?: boolean } = {}
) {
  return fs.writeFile(
    filePath,
    pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json),
    'utf-8'
  )
}

export function markdownToText(markdown?: string): string {
  return remark()
    .use(stripMarkdown)
    .processSync(markdown ?? '')
    .toString()
}
