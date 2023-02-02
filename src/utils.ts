import fs from 'node:fs/promises'

import type { ChatGPTAPI, ChatMessage } from 'chatgpt'
import { remark } from 'remark'
import stripMarkdown from 'strip-markdown'

import * as types from './types'

/**
 * Asks ChatGPT for a response to a prompt
 */
export async function getChatGPTResponse(
  prompt: string,
  {
    chatgpt,
    conversationId,
    parentMessageId,
    stripMentions = false,
    timeoutMs = 3 * 60 * 1000 // 3 minutes
  }: {
    chatgpt: ChatGPTAPI
    conversationId?: string
    parentMessageId?: string
    stripMentions?: boolean
    timeoutMs?: number
  }
): Promise<types.ChatGPTResponse> {
  let response: string
  let messageId: string

  try {
    console.log('chatgpt.sendMessage', prompt, {
      conversationId,
      parentMessageId
    })

    const res = await chatgpt.sendMessage(prompt, {
      timeoutMs,
      conversationId,
      parentMessageId
    })

    response = res.text
    conversationId = res.conversationId
    messageId = res.id
    parentMessageId = res.parentMessageId
  } catch (err: any) {
    console.error('ChatGPT error', {
      prompt,
      error: err,
      response,
      conversationId,
      messageId
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
    parentMessageId
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

export async function saveJsonFile(filePath: string, json: any) {
  return fs.writeFile(filePath, JSON.stringify(json, null, 2), 'utf-8')
}

export function markdownToText(markdown?: string): string {
  return remark()
    .use(stripMarkdown)
    .processSync(markdown ?? '')
    .toString()
}
