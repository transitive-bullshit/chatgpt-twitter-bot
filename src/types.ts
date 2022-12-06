import { type Client as TwitterClient } from 'twitter-api-sdk'
import { TwitterApiv1 } from 'twitter-api-v2'
import { type AsyncReturnType } from 'type-fest'

export { TwitterClient }
export { TwitterApiv1 as TwitterClientV1 }

export interface Config {
  refreshToken?: string
  sinceMentionId?: string
}

export interface ChatGPTInteraction {
  prompt: string
  promptTweetId: string
  promptUserId: string
  promptUsername: string
  promptUrl?: string

  response?: string
  responseTweetIds?: string[]

  error?: string
  isErrorFinal?: boolean
}

export interface ChatGPTSession {
  interactions: ChatGPTInteraction[]
  isRateLimited: boolean
  isRateLimitedTwitter: boolean
  isExpiredAuth: boolean
  isExpiredAuthTwitter: boolean
  sinceMentionId?: string
}

export type Tweet = AsyncReturnType<
  TwitterClient['tweets']['findTweetsById']
>['data']
export type TwitterUser = AsyncReturnType<
  TwitterClient['users']['findMyUser']
>['data']
export type CreatedTweet = AsyncReturnType<
  TwitterClient['tweets']['createTweet']
>['data']

export type ChatErrorType =
  | 'unknown'
  | 'timeout'
  | 'twitter:auth'
  | 'twitter:duplicate'
  | 'twitter:rate-limit'

export class ChatError extends Error {
  isFinal: boolean = false
  type?: ChatErrorType = 'unknown'
}

export type TweetMode = 'image' | 'thread'
