import fs from 'node:fs/promises'

import delay from 'delay'
import mkdir from 'mkdirp'
import pMap from 'p-map'
import BTree from 'sorted-btree'

import * as config from './config'
import * as types from './types'
import { maxTwitterId, tweetIdComparator } from './twitter'

/**
 * NOTE: Twitter's API restricts the number of tweets we can fetch from their
 * API, so constantly fetching the same set of mentions over and over as we poll
 * for new mentions is both really inefficient and was going to quickly lead to
 * us going over Twitter's quota.
 *
 * So we're using a cache of Twitter mentions by User ID, stored in a sorted
 * B-Tree and persisted to disk.
 *
 * This drastically reduces the number of tweets we need to fetch from Twitter
 * without complicating things too much.
 */

// NOTE: the BTree imports are wonky, so this is a hacky workaround
const BTreeClass = (BTree as any).default as typeof BTree

type TwitterUserIdMentionsCache = Record<string, TwitterUserMentionsCache>

let globalUserIdMentionsCache: TwitterUserIdMentionsCache = {}

export async function loadUserMentionCacheFromDiskByUserId({
  userId
}: {
  userId: string
}) {
  const cache = await TwitterUserMentionsCache.loadFromDisk({ userId })
  if (cache) {
    globalUserIdMentionsCache[userId] = cache
  }
}

export async function saveAllUserMentionCachesToDisk() {
  return pMap(
    Object.keys(globalUserIdMentionsCache),
    async (userId) => {
      const cache = globalUserIdMentionsCache[userId]
      return cache.saveToDisk()
    },
    {
      concurrency: 2
    }
  )
}

export class TwitterUserMentionsCache {
  userId: string

  mentions: BTree<string, types.TweetMention> = new BTreeClass(
    undefined,
    tweetIdComparator
  )
  users: Record<string, Partial<types.TwitterUser>> = {}
  tweets: Record<string, types.TweetMention> = {}

  constructor({ userId }: { userId: string }) {
    this.userId = userId
  }

  get minTweetId(): string {
    return this.mentions.minKey()
  }

  get maxTweetId(): string {
    return this.mentions.maxKey()
  }

  addResult(result: types.TweetMentionResult) {
    this.users = {
      ...this.users,
      ...result.users
    }

    this.tweets = {
      ...this.tweets,
      ...result.tweets
    }

    this.mentions.setPairs(
      result.mentions.map((mention) => [mention.id, mention])
    )
  }

  getUserMentionsSince(sinceId: string) {
    const result: types.TweetMentionResult = {
      mentions: [],
      users: {},
      tweets: {},
      sinceMentionId: sinceId
    }

    const minPair = this.mentions.getPairOrNextHigher(sinceId)
    if (minPair) {
      const minKey = minPair[0]
      const maxKey = this.maxTweetId

      result.mentions = this.mentions
        .getRange(minKey, maxKey, true)
        .map((pair) => pair[1])

      result.sinceMentionId = maxKey
    }

    result.users = { ...this.users }
    result.tweets = { ...this.tweets }

    return result
  }

  async saveToDisk() {
    const filePath = config.getTwitterUserMentionsCachePathForUserById({
      userId: this.userId
    })

    try {
      await mkdir(config.cacheDir)
      const result: any = this.getUserMentionsSince(this.minTweetId)
      result.userId = this.userId
      result.minTweetId = this.minTweetId
      result.maxTweetId = this.maxTweetId

      await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8')
    } catch (err) {
      // ignore error with warning (cache may not exist yet)
      console.warn(
        `warning failed to save TwitterUsersMentionCache to disk (${filePath})`,
        err
      )
    }
  }

  static async loadFromDisk({ userId }: { userId: string }) {
    const filePath = config.getTwitterUserMentionsCachePathForUserById({
      userId
    })

    try {
      const data = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(data)

      const cache = new TwitterUserMentionsCache({ userId })
      cache.addResult(parsed)
      return cache
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        // ignore error with warning (cache may not exist yet)
        console.warn(
          `warning failed to load TwitterUsersMentionCache from disk (${filePath})`,
          err
        )
      }
    }

