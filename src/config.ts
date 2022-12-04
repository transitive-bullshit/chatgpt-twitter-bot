import Conf from 'conf'
import dotenv from 'dotenv-safe'

import * as types from './types'

dotenv.config()

export const twitterBotHandle = '@ChatGPTBot'
export const twitterBotHandleL = twitterBotHandle.toLowerCase()

export const languageAllowList = new Set(['eng', 'sco', 'spa', 'deu'])

export const languageDisallowList = new Set([
  'jpn',
  'cmn',
  'zho',
  'cth',
  'yue',
  'nan',
  'nod',
  'sou',
  'tha',
  'vie'
])

// Optional redis instance for persisting responses
export const enableRedis = true
export const redisHost = process.env.REDIS_HOST
export const redisPassword = process.env.REDIS_PASSWORD
export const redisUser = process.env.REDIS_USER || 'default'
export const redisNamespace = process.env.REDIS_NAMESPACE || 'chatgpt'
export const redisUrl =
  process.env.REDIS_URL || `redis://${redisUser}:${redisPassword}@${redisHost}`

export default new Conf<types.Config>({
  defaults: { refreshToken: process.env.TWITTER_OAUTH_REFRESH_TOKEN }
})
