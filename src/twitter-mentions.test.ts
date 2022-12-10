import test from 'ava'

import { TwitterUserMentionsCache } from './twitter-mentions'

test('TwitterUserMentionsCache empty', async (t) => {
  const cache = new TwitterUserMentionsCache({ userId: 'foo' })

  const emptyResult = cache.getUserMentionsSince('0')
  t.is(emptyResult.mentions.length, 0)
  t.is(Object.keys(emptyResult.users).length, 0)
  t.is(Object.keys(emptyResult.tweets).length, 0)
  t.is(emptyResult.sinceMentionId, '0')
})

test('TwitterUserMentionsCache add mentions', async (t) => {
  const cache = new TwitterUserMentionsCache({ userId: 'foo' })

  cache.addResult({
    mentions: [{ id: '500' }, { id: '503' }, { id: '1000' }, { id: '99' }],
    users: { foo: {}, bar: {} },
    tweets: {},
    sinceMentionId: '0'
  })

  t.is(cache.minTweetId, '99')
  t.is(cache.maxTweetId, '1000')

  {
    const result = cache.getUserMentionsSince('0')
    t.is(result.mentions.length, 4)
    t.is(Object.keys(result.users).length, 2)
    t.is(Object.keys(result.tweets).length, 0)
    t.is(result.sinceMentionId, '1000')
  }

  {
    const result = cache.getUserMentionsSince('501')
    t.is(result.mentions.length, 2)
    t.is(Object.keys(result.users).length, 2)
    t.is(Object.keys(result.tweets).length, 0)
    t.is(result.sinceMentionId, '1000')
  }

  {
    const result = cache.getUserMentionsSince('1001')
    t.is(result.mentions.length, 0)
    t.is(Object.keys(result.users).length, 2)
    t.is(Object.keys(result.tweets).length, 0)
    t.is(result.sinceMentionId, '1001')
  }
})

test('TwitterUserMentionsCache add mentions multiple batches', async (t) => {
  const cache = new TwitterUserMentionsCache({ userId: 'foo' })

  cache.addResult({
    mentions: [{ id: '500' }, { id: '503' }, { id: '1000' }, { id: '99' }],
    users: { foo: {}, bar: {} },
    tweets: {},
    sinceMentionId: '0'
  })

  cache.addResult({
    mentions: [{ id: '500' }, { id: '43' }, { id: '1500' }, { id: '99' }],
    users: { baz: {} },
    tweets: { foo: {} },
    sinceMentionId: '10'
  })

  t.is(cache.minTweetId, '43')
  t.is(cache.maxTweetId, '1500')

  {
    const result = cache.getUserMentionsSince('0')
    // make sure duplicates are ignored
    t.is(result.mentions.length, 6)
    t.is(Object.keys(result.users).length, 3)
    t.is(Object.keys(result.tweets).length, 1)
    t.is(result.sinceMentionId, '1500')
  }

  {
    const result = cache.getUserMentionsSince('501')
    t.is(result.mentions.length, 3)
    t.is(Object.keys(result.users).length, 3)
    t.is(Object.keys(result.tweets).length, 1)
    t.is(result.sinceMentionId, '1500')
  }

  {
    const result = cache.getUserMentionsSince('1001')
    t.is(result.mentions.length, 1)
    t.is(Object.keys(result.users).length, 3)
    t.is(Object.keys(result.tweets).length, 1)
    t.is(result.sinceMentionId, '1500')
  }
})
