import winkNLPModel from 'wink-eng-lite-web-model'
import winkNLP from 'wink-nlp'

const nlp = winkNLP(winkNLPModel)

export function getTweetsFromResponse(response: string): string[] {
  // convert the response to tweet-sized chunks
  const paragraphs = response
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)

  // const sentences = paragraphs.map((p) => p.sentences().out())
  let tweetDrafts = []
  const maxTweetLength = 250
  let currentTweet = ''

  for (const paragraph of paragraphs) {
    const doc = nlp.readDoc(paragraph)
    const sentences = doc.sentences().out()
    // console.log(JSON.stringify(sentences, null, 2))

    for (let sentence of sentences) {
      do {
        if (currentTweet.length > 200) {
          tweetDrafts.push(currentTweet)
          currentTweet = ''
        }

        const tweet = currentTweet ? `${currentTweet}\n\n${sentence}` : sentence

        if (tweet.length > maxTweetLength) {
          const tokens = sentence.split(' ')
          let partialTweet = currentTweet ? `${currentTweet}\n\n` : ''
          let partialNextSentence = ''
          let isNext = false

          for (const token of tokens) {
            const temp = `${partialTweet}${token} `
            if (!isNext && temp.length < maxTweetLength) {
              partialTweet = temp
            } else {
              isNext = true
              partialNextSentence = `${partialNextSentence}${token} `
            }
          }

          if (partialTweet.length > maxTweetLength) {
            console.error(
              'error: unexptected tweet length too long',
              partialTweet
            )
          }

          tweetDrafts.push(partialTweet.trim() + '...')
          currentTweet = ''
          sentence = partialNextSentence
        } else {
          currentTweet = tweet.trim()
          break
        }
      } while (sentence.trim().length)
    }
  }

  if (currentTweet) {
    tweetDrafts.push(currentTweet.trim())
    currentTweet = null
  }

  tweetDrafts = tweetDrafts.filter(Boolean)
  console.log(tweetDrafts.length, JSON.stringify(tweetDrafts, null, 2))

  const tweets = tweetDrafts.map(
    (draft, index) => `${index + 1}/${tweetDrafts.length} ${draft.trim()}`
  )

  return tweets
}
