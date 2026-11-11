import { HttpError } from '../middleware/errorHandler.js'
import { validateWorkflowGraph } from '../shared/workflowValidation.js'

export function assertValidWorkflowGraph(graph: { nodes: unknown; edges: unknown }): void {
  const issues = validateWorkflowGraph(graph)
  if (issues.length) throw new HttpError(400, `工作流校验失败：${issues.map(issue => issue.message).join('；')}`, issues)
}
