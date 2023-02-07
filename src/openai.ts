import { Configuration, OpenAIApi } from 'openai'

import './config'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})
export const openai = new OpenAIApi(configuration)

export async function checkModeration(input: string) {
  const res = await openai.createModeration({
    input
  })

  return res.data.results[0]
}
