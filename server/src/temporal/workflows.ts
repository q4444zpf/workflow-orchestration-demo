import { ActivityCancellationType, ApplicationFailure, CancellationScope, defineQuery, isCancellation, proxyActivities, setHandler } from '@temporalio/workflow'
import type { GraphActivities, NodeCall, NodeTaskResult, WorkflowInput } from './contracts.js'

const persistence = proxyActivities<GraphActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumInterval: '10 seconds' },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED
})

function failureMessage(error: unknown): string {
  let value = error
  let message = '工作流执行失败'
  for (let depth = 0; depth < 8 && value instanceof Error; depth++) {
    message = value.message
    value = value.cause
  }
  return message
}

export async function graphWorkflow(input: WorkflowInput): Promise<string | null> {
  let count = 0
  setHandler(defineQuery<{ nodeCalls: number }>('progress'), () => ({ nodeCalls: count }))
  try {
    const plan = await persistence.loadExecutionPlan(input.executionId, input.engineVersion)
    const start = plan.nodes.find(node => node.type === 'start')
    if (!start) throw ApplicationFailure.nonRetryable('工作流缺少开始节点', 'INVALID_GRAPH')
    async function runPath(firstId: string, initialContext: string | null, locals: Record<string, string>, scopePath: string, contextOverrides: Record<string, string> = {}): Promise<{ contextRef: string | null; outputRef: string }> {
      let currentId: string | undefined = firstId
      let contextRef = initialContext
      let resultRef: string | undefined
      while (currentId) {
        const node = plan.nodes.find(node => node.id === currentId)
        if (!node) throw ApplicationFailure.nonRetryable('连线引用不存在的节点', 'INVALID_GRAPH')
        if (count >= plan.limits.maxNodeCalls) throw ApplicationFailure.nonRetryable(`节点调用次数超过上限 ${plan.limits.maxNodeCalls}`, 'NODE_CALL_LIMIT')
        count++
        const call: NodeCall = { executionId: input.executionId, nodeId: node.id, invocationId: `call-${count}`, sequence: count, scopePath, contextRef, contextOverrides, locals }
        const tasks = proxyActivities<GraphActivities>({
          startToCloseTimeout: node.timeoutMs + 10000,
          heartbeatTimeout: '5 seconds',
          cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
          retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '10 seconds', maximumAttempts: node.type === 'loop' || node.type === 'parallel' ? 3 : node.maximumAttempts }
        })
        const outgoing = plan.edges.filter(edge => edge.source === node.id)
        let result: NodeTaskResult
        try {
          result = await tasks.executeNodeActivity(call)
          if (node.type === 'loop' && !result.outputRef) {
            const body = outgoing.find(edge => edge.label === 'body')
            if (!body || !result.items) throw ApplicationFailure.nonRetryable('循环缺少循环体或迭代引用', 'INVALID_LOOP')
            if (count + result.items.length > plan.limits.maxNodeCalls) throw ApplicationFailure.nonRetryable(`节点调用次数超过上限 ${plan.limits.maxNodeCalls}`, 'NODE_CALL_LIMIT')
            const results: string[] = []
            for (let index = 0; index < result.items.length; index++) {
              const item = result.items[index]
              const bodyResult = await runPath(body.target, contextRef, { ...locals, item }, `${scopePath}/${node.id}[${index}]`, { ...contextOverrides, [node.id]: item })
              results.push(bodyResult.outputRef)
            }
            result = await persistence.completeControlActivity({ call, resultRefs: results })
          }
          if (node.type === 'parallel' && !result.outputRef) {
            const forks = outgoing.filter(edge => edge.label?.startsWith('fork-'))
              .sort((left, right) => Number(left.label?.slice(5)) - Number(right.label?.slice(5)))
            if (!forks.length) throw ApplicationFailure.nonRetryable('并行节点缺少分支', 'INVALID_PARALLEL')
            const scopes = forks.map(() => new CancellationScope({ cancellable: true }))
            const pending = forks.map((edge, index) => scopes[index].run(() => runPath(edge.target, contextRef, { ...locals }, `${scopePath}/${node.id}/${edge.label}`, { ...contextOverrides })))
            try {
              const completed = await Promise.all(pending)
              const resultRefs = Object.fromEntries(forks.map((edge, index) => [edge.label || '', completed[index].outputRef]))
              result = await persistence.completeControlActivity({ call, resultRefs })
            } catch (error) {
              for (const scope of scopes) scope.cancel()
              // WAIT_CANCELLATION_COMPLETED 让每条支路在拒绝前完成 HTTP/Docker 清理。
              await CancellationScope.nonCancellable(() => Promise.allSettled(pending))
              throw error
            }
          }
          if (!result.outputRef) throw ApplicationFailure.nonRetryable('节点没有返回结果引用', 'INVALID_NODE_RESULT')
        } catch (error) {
          if (node.type === 'loop' || node.type === 'parallel') {
            await CancellationScope.nonCancellable(() => persistence.failControlActivity(call, isCancellation(error) ? 'stopped' : 'failed', failureMessage(error)))
          }
          throw error
        }
        resultRef = result.outputRef
        contextRef = result.contextRef
        const next = node.type === 'branch' ? outgoing.find(edge => (edge.branchId ?? edge.label) === result.route)
          : node.type === 'loop' ? outgoing.find(edge => edge.label === 'next')
            : node.type === 'parallel' ? outgoing.find(edge => edge.label === 'join') : outgoing[0]
        if (node.type === 'branch' && !next) throw ApplicationFailure.nonRetryable('分支没有对应出口', 'INVALID_BRANCH_ROUTE')
        currentId = node.type === 'end' ? undefined : next?.target
      }
      if (!resultRef) throw ApplicationFailure.nonRetryable('执行路径没有输出引用', 'INVALID_NODE_RESULT')
      return { contextRef, outputRef: resultRef }
    }
    const { outputRef: resultRef } = await runPath(start.id, null, {}, 'root')
    await persistence.finishExecution(input.executionId, 'success', resultRef)
    return resultRef
  } catch (error) {
    const cancelled = isCancellation(error)
    const message = failureMessage(error)
    await CancellationScope.nonCancellable(() => persistence.finishExecution(input.executionId, cancelled ? 'stopped' : 'failed', null, message))
    if (cancelled) throw error
    throw ApplicationFailure.nonRetryable(message, 'WORKFLOW_FAILED')
  }
}
