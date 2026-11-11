# 执行器版本发布与历史重放

每次执行的 `engine_version` 与工作流 JSON 的版本分别管理。版本 `v1` 只从 `workflow-orchestration-v1` 接收 Workflow 和 Activity 任务；API 改为 `v2` 后，新执行使用 `workflow-orchestration-v2`。旧任务一直留在原队列，缺少旧 Worker 时等待匹配 Worker，不会自动交给新版本。

## 首次发布

在 `server` 目录执行，示例使用 PowerShell：

```powershell
npm run engine:publish -- v1
$env:DB_PATH = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path '../data/demo.db'))
$env:TEMPORAL_ADDRESS = '127.0.0.1:7233'
$env:TEMPORAL_NAMESPACE = 'default'
$env:WORKFLOW_ENGINE_VERSION = 'v1'
npm run engine:start -- v1
```

必须将 `DB_PATH` 设置为 API、全部版本 Worker 共用的绝对数据库路径。不能直接复制示例路径到其他安装位置；使用该安装实际的数据文件。`:memory:` 只供隔离测试使用。

发布命令先构建，再将完整 `dist`（包含 Workflow、Activity、表达式与节点执行器、数据库 schema）、`Dockerfile.runner`、`src/runner`、`package.json` 和锁文件复制到独立目录。在此目录按锁文件执行 `npm ci --omit=dev`，并确认 SQLite 原生依赖、Temporal Worker 能够加载。发布件不引用开发目录的 `node_modules`。

每份发布件包含受控 `.npmrc`，仅允许 `sqlite3`、`@swc/core`、`protobufjs`、`esbuild` 的安装脚本。新版 npm 的严格检查也会检查被省略的开发依赖，所以列表保留 `esbuild`，实际仍省略开发依赖。依赖新增安装脚本时发布会明确失败，需要核查后更新发布工具允许列表；不修改全局 npm 设置。

默认目录为 `server/engine-releases/<版本>/`，可用绝对路径环境变量 `WORKFLOW_ENGINE_RELEASES_DIR` 指定专用发布仓库。版本号仅允许 1–64 位字母、数字、下划线和连字符，同名目录永远不能覆盖。发布失败会清理本次拥有的未完成目录；没有有效清单的目录不能启动。不要将含依赖的发布目录提交到 Git。

`release.json` 记录版本、队列、Node 主版本、平台、架构，以及全部代码、依赖和 Python 资源的 SHA256。启动与重放均检查清单；资源缺失、被改动或平台不符时直接报错。版本发布后不要修改其中任何文件，也不要在原目录执行 npm 更新。必须使用原 Node 主版本、平台、架构运行，换运行环境时为重新准备的发布件使用新版本号。

## 升级并保留在途任务

1. 保留正在运行的 `v1` Worker 及完整发布目录。
2. 更新代码后执行 `npm run engine:publish -- v2`，成功后用新终端设置相同 `DB_PATH`、Temporal 地址及 namespace，设置 `WORKFLOW_ENGINE_VERSION=v2`，执行 `npm run engine:start -- v2`。
3. 使用 `WORKFLOW_ENGINE_VERSION=v2` 和 `npm run start:api` 重启独立 API。之后的新执行绑定 `v2`，已有执行保持数据库快照中的 `v1`。
4. 验证新执行完成，检查旧版本的运行中和待执行任务。需要重启旧 Worker 时仍运行 `npm run engine:start -- v1`，并将该终端的版本环境变量设为 `v1`。
5. 只有旧版本全部在途执行终结、没有待执行任务，且不再需要恢复这些任务时，才可停止其 Worker。仍需历史重放时继续保留对应完整发布件。

必须保留发布目录中的独立依赖、schema、Dockerfile 与 Python runner，以及 Docker 中由这些资源生成的内容散列镜像。基础 Python 镜像由 Dockerfile 固定 digest；发布件首次使用时可以据此重建，需保证该 digest 对应镜像仍可获取。迁移机器时应保留对应镜像或镜像归档。

开发命令 `dev:worker` 和直接运行 `dist/temporal/worker.js` 使用当前工作区代码，适用于开发验证。正式版本运维入口为 `engine:start`：它只启动已归档的 `dist/temporal/worker.js`，相对导入也全部来自该发布目录。

## 导出与重放历史

在仍保留发布件的机器上，导出时使用匹配执行器版本；可选 `RunId` 用于精确选择一次运行：

```powershell
npm run history:export -- v1 workflow-123 D:\history\workflow-123.json
# 或：npm run history:export -- v1 workflow-123 D:\history\workflow-123.json <RunId>
npm run history:replay -- v1 D:\history\workflow-123.json
```

输出文件必须尚不存在，父目录需预先建立。导出内容包含 Temporal 完整历史、执行器版本、Workflow ID 和发布清单摘要。工具核对历史开始事件中的输入版本及任务队列，禁止把其他版本历史重新标为本版本。

重放使用发布件自己的 SDK，在独立子进程中调用 `Worker.runReplayHistory`，不需要连接 Temporal，也不需要 SQLite 或 Docker 服务。只加载 Workflow 代码，不注册或导入 Activities；HTTP、Python、表达式等 Activity 的结果直接从历史读取，不产生实际外部副作用。历史版本、队列或发布清单摘要不匹配时，在运行重放前明确失败。重放成功仅证明该份历史与对应 Workflow 代码兼容，新增分支、循环和并行场景仍应分别导出代表性历史验证。

不要以修改版本号或历史归档来绕过版本错误；找到导出时的完整发布件再重放。

## 自动验证

```powershell
npm test -- --run tests/engineReleases.test.ts
$env:RUN_ENGINE_RELEASE_INTEGRATION = '1'
npm test -- --run tests/engineReleases.integration.test.ts
Remove-Item Env:RUN_ENGINE_RELEASE_INTEGRATION
```

集成验证需要本地 Temporal。它在系统临时目录独立安装两份完整依赖，使用唯一 `test-versions-*` 版本与 Workflow ID，验证新版队列先完成、旧版保持等待、匹配旧 Worker 上线后完成、匹配历史重放成功、错配版本明确失败。测试 Activity 仅向本测试拥有的文件写入标记；重放后标记不变，证明没有导入或执行 Activity。测试不会使用用户数据库或删除 Temporal 服务、数据卷。
