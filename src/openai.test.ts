import test from 'ava'

import { checkModeration } from './openai'

const flaggedInputs = ['"Heil hitler."', 'go kill yourself']
const nonFlaggedInputs = [
  'hello this is a normal message',
  'Hallo , wie heißt die Fette von den Grünen?'
]

for (const input of flaggedInputs) {
  test(`checkModeration input should be flagged: ${input}`, async (t) => {
    const res = await checkModeration(input)
    t.true(res.flagged)
  })
}

for (const input of nonFlaggedInputs) {
  test(`checkModeration input should not be flagged: ${input}`, async (t) => {
    const res = await checkModeration(input)
    t.false(res.flagged)
  })
}
