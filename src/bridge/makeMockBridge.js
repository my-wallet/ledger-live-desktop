// @flow
import logger from 'logger'
import { Observable } from 'rxjs'
import {
  genAccount,
  genAddingOperationsInAccount,
  genOperation,
} from '@ledgerhq/live-common/lib/mock/account'
import { getOperationAmountNumber } from '@ledgerhq/live-common/lib/helpers/operation'
import Prando from 'prando'
import type { Operation } from '@ledgerhq/live-common/lib/types'
import type { WalletBridge } from './types'

const defaultOpts = {
  syncSuccessRate: 0.8,
  scanAccountDeviceSuccessRate: 0.8,
  transactionsSizeTarget: 100,
  extraInitialTransactionProps: () => null,
}

const delay = ms => new Promise(success => setTimeout(success, ms))

type Opts = *

function makeMockBridge(opts?: Opts): WalletBridge<*> {
  const {
    syncSuccessRate,
    transactionsSizeTarget,
    EditFees,
    EditAdvancedOptions,
    scanAccountDeviceSuccessRate,
    extraInitialTransactionProps,
    getTotalSpent,
    getMaxAmount,
    checkCanBeSpent,
  } = {
    ...defaultOpts,
    ...opts,
  }

  const broadcasted: { [_: string]: Operation[] } = {}

  const syncTimeouts = {}

  return {
    synchronize: initialAccount =>
      Observable.create(o => {
        const accountId = initialAccount.id
        if (syncTimeouts[accountId]) {
          // this is just for tests. we'll assume impl don't need to handle race condition on this function.
          logger.warn('synchronize was called multiple pending time for same accounts!!!')
        }
        syncTimeouts[accountId] = setTimeout(() => {
          if (Math.random() < syncSuccessRate) {
            const ops = broadcasted[accountId] || []
            broadcasted[accountId] = []
            o.next(account => {
              account = { ...account }
              account.blockHeight++
              for (const op of ops) {
                account.balance = account.balance.plus(getOperationAmountNumber(op))
              }
              return account
            })
            o.complete()
          } else {
            o.error(new Error('Sync Failed'))
          }
          syncTimeouts[accountId] = null
        }, 20000)

        return () => {
          clearTimeout(syncTimeouts[accountId])
          syncTimeouts[accountId] = null
        }
      }),

    scanAccountsOnDevice: currency =>
      Observable.create(o => {
        let unsubscribed = false

        async function job() {
          if (Math.random() > scanAccountDeviceSuccessRate) {
            await delay(1000)
            if (!unsubscribed) o.error(new Error('scan failed'))
            return
          }
          const nbAccountToGen = 3
          for (let i = 0; i < nbAccountToGen && !unsubscribed; i++) {
            await delay(500)
            const account = genAccount(String(Math.random()), {
              operationsSize: 0,
              currency,
            })
            account.unit = currency.units[0]
            if (!unsubscribed) o.next(account)
          }
          if (!unsubscribed) o.complete()
        }

        job()

        return {
          unsubscribe() {
            unsubscribed = true
          },
        }
      }),

    pullMoreOperations: async (_accountId, _desiredCount) => {
      await delay(1000)
      return account => {
        if (transactionsSizeTarget >= account.operations.length) return account
        const count = transactionsSizeTarget * (0.1 + 0.5 * Math.random())
        account = { ...account }
        return genAddingOperationsInAccount(account, count, String(Math.random()))
      }
    },

    isRecipientValid: (currency, recipient) => Promise.resolve(recipient.length > 0),

    createTransaction: () => ({
      amount: 0,
      recipient: '',
      ...extraInitialTransactionProps(),
    }),

    editTransactionAmount: (account, t, amount) => ({
      ...t,
      amount,
    }),

    getTransactionAmount: (a, t) => t.amount,

    editTransactionRecipient: (account, t, recipient) => ({
      ...t,
      recipient,
    }),

    getTransactionRecipient: (a, t) => t.recipient,

    EditFees,

    EditAdvancedOptions,

    isValidTransaction: (a, t) => (t.amount > 0 && t.recipient && true) || false,

    checkCanBeSpent,

    getTotalSpent,

    getMaxAmount,

    signAndBroadcast: (account, t) =>
      Observable.create(o => {
        const rng = new Prando()
        const op = genOperation(account, account.operations, account.currency, rng)
        op.type = 'OUT'
        op.value = t.amount
        op.blockHash = null
        op.blockHeight = null
        op.senders = [account.freshAddress]
        op.recipients = [t.recipient]
        op.blockHeight = account.blockHeight
        op.date = new Date()
        broadcasted[account.id] = (broadcasted[account.id] || []).concat(op)
        o.next({ type: 'signed' })
        o.next({ type: 'broadcasted', operation: { ...op } })
      }),
  }
}

export default makeMockBridge
