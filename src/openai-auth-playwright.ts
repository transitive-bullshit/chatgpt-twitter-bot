import { type Browser, chromium } from 'playwright'

const headers = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
}

/**
 * Generates a fresh session token for an OpenAI account based on email +
 * password.
 */
export async function getSessionTokenForOpenAIAccount({
  email,
  password
}: // timeoutMs = 2 * 60 * 1000 // TODO
{
  email: string
  password: string
  timeoutMs?: number
}): Promise<string> {
  console.log('getSessionTokenForOpenAIAccount', email)
  let token: string
  let browser: Browser

  try {
    browser = await chromium.launch({
      headless: false
    })
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.setExtraHTTPHeaders(headers)
    await page.setDefaultTimeout(10 * 60 * 1000)
    await page.goto('https://chat.openai.com/auth/login')

    await page.waitForSelector('button:nth-child(1)')
    await page.click('button:nth-child(1)')

    await page.waitForSelector('h1')

    await page.fill('#username', email)
    await page.click('button[type="submit"]')

    await page.waitForSelector('#password')
    await page.waitForSelector('button[type="submit"]')
    await page.waitForSelector('h1')

    await page.fill('#password', password)

    await page.click('button[type="submit"]')

    await page.waitForURL('https://chat.openai.com/chat', { timeout: 10000 })
    const cookies = (await context.storageState()).cookies

    const sessionTokenItem = cookies.find(
      (item) => item.name == '__Secure-next-auth.session-token'
    )

    token = sessionTokenItem.value
  } catch (err) {
    console.error(err, { email })
  } finally {
    await browser.close()
  }

  if (!token) {
    throw new Error(`returned empty session token for OpenAI account ${email}`)
  }
  return token
}
