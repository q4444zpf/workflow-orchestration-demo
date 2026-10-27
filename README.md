# 工作流编排演示

一个基于 Vue Flow + Express + SQLite + Docker Python 沙箱的可视化工作流编排演示项目。

## 功能特性

- 可视化画布：使用 Vue Flow 拖拽编排工作流节点
- 节点类型：开始、结束、HTTP API、Python 代码、分支、循环、并行
- HTTP API 注册：统一管理外部接口，支持在节点中通过模板引用变量
- Python 执行：基于 Docker 容器实现安全的 Python 代码沙箱运行
- 执行观测：实时查看每个节点的输入、输出与日志
- 工作流发布：将工作流发布为公开 HTTP API，通过 curl 直接调用

## 技术栈

- 前端：Vue 3 + TypeScript + Vite + Element Plus + Vue Flow + Monaco Editor
- 后端：Node.js + Express + TypeScript + SQLite3
- 执行引擎：Docker + Python 3.11 沙箱

## 环境要求

- Node.js >= 18
- npm
- Docker Desktop（必须安装并运行，用于执行 Python 节点）

## 安装步骤

1. 克隆仓库后进入项目根目录：

```bash
cd workflow-orchestration-demo
```

2. 安装前端依赖：

```bash
npm install
```

3. 安装后端依赖：

```bash
cd server
npm install
cd ..
```

4. 确保 Docker Desktop 已启动。首次执行 Python 节点时，系统会自动构建 `workflow-python-sandbox` 镜像。

## 启动命令

同时启动前端和后端（需要两个终端）：

```bash
# 终端 1：启动前端开发服务器（端口 5173）
npm run dev

# 终端 2：启动后端开发服务器（端口 3000）
npm run dev:server
```

打开浏览器访问 http://localhost:5173 即可使用工作流编辑器。

## Docker 要求

- 必须安装 Docker Desktop 并保持运行状态
- Python 节点在 `workflow-python-sandbox` 容器中执行，镜像基于 `python:3.11-alpine`
- 容器默认限制：128 MB 内存、0.5 CPU、只读文件系统、无网络访问
- 首次执行 Python 节点时，后端会自动调用 `docker build` 构建镜像

## 使用说明

### 1. 注册外部 API（可选）

示例工作流 `examples/sample-workflow.json` 的 HTTP 节点使用硬编码地址 `https://httpbin.org/get?userId={{var.userId}}`，因此**直接导入示例时无需注册 API**。

注册 API 适用于需要在多个 HTTP 节点中复用同一接口、或希望通过 API 管理页面统一维护外部服务的场景。注册命令示例：

```bash
curl -X POST http://localhost:3000/api/apis \
  -H "Content-Type: application/json" \
  -d '{
    "name": "httpbin-get",
    "method": "GET",
    "url": "https://httpbin.org/get",
    "headers": {},
    "sample_params": {"userId": "alice"}
  }'
```

### 2. 创建工作流

进入 **工作流编辑器**，可以通过两种方式创建工作流：

- 在画布上拖拽节点并连线
- 直接导入 JSON：将 `examples/sample-workflow.json` 的内容通过 `POST /api/workflows` 导入

示例导入命令：

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d @examples/sample-workflow.json
```

示例工作流说明：

- 从 `userId` 变量开始
- 调用 `https://httpbin.org/get?userId={{var.userId}}`
- 使用 Python 节点解析响应并计算评分 `score = min(len(userId) * 20, 100)`
- 分支节点判断 `score >= 80`，分别走向两个结束节点

### 3. 执行工作流

在编辑器中点击 **执行**，或调用 API：

```bash
curl -X POST http://localhost:3000/api/workflows/1/execute \
  -H "Content-Type: application/json" \
  -d '{"variables": {"userId": "123"}}'
```

返回结果示例（`userId="123"` 长度为 3，评分 60，走 `false` 分支）：

```json
{
  "executionId": 1,
  "status": "success",
  "result": {
    "userId": "123",
    "score": 60
  },
  "context": { ... },
  "logs": [ ... ]
}
```

### 4. 发布工作流为 API

在编辑器中输入发布路径（如 `sample`）并点击 **发布**，或调用：

```bash
curl -X POST http://localhost:3000/api/workflows/1/publish \
  -H "Content-Type: application/json" \
  -d '{"publish_path": "sample"}'
```

### 5. 通过 curl 调用已发布的工作流

```bash
curl -X POST http://localhost:3000/api/run/sample \
  -H "Content-Type: application/json" \
  -d '{"userId": "123"}'
```

## 项目目录

```
.
├── examples/                 # 示例工作流
│   └── sample-workflow.json
├── server/                   # 后端服务
│   ├── src/
│   │   ├── app.ts
│   │   ├── routes/           # REST API 路由
│   │   ├── services/         # 执行器、HTTP 代理、Docker Runner
│   │   └── types/
│   ├── tests/                # 后端测试
│   └── Dockerfile.runner     # Python 沙箱镜像
├── src/                      # 前端源码
│   ├── api/                  # 前端 API 客户端
│   ├── components/           # 节点组件与编辑器面板
│   ├── types/
│   └── views/
├── package.json
└── README.md
```

## 测试与构建

后端测试与构建：

```bash
cd server
npm test
npm run build
```

前端构建：

```bash
npm run build
```

## 注意事项

- 示例工作流中的 HTTP 节点默认调用 `https://httpbin.org/get`，请确保网络可达，或在注册 API 后替换为本地或内网地址
- Python 代码中必须将要返回的结果赋值给 `OUTPUT` 变量
- 分支节点的两个出边标签必须分别为 `true` 和 `false`
