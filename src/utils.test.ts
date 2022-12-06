import test from 'ava'

import { getTweetsFromResponse } from './utils'

test('getTweetsFromResponse', async (t) => {
  t.deepEqual(
    getTweetsFromResponse(
      'Be sure to check out Next.js and the amazing performance lorem ipsum.'
    ),
    ['Be sure to check out Next.js and the amazing performance lorem ipsum.']
  )
})
