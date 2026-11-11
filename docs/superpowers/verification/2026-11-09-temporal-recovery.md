# Temporal 服务重启恢复验证

日期：2026-11-09（本地时间）。对应工单：`.scratch/temporal-migration/issues/09-restart-recovery.md`。

## 环境与复现

保持本地 Temporal `127.0.0.1:7233` 运行，在 `server` 目录执行：

```powershell
npm test -- tests/temporalRecovery.test.ts
```

测试使用 Node 24，以 `spawn(process.execPath, ['--import', 'tsx', script])` 启动独立 API 和 Worker；强杀的是这些直接子进程。API 使用动态独立端口，执行器版本及任务队列使用 `test-recovery-<UUID>`。SQLite 明确设置到系统临时目录 `workflow-recovery-test-*/isolated.sqlite`，子进程的 `DB_PATH` 覆盖测试环境默认值。

测试结束后捕获子进程退出、释放 HTTP 连接，只清理测试掌握的 Temporal Workflow ID。删除临时文件前检查目录位于系统临时目录内、目录名前缀正确、SQLite 路径位于该测试目录内。测试不使用默认 `data/demo.db`，不停止用户 API/Worker，不操作 Temporal 容器或持久化卷。

## 故障窗口与断言

| 场景 | 故障注入 | 验证结果 |
| --- | --- | --- |
| Worker 执行中重启 | 第一个 HTTP 完成、第二个 GET 服务端挂起时强杀 Worker，编辑定义和变量默认值后重启 | 第一个 HTTP 仅调用 1 次；第二个 GET 调用 2 次，两个 attempt 分别为 failed/success；旧执行结果为 42，新定义执行结果为 99，新 HTTP 使用新默认值 90 |
| SQL 已保存、Temporal 尚未确认 | 测试专用 Worker 包装真实 Activity，在其返回成功引用后、向 SDK 返回前强杀自身 | SQL 中第一次结果已经成功提交；重启后第二次 attempt 复用缓存；外部 HTTP 仅调用 1 次，两个 attempt 均有 success 记录，最终结果为 64 |
| API 离线、Worker 继续运行 | SSE 订阅取得游标后强杀 API，在 API 离线期间释放 HTTP 并等待 Temporal 完成，然后重启 API | 同一 executionId 查询得到 success/51；重启前后 SSE 事件拼接与完整历史完全一致；日志 6 条无重复；`after` 与 `Last-Event-ID` 续传一致，完成事件恰好 1 条 |
| 尚未向 Temporal 启动 | 独立种子进程只调用真实 `createExecution` 保存 pending 记录，API 不运行 | API 启动后后台校正器恢复同一记录，使用原 Temporal Workflow ID；HTTP 仅调用 1 次 |
| Temporal 已接受、启动确认未保存 | 独立种子进程保存记录并真实启动 Temporal，跳过 `markExecutionStarted` 后退出 | API 重启后校正已有执行，不重复运行；Temporal runId 不变，HTTP 仅调用 1 次 |
| 请求去重 | 在上述两个窗口恢复后，重复提交原 requestId，再重启 API | 返回同一 executionId；每个 requestKey 只有一条 SQLite 记录；原 Workflow ID/runId 保持不变 |
| Temporal 不可用 | 仅将独立测试 API 的 `TEMPORAL_ADDRESS` 指向本机未监听端口，再发起包含 HTTP 节点的工作流 | 启动返回 HTTP 503、待确认说明和 executionId；查询保留 `start_state=pending`、`sync_warning`，nodeRuns 为空，测试 HTTP 调用次数为 0，没有执行旧调度器 |

生产代码没有增加故障注入开关。辅助脚本位于 `server/tests/helpers/seedRecoveryExecution.ts` 和 `server/tests/helpers/crashAfterSavedResultWorker.ts`。

## 实际发现与修复验证

首轮三项核心恢复场景通过后，增加 attempt 状态断言，成功复现监控缺陷：Worker 强杀前的 attempt 1 永久保留 `running`，尽管 attempt 2 和整次执行已成功。

失败证据：`attempts = [{ attempt: 1, status: 'running' }, { attempt: 2, status: 'success' }]`；期望为 `failed/success`。当时 `executionStore.prepareNodeRun` 仅插入新 attempt，整体 success 的完成处理也不会终结旧 attempt。

持久化模块负责人修复后，同一失败断言保留并通过：新 attempt 开始时，仅将同一 invocation 中编号较小、仍为 running 的尝试明确结束，保存错误“节点尝试因执行器中断或超时而结束”及相应持久化事件。

2026-11-09 22:55 的验证：4 项全部通过，Vitest 总耗时 43.60 秒。该轮版本为 `test-recovery-6e2bbf0f-5bba-44f0-8852-3d73e5f51cdf`；Worker 恢复执行 ID 为 1，SQL 成功未确认窗口为 3，API 重启为 4，两个启动窗口为 5/6。SSE 游标 78，前 9 个事件加后 10 个事件等于全部 19 个事件。

22:57 再次完整回归为 4/4 通过，总耗时 43.11 秒。随后加强启动窗口断言：API 重启后不先查询执行 HTTP 接口，而是直接轮询临时 SQLite，要求后台校正器独立把两条记录更新为 `start_state=started`、`status=success`；避免查询入口的同步逻辑掩盖后台校正器失效。执行 `npm test -- tests/temporalRecovery.test.ts -t "API 重启校正"`，该加强场景通过，总耗时 6.59 秒，其余 3 项由测试名称过滤器排除。

最终恢复套件在 2026-11-09 23:08:15 开始执行，**5/5 全部通过**，总耗时 **51.35 秒**。证据保存在 [recovery-final.log](../../../output/temporal-migration/recovery-final.log)。本轮版本为 `test-recovery-a5a5d257-f165-4f4a-8e0b-da594cf76319`；Worker 恢复仍得到结果 42、首次 HTTP 1 次、在途 GET 2 次及 failed/success 两次记录；SQL 已保存窗口得到 64、外部调用 1 次；API 重启结果为 51，SSE 游标 81，前 9 个事件与续传 10 个事件组成全部 19 个事件，日志 6 条。两个启动窗口分别保留执行 ID 5/6、稳定 Workflow ID 和 runId，HTTP 各调用 1 次。新增第 5 项验证上述 Temporal 不可用提示与无旧调度路径，未停止共享 Temporal 服务。

## 本轮边界

本轮使用小型 HTTP 直线流程，不覆盖 Python 容器恢复或复杂循环/并行恢复。Temporal 不可用场景通过独立 API 的不可达地址验证启动和查询行为，没有停止共享服务，也没有模拟 Temporal 服务本身崩溃、历史库故障或网络分区中的在途任务。外部操作已经成功、但尚未写入 SQL 的窗口仍可能重试，需依照 HTTP 幂等配置处理；本测试不承诺外部副作用恰好一次。
