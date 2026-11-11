import { getBranchDefinitions } from './branches.js'

// 仅依赖图数据，供浏览器和后端共用，避免两端校验规则不一致。
export interface WorkflowValidationIssue {
  code: string
  message: string
  nodeId?: string
  edgeId?: string
}

interface GraphNode { id: string; type: string; data?: unknown }
interface GraphEdge { id: string; source: string; target: string; label?: unknown; branchId?: unknown }
const nodeTypes = new Set(['start', 'end', 'http', 'python', 'branch', 'loop', 'parallel'])
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
function isNode(value: unknown): value is GraphNode {
  return isRecord(value) && isId(value.id) && typeof value.type === 'string' && nodeTypes.has(value.type)
}
function isEdge(value: unknown): value is GraphEdge {
  return isRecord(value) && isId(value.id) && isId(value.source) && isId(value.target)
}
function name(node: GraphNode): string {
  return isRecord(node.data) && typeof node.data.label === 'string' && node.data.label.trim() ? node.data.label : node.id
}

function branchRoute(edge: GraphEdge): unknown {
  if (edge.branchId !== undefined) return edge.branchId
  return edge.label === 'true' || edge.label === 'false' ? edge.label : undefined
}

function reachable(root: string, outgoing: Map<string, GraphEdge[]>): Set<string> {
  const reached = new Set<string>()
  const pending = [root]
  while (pending.length) {
    const id = pending.pop()
    if (id === undefined || reached.has(id)) continue
    reached.add(id)
    for (const edge of outgoing.get(id) || []) pending.push(edge.target)
  }
  return reached
}

function hasCycle(nodes: GraphNode[], outgoing: Map<string, GraphEdge[]>): boolean {
  const incoming = new Map(nodes.map(node => [node.id, 0]))
  for (const exits of outgoing.values()) {
    for (const edge of exits) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
  }
  const pending = [...incoming].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (pending.length) {
    const id = pending.pop()
    if (id === undefined) continue
    visited++
    for (const edge of outgoing.get(id) || []) {
      const count = (incoming.get(edge.target) || 0) - 1
      incoming.set(edge.target, count)
      if (count === 0) pending.push(edge.target)
    }
  }
  return visited !== incoming.size
}

