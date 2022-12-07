import { Client, auth } from 'twitter-api-sdk'

import config from './config'

async function main() {
  // const refreshToken = process.env.TWITTER_OAUTH_REFRESH_TOKEN || config.get('refreshToken')
  const refreshToken = config.get('refreshToken')
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
    return token
  }

  await refreshTwitterAuthToken()

  const twitter = new Client(authClient)
  const { data: user } = await twitter.users.findMyUser({
    'user.fields': [
      'entities',
      'description',
      'profile_image_url',
      'protected',
      'public_metrics'
    ]
  })

  if (!user?.id) {
    throw new Error('twitter error unable to fetch current user')
  }

  console.log(user)

  // const d = await twitter.tweets.usersIdTweets(user.id)
  // console.log(d)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', JSON.stringify(err, null, 2))
    process.exit(1)
  })
