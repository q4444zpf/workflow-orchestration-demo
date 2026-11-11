import { mount, flushPromises } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutionHistory from '../src/views/ExecutionHistory.vue'
import ExecutionDetail from '../src/views/ExecutionDetail.vue'
import WorkflowList from '../src/views/WorkflowList.vue'
import { executionApi, workflowApi } from '../src/api'

const route = reactive({ params: { id: '43' }, query: {} as Record<string, string> })
const navigation = { replace: vi.fn(async (location: { query: Record<string, string> }) => { route.query = location.query }) }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => navigation }))
vi.mock('../src/api', () => ({ executionApi: { list: vi.fn(), get: vi.fn() }, workflowApi: { list: vi.fn() } }))
const run = { id: 43, workflow_id: 41, status: 'failed' as const, input: { score: 0, enabled: false }, result: null,
  error: '计算失败', started_at: '2026-11-10T12:00:00Z', ended_at: '2026-11-10T12:00:02Z',
  workflow_snapshot: { name: '评分流程', nodes: [{ id: 'py', type: 'python', position: { x: 0, y: 0 }, data: { label: '评分计算' } }], edges: [] },
  context: {}, logs: [], nodeRuns: [1, 2].map(attempt => ({ invocationId: 'loop-py', nodeId: 'py', scopePath: 'root/loop:0', attempt,
    status: 'failed' as const, input: { score: 0 }, output: false, error: `ValueError: 尝试${attempt}`, startedAt: '2026-11-10T12:00:00Z', endedAt: '2026-11-10T12:00:01Z' })) }
