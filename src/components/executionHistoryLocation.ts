export interface HistoryLocationState { workflowId: string; status: string; page: number }

export function readHistoryLocation(query: Record<string, unknown>): HistoryLocationState {
  const workflow = typeof query.workflowId === 'string' ? Number(query.workflowId) : NaN
  const workflowId = Number.isSafeInteger(workflow) && workflow > 0 ? String(workflow) : ''
  const status = typeof query.status === 'string' && ['running', 'success', 'failed', 'stopped'].includes(query.status) ? query.status : ''
  const number = typeof query.page === 'string' ? Number(query.page) : NaN
  const page = Number.isSafeInteger(number) && number > 0 && number <= 1_000_000 ? number : 1
  return { workflowId, status, page }
}

export function historyLocationQuery(state: HistoryLocationState): Record<string, string> {
  return { ...(state.workflowId ? { workflowId: state.workflowId } : {}), ...(state.status ? { status: state.status } : {}), page: String(state.page) }
}
export function historyLocationPath(state: HistoryLocationState): string { return '/executions?' + new URLSearchParams(historyLocationQuery(state)).toString() }
export function executionDetailPath(id: number, state: HistoryLocationState): string { return `/executions/${id}?` + new URLSearchParams(historyLocationQuery(state)).toString() }
