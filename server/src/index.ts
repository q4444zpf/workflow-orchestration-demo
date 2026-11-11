import { createApp } from './app.js'
import { initializeDb } from './db/index.js'
import { startExecutionReconciler } from './services/executionService.js'
import { interruptLegacyExecutions } from './services/executionStore.js'
import { closeTemporalClient } from './temporal/client.js'

const app = createApp()
const PORT = process.env.PORT || 3000

await initializeDb()
await interruptLegacyExecutions()
const stopReconciler = startExecutionReconciler()
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

function shutdown() {
  stopReconciler()
  server.close(() => { void closeTemporalClient().finally(() => process.exit(0)) })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
