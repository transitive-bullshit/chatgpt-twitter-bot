import { type Role } from 'chatgpt'
import { type Client as TwitterClient } from 'twitter-api-sdk'
import {
  type DirectMessageCreateV1, // type UserV1 as TwitterUserV1,
  type TwitterApiv1
} from 'twitter-api-v2'
import { type AsyncReturnType } from 'type-fest'

export { TwitterClient }
export { TwitterApiv1 as TwitterClientV1 }
export { DirectMessageCreateV1 as TwitterDMV1 }

export interface Config {
  accessToken?: string
  refreshToken?: string
  sinceMentionId?: string
}

export type ChatGPTInteractionType = 'tweet' | 'dm'

export interface ChatGPTInteraction {
  role?: Role
  type?: ChatGPTInteractionType

  prompt: string
  promptTweetId: string
  promptUserId: string
  promptUsername: string
  promptUrl?: string
  promptLikes?: number
  promptRetweets?: number
  promptReplies?: number
  promptDate?: string
  promptLanguage?: string
  promptLanguageScore?: number

  response?: string
  responseTweetIds?: string[]
  responseMediaId?: string
  responseUrl?: string
  responseLikes?: number
  responseRetweets?: number
  responseReplies?: number
  responseDate?: string

  chatgptConversationId?: string
  chatgptParentMessageId?: string
  chatgptMessageId?: string
  chatgptAccountId?: string
  model?: string

  error?: string
  isErrorFinal?: boolean

  priorityScore?: number
  numFollowers?: number
  isReply?: boolean
}

export interface ChatGPTSession {
  interactions: ChatGPTInteraction[]
  isRateLimited: boolean
  isRateLimitedTwitter: boolean
  isExpiredAuth: boolean
  isExpiredAuthTwitter: boolean
  sinceMentionId?: string
  hasAllOpenAIAccountsExpired?: boolean
  hasNetworkError: boolean
}

export interface ChatGPTResponse {
  response: string
  conversationId?: string
  messageId?: string
  parentMessageId?: string
  accountId?: string
}

type Unpacked<T> = T extends (infer U)[] ? U : T

export type Tweet = Unpacked<
  AsyncReturnType<TwitterClient['tweets']['findTweetsById']>['data']
>
export type TwitterUser = AsyncReturnType<
  TwitterClient['users']['findMyUser']
>['data']
export type CreatedTweet = AsyncReturnType<
  TwitterClient['tweets']['createTweet']
>['data']

export type TweetsQueryOptions = Pick<
  Parameters<TwitterClient['tweets']['findTweetsById']>[0],
  'expansions' | 'tweet.fields' | 'user.fields'
>

export type TwitterUserIdMentionsQueryOptions = Parameters<
  TwitterClient['tweets']['usersIdMentions']
>[1]

export type TweetMention = Partial<Tweet> & {
  prompt?: string
  numMentions?: number
  priorityScore?: number
  numFollowers?: number
  promptUrl?: string
  isReply?: boolean
  isGPT4?: boolean
}

export type TweetMentionBatch = {
  mentions: TweetMention[]
  users: Record<string, Partial<TwitterUser>>
  tweets: Record<string, TweetMention>
  minSinceMentionId: string
  sinceMentionId: string
  numMentionsPostponed: number
}

export type TweetMentionResult = {
  mentions: TweetMention[]
  users: Record<string, Partial<TwitterUser>>
  tweets: Record<string, TweetMention>
  sinceMentionId: string
}

export type ChatErrorType =
  | 'unknown'
  | 'timeout'
  | 'network'
  | 'twitter:auth'
  | 'twitter:forbidden'
  | 'twitter:rate-limit'
  | 'chatgpt:pool:timeout'
  | 'chatgpt:pool:rate-limit'
  | 'chatgpt:pool:unavailable'
  | 'chatgpt:pool:account-not-found'
  | 'chatgpt:pool:account-on-cooldown'
  | 'chatgpt:pool:no-accounts'
  | 'openai:prompt:moderation'
  | 'openai:response:moderation'

export class ChatError extends Error {
  isFinal: boolean = false
  type?: ChatErrorType = 'unknown'
  accountId?: string
  statusCode?: number
  statusText?: string
}

export type GetAccessTokenFn = ({
  email,
  password,
  sessionToken
}: {
  email: string
  password: string
  sessionToken?: string
}) => string | Promise<string>
