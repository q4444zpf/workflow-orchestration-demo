import { Client, Connection } from '@temporalio/client'
import { temporalAddress, temporalNamespace } from './config.js'

let connection: Connection | undefined
let pending: Promise<Client> | undefined

export function getTemporalClient(): Promise<Client> {
  if (!pending) {
    pending = Connection.connect({ address: temporalAddress(), connectTimeout: '3 seconds' }).then(value => {
      connection = value
      return new Client({ connection: value, namespace: temporalNamespace() })
    }).catch(error => { pending = undefined; throw error })
  }
  return pending
}

export async function closeTemporalClient(): Promise<void> {
  const current = connection
  connection = undefined
  pending = undefined
  await current?.close()
}
