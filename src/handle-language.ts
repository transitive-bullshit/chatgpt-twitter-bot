import { franc } from 'franc'
import { iso6393 } from 'iso-639-3'

import * as types from './types'
import { languageAllowList, languageDisallowList } from './config'
import { createTweet } from './twitter'

export async function handlePromptLanguage({
  result,
  dryRun,
  twitter,
  tweetMode = 'image'
}: {
  result: types.ChatGPTInteraction
  dryRun: boolean
  twitter: types.TwitterClient
  tweetMode?: types.TweetMode
}): Promise<boolean> {
  // TODO: the `franc` module we're using for language detection doesn't
  // seem very accurate at inferrring english. It will often pick some
  // european dialect instead.
  const lang = franc(result.prompt, { minLength: 5 })

  if (!languageAllowList.has(lang)) {
    const entry = iso6393.find((i) => i.iso6393 === lang)
    const langName = entry?.name || lang || 'unknown'

    // Check for languages that we know will cause problems for our code
    // and degrace gracefully with an error message.
    if (tweetMode === 'thread' && languageDisallowList.has(lang)) {
      console.error()
      console.error('error: unsupported language detected in prompt', {
        lang,
        langName,
        prompt: result.prompt,
        promptTweetId: result.promptTweetId
      })
      console.error()

      const tweetText = `${
        result.promptUsername
          ? `Hey @${result.promptUsername}, we're sorry but `
          : "We're sorry but "
      }${
        langName === 'unknown' ? 'your prompt' : langName
      } is currently not supported by this chatbot. We apologize for the inconvenience and will be adding support for more languages soon.\n\nRef: ${
        result.promptTweetId
      }`

      const tweet = await createTweet(
        {
          text: tweetText,
          reply: {
            in_reply_to_tweet_id: result.promptTweetId
          }
        },
        { twitter, dryRun }
      )

      result.error = `Unsupported language "${langName}"`
      result.isErrorFinal = true
      result.responseTweetIds = [tweet?.id].filter(Boolean)
      return false
    } else if (!languageDisallowList.has(lang)) {
      console.warn()
      console.warn('warning: unrecognized language detected in prompt', {
        lang,
        langName,
        prompt: result.prompt,
        promptTweetId: result.promptTweetId
      })
      console.warn()
    }
  }

  return true
}
