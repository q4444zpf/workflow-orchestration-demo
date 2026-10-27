import express from 'express'
import cors from 'cors'
import apiRoutes from './routes/apis.js'
import workflowRoutes from './routes/workflows.js'
import executionRoutes from './routes/executions.js'
import { errorHandler } from './middleware/errorHandler.js'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.use('/api/apis', apiRoutes)
  app.use('/api/workflows', workflowRoutes)
  app.use('/api/executions', executionRoutes)

  app.use(errorHandler)

  return app
}
