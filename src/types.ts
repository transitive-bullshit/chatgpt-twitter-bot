export interface Config {
  refreshToken?: string
  sinceMentionId?: string
}

export interface ChatGPTResponse {
  promptTweetId: string
  prompt: string
  response?: string
  responseTweetIds?: string[]
  error?: string
}
