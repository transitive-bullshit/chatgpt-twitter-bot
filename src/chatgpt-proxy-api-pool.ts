import { ChatGPTUnofficialProxyAPI, type ChatMessage } from 'chatgpt'
import delay from 'delay'
import pMap from 'p-map'
import QuickLRU from 'quick-lru'
import random from 'random'

import * as types from './types'

type ChatGPTAPIInstance = InstanceType<typeof ChatGPTUnofficialProxyAPI>
type ChatGPTAPISendMessageOptions = Parameters<
  ChatGPTAPIInstance['sendMessage']
>[1]
type ChatGPTAPIInstanceOptions = Omit<
  ConstructorParameters<typeof ChatGPTUnofficialProxyAPI>[0],
  'accessToken'
>

export interface ChatGPTAPIAccountInit {
  email: string
  password: string
}

interface ChatGPTAPIAccount extends ChatGPTAPIAccountInit {
  id: string
  api: ChatGPTUnofficialProxyAPI
}

/**
 * Wrapper around N instances of ChatGPTBrowserAPI that handles rotating out accounts
 * that are on cooldown.
 *
 * Whenever you send a message using the pool, a random account will be chosen.
 *
 * NOTE: **`conversationId` and `parentMessageId` are account-specific**, so
 * conversations cannot be transferred between accounts.
 */
export class ChatGPTUnofficialProxyAPIPool extends ChatGPTUnofficialProxyAPI {
  protected _accounts: Array<ChatGPTAPIAccount>
  protected _accountsMap: Record<string, ChatGPTAPIAccount>
  protected _accountsInit: Array<ChatGPTAPIAccountInit>
  protected _accountsOnCooldown: QuickLRU<string, boolean>
  protected _accountsInUse: Set<string>
  protected _accountCooldownMs: number
  protected _accountOffset: number
  protected _chatgptapiOptions: ChatGPTAPIInstanceOptions
  protected _getAccessTokenFn: types.GetAccessTokenFn

  constructor(
    accounts: ChatGPTAPIAccountInit[],
    opts: ChatGPTAPIInstanceOptions & {
      apiCooldownMs?: number
      getAccesstokenFn: types.GetAccessTokenFn
    }
  ) {
    const {
      apiCooldownMs = 1 * 60 * 1000,
      getAccesstokenFn,
      ...initOptions
    } = opts

    if (!accounts.length) {
      throw new Error(
        'ChatGPTUnofficialProxyAPIPool must pass at least one account'
      )
    }

    super({
      ...initOptions,
      accessToken: 'invalid'
    })

    this._chatgptapiOptions = initOptions
    this._accountsInit = accounts
    this._getAccessTokenFn = getAccesstokenFn

    this._accountOffset = 0
    this._accountCooldownMs = apiCooldownMs
    this._accountsOnCooldown = new QuickLRU<string, boolean>({
      maxSize: 1024,
      maxAge: apiCooldownMs
    })
    this._accountsInUse = new Set<string>()
  }

