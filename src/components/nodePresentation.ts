import { VideoPlay, SwitchButton, Link, Document, Share, Refresh, CopyDocument } from '@element-plus/icons-vue'
export const nodeCatalog = {
  start: { label: '开始', icon: VideoPlay, color: '#32a332', description: '工作流入口' },
  end: { label: '结束', icon: SwitchButton, color: '#6d7c92', description: '输出最终结果' },
  http: { label: 'HTTP API', icon: Link, color: '#1677ff', description: '调用外部接口' },
  python: { label: 'Python', icon: Document, color: '#d9a200', description: '执行 Python 代码' },
  branch: { label: '分支', icon: Share, color: '#8454e8', description: '按条件选择路径' },
  loop: { label: '循环', icon: Refresh, color: '#2f9c79', description: '重复执行节点' },
  parallel: { label: '并行', icon: CopyDocument, color: '#8454e8', description: '同时执行多个分支' }
}
export function nodeMeta(type: string) { return Object.entries(nodeCatalog).find(([key]) => key === type)?.[1] ?? nodeCatalog.http }
export function nodeName(node: { id: string; type: string; data: Record<string, unknown> }) {
  return typeof node.data.label === 'string' && node.data.label.trim() ? node.data.label : nodeMeta(node.type).label
}
