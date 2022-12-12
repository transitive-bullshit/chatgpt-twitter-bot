import delay from 'delay'
import { type Browser } from 'puppeteer'
import { executablePath } from 'puppeteer'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

const headers = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
}

/**
 * Generates a fresh session token for an OpenAI account based on email +
 * password.
 */
export async function getSessionTokenForOpenAIAccountUsingPuppeteer({
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
    browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox'],
      ignoreHTTPSErrors: true,
      executablePath: executablePath()
    })
    // const context = await browser.createIncognitoBrowserContext()
    const page = await browser.newPage()

    await page.setExtraHTTPHeaders(headers)
    await page.setDefaultTimeout(10 * 60 * 1000)
    await page.goto('https://chat.openai.com/auth/login')

    await page.waitForSelector('button:nth-child(1)')
    await page.click('button:nth-child(1)')

    await page.waitForSelector('h1')

    await page.type('#username', email, { delay: 50 })
    await page.click('button[type="submit"]')

    await page.waitForSelector('#password')
    await page.waitForSelector('button[type="submit"]')
    await page.waitForSelector('h1')

    await page.type('#password', password, { delay: 50 })

    await page.click('button[type="submit"]')

    // 'https://chat.openai.com/chat'
    await page.waitForNavigation({ timeout: 10000 })
    const cookies = await page.cookies('https://chat.openai.com')
    console.log(cookies)
    // const cookies = (await context.storageState()).cookies

    // const sessionTokenItem = cookies.find(
    //   (item) => item.name == '__Secure-next-auth.session-token'
    // )

    // token = sessionTokenItem.value
  } catch (err) {
    console.error(err, { email })
    await delay(100000)
  } finally {
    await browser.close()
  }

  if (!token) {
    throw new Error(`returned empty session token for OpenAI account ${email}`)
  }
  return token
}
