import express from 'express'
import cors from 'cors'
import { initializeDb } from './db/index.js'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = 3000

app.get('/', (_req, res) => {
  res.send('Workflow Orchestration Server is running')
})

await initializeDb()
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
