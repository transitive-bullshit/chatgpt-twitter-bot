import { ChatGPTAPI } from 'chatgpt'

import './config'
import { generateAccessTokenForOpenAIAccount } from './openai-auth'

/**
 * TODO
 */
async function main() {
  const email = process.env.OPENAI_EMAIL
  const password = process.env.OPENAI_PASSWORD
  const accessToken = await generateAccessTokenForOpenAIAccount({
    email,
    password
  })

  const chatgpt = new ChatGPTAPI({
    apiReverseProxyUrl: 'https://chatgpt.pawan.krd/api/completions',
    apiKey: accessToken,
    completionParams: {
      model: 'text-davinci-002-render' // free, default model
      // model: 'text-davinci-002-render-paid' // paid, default model
      // model: 'text-davinci-002-render-sha' // paid, turbo model
    }
  })
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
