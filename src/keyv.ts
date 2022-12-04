import KeyvRedis from '@keyv/redis'
import Keyv from 'keyv'

import * as config from './config'

let keyv: Keyv
if (config.enableRedis) {
  const redis = new KeyvRedis(config.redisUrl)

  keyv = new Keyv({ store: redis, namespace: config.redisNamespace })
} else {
  keyv = new Keyv({ namespace: config.redisNamespace })
}

export { keyv }
