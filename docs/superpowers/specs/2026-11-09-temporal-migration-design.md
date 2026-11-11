# Temporal 调度迁移设计：访谈确认稿

日期：2026-11-09。状态：Q1–Q16 及整体范围均已获用户确认，进入实施。

## 1. 目标与交付边界

保留 Vue Flow 编辑器、工作流 JSON、现有节点类型和画布下方的执行监控。后端调度全面交给 Temporal，不增加现有引擎与 Temporal 的运行时选择，也不在 Temporal 启动失败时自动回退。

第一阶段的核心验收：服务重启后能够恢复流程，并保留已完成节点的结果。恢复不代表外部副作用可以保证只发生一次；未确认完成的节点按幂等及重试策略处理。

使用本地 Docker 环境，新增 Temporal 服务及独立 Worker 进程。“逐步”指开发和验证顺序，交付后所有新执行统一使用 Temporal。

## 2. 职责与数据归属

- Vue Flow：编辑节点、连线与配置，不承接可靠调度。
- 工作流 JSON：继续作为图定义；现有 JSON 无需修改即可导入，可扩展可选的版本、重试及超时字段。
- Temporal Workflow：一次流程对应一次 Workflow，负责路径、循环和并行调度。
- Activities：HTTP 调用、Python 沙箱，以及条件表达式求值等需要与 Workflow 调度隔离的操作。
- Temporal：执行状态的权威来源。
- SQLite：继续保存定义，新增执行时的完整 JSON 快照、输入变量、执行器版本，以及监控查询所需的执行记录、输入输出和日志。
- SSE：继续向现有界面推送状态；API 重启后需要校正状态并补齐进度。

每次执行固定使用启动时的定义及变量快照。后续编辑仅影响新执行。

## 3. 节点与控制流语义

现有开始、结束、HTTP、Python、分支、循环、并行节点均保留。现有节点配置、循环数组结果及按 `fork-N` 汇总的并行结果需要保持兼容。

循环每一轮及每条并行分支拥有独立的临时变量和执行记录，修正当前共享 `var.item`、共享上下文及按 nodeId 覆盖历史的问题。

支持边界明确的结构化流程：循环体独立结束后通过 `next` 继续；并行分支分别结束后通过 `join` 继续。任意回连、分支交叉连接等语义不明确的图在校验时拒绝执行。保留现有连线标签及示例兼容性，收紧拓扑校验。

## 4. 多条件分支

分支节点支持多个有序条件出口，必须存在默认出口。按配置顺序逐个判断，只执行第一个命中的分支。所有条件均正常求值为 false 时才走默认出口；需要同时执行多条路径时使用并行节点。

属性面板支持分支新增、删除、排序，以及名称、条件配置。旧的单条件 `true` / `false` 两路分支保持兼容。

继续支持现有 JavaScript 条件表达式。独立 Activity 求值并返回选中的分支 ID，结果进入 Temporal 执行历史。表达式报错或返回非布尔值时节点失败，不把错误当作 false。

例如：高分 `score >= 80`，中等 `score >= 60`，默认其余。90 只走高分，70 走中等。

## 5. 重试、失败与取消

GET 请求及纯计算 Python 节点允许有限重试。有写入副作用的接口，仅在外部服务支持幂等处理时自动重试，否则故障后标记失败并交由人工处理。

已被 Temporal 确认完成的 Activity 结果在恢复时复用。外部操作成功但完成结果尚未被记录时，Activity 仍可能再次执行；不承诺外部副作用 exactly-once。

一个并行分支最终失败后，取消其余分支，等待执行器完成清理，再将整次流程标记为失败。HTTP 与 Python 沙箱需要配合取消；Temporal 本身不会自动终止 Docker 容器。已经完成的外部写入保留，首期不提供自动回滚或业务补偿。

## 6. 容量与版本

- 单节点输出最大 1 MB。
- 单次流程最多执行 1000 次节点调用，循环中每次调用均计数。
- 两项上限均可配置，超限明确失败，不静默截断结果。
- 完整节点输入输出继续存 SQLite，Temporal 尽量传递结果引用，控制载荷及历史体积。

每次执行绑定执行器版本。升级后的新执行使用新版，旧执行继续由对应旧版 Worker 执行到结束，运行中的执行不自动切换解释器版本。JSON 版本与执行器代码版本分别管理。

## 7. 旧记录与切换

旧执行历史保留查询，不把旧引擎运行到一半的任务迁入 Temporal 原地续跑。切换前让旧任务完成或停止；遗留中断任务明确标记，必要时通过 Temporal 重新启动。

交付后只有 Temporal 新执行入口，不保留静默回退路径。

## 8. 实施顺序（整理建议）

以下是依据上述决定整理的工程顺序，属于实施建议，不新增运行时双引擎方案：

1. 固化兼容协议与执行快照；补充多分支模型、独立节点执行记录及结构化拓扑校验。
2. 建立本地 Temporal 服务、独立 Worker、HTTP/Python/表达式 Activities 及图解释 Workflow；逐类验证七种节点。
3. 将执行入口、状态查询、监控投影及 SSE 接入 Temporal，完成取消、清理、重试与版本绑定。
4. 验证旧历史可查询及切换行为，统一使用 Temporal，删除旧调度路径。

默认重试次数、超时与退避参数、具体版本路由方式、数据库迁移细节及事件同步机制由实施计划给出。这些工程细节必须满足上述行为和容量边界。

## 9. 验收清单（由已确认目标推导）

- 现有 JSON 和示例可导入，现有七种节点及多条件分支按约定执行。
- 重启 API、重启 Worker 后检查状态与结果恢复；已确认完成的节点不会因重放而重新调度。
- 故障发生在外部调用完成确认前时，执行符合已声明的幂等与重试策略。
- 执行过程中修改工作流，当前执行继续使用原快照，新执行使用新定义。
- 嵌套循环及并行循环不会串扰临时变量，能区分每轮、每分支的执行记录。
- 并行最终失败时其余分支收到取消并完成清理；Python 超时、取消及 Worker 故障后的容器清理有验证。
- API 重启、SSE 断开重连后监控能够恢复；执行监控继续位于画布下方。
- 单节点输出与累计节点调用超限时明确失败。
- 旧执行历史可查询，旧中断执行不会冒充 Temporal 中的可恢复任务。
- 代表性执行历史可以由匹配版本的 Worker 重放，升级不改变在途执行的解释器。

## 10. 依据

代码核查：`server/src/services/executor.ts`、`routes/workflows.ts`、`routes/executions.ts`、`services/executionEvents.ts`、`services/dockerRunner.ts`。当前持久化主要发生于开始和结束，缺少持久化执行快照及逐节点恢复记录。

Temporal 官方资料：

- [TypeScript Workflow 基础与确定性约束](https://docs.temporal.io/develop/typescript/workflows/basics#develop-workflow-logic)
- [Activity 幂等与重复执行](https://docs.temporal.io/activity-definition#idempotency)
- [取消处理](https://docs.temporal.io/develop/typescript/workflows/cancellation)
- [Heartbeat 与超时](https://docs.temporal.io/develop/typescript/activities/timeouts#heartbeat-an-activity)
- [载荷及历史限制](https://docs.temporal.io/evaluate/cloud/limits#programming-model-level)
- [Workflow 版本管理](https://docs.temporal.io/develop/typescript/workflows/versioning)
- [历史重放测试](https://docs.temporal.io/develop/typescript/best-practices/testing-suite#how-to-replay-a-workflow-execution)
