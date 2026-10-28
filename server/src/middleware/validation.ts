import { HttpError } from './errorHandler.js'
import { RegisteredApi, Workflow } from '../types/index.js'

export function validateId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `Invalid id: ${raw}`)
  }
  return id
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
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new HttpError(400, 'Field "nodes" is required and must be a non-empty array')
  }
  if (!Array.isArray(edges)) {
    throw new HttpError(400, 'Field "edges" is required and must be an array')
  }
  return {
    name,
    description: body.description,
    variables: body.variables,
    nodes,
    edges
  }
}
