import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import dotenv from 'dotenv-safe'
import { oraPromise } from 'ora'

dotenv()

/**
 * Example CLI for testing functionality.
 */
async function main() {
  const api = new ChatGPTAPI()
  await api.init()

  const isSignedIn = await api.getIsSignedIn()

  if (!isSignedIn) {
    // Wait until the user signs in via the chromium browser
    await oraPromise(
      new Promise<void>(async (resolve, reject) => {
        try {
          await delay(1000)
          const isSignedIn = await api.getIsSignedIn()
          if (isSignedIn) {
            return resolve()
          }
        } catch (err) {
          return reject(err)
        }
      }),
      'Please sign in to ChatGPT'
    )
  }

  const response = await api.sendMessage(
    // 'Write a TypeScript function for conway sort.'
    'Write a python version of bubble sort. Do not include example usage.'
  )

  await api.close()

  return response
}

main().then((res) => {
  console.log(res)
})
