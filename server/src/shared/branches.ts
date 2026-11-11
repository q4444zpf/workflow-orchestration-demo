// 纯数据模型，浏览器、API 与 Worker 可共用，不能引入平台运行时。
export interface BranchDefinition {
  id: string
  label: string
  condition?: string
  isDefault?: boolean
}

function isBranch(value: unknown): value is BranchDefinition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return 'id' in value && typeof value.id === 'string' && value.id.trim().length > 0
    && 'label' in value && typeof value.label === 'string' && value.label.trim().length > 0
    && (!('condition' in value) || value.condition === undefined || typeof value.condition === 'string')
    && (!('isDefault' in value) || value.isDefault === undefined || typeof value.isDefault === 'boolean')
}

// 保留配置顺序和稳定 ID；配置完整性由 validateWorkflowGraph 单独报告。
export function getBranchDefinitions(config: { condition?: unknown; branches?: unknown }): BranchDefinition[] {
  if (config.branches !== undefined) {
    return Array.isArray(config.branches) ? config.branches.filter(isBranch).map(branch => ({ ...branch })) : []
  }
  return [
    { id: 'true', label: 'true', condition: typeof config.condition === 'string' ? config.condition : '' },
    { id: 'false', label: 'false', isDefault: true }
  ]
}
