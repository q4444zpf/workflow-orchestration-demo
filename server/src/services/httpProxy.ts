import { evaluatePath } from './valuePath.js'
import axios, { AxiosRequestConfig, Method } from 'axios'

export interface HttpConfig {
  method: Method
  url: string
  headers?: Record<string, string>
  resolvedHeaders?: Record<string, string>
  body?: unknown
  bodyIsValue?: boolean
  params?: Record<string, unknown>
  timeout?: number
}

export interface HttpResult {
  status: number
  data: unknown
  headers: Record<string, string>
}

export class HttpProxyError extends Error {
  status?: number
  data?: unknown

  constructor(message: string, options?: { status?: number; data?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'HttpProxyError'
    this.status = options?.status
    this.data = options?.data
  }
}

export interface HttpCallOptions {
  signal?: AbortSignal
  maxOutputBytes?: number
}

function abortError(cause: unknown): Error {
  const error = new Error('HTTP request canceled', { cause })
  error.name = 'AbortError'
  return error
}

function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

function responseHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (value === null || typeof value !== 'object') return headers
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      headers[key] = String(entry)
    } else if (Array.isArray(entry) && entry.every(item => typeof item === 'string')) {
      headers[key] = entry.join(', ')
    }
  }
  return headers
}

export async function callHttpApi(config: HttpConfig, context: unknown, options: HttpCallOptions = {}): Promise<HttpResult> {
  if (options.signal?.aborted) throw abortError(options.signal.reason)
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new HttpProxyError('maxOutputBytes must be a positive safe integer')
  }
  const url = renderTemplate(config.url, context)
  const headers: Record<string, string> = {}
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      headers[k] = renderTemplate(v, context)
    }
  }
  // 新绑定已经求值；与旧模板头分离，避免把字面量或引用值再次展开。
  for (const [key, value] of Object.entries(config.resolvedHeaders || {})) {
    for (const existing of Object.keys(headers)) if (existing.toLowerCase() === key.toLowerCase()) delete headers[existing]
    headers[key] = value
  }

  const body = config.body !== undefined
    ? (typeof config.body === 'string' && !config.bodyIsValue ? renderTemplate(config.body, context) : config.body)
    : undefined

  const axiosConfig: AxiosRequestConfig = {
    method: config.method,
    url,
    headers,
    timeout: config.timeout || 30000,
    signal: options.signal,
    maxContentLength: maxOutputBytes,
    maxBodyLength: maxOutputBytes
  }
  if (config.params !== undefined) axiosConfig.params = config.params

  if (body !== undefined && config.method !== 'GET') {
    if (config.bodyIsValue) {
      const contentType = Object.keys(headers).find(key => key.toLowerCase() === 'content-type')
      if (!contentType) headers['Content-Type'] = 'application/json'
      axiosConfig.data = typeof body === 'string' && contentType && !headers[contentType].toLowerCase().includes('json') ? body : JSON.stringify(body)
    } else if (typeof body === 'string') {
      try {
        axiosConfig.data = JSON.parse(body)
      } catch (err) {
        throw new HttpProxyError(
          `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
          { data: body, cause: err }
        )
      }
    } else {
      axiosConfig.data = body
    }
  }

  try {
    const res = await axios<unknown>(axiosConfig)
    return {
      status: res.status,
      data: res.data,
      headers: responseHeaders(res.headers)
    }
  } catch (err: unknown) {
    if (options.signal?.aborted || property(err, 'code') === 'ERR_CANCELED' || property(err, 'name') === 'AbortError') {
      throw abortError(err)
    }
    const response = property(err, 'response')
    const responseStatus = property(response, 'status')
    const status = typeof responseStatus === 'number' ? responseStatus : undefined
    const message = status
      ? `HTTP request failed: ${status}`
      : (err instanceof Error && err.message ? err.message : 'HTTP request failed')
    throw new HttpProxyError(message, {
      status,
      data: property(response, 'data'),
      cause: err
    })
  }
}

function renderTemplate(template: string, context: unknown): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const value = evaluatePath(expr.trim(), context)
    return value === undefined ? '' : String(value)
  })
}
