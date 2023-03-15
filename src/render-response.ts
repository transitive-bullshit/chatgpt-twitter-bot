import fs from 'fs/promises'
import got from 'got'
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import pMemoize from 'p-memoize'
import { renderText } from 'puppeteer-render-text'
import QuickLRU from 'quick-lru'
import random from 'random'
import { temporaryFile } from 'tempy'

import { twitterBotHandle } from './config'
import { logoBase64DataUri } from './logo-base64'

const minWidth = 640
const maxWidth = 1360

const backgroundImages = [
  'https://kwote.app/_next/static/media/07.f6c3e632.jpg',
  'https://kwote.app/_next/static/media/14.97bb9296.jpg',
  'https://kwote.app/_next/static/media/16.92c9365e.jpg',
  'https://kwote.app/_next/static/media/20.8f22c4bc.jpg'
]

const injectedHead = `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/default.min.css">

<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github-dark-dimmed.min.css">
`

// not needed client-side
// <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>

const injectedStyle = `
body {
  /* -webkit-font-smoothing: antialiased; */
  overflow: unset !important;
}

.block {
  display: block !important;;
}

.wrapper {
  min-width: ${minWidth}px;
  max-width: ${maxWidth}px;
  padding: 32px;
  background-image: url("https://kwote.app/_next/static/media/20.8f22c4bc.jpg");
  background-size: cover;
  aspect-ratio: 2.0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.content {
  min-width: ${minWidth - 32 * 2}px;
  max-width: 100%;
  background: #444654;
  color: #eee;

  border-radius: 16px;
  line-height: 1.3;
  box-shadow: 0px 5px 20px rgba(0, 0, 0, 0.05), 0px 1px 4px rgba(0, 0, 0, 0.15);
  font-size: 32px;
  padding: 0 0 32px;

  display: flex;
  flex-direction: column;
}

img {
  max-width: 100%;
}

.promptW, .responseW {
  display: flex;
  flex-direction: row;
  gap: 32px;
}

.prompt > :first-child,
.response > :first-child {
  margin-block-start: 0;
  margin-top: 0;
}

.prompt > :last-child,
.response > :last-child {
  margin-block-end: 0;
  margin-bottom: 0;
}

.hljs {
  padding: 24px;
  border-radius: 8px;
  max-width: ${maxWidth - 32 * 5 - 64}px;
  overflow: hidden;
}

.promptW {
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  color: #fff;
  padding: 32px;
  background: #343541;
}

.responseW {
  padding: 32px 32px 0;
}

.footer {
  padding: 32px 32px 0;
  align-self: flex-end;
  font-size: 28px;
  color: #fff;
  display: flex;
  flex-direction: row;
  align-items: center;
}

pre {
  max-width: 100%;
  white-space: pre-wrap;
}

.logo {
  display: block;
  width: 1.5em;
  height: 1.5em;
  margin-right: 0.4em;
}

.user {
  color: #999;
  margin-bottom: 0.5em;
}

.avatar {
  width: 2em;
  height: 2em;
  border-radius: 50%;
}

p {
  white-space: pre-line;
}

p,
ol,
ul,
li,
hr,
pre {
  margin-bottom: 1em;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  margin-bottom: 0.5em;
}
`

const defaultUserImageUrl =
  'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'

const userImageCache = new QuickLRU<string, string>({
  maxSize: 4096
})

const getUserImageAsDataUrl = pMemoize(getUserImageAsDataUrlImpl, {
  cache: userImageCache
})

async function getUserImageAsDataUrlImpl(
  userImageUrl: string
): Promise<string> {
  const res = await got(userImageUrl, { responseType: 'buffer' })

  if (!res.ok) {
    throw new Error(`Failed to fetch user image: ${userImageUrl}`)
  }

  return `data:${
    res.headers['content-type'] || 'image/png'
  };base64,${res.body.toString('base64')}`
}

export async function renderResponse({
  prompt,
  response,
  userImageUrl = defaultUserImageUrl,
  username,
  outputPath,
  htmlOutputPath,
  model
}: {
  prompt?: string
  response: string
  userImageUrl?: string
  username?: string
  outputPath?: string
  htmlOutputPath?: string
  model?: string
}): Promise<string> {
  const md = new MarkdownIt({
    highlight: function (str: string, lang: string) {
      const language = lang || undefined
      try {
        let code = ''
        if (language) {
          code = hljs.highlight(str, { language }).value
        } else {
          code = hljs.highlightAuto(str).value
        }

        return '<pre class="hljs"><code>' + code + '</code></pre>'
      } catch (__) {}

      return '' // use external default escaping
    }
  })

  const responseInjection = md
    .render(
      response
        .replaceAll(/^\n+/g, '')
        .replaceAll(/^\s+/g, '')
        .replaceAll(/\n+$/g, '')
        .replaceAll(/\s$/g, '')
        .trim()
    )
    .trim()

  let userImageUrlDataUri = userImageUrl
  try {
    userImageUrlDataUri = await getUserImageAsDataUrl(userImageUrl)
  } catch (err) {
    try {
      userImageUrlDataUri = await getUserImageAsDataUrl(defaultUserImageUrl)
    } catch (err) {
      console.warn('error fetching user image', userImageUrl, err.toString())
    }
  }

  let userHeader = ''
  const userImage = `<img class="avatar" src="${userImageUrlDataUri}" />`
  const responseUserImage = `<img class="avatar" src="${logoBase64DataUri}" />`
  if (username) {
    if (!username.startsWith('@')) {
      username = `@${username}`
    }
    userHeader = `<p class="user">${username}</p>`
  }

  const twitterBotModel = model ? ` (<i>${model}</i>)` : ''
  let responseUserHeader = `<p class="user">${twitterBotHandle}${twitterBotModel}</p>`

  const promptHtml = prompt
    ? md
        .render(
          prompt
            .replaceAll(/^\n+/g, '')
            .replaceAll(/^\s+/g, '')
            .replaceAll(/\n+$/g, '')
            .replaceAll(/\s$/g, '')
            .trim()
        )
        .trim()
    : null

  const promptInjection = prompt
    ? `<div class='promptW'>${userImage}<div class='prompt'>${userHeader}${promptHtml}</div></div>`
    : undefined

  const backgroundImage = random.choice(backgroundImages)

  // const footer = `<div class='footer'><img class="logo" src="${logoBase64DataUri}" /> Generated by ${twitterBotHandle}</div>`

  const input = `
<div class='wrapper' style="background-image: url('${backgroundImage}');">
  <div class='content'>
    ${promptInjection}

    <div class='responseW'>
      ${responseUserImage}

      <div class='response'>${responseUserHeader}${responseInjection}</div>
    </div>
  </div>
</div>
`

  const output = outputPath || temporaryFile({ extension: 'jpg' })
  const html = await renderText({
    text: input,
    output,
    width: maxWidth,
    style: {
      fontFamily: 'Inter'
    },
    inject: {
      head: injectedHead,
      style: injectedStyle
    }
  })

  if (htmlOutputPath) {
    await fs.writeFile(htmlOutputPath, html, 'utf-8')
  }

  return output
}
