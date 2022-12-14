import test from 'ava'
import { TimeoutError } from 'p-timeout'

import { generateSessionTokenForOpenAIAccountTLS } from './openai-auth'

const isCI = !!process.env.CI

test('generateSessionTokenForOpenAIAccountTLS', async (t) => {
  if (isCI) {
    await t.throwsAsync(
      async () => {
        await generateSessionTokenForOpenAIAccountTLS({
          email: 'foo@example.com',
          password: 'bar'
        })
      },
      {
        message: 'Wrong email or password for OpenAI account "foo@example.com"'
      }
    )

    await t.throwsAsync(
      async () => {
        await generateSessionTokenForOpenAIAccountTLS({
          email: 'foo@example.com',
          password: 'bar',
          timeoutMs: 1
        })
      },
      {
        instanceOf: TimeoutError
      }
    )
  } else {
    // no-op on localhost so we don't get our IP banned
    t.is(true, true)
  }
})
