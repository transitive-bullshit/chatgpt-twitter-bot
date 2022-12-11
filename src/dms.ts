import * as config from './config'
import * as types from './types'
import { dms } from './keyv'
import { getPrompt } from './mentions'
import { getUserById } from './twitter'

/**
 * NOTE: Twitter DMs are not currently support.
 *
 * Support was a WIP before being dropped to focus on other projects.
 */
export async function respondToDM(
  dm: types.TwitterDMV1,
  {
    dryRun,
    twitterV1
  }: {
    dryRun: boolean
    twitterV1: types.TwitterClientV1
  }
): Promise<types.ChatGPTInteraction> {
  const dmData = dm.message_create
  if (!dmData) {
    // different type of event
    return
  }

  const promptMessageId = dm.id
  const promptUserId = dmData.sender_id

  if (!promptUserId || promptUserId === config.twitterBotUserId) {
    return
  }

  const keyPrefix = `${config.redisNamespaceDMs}:${promptUserId}`
  const prompt = getPrompt(dmData.message_data.text)

  if (!prompt) {
    // TODO
    return
  }

  const user = await getUserById(promptUserId, {
    twitterV1
  })

  if (!user) {
    // TODO
    return
  }

  const result: types.ChatGPTInteraction = {
    type: 'dm',
    role: 'assistant',
    prompt,
    promptUserId,
    promptTweetId: promptMessageId,
    promptUsername: user.screen_name
  }

  const dmsQuery = dms.iterator(`${keyPrefix}:*`)
  for await (const message of dmsQuery) {
    const currentDM = message as types.TwitterDMV1
    console.log(message)
  }

  const outboundDM = await twitterV1.sendDm({
    recipient_id: promptUserId,
    text: 'Test'
    // attachment: {
    //   type: 'media',
    //   media: {
    //     id:
    //   }
    // }
  })
  console.log(JSON.stringify(outboundDM, null, 2))
  // const outboundDMEvent = outboundDM.event?.message_create

  return result
}
