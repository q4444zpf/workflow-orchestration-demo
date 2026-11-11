# 工作流编排演示

基于 Vue Flow、Monaco Editor、Express、SQLite 和 Temporal 的可视化工作流编排 Demo。保留画布与工作流 JSON，所有新执行统一由 Temporal 调度，Python 节点在 Docker 沙箱中运行。

## 能力与执行模型

- 拖拽编排开始、结束、HTTP API、Python、条件分支、循环和并行节点；注册外部 API 供节点复用。
- 一次执行对应一个 Temporal Workflow，节点操作通过 Activities 执行。API 与 Worker 是独立进程。
- 启动时保存定义、变量、限额及执行器版本快照；后续编辑只影响新执行。
- SQLite 保存完整输入输出、结果引用、逐次调用与重试记录，以及有序事件；画布下方通过持久化 SSE 展示进度。
- API 或 Worker 重启后按同一执行 ID 恢复。Temporal 是状态权威来源，服务不可用时明确返回待确认状态，不回退旧调度器。
- 工作流可发布为公开 HTTP API，异步取得执行 ID，再查询结果或订阅事件。

## 环境与开发启动

需要 Node.js **>= 20.3.0**、npm、已启动的 Docker Desktop。前端使用 Vue 3、TypeScript、Vite、Element Plus、Vue Flow、Monaco Editor；后端使用 Express、Temporal TypeScript SDK 和 SQLite3。本地 Compose 提供带持久化卷的 Temporal 开发服务器，适用于本 Demo。

以下 PowerShell 命令均从项目根目录执行：

```powershell
npm install
npm --prefix server install
npm run temporal:up
# 首次启动且尚无 v4 发布件时执行一次
if (!(Test-Path 'server/engine-releases/v4/release.json')) {
  npm --prefix server run engine:publish -- v4
}
```