const global = { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } }
beforeEach(() => {
  vi.clearAllMocks(); route.params.id = '43'; route.query = {}
  vi.mocked(workflowApi.list).mockResolvedValue([{ id: 41, name: '评分流程', is_published: false }])
  vi.mocked(executionApi.list).mockResolvedValue({ items: [{ ...run, workflow_name: '评分流程' }], total: 21, page: 1, pageSize: 20 })
  vi.mocked(executionApi.get).mockResolvedValue(run)
})
describe('工作流列表与执行日志', () => {
  it('长节点异常保留末尾内容，并提供可键盘聚焦的异常滚动区域', async () => {
    const trace = Array.from({ length: 200 }, (_, index) => `异常栈第${index}行`).join('\n')
    vi.mocked(executionApi.get).mockResolvedValueOnce({ ...run, nodeRuns: [{ ...run.nodeRuns[0], error: trace }] })
    const wrapper = mount(ExecutionDetail, { global }); await flushPromises()
    const region = wrapper.find('[aria-label="节点异常内容"]')
    expect(region.exists()).toBe(true)
    expect(region.attributes('tabindex')).toBe('0')
    expect(region.text()).toContain('异常栈第199行')
    wrapper.unmount()
  })
  it('详情默认聚焦节点，标签切换可访问完整数据且保留选中的尝试', async () => {
    const wrapper = mount(ExecutionDetail, { global }); await flushPromises()
    expect(wrapper.get('#detail-tab-nodes').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[data-testid="execution-input"]').exists()).toBe(false)
    await wrapper.findAll('[data-run-key]')[1].trigger('click')
    await wrapper.get('#detail-tab-input').trigger('click')
    expect(wrapper.get('[data-testid="execution-input"]').text()).toContain('"score": 0')
    expect(wrapper.get('[data-testid="history-node-output"]').isVisible()).toBe(false)
    await wrapper.get('#detail-tab-output').trigger('click')
    expect(wrapper.get('[data-testid="execution-output"]').text()).toBe('null')
    await wrapper.get('#detail-tab-logs').trigger('click')
    expect(wrapper.text()).toContain('暂无事件日志')
    await wrapper.get('#detail-tab-nodes').trigger('click')
    expect(wrapper.get('[data-testid="history-node-error"]').text()).toBe('ValueError: 尝试2')
    wrapper.unmount()
  })
  it('详情标签支持键盘切换，切换执行后回到节点记录', async () => {
    const wrapper = mount(ExecutionDetail, { global }); await flushPromises()
    await wrapper.get('#detail-tab-nodes').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('#detail-tab-input').attributes('aria-selected')).toBe('true')
    route.params.id = '44'; await flushPromises()
    expect(wrapper.get('#detail-tab-nodes').attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })
  it.each([[21, 2], [0, 1]])('记录变动或超范围URL自动校正到有效页：total=%i', async (total, expectedPage) => {
    route.query = { workflowId: '41', status: 'failed', page: '999999' }
    vi.mocked(executionApi.list).mockResolvedValue({ items: [], total, page: 999999, pageSize: 20 })
    const wrapper = mount(ExecutionHistory, { global }); await flushPromises()
    expect(route.query).toEqual({ workflowId: '41', status: 'failed', page: String(expectedPage) })
    expect(executionApi.list).toHaveBeenLastCalledWith({ workflowId: 41, status: 'failed', page: expectedPage, pageSize: 20 })
    expect(wrapper.text()).not.toContain('999999'); wrapper.unmount()
  })
  it('卡片列表按发布状态和名称筛选，分页后过滤回第一页，保留独立入口', async () => {
    vi.mocked(workflowApi.list).mockResolvedValueOnce(Array.from({ length: 9 }, (_, index) => ({ id: index + 1, name: `测试流程${index + 1}`, is_published: index === 8 })))
    const wrapper = mount(WorkflowList, { global }); await flushPromises()
    expect(wrapper.findAll('article[data-workflow-id]')).toHaveLength(8)
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.get('[aria-label="下一页工作流"]').trigger('click')
    expect(wrapper.findAll('article[data-workflow-id]')).toHaveLength(1)
    await wrapper.get('[aria-label="筛选已发布工作流"]').trigger('click')
    expect(wrapper.find('article[data-workflow-id="9"]').exists()).toBe(true)
    expect(wrapper.get('[aria-label="上一页工作流"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="搜索工作流"]').setValue('不存在')
    expect(wrapper.text()).toContain('没有匹配的工作流')
    await wrapper.get('[aria-label="搜索工作流"]').setValue('测试流程9')
    expect(wrapper.find('a[href="/editor/9"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/executions?workflowId=9"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="execution-input"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('日志URL保存筛选和页码，详情返回恢复原列表查询', async () => {
    route.query = { workflowId: '41', status: 'failed', page: '2' }
    const wrapper = mount(ExecutionHistory, { global }); await flushPromises()
    expect(executionApi.list).toHaveBeenLastCalledWith({ workflowId: 41, status: 'failed', page: 2, pageSize: 20 })
    expect(wrapper.find('a[href="/executions/43?workflowId=41&status=failed&page=2"]').exists()).toBe(true)
    wrapper.unmount()
    const detail = mount(ExecutionDetail, { global }); await flushPromises()
    expect(detail.find('a[href="/executions?workflowId=41&status=failed&page=2"]').exists()).toBe(true)
    detail.unmount()
  })
  it('同一日志路由的查询改变后加载新数据，非法页码回退首页', async () => {
    const wrapper = mount(ExecutionHistory, { global }); await flushPromises()
    route.query = { workflowId: '41', status: 'failed', page: '-2' }; await flushPromises()
    expect(executionApi.list).toHaveBeenLastCalledWith({ workflowId: 41, status: 'failed', page: 1, pageSize: 20 })
    route.query = { page: '2' }; await flushPromises()
    expect(executionApi.list).toHaveBeenLastCalledWith({ workflowId: undefined, status: undefined, page: 2, pageSize: 20 })
    wrapper.unmount()
  })
  it('工作流列表支持编辑和查看本工作流日志', async () => {
    const wrapper = mount(WorkflowList, { global }); await flushPromises()
    expect(wrapper.text()).toContain('评分流程')
    expect(wrapper.find('a[href="/editor/41"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/executions?workflowId=41"]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('按工作流和状态筛选重置分页，支持翻页', async () => {
    const wrapper = mount(ExecutionHistory, { global }); await flushPromises()
    await wrapper.get('[aria-label="下一页"]').trigger('click'); await flushPromises()
    expect(executionApi.list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, workflowId: undefined, status: undefined })
    await wrapper.get('[aria-label="筛选工作流"]').setValue('41'); await flushPromises()
    await wrapper.get('[aria-label="筛选执行状态"]').setValue('failed'); await flushPromises()
    expect(executionApi.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, workflowId: 41, status: 'failed' })
    expect(wrapper.text()).toContain('评分流程'); wrapper.unmount()
  })
  it('详情展示历史节点名称、输入、输出、异常、时间和独立尝试', async () => {
    const wrapper = mount(ExecutionDetail, { global }); await flushPromises()
    expect(wrapper.text()).toContain('评分流程')
    await wrapper.get('#detail-tab-input').trigger('click')
    expect(wrapper.get('[data-testid="execution-input"]').text()).toContain('"score": 0')
    await wrapper.get('#detail-tab-nodes').trigger('click')
    expect(wrapper.text()).toContain('计算失败')
    expect(wrapper.findAll('[data-run-key]')).toHaveLength(2)
    await wrapper.findAll('[data-run-key]')[1].trigger('click')
    expect(wrapper.get('[data-testid="history-node-error"]').text()).toBe('ValueError: 尝试2')
    expect(wrapper.get('[data-testid="history-node-output"]').text()).toBe('false')
    expect(wrapper.text()).toContain('1.00 秒'); expect(wrapper.text()).toContain('评分计算')
    wrapper.unmount()
  })
  it('旧执行缺少输入与定义时提示缺失，保留旧节点输入输出', async () => {
    vi.mocked(executionApi.get).mockResolvedValueOnce({ id: 43, workflow_id: 1, status: 'success', context: { old: { input: false, output: 0, status: 'success' } }, result: false, logs: [] })
    const wrapper = mount(ExecutionDetail, { global }); await flushPromises()
    await wrapper.get('#detail-tab-input').trigger('click')
    expect(wrapper.get('[data-testid="execution-input"]').text()).toContain('未保存运行输入')
    await wrapper.get('#detail-tab-nodes').trigger('click')
    expect(wrapper.get('[data-testid="history-node-output"]').text()).toBe('0')
    await wrapper.get('#detail-tab-output').trigger('click')
    expect(wrapper.get('[data-testid="execution-output"]').text()).toBe('false'); wrapper.unmount()
  })
  it('切换执行时清除旧详情，迟到响应不能覆盖新记录，错误可以重试', async () => {
    let finish: (value: typeof run) => void = () => {}
    vi.mocked(executionApi.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(ExecutionDetail, { global }); await nextTick()
    vi.mocked(executionApi.get).mockRejectedValueOnce(new Error('断线'))
    route.params.id = '44'; await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('加载执行详情失败')
    finish(run); await flushPromises(); expect(wrapper.text()).not.toContain('评分计算')
    await wrapper.get('[aria-label="重新加载执行详情"]').trigger('click'); await flushPromises()
    expect(executionApi.get).toHaveBeenLastCalledWith(44); wrapper.unmount()
  })
})
