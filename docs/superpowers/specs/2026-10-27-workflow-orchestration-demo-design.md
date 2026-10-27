# 工作流编排 Demo 设计文档

## 1. 项目概述

### 1.1 目标
构建一个基于 Vue Flow + Monaco Editor 的可视化工作流编排 Demo，支持：
- 算法节点以 HTTP API 形式注册并拖拽到画布
- 分支、循环、并行等控制流节点
- Python 代码节点（在 Docker 沙箱中执行）
- 流程可执行，可查看每个节点的实时运行状态、输入输出
- 工作流可发布为 API 接口，共享变量即为接口入参

### 1.2 范围
- 前端：Vue 3 + Vite + TypeScript + Vue Flow + Monaco Editor
- 后端：Node.js + Express + TypeScript
- 持久化：SQLite
- Python 执行：Docker 容器沙箱
- 部署：本地开发环境，需安装 Docker

## 2. 技术架构

```
┌─────────────────────────────────────────┐
│  前端 (Vue 3 + Vite + TS)               │
│  - 编排画布 (Vue Flow)                  │
│  - 属性面板 + Monaco 编辑器             │
│  - API 注册页面                         │
│  - 执行监控面板                         │
├─────────────────────────────────────────┤
│  后端 (Node + Express + TS)             │
│  - REST API                             │
│  - 流程执行引擎 (DAG + 控制流)          │
│  - Docker Python 沙箱调度               │
│  - HTTP API 代理                        │
├─────────────────────────────────────────┤
│  持久化 (SQLite)                        │
│  - registered_apis                      │
│  - workflows                            │
│  - executions                           │
└─────────────────────────────────────────┘
```

### 2.1 技术选型

| 模块 | 选型 | 理由 |
|---|---|---|
| 前端框架 | Vue 3 + Vite + TypeScript | 现代化、类型安全、热更新快 |
| UI 组件库 | Element Plus | 适合后台工具型界面，组件丰富 |
| 流程画布 | @vue-flow/core + background/controls | 成熟、可拖拽、可自定义节点 |
| 代码编辑 | Monaco Editor (monaco-editor-vue3) | 支持 Python 语法高亮、JSON 编辑 |
| 后端框架 | Express + TypeScript | 轻量、易扩展 |
| Python 沙箱 | Docker + 自定义 Python 镜像 | 资源/网络隔离 |
| 数据库 | SQLite (better-sqlite3) | 零配置、单文件、Demo 足够 |
| HTTP 调用 | axios（后端代理） | 统一处理 CORS、超时、错误 |

### 2.2 部署方式
- 前端：`npm run dev`（Vite 开发服务，代理到后端）
- 后端：`npm run dev:server`
- Docker：后端启动时检查 Docker 可用性，首次运行时构建 `workflow-python-sandbox` 镜像

## 3. 前端设计

### 3.1 页面路由

| 路由 | 用途 |
|---|---|
| `/apis` | API 注册管理页 |
| `/editor/:id?` | 流程编排页 |
| `/executions/:id` | 执行详情页（也可作为编辑器右侧抽屉） |

### 3.2 流程编排页布局

```
┌─────────────────────────────────────────────────────────────┐
│  顶部工具栏：保存 / 运行 / 清空 / 导入导出 / 返回API列表        │
├──────────┬────────────────────────────────────┬─────────────┤
│          │                                    │             │
│  节点库   │         Vue Flow 画布              │   属性面板   │
│ (可拖拽)  │    ┌─────┐    ┌─────┐             │  / 执行面板  │
│          │    │ Start│───▶│ API │───▶ ...     │             │
│ - 开始    │    └─────┘    └─────┘             │  Monaco     │
│ - 结束    │                                    │  编辑配置    │
│ - HTTP API│                                    │             │
│ - Python │                                    │             │
│ - 分支    │                                    │             │
│ - 循环    │                                    │             │
│ - 并行    │                                    │             │
│          │                                    │             │
└──────────┴────────────────────────────────────┴─────────────┘
```

### 3.3 节点库

左侧节点库分两类：
- **基础节点**：开始、结束、分支、循环、并行、Python 代码
- **已注册 API**：从 `/api/apis` 拉取，每个注册 API 对应一个可拖拽节点

### 3.4 节点样式

