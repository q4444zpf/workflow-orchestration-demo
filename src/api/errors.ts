function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null }
export function responseData(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.data)) return undefined
  return error.response.data
}
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = responseData(error)
  return typeof data?.message === 'string' ? data.message : error instanceof Error ? error.message : fallback
}
