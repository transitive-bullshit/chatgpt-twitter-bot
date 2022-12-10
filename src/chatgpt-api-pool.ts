import fs from 'node:fs/promises'
import path from 'node:path'

import { ChatGPTAPI } from 'chatgpt'
import delay from 'delay'
import mkdir from 'mkdirp'
import pMap from 'p-map'
import QuickLRU from 'quick-lru'

import { ChatGPTError } from '../../chatgpt-api/build'
import { cacheDir } from './config'
import { generateSessionTokenForOpenAIAccount } from './openai-auth'
import { ChatError } from './types'
import { omit } from './utils'

type ChatGPTAPIInstance = InstanceType<typeof ChatGPTAPI>
type ChatGPTAPISendMessageOptions = Parameters<
  ChatGPTAPIInstance['sendMessage']
>[1]
type ChatGPTAPIInstanceOptions = Omit<
  ConstructorParameters<typeof ChatGPTAPI>[0],
  'sessionToken'
>

export interface ChatGPTAPIAccountInit {
  // must pass either email and pasword OR sessionToken
  // (passing all three is preferred)
  email?: string
  password?: string
  sessionToken?: string
}

interface ChatGPTAPIAccount extends ChatGPTAPIAccountInit {
  id: string
  api: ChatGPTAPI
}

/**
 * Wrapper around N instances of ChatGPTAPI that handles rotating out accounts
 * that are on cooldown.
 *
 * Whenever you send a message using the pool, a random account will be chosen.
 *
 * NOTE: **`conversationId` and `parentMessageId` are account-specific**, so
 * conversations cannot be transferred between accounts.
 */
export class ChatGPTAPIPool extends ChatGPTAPI {
  protected _accounts: Array<ChatGPTAPIAccount>
  protected _accountsMap: Record<string, ChatGPTAPIAccount>
  protected _accountsInit: Array<ChatGPTAPIAccountInit>
  protected _accountsOnCooldown: QuickLRU<string, boolean>
  protected _accountCooldownMs: number
  protected _accountOffset: number
  protected _chatgptapiOptions: ChatGPTAPIInstanceOptions

  constructor(
    accounts: ChatGPTAPIAccountInit[],
    opts: ChatGPTAPIInstanceOptions & {
      apiCooldownMs?: number
    } = {}
  ) {
    const { apiCooldownMs = 1 * 60 * 1000, ...initOptions } = opts

    if (!accounts.length) {
      throw new Error('ChatGPTAPIPool must pass at least one account')
    }

    super({
      ...initOptions,
      sessionToken: accounts[0].sessionToken
    })

    this._chatgptapiOptions = initOptions
    this._accountsInit = accounts

    this._accountOffset = 0
    this._accountCooldownMs = apiCooldownMs
    this._accountsOnCooldown = new QuickLRU<string, boolean>({
      maxSize: 1024,
      maxAge: apiCooldownMs
    })
  }

  /**
   * Initializes all ChatGPT accounts and ensures value session tokens for
   * each of them.
   */
  async init() {
    this._accounts = (
      await pMap(
        this._accountsInit,
        async (accountInit, index): Promise<ChatGPTAPIAccount> => {
          let api: ChatGPTAPI = null
          const accountId = accountInit.email || `account-${index}`

          try {
            if (accountInit.sessionToken) {
              api = new ChatGPTAPI({
                ...this._chatgptapiOptions,
                sessionToken: accountInit.sessionToken
              })

              try {
                await api.ensureAuth()
              } catch (err) {
                console.warn(
                  `ChatGPTAPIPool invalid session token for account "${accountId}"`,
                  err.toString()
                )
                api = null
              }
            }

            if (!api && accountInit.email && accountInit.password) {
              const sessionToken = await generateSessionTokenForOpenAIAccount({
                email: accountInit.email,
                password: accountInit.password
              })

              api = new ChatGPTAPI({
                ...this._chatgptapiOptions,
                sessionToken
              })
            }

            if (!api) {
              console.error(
                `ChatGPTAPIPool unable to obtain auth for account "${accountId}"`
              )
              return null
            }

            const account = {
              ...accountInit,
              api,
              id: accountId
            }

            console.log(
              `ChatGPTAPIPool successfully initialized account "${accountId}"`
            )
            return account
          } catch (err) {
            console.error(
              `ChatGPTAPIPool error obtaining auth for account "${accountId}"`,
              err.toString()
            )
            return null
          }
        },
        {
          concurrency: 1
        }
      )
    ).filter(Boolean)

    this._accountsMap = this._accounts.reduce(
      (map, account) => ({
        ...map,
        [account.id]: account
      }),
      {}
    )

    await this.storeAccountsToDisk()
  }

