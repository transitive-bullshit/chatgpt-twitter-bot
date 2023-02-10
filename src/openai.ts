import {
  Configuration,
  CreateModerationResponseResultsInner,
  OpenAIApi
} from 'openai'

import './config'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})
export const openai = new OpenAIApi(configuration)

const blockedRegexes = [
  /\bheil\s*hitler/gi,
  /\bnigg[ae]rs?\b/gi,
  /\bfagg?ots?\b/gi,
  /\bneger\b/gi,
  /\bschwuchteln?\b/gi,
  /\bhimmlers?\b/gi,
  /\bkanac?ken?\b/gi
]

export async function checkModeration(input: string = '') {
  const inputL = input.toLowerCase().trim()
  for (const blockedRegex of blockedRegexes) {
    if (blockedRegex.test(inputL)) {
      return {
        flagged: true,
        categories: {
          hate: true
        },
        category_scores: {}
      } as CreateModerationResponseResultsInner
    }
  }

  const res = await openai.createModeration({
    input
  })

  return res.data.results[0]
}
