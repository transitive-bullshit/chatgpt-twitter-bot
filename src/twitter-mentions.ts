import delay from 'delay'
// import fs from 'fs/promises'
import BTree from 'sorted-btree'

import * as types from './types'
import { maxTwitterId } from './twitter'

export class TwitterUserMentionsCache {
  userId: string

  mentions: BTree<string, types.TweetMention> = new BTree(
    undefined,
    (a: string, b: string) => a.localeCompare(b)
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
}

type TwitterUserIdMentionsCache = Record<string, TwitterUserMentionsCache>

// TODO: store and load this to disk
const userIdMentionsCache: TwitterUserIdMentionsCache = {}

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

  if (!userIdMentionsCache[userId]) {
    userIdMentionsCache[userId] = new TwitterUserMentionsCache({ userId })
  }

  if (!noCache) {
    const cachedResult = userIdMentionsCache[userId].getUserMentionsSince(
      originalSinceMentionId
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
      result.sinceMentionId = maxTwitterId(
        result.sinceMentionId,
        cachedResult.sinceMentionId
      )

      console.log('twitter.tweets.userIdMentions cache hit', {
        sinceMentionId: originalSinceMentionId,
        numMentions: result.mentions.length
      })
    }
  }

  let lastSinceMentionId = result.sinceMentionId

  do {
    console.log('twitter.tweets.usersIdMentions', {
      sinceMentionId: result.sinceMentionId
    })
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
    if (
      !numMentionsInQuery ||
      !resolveAllMentions ||
      result.sinceMentionId === lastSinceMentionId
    ) {
      break
    }

    lastSinceMentionId = result.sinceMentionId
    console.log('pausing for twitter...')
    await delay(6000)
  } while (true)

  userIdMentionsCache[userId].addResult(result)
  return result
}