Temporal RPC 地址为 `127.0.0.1:7233`，管理界面为 [Temporal UI](http://localhost:8233)。`compose.yaml` 将服务绑定到本机，数据保存在 `temporal-home` 卷中。

准备两个终端，工作目录均为项目根目录：

```powershell
# 终端 1：前端，端口 5173
npm run dev

# 终端 2：API（端口 3000）和 v4 Worker
npm run dev:server
```

`dev:server` 校验并启动 v4 发布件，同时启动 API。两个进程默认使用项目根目录的 `data/demo.db`、Temporal 地址 `127.0.0.1:7233` 和命名空间 `default`。已有安装可在启动终端设置绝对 `DB_PATH` 指向原数据库，也可设置 `WORKFLOW_ENGINE_VERSION` 选择另一个已发布版本。任一进程意外退出时，启动终端会报错并关闭由本次命令启动的另一进程。

运行构建后的服务时使用 `npm --prefix server run build`，再执行 `npm --prefix server start`。需要独立运行 API 时，使用 `npm --prefix server run dev:api` 或 `npm --prefix server run start:api`，并为独立 Worker 设置相同的绝对 `DB_PATH`。

打开 [工作流列表](http://localhost:5173/workflows)，使用卡片浏览、新建或编辑工作流。列表支持名称搜索、发布状态筛选及每页8条分页；点击卡片“执行日志”进入独立日志列表，再点击指定记录进入独立详情页。编辑器左上角“返回列表”返回此页；未保存修改会提示保存或放弃，关闭提示可继续编辑。Worker 首次执行 Python 时自动构建带内容散列标签的沙箱镜像，需要能获取固定 digest 的 `python:3.11-alpine` 基础镜像。容器限制为 128 MB 内存、0.5 CPU、只读文件系统、无网络；超时或取消时清理对应容器，Worker 定期回收本项目过期沙箱。

`dev:worker` 使用当前工作区代码，仅用于开发验证。需要保持在途解释器不变时，使用完整版本发布件和 `engine:start`；发布、升级、旧 Worker 保留及历史重放步骤见 [执行器版本发布与历史重放](docs/temporal-engine-versions.md)。API 的版本决定新执行任务队列，旧执行继续等待绑定版本的 Worker。

当前源码未显式设置 `WORKFLOW_ENGINE_VERSION` 时使用 `v4`，支持可视化复杂参数、输入来源选择、HTTP 请求值绑定与输出字段投影。开始节点默认输出全部有效运行参数（包括变量默认值），选择自定义字段后仅输出已配置映射。已有 `v1`、`v2`、`v3` 发布件与旧执行保持原样。固定版本运行时请显式设置 API 和对应 Worker 的版本。

停止本地 Temporal 可执行 `npm run temporal:down`，持久化卷会保留。停止期间新执行不能确认启动；恢复服务和对应 Worker 后，API 校正器继续处理已保存记录。

## 导入、执行与发布

### 界面参数配置

1. 点击工具栏“参数配置”，定义名称、类型、必填、说明和可选默认值。支持文本、数字、布尔、对象子字段以及对象/数组元素；默认值也通过表单填写。
2. 点击“运行”，根据定义填写运行表单。对象、数组逐级展开，可增删数组项目；取消不保存或启动执行。必填与类型问题在字段旁显示。
3. 选中节点，在输入字段表格中选择“工作流参数”“全部工作流参数”或可用的上游节点输出，再选择完整值或子字段。循环体还可选择当前元素。系统维护真实节点 ID 和字段路径。
4. Python 代码继续将结果赋给 `OUTPUT`，输出表格可以选取整个结果或其子字段。HTTP 默认输出完整响应，也可选取状态、响应头或响应数据；查询参数、请求头和请求体均通过表单绑定固定值或输入来源。
5. 结束节点选择“直接返回一个结果”或“组合多个输出字段”。输出结构声明提供下游字段提示；动态字段尚未声明时，可指定子字段路径。

配置和运行填写使用表单；执行监控中的实际数据仍以格式化内容展示。原工作流文件及公开 API 继续使用 JSON，原有映射和模板载入时保持原样。删除参数、节点或已声明输出字段导致引用失效时，校验会提示重新选择。

### 执行历史日志

工作流列表或编辑器的“执行日志”进入历史记录；也可打开 [全部执行日志](http://localhost:5173/executions)，按工作流与状态筛选、分页查询。筛选和页码保存在地址中，进入详情后返回可恢复查询位置；页码超出已有记录范围时自动校正。点击“查看详情”可查看整体运行输入、最终输出、开始/结束时间、耗时与异常，以及每个节点调用的输入输出、异常、时间、作用域、重试次数和事件日志。运行中详情每3秒刷新。

历史详情使用执行启动时保存的定义与输入，不随编辑器后续修改变化。旧记录没有输入快照时显示“未保存运行输入”。列表显示已保存状态，详情通过 Temporal 校正最新状态。查询概要接口为 `GET /api/executions?page=1&pageSize=20&workflowId=1&status=success`，详情接口为 `GET /api/executions/:id`。

### API 调用

可在画布创建工作流，也可导入 `examples/sample-workflow.json`。示例直接调用 `https://httpbin.org/get`，无需预先注册 API；网络不可达时将 HTTP 节点替换为本地服务。

以下是 Bash/curl 示例；PowerShell 可使用 `curl.exe` 并按其参数引用规则传入 JSON。将示例 ID `1` 替换为实际创建的 ID。

```bash
# 导入示例
curl -X POST http://localhost:3000/api/workflows \
  -H 'Content-Type: application/json' \
  --data-binary @examples/sample-workflow.json

# 启动执行，可用稳定请求标识重试同一次提交
curl -X POST http://localhost:3000/api/workflows/1/execute \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: sample-request-001' \
  -d '{"variables":{"userId":"123"}}'
```

启动接口异步返回，例如 `{"executionId":1}`，不等待最终结果。编辑器接口使用 `variables` 对象；公开调用直接以请求体作为变量。请求标识可通过 `Idempotency-Key` 提供，编辑器执行接口也接受 `requestId`。仅重试同一次请求时复用标识，新的运行使用新标识。相同标识对应的定义或变量发生变化时返回 HTTP 409。

```bash
# 查询状态、结果、逐次节点记录及事件游标
curl http://localhost:3000/api/executions/1

# 订阅持久化事件
curl -N http://localhost:3000/api/executions/1/events

# 从上次事件 ID 续传；也支持 Last-Event-ID 请求头
curl -N 'http://localhost:3000/api/executions/1/events?after=12'

# 发布并调用
curl -X POST http://localhost:3000/api/workflows/1/publish \
  -H 'Content-Type: application/json' -d '{"publish_path":"sample"}'
curl -X POST http://localhost:3000/api/run/sample \
  -H 'Content-Type: application/json' -d '{"userId":"123"}'
```

公开调用同样返回 `executionId`。Temporal 启动结果暂未确认时，接口返回 HTTP 503、说明和已保存的 `executionId`；继续查询该 ID，避免重复提交。查询可能包含 `sync_warning`，表示当前返回已保存记录、权威状态仍待同步。SSE 使用递增事件 ID，可在 API 重启后续传；查询快照提供 `last_event_id`。

## 节点与控制流

工作流 JSON 可带 `schema_version: 1`；省略时按版本 1 保存和执行，未知版本返回 HTTP 400。JSON 版本描述图格式，与执行器代码的 `engine_version` 分别管理。

编辑器的校验按钮、执行和发布入口使用相同图校验。保存允许不完整草稿；执行前要求唯一开始节点、至少一个结束节点、唯一有效的节点/连线 ID，所有节点可从开始节点到达。非法图返回 HTTP 400 和 `issues`。

- **分支**：有序条件出口按配置顺序选择第一个 `true`，所有条件均为 `false` 时走唯一默认出口。条件须返回布尔值，表达式错误会失败。出口用稳定 `branchId` 关联连线；旧 JSON 的 `condition` 和 `true` / `false` 标签兼容。
- **循环**：`body` 指向独立结束的循环体，`next` 指向后续流程。每轮有独立 `var.item` 和上下文，结果按轮次汇总为数组。
- **并行**：每条唯一 `fork-N` 分支独立结束，`join` 指向汇总后的流程；结果按 `fork-N` 汇总。某分支最终失败后，取消其余分支并等待 HTTP / Python 清理，再结束整次执行。
- **拓扑**：普通节点只有一条出线；禁止任意回连、循环体与后续区域重叠、并行支路共享节点或从外部侵入子流程。互斥条件分支可以汇合。
- **Python**：代码将结果赋值给 `OUTPUT`，通过节点输出映射供后续节点读取。

GET 和纯计算 Python 默认最多尝试 3 次。写操作只有配置 `idempotent: true`、且外部接口实际支持幂等处理时才允许自动重试，重试使用稳定的 `Idempotency-Key`；其他写操作只尝试一次。HTTP 非 2xx 会失败，已完成外部写入不自动回滚。外部操作成功但结果尚未确认时仍可能重试，不承诺副作用恰好一次。

默认单节点 JSON 输出上限为 **1 MiB（1,048,576 字节）**，单次执行最多 **1000 次逻辑节点调用**；循环每轮计数，重试不另算逻辑调用。可在 API 启动环境设置 `WORKFLOW_MAX_OUTPUT_BYTES`（1–16,777,216）和 `WORKFLOW_MAX_NODE_CALLS`（1–5000），新执行保存限额快照。超限明确失败，不静默截断输出。

## 项目入口

| 目录或文件 | 职责 |
| --- | --- |
| `src/views/WorkflowEditor.vue`、`src/components/` | 画布、属性与执行面板 |
| `src/composables/useExecutionMonitor.ts` | SSE 游标、查询恢复和监控状态 |
| `server/src/routes/` | 定义、执行、公开调用及监控接口 |
| `server/src/temporal/` | Workflow 图调度、节点 Activities、客户端与 Worker |
| `server/src/services/executionService.ts` | 启动确认、请求去重、Temporal 状态校正 |
| `server/src/services/executionStore.ts` | SQL 快照、值引用、逐次记录与有序事件 |
| `server/src/services/nodeExecutor.ts` | 单节点 HTTP、Python、表达式执行边界 |
| `server/src/shared/` | 前后端共用的分支模型与图校验 |
| `server/src/db/` | SQLite schema 与迁移 |
| `docs/superpowers/` | 迁移设计、计划及验证证据 |

## 测试与构建

从项目根目录运行：

```powershell
npm test
npm --prefix server test
npm --prefix server run build
npm run build
```

完整后端测试需要 Docker 与本地 Temporal `127.0.0.1:7233`。单元测试默认使用内存 SQLite；真实恢复测试为独立 API/Worker 建立临时数据库、版本和任务队列。不要将测试数据库改为用户数据文件。

```powershell
# 真实进程重启、启动窗口及 Temporal 不可用验证
npm --prefix server test -- --run tests/temporalRecovery.test.ts
```

场景与覆盖边界见 [Temporal 服务重启恢复验证](docs/superpowers/verification/2026-11-09-temporal-recovery.md)。完整发布件 A/B 与历史重放集成测试需显式启用，命令见 [版本文档的自动验证](docs/temporal-engine-versions.md#自动验证)。

## 旧执行记录

旧历史继续通过执行查询读取。切换前应让旧任务完成或停止；旧引擎在途状态不会迁入 Temporal。API 启动时将没有 Temporal ID 的遗留 `running` 记录标记为中断，需要重新发起时会创建新的 Temporal 执行。
