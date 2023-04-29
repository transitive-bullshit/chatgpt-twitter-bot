import path from 'node:path'

import stringify from 'fast-json-stable-stringify'
import pMap from 'p-map'
import { TweetV1, TwitterApi } from 'twitter-api-v2'

import * as types from './types'
import { cacheDir, redisNamespace } from './config'
import { detectLanguage } from './huggingface'
import { keyv, redis } from './keyv'
import { getTweetsByIds, tweetIdComparator } from './twitter'
import { saveJsonFile } from './utils'

async function main() {
  const exportStats = !!process.env.EXPORT_STATS
  const exportData = !!process.env.EXPORT
  const minTweetId = process.env.MIN_TWEET_ID || '0'

  const twitterApi = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET_KEY,
    accessToken: process.env.TWITTER_API_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_API_ACCESS_SECRET
  })
  const { v1: twitterV1 } = twitterApi

  // const res = await twitterV1.users({ screen_name: 'ChatSonicAI' })
  // console.log(JSON.stringify(res, null, 2))
  // return

  console.log('fetching redis interactions')
  const keys = await redis.keys(`${redisNamespace}:*`)
  const records = await redis.mget(keys)
  const interactions: types.ChatGPTInteraction[] = records
    .map((r) => JSON.parse(r)?.value)
    .filter(Boolean)
    .filter(
      (interaction: types.ChatGPTInteraction) =>
        interaction.role === 'assistant' &&
        !interaction.error &&
        tweetIdComparator(interaction.promptTweetId, minTweetId) === 1
      // && !interaction.promptLanguage
    )
  // console.log(interactions)

  if (exportData) {
    console.log('exporting interactions...', interactions.length)

    await saveJsonFile(
      path.join(cacheDir, 'chatgpt-twitter-bot-export.json'),
      interactions,
      { pretty: false }
    )

    return
  } else if (exportStats) {
    // for (const interaction of interactions) {
    //   if (interaction.promptUsername === 'pandaspende') {
    //     console.log(interaction)
    //   }
    // }
    // return

    console.log('analyzing interactions...', interactions.length)
    const languageCounts = aggregateLanguagesForInteractions(interactions)
    await saveJsonFile(
      path.join(cacheDir, 'top-prompt-languages.json'),
      languageCounts
    )

    const germanInteractions = interactions.filter(
      (interaction) => interaction.promptLanguage === 'de'
    )
    const englishInteractions = interactions.filter(
      (interaction) => interaction.promptLanguage === 'en'
    )
    const chineseInteractions = interactions.filter(
      (interaction) => interaction.promptLanguage === 'zh'
    )
    const otherInteractions = interactions.filter(
      (interaction) =>
        interaction.promptLanguage &&
        interaction.promptLanguage !== 'en' &&
        interaction.promptLanguage !== 'de'
    )

    const interactionCategories = [
      {
        interactions,
        label: 'all'
      },
      {
        interactions: germanInteractions,
        label: 'de'
      },
      {
        interactions: englishInteractions,
        label: 'en'
      },
      {
        interactions: chineseInteractions,
        label: 'zh'
      },
      {
        interactions: otherInteractions,
        label: 'other'
      }
    ]

    for (const interactionCategory of interactionCategories) {
      const { interactions, label } = interactionCategory

      interactions.sort((a, b) => (b.promptLikes || 0) - (a.promptLikes || 0))
      // if (label === 'all') {
      //   const c = aggregateLanguagesForInteractions(interactions.slice(0, 100))
      //   console.log('top prompt likes', c)
      // }
      await saveJsonFile(
        path.join(cacheDir, `${label}-top-prompt-likes.json`),
        interactions.slice(0, 100)
      )

      interactions.sort(
        (a, b) => (b.promptRetweets || 0) - (a.promptRetweets || 0)
      )
      await saveJsonFile(
        path.join(cacheDir, `${label}-top-prompt-retweets.json`),
        interactions.slice(0, 100)
      )

      interactions.sort(
        (a, b) => (b.responseLikes || 0) - (a.responseLikes || 0)
      )
      // if (label === 'all') {
      //   const c = aggregateLanguagesForInteractions(interactions.slice(0, 100))
      //   console.log('top response likes', c)
      // }
      await saveJsonFile(
        path.join(cacheDir, `${label}-top-response-likes.json`),
        interactions.slice(0, 100)
      )

      interactions.sort(
        (a, b) => (b.responseRetweets || 0) - (a.responseRetweets || 0)
      )
      await saveJsonFile(
        path.join(cacheDir, `${label}-top-response-retweets.json`),
        interactions.slice(0, 100)
      )

      interactions.sort((a, b) => (b.numFollowers || 0) - (a.numFollowers || 0))
      await saveJsonFile(
        path.join(cacheDir, `${label}-top-followers.json`),
        interactions.slice(0, 1000)
      )

      const dateInteractions = interactions.filter(
        (interaction) => interaction.promptDate
      )
      dateInteractions.sort(
        (a, b) =>
          new Date(b.promptDate).getTime() - new Date(a.promptDate).getTime()
      )
      const dateMap = {}
      for (const i of dateInteractions) {
        const date = i.promptDate.split('T')[0]
        dateMap[date] = (dateMap[date] || 0) + 1
      }
      const r = Object.entries(dateMap).map(([date, count]) => ({
        date,
        count
      }))
      await saveJsonFile(
        path.join(cacheDir, `${label}-all-tweets.json`),
        r
        // dateInteractions.map((interaction) => ({
        //   date: interaction.promptDate.split('T')[0],
        //   promptLikes: interaction.promptLikes,
        //   responseLikes: interaction.responseLikes,
        //   numFollowers: interaction.numFollowers
        // }))
      )
    }

    return
  }

  // update tweet stats in batches
  const batches: types.ChatGPTInteraction[][] = []
  const batchSize = 50
  const numBatches = Math.ceil(interactions.length / batchSize)
  for (let i = 0; i < numBatches; ++i) {
    const offset = i * batchSize
    batches.push(interactions.slice(offset, offset + batchSize))
  }

  console.log()
  console.log(
    'processing',
    numBatches,
    'batches',
    `(${interactions.length} total interactions)`
  )
  console.log()

  await pMap(
    batches,
    async (batch, index) => {
      try {
        const tweetIds = Array.from(
          new Set(
            batch
              .flatMap((interaction) => [
                interaction.promptTweetId,
                interaction.responseTweetIds[
                  interaction.responseTweetIds?.length - 1
                ]
              ])
              .filter(Boolean)
          )
        )

        console.log(`(batch ${index}/${numBatches})`, 'tweets', tweetIds.length)

        const tweets = await getTweetsByIds(tweetIds, { twitterV1 })
        const tweetsMap = tweets.reduce<Record<string, TweetV1>>(
          (acc, tweet) => ({ ...acc, [tweet.id_str]: tweet }),
          {}
        )

        // console.log('tweets', tweets.length)

        await pMap(
          batch,
          async (interaction) => {
            try {
              // console.log(interaction)
              const original = stringify(interaction)

              if (interaction.role === 'assistant' && !interaction.error) {
                if (!interaction.promptLanguage) {
                  try {
                    const languageScores = await detectLanguage(
                      interaction.prompt
                    )

                    console.log(
                      'lang',
                      interaction.prompt,
                      languageScores.slice(0, 3)
                    )

                    const promptLanguage = languageScores[0].label
                    const promptLanguageScore = languageScores[0].score
                    interaction.promptLanguage = promptLanguage
                    interaction.promptLanguageScore = promptLanguageScore
                  } catch (err) {
                    console.warn('error detecting language', err.toString())
                  }
                }

                const promptTweetId = interaction.promptTweetId
                if (promptTweetId) {
                  const tweet = tweetsMap[promptTweetId]
                  if (tweet) {
                    // console.log('prompt', tweet)
                    interaction.promptLikes = tweet.favorite_count ?? 0
                    interaction.promptRetweets = tweet.retweet_count ?? 0
                    interaction.promptReplies = tweet.reply_count ?? 0
                    if (tweet.created_at) {
                      interaction.promptDate = new Date(
                        tweet.created_at
                      ).toISOString()
                    }
                  }
                }

                const responseTweetId =
                  interaction.responseTweetIds[
                    interaction.responseTweetIds?.length - 1
                  ]
                if (responseTweetId) {
                  const tweet = tweetsMap[responseTweetId]
                  if (tweet) {
                    // console.log('response', tweet)
                    interaction.responseLikes = tweet.favorite_count ?? 0
                    interaction.responseRetweets = tweet.retweet_count ?? 0
                    interaction.responseReplies = tweet.reply_count ?? 0

                    if (tweet.created_at) {
                      interaction.responseDate = new Date(
                        tweet.created_at
                      ).toISOString()
                    }

                    const updated = stringify(interaction)
                    if (original !== updated) {
                      console.log('update', interaction)
                      await keyv.set(promptTweetId, interaction)
                    }
                  }
                }
              }
            } catch (err) {
              console.warn(
                'error processing interaction',
                `(batch ${index}/${numBatches})`,
                interaction,
                err.toString()
              )
            }
          },
          {
            concurrency: 8
          }
        )
      } catch (err) {
        console.warn(
          'error processing interactions',
          `(batch ${index}/${numBatches})`,
          err.toString()
        )
      }
    },
    {
      concurrency: 2
    }
  )
}

function aggregateLanguagesForInteractions(
  interactions: types.ChatGPTInteraction[]
) {
  const languageCounts: Record<string, number> = {}
  for (const interaction of interactions) {
    if (interaction.promptLanguage) {
      languageCounts[interaction.promptLanguage] =
        (languageCounts[interaction.promptLanguage] ?? 0) + 1
    }
  }

  return languageCounts
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
