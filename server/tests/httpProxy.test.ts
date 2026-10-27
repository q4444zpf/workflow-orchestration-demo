import { describe, it, expect } from 'vitest'
import { callHttpApi } from '../src/services/httpProxy.js'

describe('httpProxy', () => {
  it('renders url template from context', async () => {
    const result = await callHttpApi(
      { method: 'GET', url: 'https://httpbin.org/get?x={{ctx.userId}}' },
      { ctx: { userId: 42 } }
    )
    expect(result.status).toBe(200)
    expect(result.data.args.x).toBe('42')
  })
})
