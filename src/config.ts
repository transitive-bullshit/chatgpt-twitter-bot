import path from 'node:path'

import Conf from 'conf'
import dotenv from 'dotenv-safe'

import * as types from './types'

dotenv.config()

export const twitterBotHandle = '@ChatGPTBot'
export const twitterBotHandleL = twitterBotHandle.toLowerCase()
export const twitterBotUserId = '1598922281434103808'

export const cacheDir = 'out'
export const getTwitterUserMentionsCachePathForUserById = ({
  userId
}: {
  userId: string
}) => path.join(cacheDir, `twitter-mentions-${userId}.json`)

export const defaultMaxNumMentionsToProcessPerBatch = 10

// tweets that try to break the bot...
export const tweetIgnoreList = new Set([
  '1599344387401863174',
  '1604326985416613888',
  '1643945307095420930',
  '1645615915088896000'
])

// ignore known bots; we don't want them endlessly replying to each other
export const twitterUsersIgnoreList = new Set([
  '1506967793409065000', // ReplyGPT
  '1607692579243687936' // ChatSonicAI
])

// Used by the author(s) for faster testing and feedback
export const priorityUsersList = new Set([
  '327034465', // transitive_bs
  '1235525929335689217', // LofiGrind (my test acct)
  '1598922281434103808' // ChatGPTBot
])

// Optional redis instance for persisting responses
export const enableRedis = true
export const redisHost = process.env.REDIS_HOST
export const redisPassword = process.env.REDIS_PASSWORD
export const redisUser = process.env.REDIS_USER || 'default'
export const redisNamespace = process.env.REDIS_NAMESPACE || 'chatgpt'
export const redisNamespaceDMs =
  process.env.REDIS_NAMESPACE_DMS || 'chatgpt-dms'
export const redisNamespaceMessages =
  process.env.REDIS_NAMESPACE_MESSAGES || 'chatgpt-messages'
export const redisUrl =
  process.env.REDIS_URL || `redis://${redisUser}:${redisPassword}@${redisHost}`

export default new Conf<types.Config>({
  defaults: {
    refreshToken: process.env.TWITTER_OAUTH_REFRESH_TOKEN,
    accessToken: process.env.TWITTER_OAUTH_ACCESS_TOKEN
  }
})
