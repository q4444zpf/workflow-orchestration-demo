import axios, { AxiosRequestConfig, Method } from 'axios'

export interface HttpConfig {
  method: Method
  url: string
  headers?: Record<string, string>
  body?: any
  timeout?: number
}

export interface HttpResult {
  status: number
  data: any
  headers: Record<string, string>
}

export async function callHttpApi(config: HttpConfig, context: any): Promise<HttpResult> {
  const url = renderTemplate(config.url, context)
  const headers: Record<string, string> = {}
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      headers[k] = renderTemplate(v, context)
    }
  }

  const body = config.body !== undefined
    ? (typeof config.body === 'string' ? renderTemplate(config.body, context) : config.body)
    : undefined

  const axiosConfig: AxiosRequestConfig = {
    method: config.method,
    url,
    headers,
    timeout: config.timeout || 30000,
    validateStatus: () => true
  }

  if (body !== undefined && config.method !== 'GET') {
    axiosConfig.data = typeof body === 'string' ? JSON.parse(body) : body
  }

  const res = await axios(axiosConfig)
  return {
    status: res.status,
    data: res.data,
    headers: res.headers as Record<string, string>
  }
}

function renderTemplate(template: string, context: any): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
    const value = evaluateExpression(expr.trim(), context)
    return value === undefined ? '' : String(value)
  })
}

function evaluateExpression(expr: string, context: any): any {
  const parts = expr.split('.')
  let value = context
  for (const part of parts) {
    if (value == null) return undefined
    value = value[part]
  }
  return value
}
