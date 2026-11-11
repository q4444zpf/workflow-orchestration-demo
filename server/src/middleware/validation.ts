import { HttpError } from './errorHandler.js'
import { RegisteredApi, Workflow } from '../types/index.js'
import { resolveParameterValues, validateParameterDefinitions } from '../shared/parameterSchema.js'

export function validateId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `Invalid id: ${raw}`)
  }
  return id
}

export function validateVariables(definitions: unknown, inputs: unknown): Record<string, unknown> {
  const result = resolveParameterValues(definitions, inputs)
  if (result.issues.length) throw new HttpError(400, result.issues.map(issue => issue.message).join('；'), result.issues.map(issue => ({ code: 'PARAMETER_INVALID', message: issue.message, path: issue.path })))
  return result.values
}

export function validateRegisteredApi(body: any): RegisteredApi {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'Request body must be an object')
  }
  const { name, method, url } = body
  if (!name || typeof name !== 'string') {
    throw new HttpError(400, 'Field "name" is required and must be a string')
  }
  if (!method || !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    throw new HttpError(400, 'Field "method" must be one of GET, POST, PUT, DELETE')
  }
  if (!url || typeof url !== 'string') {
    throw new HttpError(400, 'Field "url" is required and must be a string')
  }
  return {
    name,
    description: body.description,
    method,
    url,
    headers: body.headers,
    sample_params: body.sample_params,
    output_schema: body.output_schema
  }
}

export function validateWorkflow(body: any): Workflow {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'Request body must be an object')
  }
  const { name, nodes, edges } = body
  if (!name || typeof name !== 'string') {
    throw new HttpError(400, 'Field "name" is required and must be a string')
  }
  if (!Array.isArray(nodes)) {
    throw new HttpError(400, 'Field "nodes" is required and must be an array')
  }
  if (!Array.isArray(edges)) {
    throw new HttpError(400, 'Field "edges" is required and must be an array')
  }
  if (body.schema_version !== undefined && body.schema_version !== 1) {
    throw new HttpError(400, '不支持的工作流 JSON 版本，仅支持 schema_version=1')
  }
  const parameterIssues = validateParameterDefinitions(body.variables)
  if (parameterIssues.length) throw new HttpError(400, parameterIssues.map(issue => issue.message).join('；'))
  return {
    schema_version: 1,
    name,
    description: body.description,
    variables: body.variables,
    nodes,
    edges
  }
}
