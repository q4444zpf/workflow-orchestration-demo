# AGENTS.md — 工作流编排演示项目

本项目是 **Vue Flow + Monaco Editor + Express + SQLite + Docker Python 沙箱** 的可视化工作流编排 Demo。

> 本文件面向后续接手本项目的 AI Agent / 协作者。修改代码前请先阅读本文件。

---

## 1. 项目概览

- **仓库名**: `workflow-orchestration-demo`
- **目的**: 让用户通过可视化画布拖拽编排工作流节点，并实际执行。
- **核心能力**:
  - HTTP API 注册与复用（`ApiManager`）
  - 节点类型：开始、结束、HTTP API、Python 代码、分支、循环、并行
  - Python 代码在 Docker 容器沙箱中运行
  - 执行过程实时推送（SSE），展示每个节点的输入/输出
  - 工作流可发布为公开 HTTP API，共享变量作为入参
  - 执行日志与结果持久化到 SQLite

---

## 2. 技术栈

### 前端

- Vue 3 + TypeScript（strict）+ Vite
- `vue-router` 路由
- `@vue-flow/core` 可视化画布
- `element-plus` UI 组件
- `monaco-editor` 代码/JSON 编辑器
- `axios` HTTP 客户端

### 后端

- Node.js + Express + TypeScript（ESM，`type: "module"`）
- `sqlite3` 数据持久化
- `axios` 外部 HTTP 代理
- `tsx` 开发热重载，`vitest` 测试
- Docker + `python:3.11-alpine` 沙箱镜像

---

## 3. 项目结构

```
.
├── examples/                    # 示例工作流 JSON
├── server/                      # 后端
│   ├── src/
│   │   ├── app.ts               # Express 应用工厂
│   │   ├── index.ts             # 启动入口
│   │   ├── db/                  # SQLite 初始化与连接
│   │   ├── middleware/          # asyncHandler、errorHandler、validation
│   │   ├── routes/              # apis.ts / workflows.ts / executions.ts
│   │   ├── services/            # executor / dockerRunner / httpProxy / executionEvents
│   │   └── types/               # 共享类型
│   ├── tests/                   # Vitest 测试
│   ├── Dockerfile.runner        # Python 沙箱镜像
│   └── package.json
├── src/                         # 前端
│   ├── api/                     # axios 封装
│   ├── components/              # 节点组件、画布、属性面板、执行面板、节点库
│   ├── views/                   # ApiManager.vue / WorkflowEditor.vue
│   ├── types/                   # 前端类型
│   └── router.ts
├── docs/superpowers/            # 设计文档与实施计划
├── package.json
└── vite.config.ts               # Vite 代理 /api/ -> localhost:3000
```

---

## 4. 常用命令

```bash
# 安装前端依赖
npm install

# 安装后端依赖
cd server && npm install

# 启动前端（端口 5173）
npm run dev

# 启动后端（端口 3000）
npm run dev:server

# 后端测试
cd server && npm test

# 后端构建
cd server && npm run build

# 前端构建
npm run build
```

---

## 5. 开发约定

### 5.1 TypeScript / ESM

- 前后端均使用 ES 模块（`type: "module"`），不要写 CommonJS `require`。
- 后端严格模式已开启；避免 `any` 和类型断言 `as`。
- 所有 Express 路由处理器必须包裹 `asyncHandler`，禁止裸写可能抛异常的 async 函数。

### 5.2 错误处理

- 业务错误使用自定义 `HttpProxyError` 等错误类，并在 `errorHandler` 中统一格式化。
- 不要在路由中直接 `console.error` 吞掉异常；交给中间件处理或记录后抛出。

### 5.3 数据库

- SQLite 初始化见 `server/src/db/index.ts` 与 `server/src/db/schema.sql`。
- 新增表/字段时同步修改 `schema.sql` 与初始化逻辑，并考虑已有数据迁移。

### 5.4 Python 沙箱

- Python 代码节点通过 `server/src/services/dockerRunner.ts` 在 `workflow-python-sandbox` 容器中执行。
- 用户代码需将结果赋值给 `OUTPUT` 变量，脚本会序列化 `OUTPUT` 返回。
- 沙箱默认限制：128 MB 内存、0.5 CPU、只读文件系统、无网络。
- **必须安装并运行 Docker Desktop** 才能执行 Python 节点。

### 5.5 执行引擎

- 入口：`server/src/services/executor.ts`。
- 工作流执行已改为**异步**：`POST /api/workflows/:id/execute` 立即返回 `{ executionId }`，后台执行。
- SSE 通过 `executionEvents.ts` 管理；执行结束后才清理事件缓冲，避免前端订阅前丢失事件。
- 分支节点出边标签必须是 `true` / `false`；循环节点基于出边标签决定继续/退出。

### 5.6 前端状态

- `PropertyPanel` 等组件不要直接修改 `props.node.data`；使用本地副本并通过事件通知父组件更新。
- 画布拖拽节点时使用 `screenToFlowCoordinate` 转换坐标，避免位置偏移。

---

## 6. 测试

- 后端测试位于 `server/tests/`，使用 `supertest` + `vitest`。
- 新增路由/服务必须补充对应测试。
- 提交前运行：
  ```bash
  cd server && npm test && npm run build
  npm run build
  ```

---

## 7. 环境要求

- Node.js >= 18
- npm
- Docker Desktop（必须运行）

---

## 8. 注意事项

- Vite 代理配置只代理 `/api/`，不要与前端路由 `/apis` 冲突。
- HTTP 节点现在会对非 2xx 响应抛出异常；不要恢复 `validateStatus: () => true`。
- 修改执行引擎时要同时检查 SSE 事件顺序、缓冲清理时机和 Docker 容器泄漏问题。
- 示例工作流使用 `https://httpbin.org/get`，确保网络可达或替换为本地地址。

---

## 9. 沟通语言

项目文档、代码注释、提交信息、Issue/PR 描述请使用**中文**。
