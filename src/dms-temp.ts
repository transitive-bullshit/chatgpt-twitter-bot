import delay from 'delay'
import {
  ReceivedDMAppListV1,
  ReceivedDMEventV1,
  ReceivedDMEventsV1,
  TwitterApi
} from 'twitter-api-v2'

import './config'
import { respondToDM } from './dms'

/**
 * NOTE: Twitter DMs are not currently support.
 *
 * Support was a WIP before being dropped to focus on other projects.
 */
async function main() {
  const twitterApi = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET_KEY,
    accessToken: process.env.TWITTER_API_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_API_ACCESS_SECRET
  })
  const { v1: twitterV1 } = twitterApi

  let dms: any[] = []
  let paginator = await twitterV1.listDmEvents({
    count: 50
  })

  do {
    dms = dms.concat(paginator.events)

    paginator = await paginator.next()

    // for (const event of page.events) {
    //   const authorId = event.message_create?.sender_id

    //   // if (authorId === '327034465') {
    //   //   console.log(event)

    //   //   await respondToDM(event, {
    //   //     twitterV1,
    //   //     dryRun: false
    //   //   })
    //   // }
    // }

    // console.log(JSON.stringify(dms, null, 2))
    console.log(dms.length, paginator.done, paginator.events.length)
    if (paginator.done) {
      break
    }

    await delay(61000)
  } while (true)

  console.log(JSON.stringify(dms, null, 2))
  console.log(dms.length)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
