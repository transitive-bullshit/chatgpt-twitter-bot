import test from 'ava'

import { generateSessionTokenForOpenAIAccount } from './openai-auth'

const isCI = !!process.env.CI
const isNoop = false

test('generateSessionTokenForOpenAIAccount', async (t) => {
  if (isCI) {
    if (isNoop) {
      // TODO: no-op on CI until we add python and poetry to CI environment
      t.is(true, true)
    } else {
      await t.throwsAsync(
        async () => {
          await generateSessionTokenForOpenAIAccount({
            email: 'foo@example.com',
            password: 'bar'
          })
        },
        {
          message:
            'Wrong email or password for OpenAI account "foo@example.com"'
        }
      )
    }
  } else {
    // no-op on localhost so we don't get our IP banned
    t.is(true, true)
  }
})