export function validateWorkflowGraph(graph: { nodes: unknown; edges: unknown }): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return [{ code: 'INVALID_GRAPH', message: '节点和连线必须是数组。' }]
  }
  const nodes: GraphNode[] = []
  const nodeById = new Map<string, GraphNode>()
  for (const [index, value] of graph.nodes.entries()) {
    if (!isNode(value)) {
      issues.push({ code: 'INVALID_NODE', message: `第 ${index + 1} 个节点的 ID 或类型无效。` })
      continue
    }
    nodes.push(value)
    if (nodeById.has(value.id)) issues.push({ code: 'DUPLICATE_NODE_ID', message: `节点 ID“${value.id}”重复，请使用唯一 ID。`, nodeId: value.id })
    else nodeById.set(value.id, value)
  }
  const starts = nodes.filter(node => node.type === 'start')
  if (starts.length !== 1) issues.push({ code: 'START_COUNT', message: `开始节点必须有且只有一个，当前有 ${starts.length} 个。`, nodeId: starts[0]?.id })
  if (!nodes.some(node => node.type === 'end')) issues.push({ code: 'END_REQUIRED', message: '至少需要一个结束节点。' })

  const edges: GraphEdge[] = []
  const edgeIds = new Set<string>()
  for (const [index, value] of graph.edges.entries()) {
    if (!isEdge(value)) {
      issues.push({ code: 'INVALID_EDGE', message: `第 ${index + 1} 条连线的 ID 或端点无效。` })
      continue
    }
    if (edgeIds.has(value.id)) issues.push({ code: 'DUPLICATE_EDGE_ID', message: `连线 ID“${value.id}”重复，请使用唯一 ID。`, edgeId: value.id })
    edgeIds.add(value.id)
    const source = nodeById.get(value.source)
    const target = nodeById.get(value.target)
    if (!source || !target) {
      issues.push({ code: 'MISSING_ENDPOINT', message: `连线“${value.id}”引用了不存在的节点。`, edgeId: value.id })
      continue
    }
    let valid = true
    if (source.id === target.id) {
      issues.push({ code: 'SELF_CONNECTION', message: `节点“${name(source)}”不能连接自身。`, nodeId: source.id, edgeId: value.id })
      valid = false
    }
    if (target.type === 'start') {
      issues.push({ code: 'START_INCOMING', message: `开始节点“${name(target)}”不能有入线。`, nodeId: target.id, edgeId: value.id })
      valid = false
    }
    if (source.type === 'end') {
      issues.push({ code: 'END_OUTGOING', message: `结束节点“${name(source)}”不能有出线。`, nodeId: source.id, edgeId: value.id })
      valid = false
    }
    if (valid) edges.push(value)
  }
  const outgoing = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source) || []
    list.push(edge)
    outgoing.set(edge.source, list)
  }
  for (const node of nodes) {
    const exits = outgoing.get(node.id) || []
    if (node.type === 'branch') {
      const data = isRecord(node.data) ? node.data : {}
      const definitions = getBranchDefinitions(data)
      if (data.branches !== undefined && (
        !Array.isArray(data.branches) || definitions.length !== data.branches.length
        || new Set(definitions.map(branch => branch.id)).size !== definitions.length
        || definitions.filter(branch => branch.isDefault).length !== 1
        || definitions.some(branch => !branch.isDefault && !branch.condition?.trim())
      )) {
        issues.push({ code: 'BRANCH_CONFIG', message: `分支节点“${name(node)}”的分支 ID 和名称必须有效、ID 唯一、条件非空，并且必须恰有一个默认出口。`, nodeId: node.id })
      }
      if (exits.length !== definitions.length || definitions.some(branch => exits.filter(edge => branchRoute(edge) === branch.id).length !== 1)) {
        issues.push({ code: 'BRANCH_OUTPUTS', message: `分支节点“${name(node)}”的每个分支 ID 必须恰好对应一条出线，不能有额外出口；旧格式使用 true 和 false 标签。`, nodeId: node.id })
      }
    } else if (node.type === 'loop') {
      if (exits.length !== 2 || exits.filter(edge => edge.label === 'body').length !== 1 || exits.filter(edge => edge.label === 'next').length !== 1) {
        issues.push({ code: 'LOOP_OUTPUTS', message: `循环节点“${name(node)}”必须各有一条 body 和 next 出线。`, nodeId: node.id })
      }
    } else if (node.type === 'parallel') {
      const forks = exits.filter(edge => typeof edge.label === 'string' && /^fork-(0|[1-9]\d*)$/.test(edge.label))
      if (!forks.length || exits.filter(edge => edge.label === 'join').length !== 1 || exits.length !== forks.length + 1 || new Set(forks.map(edge => edge.label)).size !== forks.length) {
        issues.push({ code: 'PARALLEL_OUTPUTS', message: `并行节点“${name(node)}”必须有至少一条编号唯一的 fork-N 出线，以及恰好一条 join 出线。`, nodeId: node.id })
      }
    } else if (node.type !== 'end' && exits.length !== 1) {
      issues.push({ code: 'NODE_OUTPUTS', message: `节点“${name(node)}”必须恰有一条出线；多路执行请使用控制节点。`, nodeId: node.id })
    }
  }
  if (hasCycle(nodes, outgoing)) issues.push({ code: 'CYCLE', message: '工作流不能包含回路；循环请使用 body 子流程与 next 后续出口。' })

  // 区域包含嵌套控制节点的全部子图。不同互斥分支允许汇合，循环体与并行支路则独立结束。
  for (const node of nodes) {
    if (node.type !== 'loop' && node.type !== 'parallel') continue
    const exits = outgoing.get(node.id) || []
    const regions = exits.map(edge => ({ edge, ids: reachable(edge.target, outgoing) }))
    const seen = new Set<string>()
    let overlap = false
    for (const region of regions) {
      for (const id of region.ids) {
        if (seen.has(id)) overlap = true
        seen.add(id)
      }
    }
    if (overlap) issues.push({ code: node.type === 'loop' ? 'LOOP_REGION_OVERLAP' : 'PARALLEL_REGION_OVERLAP', message: `控制节点“${name(node)}”的独立子流程与后续流程不能共享节点，必须分别结束。`, nodeId: node.id })
    for (const region of regions) {
      const independent = node.type === 'loop' ? region.edge.label === 'body' : typeof region.edge.label === 'string' && region.edge.label.startsWith('fork-')
      if (!independent) continue
      const intrusion = edges.find(edge => region.ids.has(edge.target) && !region.ids.has(edge.source) && edge !== region.edge)
      if (intrusion) issues.push({ code: 'REGION_ENTRY', message: `控制节点“${name(node)}”的子流程不能被其他路径从外部进入。`, nodeId: node.id, edgeId: intrusion.id })
    }
  }
  if (starts.length === 1) {
    const reached = reachable(starts[0].id, outgoing)
    for (const node of nodes) {
      if (!reached.has(node.id)) issues.push({ code: 'UNREACHABLE_NODE', message: `节点“${name(node)}”无法从开始节点到达，请连接到工作流。`, nodeId: node.id })
    }
  }
  return issues
}
