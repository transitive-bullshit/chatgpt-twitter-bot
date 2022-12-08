import test from 'ava'

import { getTweetUrl, getTweetsFromResponse } from './utils'

test('getTweetsFromResponse', async (t) => {
  t.deepEqual(
    getTweetsFromResponse(
      'Be sure to check out Next.js and the amazing performance lorem ipsum.'
    ),
    ['Be sure to check out Next.js and the amazing performance lorem ipsum.']
  )
})

test('getTweetUrl', async (t) => {
  t.is(
    getTweetUrl({ username: 'foo', id: '123' }),
    'https://twitter.com/foo/status/123'
  )

  t.is(
    getTweetUrl({ username: 'foo-abc', id: '12345678' }),
    'https://twitter.com/foo-abc/status/12345678'
  )

  t.is(getTweetUrl({ id: '123' }), undefined)
  t.is(getTweetUrl({ username: 'foo', id: '' }), undefined)
  t.is(getTweetUrl({ username: 'foo' }), undefined)
  t.is(getTweetUrl({ username: '', id: '855' }), undefined)
})
