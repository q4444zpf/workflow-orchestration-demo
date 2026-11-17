import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import ExecutionPanel from '../src/components/ExecutionPanel.vue'

const nodes = [
  { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
  { id: 'py', type: 'python', position: { x: 100, y: 0 }, data: { label: '计算评分' } }
]
const execution = { id: 1, workflow_id: 1, status: 'success' as const,
  context: {
    start: { input: {}, output: { x: 1 }, status: 'success' as const },
    py: { input: { userId: 'alice' }, output: { score: 100 }, status: 'success' as const,
      startedAt: '2026-11-09T12:00:00.000Z', endedAt: '2026-11-09T12:00:00.600Z' }
  }, logs: [{ time: '2026-11-09T12:00:00Z', nodeId: 'py', level: 'info' as const, message: 'Finished python' }], result: { score: 100 } }
describe('执行调试台', () => {
  it('HTTP 异常展示执行快照的节点名、请求方法和状态码，保留错误原文', () => {
    const snapshot = { ...nodes[1], type: 'http', data: { label: '取评分', method: 'POST' } }
    const wrapper = mount(ExecutionPanel, { props: {
      nodes, selectedNodeId: 'py', execution: { ...execution, status: 'failed',
        workflow_snapshot: { name: '评分流程', nodes: [snapshot], edges: [] },
        context: { py: { status: 'failed', input: {}, output: null, error: 'HTTP request failed: 422' } }
      }
    } })
    expect(wrapper.text()).toContain('节点“取评分”的 POST 请求失败，HTTP 状态码 422。')
    expect(wrapper.get('[data-testid="node-output"]').text()).toBe('HTTP request failed: 422')
    wrapper.unmount()
  })
  it('复制失败节点时写入面板显示的实际错误文本', async () => {
    const error = 'Python 执行失败\nValueError: 无效的评分'
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mount(ExecutionPanel, { props: {
      nodes, selectedNodeId: 'py', execution: { ...execution, status: 'failed', context: {
        ...execution.context, py: { ...execution.context.py, status: 'failed', output: null, error }
      } }
    } })
    try {
      expect(wrapper.get('[data-testid="node-output"]').text()).toBe(error)
      await wrapper.get('[aria-label="复制输出"]').trigger('click'); await flushPromises()
      expect(writeText).toHaveBeenCalledWith(error)
      expect(wrapper.get('[aria-label="复制输出"]').text()).toContain('已复制')
    } finally {
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })
  it('同一节点的循环和重试记录独立选择，实时更新不会切走正在检查的历史记录', async () => {
    const runs = [
      { invocationId: 'loop-0-py', nodeId: 'py', scopePath: 'root/loop:0', attempt: 1, status: 'failed' as const, input: { item: '第一轮' }, output: null, error: '暂时失败', startedAt: '2026-11-09T12:00:00Z' },
      { invocationId: 'loop-0-py', nodeId: 'py', scopePath: 'root/loop:0', attempt: 2, status: 'success' as const, input: { item: '第一轮' }, output: 11, startedAt: '2026-11-09T12:00:01Z' },
      { invocationId: 'loop-1-py', nodeId: 'py', scopePath: 'root/loop:1', attempt: 1, status: 'success' as const, input: { item: '第二轮' }, output: 22, startedAt: '2026-11-09T12:00:02Z' }
    ]
    const wrapper = mount(ExecutionPanel, { props: { nodes, execution: { ...execution, nodeRuns: runs }, selectedNodeId: 'py' } })
    expect(wrapper.findAll('[data-invocation-id]')).toHaveLength(3)
    expect(wrapper.get('.monitor-header').text()).toContain('调用数 2')
    expect(wrapper.get('.monitor-header').text()).toContain('尝试数 3')
    await wrapper.get('[data-invocation-id="loop-0-py"][data-attempt="1"]').trigger('click')
    expect(wrapper.get('[data-testid="node-input"]').text()).toContain('第一轮')
    expect(wrapper.get('[data-testid="node-output"]').text()).toContain('暂时失败')
    await wrapper.get('[data-invocation-id="loop-0-py"][data-attempt="2"]').trigger('click')
    expect(wrapper.get('[data-testid="node-output"]').text()).toBe('11')
    expect(wrapper.emitted('select-node')?.at(-1)).toEqual(['py'])
    await wrapper.setProps({ execution: { ...execution, nodeRuns: [...runs, { ...runs[2], invocationId: 'loop-2-py', output: 33 }] } })
    expect(wrapper.get('[data-testid="node-output"]').text()).toBe('11')
    await wrapper.get('[data-invocation-id="loop-1-py"]').trigger('click')
    expect(wrapper.get('[data-testid="node-output"]').text()).toBe('22')
    expect(wrapper.text()).toContain('root/loop:1')
    wrapper.unmount()
  })
  it('后端同步暂不可用时保留执行数据并显示可恢复提示', () => {
    const wrapper = mount(ExecutionPanel, { props: { nodes, execution: { ...execution, sync_warning: '状态同步暂不可用，正在重连' }, selectedNodeId: 'py' } })
    expect(wrapper.get('[role="status"]').text()).toContain('状态同步暂不可用')
    expect(wrapper.get('[data-testid="node-output"]').text()).toContain('100')
    wrapper.unmount()
  })
  it('选中节点时并排显示其输入输出，支持切换日志', async () => {
    const wrapper = mount(ExecutionPanel, { props: { nodes, execution, selectedNodeId: 'py' } })
    expect(wrapper.text()).toContain('执行成功')
    expect(wrapper.get('[data-testid="node-input"]').text()).toContain('alice')
    expect(wrapper.get('[data-testid="node-output"]').text()).toContain('100')
    await wrapper.get('[role="tab"][aria-controls="execution-logs"]').trigger('click')
    expect(wrapper.text()).toContain('Finished python')
    wrapper.unmount()
  })
  it('从监控列表选择节点时通知画布，且未执行节点不显示成功', async () => {
    const wrapper = mount(ExecutionPanel, { props: { nodes, execution: { ...execution, context: { start: execution.context.start } }, selectedNodeId: null } })
    await wrapper.get('[data-node-id="py"]').trigger('click')
    expect(wrapper.emitted('select-node')?.[0]).toEqual(['py'])
    expect(wrapper.get('[data-node-id="py"]').text()).toContain('未执行')
    wrapper.unmount()
  })
})
