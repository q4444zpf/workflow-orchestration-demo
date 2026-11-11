import http from 'node:http'
import { it, expect } from 'vitest'
import { callHttpApi } from '../src/services/httpProxy.js'
import { executeTaskNode } from '../src/services/nodeExecutor.js'

async function echo(action: (url: string) => Promise<void>) {
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk.toString()
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ body, headers: req.headers }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('临时端口不可用')
  try { await action(`http://127.0.0.1:${address.port}`) }
  catch (error) { throw new Error(error instanceof Error ? error.message : String(error)) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
it.each([false, 0, 123, null, 'hello'])('表单请求体按JSON值序列化，顶层标量不能被Axios丢弃：%j', async body => {
  await echo(async url => {
    const response = await callHttpApi({ method: 'POST', url, body, bodyIsValue: true }, {})
    expect(response.data).toMatchObject({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  })
})
it('新请求头的固定值与引用只求值一次，旧模板仍正常求值', async () => {
  await echo(async url => {
    const output = await executeTaskNode({ id: 'h', type: 'http', position: { x: 0, y: 0 }, data: { method: 'GET', url,
      headers: { 'X-Legacy': '{{var.secret}}' }, requestHeaders: {
        'X-Literal': { kind: 'literal', value: '{{var.secret}}' },
        'X-Reference': { kind: 'reference', path: 'var.raw' },
        'X-Template': { kind: 'template', value: 'prefix-{{var.secret}}' }
      }
    } }, {}, { var: { secret: 'expanded', raw: '{{var.secret}}' }, ctx: {} })
    expect(output).toMatchObject({ data: { headers: { 'x-literal': '{{var.secret}}', 'x-reference': '{{var.secret}}', 'x-template': 'prefix-expanded', 'x-legacy': 'expanded' } } })
  })
})
