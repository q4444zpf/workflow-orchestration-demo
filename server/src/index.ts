import { createApp } from './app.js'
import { initializeDb } from './db/index.js'

const app = createApp()
const PORT = process.env.PORT || 3000

await initializeDb()
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
