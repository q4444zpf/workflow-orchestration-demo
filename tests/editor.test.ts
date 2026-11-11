import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, onMounted } from 'vue'
import WorkflowEditor from '../src/views/WorkflowEditor.vue'
import FlowCanvas from '../src/components/FlowCanvas.vue'
import { workflowApi, executionApi } from '../src/api/index.js'
import { ElMessageBox, ElMessage } from 'element-plus'

vi.mock('../src/api/index.js', () => ({
  apiApi: { list: vi.fn().mockResolvedValue([]) },
  workflowApi: { get: vi.fn(), update: vi.fn().mockResolvedValue({}), create: vi.fn(), publish: vi.fn().mockResolvedValue({ is_published: true, publish_path: 'test' }), execute: vi.fn().mockResolvedValue({ executionId: 9 }) },
  executionApi: { events: vi.fn(), get: vi.fn() }
}))
const navigation = vi.hoisted(() => ({ push: vi.fn(), guard: undefined as (() => Promise<boolean>) | undefined }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '1' } }), useRouter: () => ({ push: navigation.push }), onBeforeRouteLeave: (guard: () => Promise<boolean>) => { navigation.guard = guard } }))
vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  ElMessageBox: { prompt: vi.fn().mockResolvedValue({ value: '{}' }), confirm: vi.fn().mockResolvedValue('confirm') }
}))
vi.mock('../src/components/PropertyPanel.vue', () => ({ default: defineComponent({ props: ['node'], template: '<div />' }) }))
vi.mock('@vue-flow/core', async importOriginal => ({
  ...await importOriginal<typeof import('@vue-flow/core')>(),
  VueFlow: defineComponent({ name: 'VueFlow', props: ['autoConnect', 'nodes', 'edges'], template: '<div><slot /></div>' }),
  useVueFlow: () => ({ screenToFlowCoordinate: (p: unknown) => p, findNode: () => undefined, updateNodeData: vi.fn() })
}))
const node = { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } }
const end = { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: { label: '结束' } }
const validWorkflow = () => ({ id: 1, name: '流程', publish_path: 'test', nodes: [node, end], edges: [{ id: 'se', source: 'start', target: 'end' }] })
let stream: { onmessage?: (event: { data: string; lastEventId?: string }) => void; onerror?: () => void; close: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workflowApi.update).mockReset().mockResolvedValue({} as never)
  vi.mocked(workflowApi.get).mockResolvedValue({ id: 1, name: '流程', nodes: [node], edges: [] })
  stream = { close: vi.fn() }
  vi.mocked(executionApi.events).mockReturnValue(stream as unknown as EventSource)
})
function editor(showPublish = false, realParameters = false) {
  return mount(WorkflowEditor, { global: { stubs: {
    NodeLibrary: true, PropertyPanel: true, ExecutionPanel: true,
    RunParametersDialog: realParameters ? false : defineComponent({ emits: ['submit'], setup(_, { emit }) { onMounted(() => emit('submit', {})); return () => null } }),
    'el-page-header': true, 'el-input': true, 'el-popover': showPublish ? { template: '<div><slot name="reference"/><slot/></div>' } : true,
    'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' }
  } } })
}
describe('编辑器回归', () => {
  it('保存并离开期间继续编辑时留在当前页面，避免丢失新修改', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    let finishSave: () => void = () => {}
    vi.mocked(workflowApi.update).mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve({} as never) }))
    const wrapper = editor(); await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node]); await flushPromises()
    const leaving = navigation.guard?.(); await flushPromises()
    expect(workflowApi.update).toHaveBeenCalled()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [end]); await flushPromises()
    finishSave(); expect(await leaving).toBe(false)
    wrapper.unmount()
  })
  it('返回工作流列表，未保存修改可以取消、放弃或保存后离开', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor(); await flushPromises()
    await wrapper.get('[aria-label="返回工作流列表"]').trigger('click')
    expect(navigation.push).toHaveBeenCalledWith('/workflows')
    expect(await navigation.guard?.()).toBe(true)
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node]); await flushPromises()
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('close')
    expect(await navigation.guard?.()).toBe(false)
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    expect(await navigation.guard?.()).toBe(true)
    vi.mocked(workflowApi.update).mockRejectedValueOnce(new Error('保存失败'))
    expect(await navigation.guard?.()).toBe(false)
    expect(await navigation.guard?.()).toBe(true)
    expect(workflowApi.update).toHaveBeenCalled(); wrapper.unmount()
  })
  it('运行先显示按定义生成的表单，取消不执行，提交后按类型传递参数', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce({ ...validWorkflow(), variables: [{ name: 'score', type: 'number', required: true }, { name: 'enabled', type: 'boolean', default: false }] })
    const wrapper = editor(false, true)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click'); await flushPromises()
    expect(workflowApi.execute).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label="取消运行"]').trigger('click')
    expect(workflowApi.update).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click'); await flushPromises()
    await wrapper.get('[aria-label="score"]').setValue('90')
    await wrapper.get('[role="dialog"] form').trigger('submit'); await flushPromises()
    expect(workflowApi.execute).toHaveBeenCalledWith(1, { score: 90, enabled: false }, expect.any(String))
    expect(ElMessageBox.prompt).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('相同启动意图在网络错误后重试复用请求标识，明确错误显示后端中文提示', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    vi.mocked(workflowApi.execute).mockRejectedValueOnce(new Error('Network Error'))
    const wrapper = editor()
    await flushPromises()
    const run = wrapper.findAll('button').find(button => button.text() === '运行')!
    await run.trigger('click'); await flushPromises()
    const firstRequestId = vi.mocked(workflowApi.execute).mock.calls[0][2]
    await run.trigger('click'); await flushPromises()
    expect(workflowApi.execute).toHaveBeenNthCalledWith(2, 1, {}, firstRequestId)
    expect(firstRequestId).toEqual(expect.any(String))
    wrapper.unmount()
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    vi.mocked(workflowApi.execute).mockRejectedValueOnce({ response: { status: 400, data: { message: '节点配置有误' } } })
    const another = editor()
    await flushPromises()
    await another.findAll('button').find(button => button.text() === '运行')!.trigger('click'); await flushPromises()
    expect(ElMessage.error).toHaveBeenLastCalledWith('节点配置有误')
    another.unmount()
  })
  it('SSE中断查询后从最后已接收事件继续订阅，终态查询保留逐次记录', async () => {
    vi.useFakeTimers()
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    try {
      await flushPromises()
      await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click'); await flushPromises()
      const record = { invocationId: 'start-call', nodeId: 'start', scopePath: 'root', attempt: 1, status: 'success', input: {}, output: 99, startedAt: '2026-11-09T12:00:00Z' }
      stream.onmessage?.({ lastEventId: '41', data: JSON.stringify({ type: 'nodeRun', nodeId: 'start', data: record }) })
      vi.mocked(executionApi.get).mockResolvedValueOnce({ id: 9, workflow_id: 1, status: 'running', context: {}, logs: [], nodeRuns: [record], result: null })
      stream.onerror?.(); await flushPromises()
      await vi.advanceTimersByTimeAsync(1000)
      expect(executionApi.events).toHaveBeenLastCalledWith(9, '41')
      vi.mocked(executionApi.get).mockResolvedValueOnce({ id: 9, workflow_id: 1, status: 'success', context: {}, logs: [], nodeRuns: [record], result: 99 })
      stream.onmessage?.({ lastEventId: '42', data: JSON.stringify({ type: 'completed' }) }); await flushPromises()
      expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution')).toMatchObject({ status: 'success', nodeRuns: [record], result: 99 })
    } finally { wrapper.unmount(); vi.useRealTimers() }
  })
  it('逐次调用事件按调用和尝试合并，重复事件不重复日志，保留节点汇总', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click')
    await flushPromises()
    const run = { invocationId: 'call-0', nodeId: 'start', scopePath: 'root/0', attempt: 1, status: 'running', input: 10, output: null, startedAt: '2026-11-09T12:00:00Z' }
    stream.onmessage?.({ lastEventId: '1', data: JSON.stringify({ type: 'nodeRun', nodeId: 'start', data: run }) })
    stream.onmessage?.({ lastEventId: '2', data: JSON.stringify({ type: 'nodeRun', nodeId: 'start', data: { ...run, status: 'success', output: 20 } }) })
    stream.onmessage?.({ lastEventId: '3', data: JSON.stringify({ type: 'nodeRun', nodeId: 'start', data: { ...run, attempt: 2 } }) })
    stream.onmessage?.({ lastEventId: '4', data: JSON.stringify({ type: 'state', nodeId: 'start', data: { status: 'success', input: 10, output: 20 } }) })
    const log = { time: '2026-11-09T12:00:00Z', nodeId: 'start', level: 'info', message: '节点完成' }
    stream.onmessage?.({ lastEventId: '5', data: JSON.stringify({ type: 'log', nodeId: 'start', data: log }) })
    stream.onmessage?.({ lastEventId: '5', data: JSON.stringify({ type: 'log', nodeId: 'start', data: log }) })
    stream.onmessage?.({ lastEventId: '6', data: JSON.stringify({ type: 'syncWarning', data: { message: '同步暂不可用' } }) })
    await flushPromises()
    const result = wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution')
    expect(result.nodeRuns).toHaveLength(2)
    expect(result.nodeRuns[0]).toMatchObject({ invocationId: 'call-0', attempt: 1, status: 'success', output: 20 })
    expect(result.context.start.output).toBe(20)
    expect(result.logs).toHaveLength(1)
    expect(result.sync_warning).toBe('同步暂不可用')
    wrapper.unmount()
  })
  it('启动返回503及executionId时关联待确认执行并查询，不再次发起执行', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    vi.mocked(workflowApi.execute).mockRejectedValueOnce({ response: { status: 503, data: { executionId: 18, message: '执行启动待确认' } } })
    vi.mocked(executionApi.get).mockResolvedValueOnce({ id: 18, workflow_id: 1, status: 'success', context: {}, logs: [], result: 7 })
    const wrapper = editor()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click')
    await flushPromises()
    expect(executionApi.get).toHaveBeenCalledWith(18)
    expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution')).toMatchObject({ id: 18, status: 'success', result: 7 })
    expect(workflowApi.execute).toHaveBeenCalledTimes(1)
    expect(workflowApi.execute).toHaveBeenCalledWith(1, {}, expect.any(String))
    wrapper.unmount()
  })
  it('启动待确认的旧查询响应不能覆盖已经收到的新SSE状态', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    vi.mocked(workflowApi.execute).mockRejectedValueOnce({ response: { status: 503, data: { executionId: 18, message: '启动待确认' } } })
    let finish: (value: object) => void = () => {}
    vi.mocked(executionApi.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = editor()
    try {
      await flushPromises()
      await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click')
      await flushPromises()
      stream.onmessage?.({ lastEventId: '10', data: JSON.stringify({ type: 'state', nodeId: 'start', data: { status: 'success', input: {}, output: 42 } }) })
      await flushPromises()
      finish({ id: 18, workflow_id: 1, status: 'running', context: { start: { status: 'running', input: {}, output: null } }, logs: [], result: null, last_event_id: 5 })
      await flushPromises()
      expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution').context.start).toMatchObject({ status: 'success', output: 42 })
    } finally { wrapper.unmount() }
  })
  it('重命名分支保持路由标识，移除分支时清理旧连线并随运行保存', async () => {
    const branch = { id: 'b', type: 'branch', position: { x: 40, y: 0 }, data: { condition: 'true' } }
    const fallback = { ...end, id: 'fallback' }
    vi.mocked(workflowApi.get).mockResolvedValueOnce({ id: 1, name: '分支', nodes: [node, branch, end, fallback], edges: [
      { id: 'sb', source: 'start', target: 'b' }, { id: 'yes', source: 'b', target: 'end', label: 'true' },
      { id: 'no', source: 'b', target: 'fallback', label: 'false' }
    ] })
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', branch)
    await flushPromises()
    const property = wrapper.findComponent({ name: 'PropertyPanel' })
    property.vm.$emit('update:node', { ...branch, data: { branches: [
      { id: 'true', label: '高分', condition: 'true' }, { id: 'false', label: '其余', isDefault: true }
    ] } })
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('edges')).toContainEqual(expect.objectContaining({ id: 'yes', branchId: 'true', sourceHandle: 'true', label: '高分' }))
    property.vm.$emit('update:node', { ...branch, data: { branches: [
      { id: 'true', label: '', condition: 'true' }, { id: 'false', label: '其余', isDefault: true }
    ] } })
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('edges')).toHaveLength(3)
    property.vm.$emit('update:node', { ...branch, data: { branches: [{ id: 'true', label: '默认', isDefault: true }] } })
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node, { ...branch, data: { branches: [{ id: 'true', label: '默认', isDefault: true }] } }, end])
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('edges').map((edge: {id:string}) => edge.id)).toEqual(['sb', 'yes'])
    await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click')
    await flushPromises()
    expect(workflowApi.update).toHaveBeenCalledWith(1, expect.objectContaining({ edges: expect.arrayContaining([expect.objectContaining({ id: 'yes', branchId: 'true' })]) }))
    expect(workflowApi.execute).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('断线查询返回快照游标后忽略已经包含在快照内的事件，避免重复日志', async () => {
    vi.useFakeTimers()
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    try {
      await flushPromises()
      await wrapper.findAll('button').find(button => button.text() === '运行')!.trigger('click'); await flushPromises()
      const log = { time: '2026-11-09T12:00:00Z', nodeId: 'start', level: 'info', message: '已保存日志' }
      stream.onmessage?.({ lastEventId: '41', data: JSON.stringify({ type: 'log', nodeId: 'start', data: log }) })
      vi.mocked(executionApi.get).mockResolvedValueOnce({ id: 9, workflow_id: 1, status: 'running', context: {}, logs: [log], last_event_id: 44, result: null })
      stream.onerror?.(); await flushPromises()
      await vi.advanceTimersByTimeAsync(1000)
      expect(executionApi.events).toHaveBeenLastCalledWith(9, '44')
      stream.onmessage?.({ lastEventId: '43', data: JSON.stringify({ type: 'log', nodeId: 'start', data: log }) })
      await flushPromises()
      expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution').logs).toHaveLength(1)
    } finally { wrapper.unmount(); vi.useRealTimers() }
  })
  it('手动校验展示错误，修正后实时显示通过，点击问题选择节点', async () => {
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node, end, { ...end, id: 'orphan', data: { label: '未连接节点' } }])
    await wrapper.findAll('button').find(b => b.text() === '校验')!.trigger('click')
    expect(wrapper.text()).toContain('无法从开始节点到达')
    const panel = wrapper.findComponent({ name: 'WorkflowValidationPanel' })
    await panel.findAll('button').find(button => button.text().includes('未连接节点'))!.trigger('click')
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toMatchObject({ id: 'orphan' })
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node, end])
    wrapper.findComponent(FlowCanvas).vm.$emit('update:edges', [{ id: 'se', source: 'start', target: 'end' }])
    await flushPromises()
    expect(wrapper.text()).toContain('校验通过')
    wrapper.unmount()
  })
  it('结构错误阻止运行和发布，但允许保存草稿', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor(true)
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [node, { ...node, id: 'start2' }])
    await wrapper.findAll('button').find(b => b.text() === '运行')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('开始节点必须有且只有一个')
    expect(ElMessageBox.prompt).not.toHaveBeenCalled()
    expect(workflowApi.execute).not.toHaveBeenCalled()
    await wrapper.findAll('button').filter(b => b.text() === '发布').at(-1)!.trigger('click')
    await flushPromises()
    expect(workflowApi.publish).not.toHaveBeenCalled()
    expect(workflowApi.update).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(b => b.text() === '保存')!.trigger('click')
    await flushPromises()
    expect(workflowApi.update).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('发布前先保存当前画布，保存失败则不发布', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor(true)
    await flushPromises()
    vi.mocked(workflowApi.update).mockRejectedValueOnce(new Error('保存失败'))
    const publishButton = wrapper.findAll('button').filter(b => b.text() === '发布').at(-1)!
    await publishButton.trigger('click')
    await flushPromises()
    expect(workflowApi.publish).not.toHaveBeenCalled()
    await publishButton.trigger('click')
    await flushPromises()
    expect(workflowApi.publish).toHaveBeenCalled()
    expect(vi.mocked(workflowApi.update).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(workflowApi.publish).mock.invocationCallOrder[0])
    wrapper.unmount()
  })
  it('定位连线问题时清空原节点选择，并能关闭校验结果', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [{ ...node, selected: true }, end])
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', node)
    wrapper.findComponent(FlowCanvas).vm.$emit('update:edges', [{ id: 'back', source: 'end', target: 'start' }])
    await wrapper.findAll('button').find(b => b.text() === '校验')!.trigger('click')
    await wrapper.findAll('button').find(b => b.text().includes('不能有入线'))!.trigger('click')
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toBeNull()
    expect(wrapper.findComponent(FlowCanvas).props('nodes').every((node: { selected?: boolean }) => !node.selected)).toBe(true)
    expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('selectedNodeId')).toBeNull()
    expect(wrapper.text()).toContain('连线标签')
    await wrapper.find('button[aria-label="关闭校验结果"]').trigger('click')
    expect(wrapper.find('[aria-label="工作流校验结果"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('确认前不删除，取消后保留节点和选择', async () => {
    let cancel: (reason: string) => void = () => {}
    vi.mocked(ElMessageBox.confirm).mockImplementationOnce(() => new Promise((_resolve, reject) => { cancel = reject }))
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', node)
    await flushPromises()
    wrapper.findComponent({ name: 'PropertyPanel' }).vm.$emit('delete-node', 'start')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('开始'), '删除节点', expect.objectContaining({ confirmButtonText: '确认删除', cancelButtonText: '取消' }))
    expect(wrapper.findComponent(FlowCanvas).props('nodes')).toHaveLength(1)
    cancel('cancel')
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('nodes')).toHaveLength(1)
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toMatchObject({ id: 'start' })
    wrapper.unmount()
  })
  it('快捷键删除也需要确认，重复请求不会重复弹窗', async () => {
    let confirm: (value: 'confirm') => void = () => {}
    vi.mocked(ElMessageBox.confirm).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve }))
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('delete-nodes', ['start'])
    wrapper.findComponent(FlowCanvas).vm.$emit('delete-nodes', ['start'])
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(FlowCanvas).props('nodes')).toHaveLength(1)
    confirm('confirm')
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('nodes')).toHaveLength(0)
    wrapper.unmount()
  })
  it('从属性面板删除节点时移除关联连线并清空选择', async () => {
    const other = { id: 'end', type: 'end', position: { x: 100, y: 0 }, data: { label: '结束' } }
    vi.mocked(workflowApi.get).mockResolvedValueOnce({ id: 1, name: '流程', nodes: [node, other], edges: [{ id: 'edge', source: 'start', target: 'end' }] })
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', other)
    await flushPromises()
    wrapper.findComponent({ name: 'PropertyPanel' }).vm.$emit('delete-node', 'end')
    await flushPromises()
    expect(wrapper.findComponent(FlowCanvas).props('nodes').map((n: { id: string }) => n.id)).toEqual(['start'])
    expect(wrapper.findComponent(FlowCanvas).props('edges')).toEqual([])
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toBeNull()
    wrapper.unmount()
  })
  it('键盘删除导致画布节点移除后清空属性和监控中的选择', async () => {
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', node)
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [])
    await flushPromises()
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toBeNull()
    expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('selectedNodeId')).toBeNull()
    wrapper.unmount()
  })
  it('点击画布节点后打开对应属性', async () => {
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('node-click', node)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'PropertyPanel' }).props('node')).toMatchObject({ id: 'start' })
    wrapper.unmount()
  })
  it('运行前保存修改，并在完成事件后加载最终结果', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    await flushPromises()
    wrapper.findComponent(FlowCanvas).vm.$emit('update:nodes', [{ ...node, data: { label: '修改后的节点' } }, end])
    await wrapper.findAll('button').find(b => b.text() === '运行')!.trigger('click')
    await flushPromises()
    expect(workflowApi.update).toHaveBeenCalledWith(1, expect.objectContaining({ nodes: [expect.objectContaining({ data: { label: '修改后的节点' } }), end] }))
    expect(vi.mocked(workflowApi.update).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(workflowApi.execute).mock.invocationCallOrder[0])
    vi.mocked(executionApi.get).mockResolvedValue({ id: 9, status: 'success', context: {}, logs: [], result: 42 })
    stream.onmessage?.({ data: JSON.stringify({ type: 'completed', nodeId: '' }) })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution')).toMatchObject({ status: 'success', result: 42 })
    expect(stream.close).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('保存失败时不启动执行', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    vi.mocked(workflowApi.update).mockRejectedValueOnce(new Error('保存失败'))
    const wrapper = editor()
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '运行')!.trigger('click')
    await flushPromises()
    expect(workflowApi.execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('事件连接中断后从服务端恢复失败状态', async () => {
    vi.mocked(workflowApi.get).mockResolvedValueOnce(validWorkflow())
    const wrapper = editor()
    await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '运行')!.trigger('click')
    await flushPromises()
    vi.mocked(executionApi.get).mockResolvedValue({ id: 9, status: 'failed', context: {}, logs: [], result: { error: '节点失败' } })
    stream.onerror?.()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ExecutionPanel' }).props('execution')).toMatchObject({ status: 'failed', result: { error: '节点失败' } })
    wrapper.unmount()
  })
})