    return null
  }
}

export function getMentionsCacheForUser(userId: string) {
  let cache = globalUserIdMentionsCache[userId]
  if (!cache) {
    cache = globalUserIdMentionsCache[userId] = new TwitterUserMentionsCache({
      userId
    })
  }

  return cache
}

/**
 * Fetches the latest mentions of the given `userId` on Twitter.
 *
 * NOTE: even with pagination, **only the 800 most recent Tweets can be retrieved**.
 * @see https://developer.twitter.com/en/docs/twitter-api/tweets/timelines/api-reference/get-users-id-mentions
 */
export async function getTwitterUserIdMentions(
  userId: string,
  opts: types.TwitterUserIdMentionsQueryOptions,
  {
    twitter,
    noCache = false,
    resolveAllMentions
  }: {
    twitter: types.TwitterClient
    noCache?: boolean
    resolveAllMentions?: boolean
  }
): Promise<types.TweetMentionResult> {
  const originalSinceMentionId = opts.since_id

  let result: types.TweetMentionResult = {
    mentions: [],
    users: {},
    tweets: {},
    sinceMentionId: originalSinceMentionId
  }

  const cache = getMentionsCacheForUser(userId)

  if (!noCache) {
    const cachedResult = cache.getUserMentionsSince(
      originalSinceMentionId || '0'
    )

    if (cachedResult) {
      result.mentions = result.mentions.concat(cachedResult.mentions)
      result.users = {
        ...cachedResult.users,
        ...result.users
      }
      result.tweets = {
        ...cachedResult.tweets,
        ...result.tweets
      }

      // TODO: fetching all mentions isn't working properly
      if (
        !cache.minTweetId ||
        tweetIdComparator(result.sinceMentionId, cache.minTweetId) < 0
      ) {
        // sinceMentionId is before the first tweet in the cache
      } else {
        result.sinceMentionId = maxTwitterId(
          result.sinceMentionId,
          cachedResult.sinceMentionId
        )
      }

      console.log('twitter.tweets.userIdMentions CACHE HIT', {
        originalSinceMentionId,
        sinceMentionId: result.sinceMentionId,
        numMentions: result.mentions.length
      })
    } else {
      console.log('twitter.tweets.userIdMentions CACHE MISS', {
        originalSinceMentionId
      })
    }
  }

  // const isFullSearch = !originalSinceMentionId && resolveAllMentions
  // let minSinceMentionId = originalSinceMentionId || result.mentions[0]?.id

  do {
    console.log('twitter.tweets.usersIdMentions', {
      sinceMentionId: result.sinceMentionId
    })

    try {
      const mentionsQuery = twitter.tweets.usersIdMentions(userId, {
        ...opts,
        since_id: result.sinceMentionId
      })

      let numMentionsInQuery = 0
      let numPagesInQuery = 0
      for await (const page of mentionsQuery) {
        numPagesInQuery++

        if (page.data?.length) {
          numMentionsInQuery += page.data?.length
          result.mentions = result.mentions.concat(page.data)

          for (const mention of page.data) {
            result.sinceMentionId = maxTwitterId(
              result.sinceMentionId,
              mention.id
            )
          }
        }

        if (page.includes?.users?.length) {
          for (const user of page.includes.users) {
            result.users[user.id] = user
          }
        }

        if (page.includes?.tweets?.length) {
          for (const tweet of page.includes.tweets) {
            result.tweets[tweet.id] = tweet
          }
        }
      }

      console.log({ numMentionsInQuery, numPagesInQuery })
      if (numMentionsInQuery < 5 || !resolveAllMentions) {
        break
      }
    } catch (err) {
      console.error('twitter API error fetching user mentions', err)

      if (result.mentions.length) {
        break
      } else {
        throw err
      }
    }

    console.log('pausing for twitter...')
    await delay(6000)
  } while (true)

  cache.addResult(result)
  return result
}
