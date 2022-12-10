import KeyvRedis from '@keyv/redis'
import Keyv from 'keyv'

import * as config from './config'

let keyv: Keyv
let dms: Keyv

if (config.enableRedis) {
  const redis = new KeyvRedis(config.redisUrl)

  keyv = new Keyv({ store: redis, namespace: config.redisNamespace })
  dms = new Keyv({ store: redis, namespace: config.redisNamespaceDMs })
} else {
  keyv = new Keyv({ namespace: config.redisNamespace })
  dms = new Keyv({ namespace: config.redisNamespaceDMs })
}

export { keyv, dms }