  /**
   * Initializes all ChatGPT accounts and ensures value session tokens for
   * each of them.
   */
  async init() {
    console.log(
      'initializing',
      this._accountsInit.length,
      'chatgpt accounts...'
    )

    // randomize account initialization
    const accountsInit: Array<ChatGPTAPIAccountInit> = []
    const n = this._accountsInit.length
    const r = [...Array(n).keys()]
    for (let i = 0; i < n; ++i) {
      const j = Math.max(0, random.int(0, r.length - 1))
      const a = this._accountsInit[r[j]]
      r.splice(j, 1)
      accountsInit.push(a)
    }

    this._accounts = (
      await pMap(
        accountsInit,
        async (accountInit, index): Promise<ChatGPTAPIAccount> => {
          let api: ChatGPTUnofficialProxyAPI = null
          const accountId = accountInit.email || `account-${index}`

          try {
            if (!accountInit.email || !accountInit.password) {
              console.error('invalid chatgpt account', accountInit)
              return null
            }

            if (index > 2) {
              await delay(2000)
            }

            console.log('initializing chatgpt account', accountInit)

            const accessToken = await this._getAccessTokenFn(accountInit)
            if (!accessToken) {
              console.warn(
                `ChatGPTUnofficialProxyAPIPool invalid session token for account "${accountId}"`
              )
            }

            api = new ChatGPTUnofficialProxyAPI({
              ...accountInit,
              ...this._chatgptapiOptions,
              accessToken: accessToken
            })

            const account = {
              ...accountInit,
              api,
              id: accountId
            }

            console.log(
              `ChatGPTUnofficialProxyAPIPool successfully initialized account "${accountId}"`
            )
            return account
          } catch (err) {
            console.error(
              `ChatGPTUnofficialProxyAPIPool error obtaining auth for account "${accountId}"`,
              err.toString()
            )

            await delay(3000)
            return null
          }
        },
        {
          concurrency: 2
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

    if (!this._accounts.length) {
      throw new Error('Failed to initialize all ChatGPT accounts')
    }

    console.log(
      '\n\ninitialized',
      this._accounts.length,
      'chatgpt accounts out of',
      this._accountsInit.length,
      'total accounts',
      this._accounts.map((a) => a.id),
      '\n'
    )
  }

  get accounts(): ChatGPTAPIAccount[] {
    if (!this._accounts) {
      throw new Error(
        'ChatGPTUnofficialProxyAPIPool error must call init() before use'
      )
    }

    return this._accounts
  }

  get accountsMap(): Record<string, ChatGPTAPIAccount> {
    if (!this._accountsMap) {
      throw new Error(
        'ChatGPTUnofficialProxyAPIPool error must call init() before use'
      )
    }

    return this._accountsMap
  }

  async getAPIAccount(): Promise<ChatGPTAPIAccount> {
    do {
      this._accountOffset = (this._accountOffset + 1) % this.accounts.length
      const account = this.accounts[this._accountOffset]
      if (!account) {
        return null
      }

      if (
        !this._accountsOnCooldown.has(account.id) &&
        !this._accountsInUse.has(account.id)
      ) {
        return account
      }

      if (
        this._accountsOnCooldown.size + this._accountsInUse.size >=
        this.accounts.length
      ) {
        console.log(`ChatGPT all accounts are on cooldown; sleeping...`)
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

    const isInUse = this._accountsInUse.has(account.id)
    if (!this._accountsOnCooldown.has(account.id) && !isInUse) {
      return account
    }

    console.log(
      `ChatGPT account ${account.id} ${
        isInUse ? 'is in use' : 'is on cooldown'
      }; sleeping...`
    )

    const maxNumTries = isInUse ? 200 : 5
    let numTries = 0

    do {
      await delay(1000)
      ++numTries

      if (
        !this._accountsOnCooldown.has(account.id) &&
        !this._accountsInUse.has(account.id)
      ) {
        return account
      }
    } while (numTries < maxNumTries)

    const error = new types.ChatError(
      `ChatGPTUnofficialProxyAPIPool account on cooldown "${accountId}"`
    )
    error.type = 'chatgpt:pool:account-on-cooldown'
    error.isFinal = false
    error.accountId = accountId
    throw error
  }

  /**
   * Attempts to renew an account's session token automatically if an `email` and
   * `password` were provided.
   *
   * @returns `true` if successful, `false` otherwise
   */
  async tryRefreshSessionForAccount(accountId: string) {
    const account = this.accountsMap[accountId]

    if (!account) {
      const error = new types.ChatError(
        `ChatGPTUnofficialProxyAPIPool account not found "${accountId}"`
      )
      error.type = 'chatgpt:pool:account-not-found'
      error.isFinal = true
      error.accountId = accountId
      throw error
    }

    if (account.email && account.password) {
      const accessToken = await this._getAccessTokenFn(account)
      if (accessToken) {
        account.api.accessToken = accessToken
        return true
      }
    }

    return false
  }

  override async sendMessage(
    prompt: string,
    opts: ChatGPTAPISendMessageOptions
  ) {
    return this.sendMessageToAccount(prompt, opts)
  }

  async sendMessageToAccount(
    prompt: string,
    opts: ChatGPTAPISendMessageOptions & {
      accountId?: string
    } = {}
  ): Promise<ChatMessage & { accountId: string }> {
    let { accountId, ...rest } = opts
    let account: ChatGPTAPIAccount
    let numRetries = 0

    do {
      try {
        if (numRetries <= 0) {
          if (!accountId && opts.conversationId) {
            // accountId = this.accounts[0].id
            rest.conversationId = undefined
            rest.parentMessageId = undefined
          }

          if (accountId) {
            account = await this.getAPIAccountById(accountId)

            if (!account) {
              // TODO: this is a really bad edge case because it means the account that
              // we previously used in this conversation is no longer available... I'm
              // really not sure how to handle this aside from throwing an unrecoverable
              // error to the user
              console.warn(
                `chatgpt account "${accountId}" not found; falling back to new conversation`
              )

              accountId = null
              opts.conversationId = undefined
              opts.parentMessageId = undefined
              account = await this.getAPIAccount()
            }
          } else {
            account = await this.getAPIAccount()
          }

          if (!account) {
            const error = new types.ChatError(
              `ChatGPTUnofficialProxyAPIPool no accounts available`
            )
            error.type = 'chatgpt:pool:no-accounts'
            error.isFinal = false
            throw error
          }
        }

        console.log('using chatgpt account', account.id)
        // const moderationPre = await account.api.sendModeration(prompt)
        // console.log('chatgpt moderation pre', account.id, moderationPre)

        this._accountsInUse.add(account.id)

        // await account.api.resetThread()
        const res = await account.api.sendMessage(prompt, rest)

        this._accountsInUse.delete(account.id)

        return { ...res, accountId: account.id }
      } catch (err) {
        if (err.name === 'TimeoutError' || err.statusCode === 504) {
          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${account?.id} timeout; pausing for 15s...`
            )
            await delay(15 * 1000)
            continue
          } else if (numRetries <= 2) {
            console.log(
              `chatgpt account ${account?.id} timeout; refreshing session`
            )

            if (await this.tryRefreshSessionForAccount(account?.id)) {
              continue
            }
          }

          // ChatGPT timed out
          console.log('chatgpt COOLDOWN', account?.id, 'timeout')
          this._accountsOnCooldown.set(account?.id, true)

          const error = new types.ChatError(err.toString())
          error.type = 'chatgpt:pool:timeout'
          error.isFinal = false
          error.accountId = account?.id
          throw error
        } else if (err.statusCode === 429) {
          console.log(
            '\nchatgpt 429',
            account?.id,
            err.statusText,
            err.toString(),
            '\n'
          )

          this._accountsOnCooldown.set(account?.id, true, {
            maxAge: this._accountCooldownMs * 3
          })

          const error = new types.ChatError(err.toString())
          error.type = 'chatgpt:pool:rate-limit'
          error.isFinal = false
          error.accountId = account?.id
          throw error
        } else if (err.statusCode === 403) {
          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${
                account?.id
              } ${err.toString()}; refreshing session`
            )

            if (await this.tryRefreshSessionForAccount(account?.id)) {
              continue
            }
          }

          console.log('\nchatgpt 403', account?.id, '\n')
          const error = new types.ChatError(err.toString())
          error.type = 'chatgpt:pool:account-on-cooldown'
          error.isFinal = false
          error.accountId = account?.id
          throw error
        } else if (err.statusCode === 404) {
          console.log(
            'chatgpt error 404',
            account?.id,
            prompt,
            rest,
            err.toString()
          )

          throw err
        } else if (err.statusCode === 503 || err.statusCode === 502) {
          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${
                account?.id
              } ${err.toString()}; refreshing session`
            )

            if (await this.tryRefreshSessionForAccount(account?.id)) {
              continue
            }
          }

          console.log('chatgpt COOLDOWN', account?.id, err.statusCode)
          this._accountsOnCooldown.set(account?.id, true, {
            maxAge: this._accountCooldownMs * 2
          })

          const error = new types.ChatError(err.toString())
          error.type = 'chatgpt:pool:unavailable'
          error.isFinal = true
          error.accountId = account?.id
          throw error
        } else if (err.statusCode === 500) {
          console.error('UNEXPECTED CHATGPT ERROR', err)

          if (++numRetries <= 1) {
            console.log(
              `chatgpt account ${
                account?.id
              } unexpected error ${err.toString()}; refreshing session`
            )

            if (await this.tryRefreshSessionForAccount(account?.id)) {
              continue
            }
          }
        } else if (err.type === 'chatgpt:pool:account-on-cooldown') {
          throw err
        } else if (err.type === 'chatgpt:pool:no-accounts') {
          throw err
        } else {
          console.error('UNEXPECTED CHATGPT ERROR', err)

          if (account?.id && ++numRetries <= 1) {
            console.log(
              `chatgpt account ${
                account?.id
              } unexpected error ${err.toString()}; refreshing session`
            )
            if (await this.tryRefreshSessionForAccount(account?.id)) {
              continue
            }
          }

          this._accountsOnCooldown.set(account?.id || accountId, true, {
            maxAge: this._accountCooldownMs * 5
          })
        }

        throw err
      } finally {
        if (account?.id) {
          this._accountsInUse.delete(account.id)
        }
      }
    } while (true)
  }
}
