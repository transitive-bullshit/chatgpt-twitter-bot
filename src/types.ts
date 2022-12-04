import { type Client } from 'twitter-api-sdk'
import { type AsyncReturnType } from 'type-fest'

export { Client as TwitterClient }

export interface Config {
  refreshToken?: string
  sinceMentionId?: string
}

export interface ChatGPTInteraction {
  promptTweetId: string
  prompt: string
  response?: string
  responseTweetIds?: string[]
  error?: string
  isErrorFinal?: boolean
}

export interface ChatGPTSession {
  interactions: ChatGPTInteraction[]
  isRateLimited: boolean
  isExpiredAuth: boolean
}

export type Tweet = AsyncReturnType<Client['tweets']['findTweetsById']>['data']
export type TwitterUser = AsyncReturnType<Client['users']['findMyUser']>['data']
export type CreatedTweet = AsyncReturnType<
  Client['tweets']['createTweet']
>['data']

export class ChatError extends Error {
  isFinal: boolean = false
}