| 类型 | 颜色 | 图标 |
|---|---|---|
| start / end | 灰色 | 圆角矩形 |
| http | 蓝色 | 云朵/接口 |
| python | 黄色 | 代码符号 |
| branch | 紫色 | 菱形 |
| loop | 绿色 | 循环箭头 |
| parallel | 橙色 | 分叉符号 |

执行状态通过边框/动画表示：
- 运行中：蓝色闪烁
- 成功：绿色边框
- 失败：红色边框
- 未执行：灰色边框

### 3.5 属性面板

选中节点后右侧显示：
- 节点名称
- 节点类型专属配置
- Monaco 编辑器（Python 代码或 JSON）
- 输入/输出变量映射

### 3.6 API 注册页字段

- 名称
- 描述
- HTTP Method
- URL
- Headers（JSON）
- 请求参数示例
- 输出字段说明

## 4. 后端设计

### 4.1 目录结构

```
server/
├── src/
│   ├── index.ts              # Express 入口
│   ├── routes/
│   │   ├── apis.ts           # API 注册 CRUD
│   │   ├── workflows.ts      # 流程 CRUD + 发布
│   │   └── executions.ts     # 执行与结果查询
│   ├── services/
│   │   ├── executor.ts       # 流程执行引擎
│   │   ├── dockerRunner.ts   # Docker Python 沙箱
│   │   └── httpProxy.ts      # HTTP API 代理
│   ├── db/
│   │   ├── index.ts          # SQLite 连接
│   │   └── schema.sql        # 表结构
│   └── types/
│       └── index.ts          # 共享类型
```

### 4.2 REST API

| 接口 | 说明 |
|---|---|
| `GET /api/apis` | 列出已注册 API |
| `POST /api/apis` | 注册新 API |
| `PUT /api/apis/:id` | 更新 API |
| `DELETE /api/apis/:id` | 删除 API |
| `GET /api/workflows` | 列出流程 |
| `GET /api/workflows/:id` | 获取流程定义 |
| `POST /api/workflows` | 创建流程 |
| `PUT /api/workflows/:id` | 更新流程 |
| `POST /api/workflows/:id/execute` | 执行流程 |
| `GET /api/executions/:id` | 查询执行状态与结果 |
| `POST /api/executions/:id/stop` | 停止执行 |
| `GET /api/executions/:id/events` | SSE 实时执行事件 |
| `POST /api/run/:publish_path` | 调用已发布的工作流 API |

### 4.3 执行引擎

执行引擎把流程视为 **DAG + 控制流节点**：

1. 从 `start` 节点开始
2. 维护执行上下文 `ctx`，存放每个节点的输入输出
3. 普通节点（HTTP / Python）执行后将结果写入 `ctx`
4. 分支节点根据条件表达式决定走哪条出边
5. 循环节点根据迭代器重复执行子图
6. 并行节点同时启动多个分支，等所有分支完成后汇合

执行状态通过 SSE 实时推送给前端。

### 4.4 Docker Python 沙箱

每次执行 Python 节点时：
1. 后端把 `inputs` 序列化为 JSON
2. 把用户代码 + 输入数据写入临时文件
3. 启动 Docker 容器运行固定的 `runner.py`
4. `runner.py` 读取输入、执行用户代码、输出结果到 stdout
5. 后端解析 stdout，超时（默认 30s）后强制停止容器

Docker 启动参数：
```bash
docker run --rm \
  --network none \
  --read-only \
  --memory=128m \
  --cpus=0.5 \
  -v /tmp/task:/tmp/task:ro \
  workflow-python-sandbox \
  python /runner/runner.py
```

### 4.5 HTTP API 代理

HTTP 节点执行时：
1. 后端读取节点配置的 URL、Method、Headers、Body
2. 使用 axios 发起请求，支持模板变量（如 `{{ctx.prevNode.output}}`）
3. 返回 status、headers、body 给执行引擎

## 5. 数据模型

### 5.1 registered_apis

```sql
CREATE TABLE registered_apis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers TEXT,          -- JSON
  sample_params TEXT,    -- JSON
  output_schema TEXT,    -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 workflows

```sql
CREATE TABLE workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  variables TEXT,        -- JSON: 工作流级共享变量定义
  nodes TEXT NOT NULL,   -- JSON: Vue Flow nodes array
  edges TEXT NOT NULL,   -- JSON: Vue Flow edges array
  publish_path TEXT,     -- 发布为 API 的路径
  is_published BOOLEAN DEFAULT 0,
  auth_type TEXT DEFAULT 'none',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.3 executions

