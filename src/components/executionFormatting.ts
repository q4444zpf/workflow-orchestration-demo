export function formatData(value: unknown): string { return value === undefined ? '未记录' : JSON.stringify(value, null, 2) }
function timestamp(value: string) { return Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value) }
export function formatTime(value?: string | null): string {
  if (!value) return '—'
  const time = timestamp(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '—'
}
export function formatDuration(start?: string | null, end?: string | null, running = false): string {
  if (running) return '执行中'
  if (!start || !end) return '—'
  const milliseconds = timestamp(end) - timestamp(start)
  return Number.isFinite(milliseconds) ? `${(Math.max(0, milliseconds) / 1000).toFixed(2)} 秒` : '—'
}
export function executionStatus(status: string): string {
  return ({ running: '执行中', success: '成功', failed: '失败', stopped: '已停止', pending: '未执行' } as Record<string, string>)[status] || '未知状态'
}