  get accounts(): ChatGPTAPIAccount[] {
    if (!this._accounts) {
      throw new Error('ChatGPTAPIPool error must call init() before use')
    }

    return this._accounts
  }

  get accountsMap(): Record<string, ChatGPTAPIAccount> {
    if (!this._accountsMap) {
      throw new Error('ChatGPTAPIPool error must call init() before use')
    }

    return this._accountsMap
  }

  async getAPIAccount(): Promise<ChatGPTAPIAccount> {
    do {
      this._accountOffset = (this._accountOffset + 1) % this.accounts.length
      const account = this.accounts[this._accountOffset]

      if (!this._accountsOnCooldown.has(account.id)) {
        return account
      }

      if (this._accountsOnCooldown.size >= this.accounts.length) {
        // All API accounts are on cooldown, so wait and try again
        await delay(1000)
      }
    } while (true)
  }

  async getAPIAccountById(accountId: string): Promise<ChatGPTAPIAccount> {
    const account = this.accountsMap[accountId]
    if (!account) {
      return null
    }

    if (!this._accountsOnCooldown.has(account.id)) {
      return account
    }

    console.log(`ChatGPT account ${account.id} is on cooldown; sleeping...`)

    do {
      await delay(1000)

      if (!this._accountsOnCooldown.has(account.id)) {
        return account
      }
    } while (true)
  }

  override async getIsAuthenticated() {
    const account = await this.getAPIAccount()
    console.log('getIsAuthenticated', account.id)
    return await account.api.getIsAuthenticated()
  }

  override async ensureAuth() {
    const account = await this.getAPIAccount()
    console.log('ensureAuth', account.id)

    try {
      return await account.api.ensureAuth()
    } catch (err) {
      if (account.email && account.password) {
        if (await this.tryRefreshSessionTokenForAccount(account.id)) {
          return await account.api.ensureAuth()
        }
      }

      throw err
    }
  }

  override async refreshAccessToken() {
    const account = await this.getAPIAccount()
    console.log('refreshAccessToken', account.id)

    try {
      return await account.api.refreshAccessToken()
    } catch (err) {
      if (account.email && account.password) {
        if (await this.tryRefreshSessionTokenForAccount(account.id)) {
          return await account.api.refreshAccessToken()
        }
      }

      throw err
    }
  }

  /**
   * Attempts to renew an account's session token automatically if an `email` and
   * `password` were provided.
   *
   * @returns `true` if successful, `false` otherwise
   */
  async tryRefreshSessionTokenForAccount(accountId: string) {
    const account = this.accountsMap[accountId]

    if (!account) {
      const error = new ChatError(
        `ChatGPTAPIPool account not found "${accountId}"`
      )
      error.type = 'chatgpt:pool:account-not-found'
      error.isFinal = true
      error.accountId = accountId
      throw error
    }

    if (account.email && account.password) {
      const sessionToken = await generateSessionTokenForOpenAIAccount({
        email: account.email,
        password: account.password
      })

      account.sessionToken = sessionToken
      account.api = new ChatGPTAPI({
        ...this._chatgptapiOptions,
        sessionToken
      })

      await this.storeAccountsToDisk()
      return true
    }

    return false
  }

  override async sendMessage(
    prompt: string,
    opts: ChatGPTAPISendMessageOptions
  ) {
    const res = await this.sendMessageToAccount(prompt, opts)
    return res.response
  }

