import { ChatGPTAPI, getOpenAIAuth } from 'chatgpt'

// import { fetch } from 'undici'
import './config'

/**
 * TODO
 */
async function main() {
  const email = ''
  const password = ''
  const authInfo = await getOpenAIAuth({
    email,
    password
  })

  const chatgpt = new ChatGPTAPI({
    ...authInfo
  })
  await chatgpt.ensureAuth()
  console.log('authed!')
  const response = await chatgpt.sendMessage('hello little AI friend')
  console.log(response)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    console.error(err?.response?.headers)
    process.exit(1)
  })
