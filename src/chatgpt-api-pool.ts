import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import QuickLRU from 'quick-lru'
import random from 'random'

type ChatGPTAPIInstance = InstanceType<typeof ChatGPTAPI>

export type ChatGPTAPIAccount = {
  // TODO
  email?: string
  password: string
  sessionToken: string
}

type ChatGPTAPIAccountInstance = {
  id: string
  api: ChatGPTAPI
  account: ChatGPTAPIAccount
}

/**
 * Wrapper around N instances of ChatGPTAPI that handles rotating out accounts
 * that are on cooldown.
 *
 * Whenever you send a message using the pool, a random account will be chosen.
 *
 * TODO: are `conversationId` and `parentMessageId` account-specific?
 */
export class ChatGPTAPIPool extends ChatGPTAPI {
  protected _accounts: Array<ChatGPTAPIAccountInstance>
  protected _accountsOnCooldown: QuickLRU<string, boolean>
  protected _accountCooldownMs: number
  protected _accountOffset: number

  constructor(
    accounts: ChatGPTAPIAccount[],
    opts: Omit<ConstructorParameters<typeof ChatGPTAPI>[0], 'sessionToken'> & {
      apiCooldownMs?: number
    } = {}
  ) {
    const { apiCooldownMs = 1 * 60 * 1000, ...rest } = opts

    if (!accounts.length) {
      throw new Error('ChatGPTAPIPool must pass at least one account')
    }

    super({
      ...rest,
      sessionToken: accounts[0].sessionToken
    })

    this._accounts = accounts.map((account, index) => ({
      api: new ChatGPTAPI({
        ...rest,
        sessionToken: account.sessionToken
      }),
      id: account.email || `account-${index}`,
      account
    }))

    this._accountOffset = 0
    this._accountCooldownMs = apiCooldownMs
    this._accountsOnCooldown = new QuickLRU<string, boolean>({
      maxSize: 1000,
      maxAge: apiCooldownMs
    })
  }

  async getAPIAccountInstance(): Promise<ChatGPTAPIAccountInstance> {
    do {
      this._accountOffset = (this._accountOffset + 1) % this._accounts.length
      const account = this._accounts[this._accountOffset]

      if (!this._accountsOnCooldown.has(account.id)) {
        return account
      }

      if (this._accountsOnCooldown.size >= this._accounts.length) {
        // All API accounts are on cooldown, so wait and try again
        await delay(1000)
      }
    } while (true)
  }

  override async getIsAuthenticated() {
    const account = await this.getAPIAccountInstance()
    return await account.api.getIsAuthenticated()
  }

  override async ensureAuth() {
    const account = await this.getAPIAccountInstance()
    return await account.api.ensureAuth()
  }

  override async refreshAccessToken() {
    const account = await this.getAPIAccountInstance()
    return await account.api.ensureAuth()
  }

  override async sendMessage(
    ...args: Parameters<ChatGPTAPIInstance['sendMessage']>
  ) {
    let account: ChatGPTAPIAccountInstance

    try {
      account = await this.getAPIAccountInstance()
      const res = await account.api.sendMessage(...args)

      const responseL = res.toLowerCase()
      if (responseL.includes('too many requests, please slow down')) {
        this._accountsOnCooldown.set(account.id, true, {
          maxAge: this._accountCooldownMs * 2
        })
        return null
      }

      if (
        responseL.includes('your authentication token has expired') ||
        responseL.includes('please try signing in again')
      ) {
        this._accountsOnCooldown.set(account.id, true)
        return null
      }
    } catch (err) {
      if (err.name === 'TimeoutError') {
        // ChatGPT timed out
        this._accountsOnCooldown.set(account.id, true)
      } else if (
        err.toString().toLowerCase() === 'error: chatgptapi error 429'
      ) {
        console.log('\nchatgpt rate limit', account.id, '\n')
        this._accountsOnCooldown.set(account.id, true, {
          maxAge: this._accountCooldownMs * 4
        })
      } else if (
        err.toString().toLowerCase() === 'error: chatgptapi error 503' ||
        err.toString().toLowerCase() === 'error: chatgptapi error 502'
      ) {
        this._accountsOnCooldown.set(account.id, true)
      }

      throw err
    }
  }
}
