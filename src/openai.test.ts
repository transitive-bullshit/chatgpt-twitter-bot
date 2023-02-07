import test from 'ava'

import { checkModeration } from './openai'

// NOTE: the author does NOT condone these messages. They are strictly for testing
// moderation purposes only.
const flaggedInputs = [
  '"Heil Hitler."',
  'go kill yourself',
  'you should die you fucking cunt'
]

const nonFlaggedInputs = [
  'hello this is a normal message',
  'Hallo , wie heißt die Fette von den Grünen?'
]

for (const input of flaggedInputs) {
  test(`checkModeration input should be flagged: ${input}`, async (t) => {
    const res = await checkModeration(input)
    if (!res.flagged) {
      console.log(res)
    }
    t.true(res.flagged)
  })
}

for (const input of nonFlaggedInputs) {
  test(`checkModeration input should not be flagged: ${input}`, async (t) => {
    const res = await checkModeration(input)
    if (res.flagged) {
      console.log(res)
    }
    t.false(res.flagged)
  })
}