```sql
CREATE TABLE executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id INTEGER,
  status TEXT,           -- running / success / failed / stopped
  context TEXT,          -- JSON: 每节点输入输出
  logs TEXT,             -- JSON: 执行日志
  result TEXT,           -- JSON: 最终结果
  started_at DATETIME,
  ended_at DATETIME
);
```

### 5.4 节点类型配置

| 类型 | 作用 | 关键配置 |
|---|---|---|
| `start` | 流程入口 | 初始输入映射 |
| `end` | 流程出口 | 结果表达式 |
| `http` | 调用 HTTP API | registered_api_id 或 URL/Method/Headers/Body |
| `python` | 执行 Python 代码 | code, inputVars, outputVar, inputMapping, outputMapping |
| `branch` | 条件分支 | 条件表达式，决定走 `true` 或 `false` 分支 |
| `loop` | 循环执行 | 迭代表达式，循环体入口 |
| `parallel` | 并行分支 | 多个并行分支入口，全部完成后汇合 |

### 5.5 Python 节点配置示例

```json
{
  "id": "node_python_1",
  "type": "python",
  "position": { "x": 300, "y": 200 },
  "data": {
    "label": "处理数据",
    "code": "OUTPUT = sum(INPUT['items'])",
    "inputVars": ["INPUT"],
    "outputVar": "OUTPUT",
    "inputMapping": {
      "INPUT": "{{ctx.prevNode.output}}"
    },
    "outputMapping": {
      "result": "OUTPUT"
    }
  }
}
```

## 6. 工作流变量与 API 发布

### 6.1 工作流级共享变量

每个工作流定义一组全局变量，作为流程内部共享数据池，也是对外暴露为 API 时的入参。

示例：
```json
[
  { "name": "userId", "type": "string", "description": "用户ID" },
  { "name": "threshold", "type": "number", "default": 0.5 }
]
```

### 6.2 变量引用

- `{{var.userId}}`：引用工作流变量
- `{{ctx.nodeId.output}}`：引用上游节点输出
- `{{ctx.nodeId.output.field}}`：引用上游节点输出的具体字段

### 6.3 API 发布

每个工作流可发布为可调用的 HTTP 接口：

```bash
POST /api/run/workflow-1
Content-Type: application/json

{ "userId": "123", "threshold": 0.8 }
```

后端处理流程：
1. 校验入参与 `variables` 定义
2. 将变量注入初始上下文
3. 启动执行引擎
4. 同步或异步返回结果

## 7. 可观测性

### 7.1 实时状态

- 节点边框颜色实时变化：未执行（灰）、运行中（蓝闪）、成功（绿）、失败（红）
- 边在执行路径上高亮
- 右侧面板显示执行概览、节点时间线、选中节点输入输出

### 7.2 日志类型

- 节点开始/完成/失败日志
- 节点输入输出快照
- 控制流日志（分支结果、循环迭代、并行汇合）
- 错误日志
- 系统日志（Docker 启动/停止、超时）

### 7.3 实时推送

- 后端通过 SSE 推送 `GET /api/executions/:id/events`
- 前端订阅事件并更新 UI

## 8. 错误处理

| 错误类型 | 处理方式 |
|---|---|
| 节点执行失败 | 标记节点为 failed，流程终止，记录错误 |
| Docker 超时 | 强制停止容器，返回 timeout 错误 |
| HTTP 请求失败 | 记录 status、error，流程终止 |
| 表达式解析失败 | 记录表达式与可用变量，流程终止 |
| 分支条件非布尔 | 记录实际值，流程终止 |
| 循环迭代器非法 | 记录迭代器值，流程终止 |

## 9. 安全

- Docker 容器 `--network none`，禁止外联
- `--read-only` 只读文件系统
- `--memory` / `--cpus` 限制资源
- Python 代码只能访问注入的 `INPUT` 变量
- HTTP 节点只允许访问已注册 API 的 URL

## 10. 成功标准

- [ ] 可以注册 HTTP API 并在画布上拖拽为节点
- [ ] 可以连接 start / http / python / branch / loop / parallel / end 节点
- [ ] 可以执行流程并看到每个节点的实时状态
- [ ] 可以查看每个节点的输入输出和日志
- [ ] Python 代码在 Docker 沙箱中执行并返回结果
- [ ] 工作流可发布为 API 并通过外部调用触发
- [ ] 流程定义和执行历史持久化到 SQLite
