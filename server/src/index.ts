import express from 'express'
import cors from 'cors'
import { initializeDb } from './db/index.js'
import apiRoutes from './routes/apis.js'
import workflowRoutes from './routes/workflows.js'
import executionRoutes from './routes/executions.js'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/apis', apiRoutes)
app.use('/api/workflows', workflowRoutes)
app.use('/api/executions', executionRoutes)

const PORT = process.env.PORT || 3000

await initializeDb()
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
