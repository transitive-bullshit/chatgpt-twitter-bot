import Conf from 'conf'
import dotenv from 'dotenv-safe'

import * as types from './types'

dotenv.config()

export const twitterBotHandle = '@ChatGPTBot'
export const twitterBotHandleL = twitterBotHandle.toLowerCase()

export const tweetIgnoreList = new Set(['1599344387401863174'])

export const priorityUsersList = new Set([
  '327034465', // transitive_bs
  '1235525929335689217', // LofiGrind (my test acct)
  '1598922281434103808' // ChatGPTBot
])

export const languageAllowList = new Set([
  'eng',
  'sco',
  'spa',
  'deu',
  'nno',
  'fra',
  'nld',
  'dan',
  'lun',
  'afr',
  'arb',
  'bcl',
  'som',
  'sot',
  'prs',
  'swe',
  'ckb',
  'nds',
  'hat',
  'sna',
  'snk',
  'pam',
  'ita',
  'nso',
  'vec',
  'bum',
  'ron',
  'lit',
  'fuv',
  'rmn',
  'por',
  'tzm'
])

// These languages are only disallowed if tweetMode is `thread` since the current
// logic to split responses up into tweets relies on Western sentence structure.
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
