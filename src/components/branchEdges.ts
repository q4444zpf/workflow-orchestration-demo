import { getBranchDefinitions } from '../../server/src/shared/branches'

export function configuredBranchIds(config: { condition?: unknown; branches?: unknown }): Set<string> {
  return new Set(Array.isArray(config.branches)
    ? config.branches.flatMap(branch => branch && typeof branch === 'object' && typeof branch.id === 'string' ? [branch.id] : [])
    : getBranchDefinitions(config).map(branch => branch.id))
}

/** 旧标签只用于识别一次出口，之后始终使用稳定 ID。 */
export function syncBranchEdge<T extends { source: string; branchId?: string; sourceHandle?: string | null; label?: unknown }>(edge: T, nodes: { id: string; type?: string; data?: Record<string, unknown> }[]): T {
  const source = nodes.find(node => node.id === edge.source)
  if (source?.type !== 'branch') return edge
  const branches = getBranchDefinitions(source.data || {})
  const branch = branches.find(branch => branch.id === (edge.branchId || edge.sourceHandle || edge.label))
  return branch ? { ...edge, branchId: branch.id, sourceHandle: branch.id, label: branch.label } : edge
}