  async sendMessageToAccount(
    prompt: string,
    opts: ChatGPTAPISendMessageOptions & {
      accountId?: string
    }
  ): Promise<{ response: string; accountId: string }> {
    let { accountId, ...rest } = opts
    let account: ChatGPTAPIAccount

    let numRetries = 0

    do {
      try {
        if (numRetries <= 0) {
          if (!accountId && opts.conversationId) {
            // If there is no account specified, but the request is part of an existing
            // conversation, then use the default account which handled all conversations
            // before we added support for multiple accounts.
            accountId = this.accounts[0].id
          }

          if (accountId) {
            account = await this.getAPIAccountById(accountId)

            if (!account) {
              // TODO: this is a really bad edge case because it means the account that
              // we previously used in this conversation is no longer available... I'm
              // really not sure how to handle this aside from throwing an unrecoverable
              // error to the user
              const error = new ChatError(
                `ChatGPTAPIPool account not found "${accountId}"`
              )
              error.type = 'chatgpt:pool:account-not-found'
              error.isFinal = true
              error.accountId = accountId
              throw error
            }
          } else {
            account = await this.getAPIAccount()
          }
        }

        console.log('using chatgpt account', account.id)
        const response = await account.api.sendMessage(prompt, rest)

        const responseL = response.toLowerCase()
        if (responseL.includes('too many requests, please slow down')) {
          this._accountsOnCooldown.set(account.id, true, {
            maxAge: this._accountCooldownMs * 3
          })
          return null
        }

        if (
          responseL.includes('your authentication token has expired') ||
          responseL.includes('please try signing in again') ||
          responseL.includes('your session has expired')
        ) {
          if (++numRetries <= 1) {
            console.log(
              `chatgpt response indicates expired session for "${account.id}"`,
              response
            )

            if (await this.tryRefreshSessionTokenForAccount(account.id)) {
              continue
            }
          }

          this._accountsOnCooldown.set(account.id, true, {
            maxAge: this._accountCooldownMs * 2
          })
          return null
        }

        return { response, accountId: account.id }
      } catch (err) {
        if (err.name === 'TimeoutError') {
          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${account.id} timeout; refreshing session`
            )

            if (await this.tryRefreshSessionTokenForAccount(account.id)) {
              continue
            }
          }

          // ChatGPT timed out
          this._accountsOnCooldown.set(account.id, true)

          const error = new ChatError(err.toString())
          error.type = 'chatgpt:pool:timeout'
          error.isFinal = false
          error.accountId = account.id
          throw error
        } else if (err instanceof ChatGPTError) {
          if (err.statusCode === 429) {
            console.log('\nchatgpt rate limit', account.id, '\n')
            this._accountsOnCooldown.set(account.id, true, {
              maxAge: this._accountCooldownMs * 5
            })

            const error = new ChatError(err.toString())
            error.type = 'chatgpt:pool:rate-limit'
            error.isFinal = false
            error.accountId = account.id
            throw error
          } else if (err.statusCode === 503 || err.statusCode === 502) {
            if (++numRetries <= 1) {
              console.log(
                `chatgpt account ${
                  account.id
                } ${err.toString()}; refreshing session`
              )

              if (await this.tryRefreshSessionTokenForAccount(account.id)) {
                continue
              }
            }

            this._accountsOnCooldown.set(account.id, true, {
              maxAge: this._accountCooldownMs * 2
            })

            const error = new ChatError(err.toString())
            error.type = 'chatgpt:pool:unavailable'
            error.isFinal = true
            error.accountId = account.id
            throw error
          } else if (err.statusCode === 500) {
            console.error('UNEXPECTED CHATGPT ERROR', err)

            if (++numRetries <= 1) {
              console.log(
                `chatgpt account ${
                  account.id
                } unexpected error ${err.toString()}; refreshing session`
              )
              if (await this.tryRefreshSessionTokenForAccount(account.id)) {
                continue
              }
            }

            this.removeAccountFromPool(account.id, { err })
          } else {
            console.error('UNEXPECTED CHATGPT ERROR', err)

            if (++numRetries <= 1) {
              console.log(
                `chatgpt account ${
                  account.id
                } unexpected error ${err.toString()}; refreshing session`
              )
              if (await this.tryRefreshSessionTokenForAccount(account.id)) {
                continue
              }
            }

            this._accountsOnCooldown.set(account.id, true, {
              maxAge: this._accountCooldownMs * 5
            })
          }
        } else {
          console.error('UNEXPECTED CHATGPT ERROR', err)

          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${
                account.id
              } unexpected error ${err.toString()}; refreshing session`
            )
            if (await this.tryRefreshSessionTokenForAccount(account.id)) {
              continue
            }
          }

          this.removeAccountFromPool(account.id, { err })
        }

        throw err
      }
    } while (true)
  }

  async storeAccountsToDisk() {
    // Store updated account details
    await mkdir(cacheDir)
    const accountsPath = path.join(cacheDir, 'accounts.json')
    await fs.writeFile(
      accountsPath,
      JSON.stringify(
        this._accounts.map((account) => omit(account, 'api')),
        null,
        2
      ),
      'utf-8'
    )
  }

  async removeAccountFromPool(accountId: string, { err }: { err?: Error }) {
    console.log(
      `CHATGPT ERROR REMOVING chatgpt account ${accountId} from pool; unexpected error ${err.toString()}`
    )

    this._accounts = this._accounts.filter((a) => a.id !== accountId)
    delete this._accountsMap[accountId]
    this._accountOffset = this._accountOffset % this._accounts.length

    await this.storeAccountsToDisk()
  }
}
