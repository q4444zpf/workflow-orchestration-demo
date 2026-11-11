# AGENTS.md — 工作流编排演示项目

修改前阅读本文件。项目文档、代码注释、提交信息和 Issue/PR 描述使用中文。

## 工作入口

项目保留 Vue 3 + TypeScript + Vue Flow + Monaco Editor 的画布和 JSON 定义；Express API、Temporal Worker 为独立进程，共享 SQLite。Node.js 要求 >= 20.3.0。开发启动、API 用法和测试命令见 [README.md](README.md)。

- 修改调度、取消或恢复时，先读 [迁移设计](docs/superpowers/specs/2026-11-09-temporal-migration-design.md) 与 [恢复验证](docs/superpowers/verification/2026-11-09-temporal-recovery.md)。
- 发布执行器、升级 Worker 或重放历史时，先读 [版本发布与重放](docs/temporal-engine-versions.md)。开发 Worker 使用当前源码；在途版本稳定性依靠完整、不可覆盖的发布件与对应版本任务队列。
- 查命令与依赖时以根目录及 `server/package.json` 为准；本地 Temporal 配置在 `compose.yaml`。

## 执行与持久化约定

- **全部新执行走 Temporal**。`services/executionService.ts` 保存启动记录、确认启动和校正状态，`temporal/workflows.ts` 负责图调度，`temporal/activities.ts` 调用单节点执行器。Temporal 不可用时保留 pending 记录和执行 ID，返回明确提示；不得恢复旧调度或静默 fallback。
- **Temporal 是执行状态的权威来源**。SQL 保存完成意图，API 确认 Temporal 终态后投影最终状态。修改完成流程时同步检查迟到 Activity、重复尝试、取消和结果缓存的交错顺序。
- **快照固定**。启动时保存完整定义、有效变量、执行器版本与限额；恢复使用原快照。Workflow 历史尽量传引用，完整输入输出存 `execution_values`，上下文引用按执行归属校验。
- **记录逐次调用**。逻辑 invocation、scope、attempt 分别记录；循环轮次、并行支路与重试不能互相覆盖。重试可复用已提交结果，但必须保持调用记录与缓存一致。
- **事件持久且有序**。`executionStore.ts` 在事务中保存状态与事件，`executionEvents.ts` 按游标读取；SSE 支持 `after` / `Last-Event-ID`，查询提供一致快照及 `last_event_id`。完成事件、最终查询和逐次状态必须一致。
- **数据库共用**。API 与全部 Worker 使用同一绝对 `DB_PATH`。`:memory:` 仅用于隔离测试。新增字段同步修改 `db/schema.sql` 和 `db/index.ts` 的已有库迁移；保持旧历史可读。异步事务使用 `db.transaction`，避免普通查询或其他调用混入事务。
- **旧执行只查历史**。无 Temporal ID 的旧在途记录启动时标记中断，不迁移在途状态；重新执行创建新记录。

## 节点和图语义

- `services/nodeExecutor.ts` 只执行单节点；分支、循环和并行路径由 Temporal Workflow 调度。HTTP、Python 和条件表达式在 Activities 内执行，Workflow 代码保持确定性。
- 多条件分支按配置顺序首命中，必须恰有一个默认出口；条件报错或非布尔值时失败。出口使用稳定 `branchId`，旧 `condition` + `true` / `false` JSON 保持兼容。
- 循环 `body` 每轮独立结束，再走 `next`，每轮隔离 `var.item` 与上下文，汇总数组。并行 `fork-N` 独立结束，再走 `join`，按出口名汇总。任一支路最终失败后取消其余分支，等待资源清理完成才结束工作流。
- 图规则统一在 `server/src/shared/workflowValidation.ts`，前后端共用。控制子图与后续区域互不重叠，禁止任意回连、交叉进入子图。修改前端分支时同时检查稳定出口、排序和删边行为。
- GET、纯计算 Python 可有限重试；有副作用的 HTTP 仅在用户配置幂等且外部服务支持时重试，使用稳定幂等键。HTTP 非 2xx 抛错；不承诺外部副作用 exactly-once，也不自动回滚已完成写入。
- 默认输出上限 1 MiB、每执行 1000 次逻辑节点调用，重试不重复计数；限额由 API 配置并固化到快照，超限明确失败。
- Python 通过 `services/dockerRunner.ts` 运行，结果赋给 `OUTPUT`；保持 128 MB、0.5 CPU、只读和无网络限制。修改超时/取消时检查当前容器、上次尝试容器与强杀后的过期容器清理，清理范围必须属于本项目/本次调用。

## 代码与前端状态

- 前后端使用 TypeScript strict、ESM。后端避免新增 `any` 和 `as`；Express 异步路由统一包裹 `asyncHandler`，业务错误交给 `errorHandler`。
- `PropertyPanel` 等组件使用本地副本并发事件更新父级，保持 props 不被直接修改。画布拖拽用 `screenToFlowCoordinate`。
- 执行监控保留在画布下方；`useExecutionMonitor.ts` 负责游标、去重和查询恢复。变更时检查旧历史降级、重试选择以及快照与并发事件的衔接。
- Vite 仅代理 `/api/`，避免与前端 `/apis` 路由冲突。

## 验证与数据边界

新增路由或服务补相应测试；修改节点调度覆盖真实 Temporal，修改 Python 清理覆盖 Docker。前端组件测试使用 Vitest + Vue Test Utils。提交前从项目根目录执行：

```powershell
npm test
npm --prefix server test
npm --prefix server run build
npm run build
```

完整后端测试依赖本地 Temporal 和 Docker。`server/vitest.config.ts` 在模块导入前固定测试 `DB_PATH=:memory:`；进程恢复测试另用受控临时数据库与唯一任务队列。保留该隔离：测试、演示和故障注入不得写入用户工作流或默认业务库。真实进程测试只停止本测试创建的进程，只清理本测试已知的 Workflow ID 和临时目录。

报告验证时区分已运行、跳过和未覆盖场景，注明需要外部服务的前提；已完成节点结果复用与外部成功但未落 SQL 的窗口是不同保证。
