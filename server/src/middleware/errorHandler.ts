import { Request, Response, NextFunction } from 'express'
import type { WorkflowValidationIssue } from '../shared/workflowValidation.js'

export class HttpError extends Error {
  constructor(public status: number, message: string, public issues?: WorkflowValidationIssue[], public executionId?: number) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : 500
  const message = err.message || 'Internal Server Error'
  const issues = err instanceof HttpError ? err.issues : undefined
  const executionId = err instanceof HttpError ? err.executionId : undefined
  res.status(status).json({ status, message, ...(issues ? { issues } : {}), ...(executionId ? { executionId } : {}) })
}
