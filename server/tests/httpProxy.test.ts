import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { callHttpApi, HttpProxyError } from '../src/services/httpProxy.js'

vi.mock('axios')

const mockedAxios = vi.mocked(axios, true) as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockedAxios.mockReset()
})

describe('callHttpApi', () => {
  it('renders URL template from context', async () => {
    mockedAxios.mockResolvedValue({ status: 200, data: {}, headers: {} })

    await callHttpApi(
      { method: 'GET', url: 'https://example.com/users/{{userId}}' },
      { userId: 42 }
    )

    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/users/42' })
    )
  })

  it('renders header templates from context', async () => {
    mockedAxios.mockResolvedValue({ status: 200, data: {}, headers: {} })

    await callHttpApi(
      {
        method: 'GET',
        url: 'https://example.com',
        headers: {
          Authorization: 'Bearer {{token}}',
          'X-User': '{{user.id}}'
        }
      },
      { token: 'abc', user: { id: 7 } }
    )

    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer abc',
          'X-User': '7'
        }
      })
    )
  })

  it('renders and parses JSON body template for non-GET methods', async () => {
    mockedAxios.mockResolvedValue({ status: 201, data: { ok: true }, headers: {} })

    const result = await callHttpApi(
      {
        method: 'POST',
        url: 'https://example.com',
        body: '{"id":{{userId}},"name":"{{name}}"}'
      },
      { userId: 7, name: 'Ada' }
    )

    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        data: { id: 7, name: 'Ada' }
      })
    )
    expect(result.status).toBe(201)
  })

  it('throws a structured error for non-2xx responses', async () => {
    const notFoundError = new Error('Request failed with status code 404')
    ;(notFoundError as any).response = {
      status: 404,
      data: { error: 'not found' },
      headers: {}
    }
    mockedAxios.mockRejectedValue(notFoundError)

    try {
      await callHttpApi({ method: 'GET', url: 'https://example.com' }, {})
      throw new Error('expected callHttpApi to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpProxyError)
      expect((err as HttpProxyError).message).toBe('HTTP request failed: 404')
      expect((err as HttpProxyError).status).toBe(404)
      expect((err as HttpProxyError).data).toEqual({ error: 'not found' })
    }
  })

  it('throws a structured error for non-2xx responses without message', async () => {
    const notFoundError = new Error('')
    ;(notFoundError as any).response = {
      status: 500,
      data: { error: 'server error' },
      headers: {}
    }
    mockedAxios.mockRejectedValue(notFoundError)

    try {
      await callHttpApi({ method: 'GET', url: 'https://example.com' }, {})
      throw new Error('expected callHttpApi to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpProxyError)
      expect((err as HttpProxyError).message).toBe('HTTP request failed: 500')
      expect((err as HttpProxyError).status).toBe(500)
    }
  })

  it('throws a structured error when axios rejects with a network/timeout error', async () => {
    const networkError = new Error('ECONNREFUSED')
    ;(networkError as any).response = { status: 0, data: 'connection refused' }
    mockedAxios.mockRejectedValue(networkError)

    try {
      await callHttpApi({ method: 'GET', url: 'https://example.com' }, {})
      throw new Error('expected callHttpApi to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpProxyError)
      expect((err as HttpProxyError).message).toBe('ECONNREFUSED')
      expect((err as HttpProxyError).status).toBe(0)
      expect((err as HttpProxyError).data).toBe('connection refused')
    }
  })

  it('throws a structured error for invalid JSON body', async () => {
    try {
      await callHttpApi(
        { method: 'POST', url: 'https://example.com', body: 'not json' },
        {}
      )
      throw new Error('expected callHttpApi to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpProxyError)
      expect((err as HttpProxyError).message).toContain('Invalid JSON body')
      expect((err as HttpProxyError).data).toBe('not json')
    }
  })

  it('renders missing template variables as empty strings', async () => {
    mockedAxios.mockResolvedValue({ status: 200, data: {}, headers: {} })

    await callHttpApi(
      { method: 'GET', url: 'https://example.com/{{missing}}' },
      {}
    )

    expect(mockedAxios).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com/' })
    )
  })

  it('将取消信号和响应字节限制传给 HTTP 传输层', async () => {
    mockedAxios.mockResolvedValue({ status: 200, data: {}, headers: {} })
    const controller = new AbortController()
    await callHttpApi({ method: 'GET', url: 'https://example.com' }, {}, { signal: controller.signal, maxOutputBytes: 512 })
    expect(mockedAxios).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal, maxContentLength: 512, maxBodyLength: 512
    }))
  })

  it('取消保留可识别的 AbortError 和原始原因', async () => {
    const controller = new AbortController()
    const cancellation = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
    mockedAxios.mockRejectedValue(cancellation)
    await expect(callHttpApi({ method: 'GET', url: 'https://example.com' }, {}, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', cause: cancellation })
  })

  it('已经取消的调用不会发起 HTTP 请求', async () => {
    const controller = new AbortController()
    controller.abort('停止执行')
    await expect(callHttpApi({ method: 'GET', url: 'https://example.com' }, {}, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', cause: '停止执行' })
    expect(mockedAxios).not.toHaveBeenCalled()
  })

  it('响应头转换为字符串字典并忽略空值', async () => {
    mockedAxios.mockResolvedValue({ status: 200, data: {}, headers: { 'x-count': 2, 'set-cookie': ['a=1', 'b=2'], empty: null, missing: undefined } })
    const result = await callHttpApi({ method: 'GET', url: 'https://example.com' }, {})
    expect(result.headers).toEqual({ 'x-count': '2', 'set-cookie': 'a=1, b=2' })
  })
})
