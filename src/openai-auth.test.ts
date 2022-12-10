import test from 'ava'

import { generateSessionTokenForOpenAIAccount } from './openai-auth'

const isCI = !!process.env.CI

test('generateSessionTokenForOpenAIAccount', async (t) => {
  if (isCI) {
    await t.throwsAsync(
      async () => {
        await generateSessionTokenForOpenAIAccount({
          email: 'foo@example.com',
          password: 'bar'
        })
      },
      {
        message: 'Wrong email or password for OpenAI account "foo@example.com"'
      }
    )
  } else {
    // no-op on localhost so we don't get our IP banned
    t.is(true, true)
  }
})
