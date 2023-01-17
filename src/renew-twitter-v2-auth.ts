import { auth } from 'twitter-api-sdk'

import config from './config'

async function main() {
  const refreshToken =
    process.env.TWITTER_OAUTH_REFRESH_TOKEN || config.get('refreshToken')
  // const refreshToken = config.get('refreshToken')
  const authToken = refreshToken ? { refresh_token: refreshToken } : undefined
  const authClient = new auth.OAuth2User({
    client_id: process.env.TWITTER_CLIENT_ID,
    client_secret: process.env.TWITTER_CLIENT_SECRET,
    callback: 'http://127.0.0.1:3000/callback',
    scopes: ['tweet.read', 'users.read', 'offline.access', 'tweet.write'],
    token: authToken
  })

  async function refreshTwitterAuthToken() {
    console.log('refreshing twitter access token')
    const { token } = await authClient.refreshAccessToken()
    config.set('refreshToken', token.refresh_token)
    console.log('twitter access token', token)
    return token
  }

  await refreshTwitterAuthToken()
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
