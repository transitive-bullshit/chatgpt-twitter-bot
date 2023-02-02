import KeyvRedis from '@keyv/redis'
import { type Redis } from 'ioredis'
import Keyv from 'keyv'

import * as config from './config'

let redis: Redis
let keyv: Keyv
let dms: Keyv
let messageStore: Keyv

if (config.enableRedis) {
  const store = new KeyvRedis(config.redisUrl)
  redis = store.redis as Redis

  keyv = new Keyv({ store, namespace: config.redisNamespace })
  messageStore = new Keyv({ store, namespace: config.redisNamespaceMessages })
  // dms = new Keyv({ store, namespace: config.redisNamespaceDMs })
} else {
  keyv = new Keyv({ namespace: config.redisNamespace })
  messageStore = new Keyv({ namespace: config.redisNamespaceMessages })
  // dms = new Keyv({ namespace: config.redisNamespaceDMs })
}

export { keyv, dms, messageStore, redis }
