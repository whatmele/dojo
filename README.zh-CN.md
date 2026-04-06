<h1 align="center">
  <img src="docs/assets/dojo-banner.svg" width="520" alt="Dojo — Agent Workspace CLI" />
</h1>

<p align="center"><strong>Agent Workspace CLI</strong> — 管理多仓库工作区、开发会话生命周期与 AI Agent 上下文</p>

---

## 这是什么？

现有 AI coding 工具（Claude Code、Codex、Cursor、Trae）只能在单个目录下工作。但实际研发中，一个需求往往跨越多个 Git 仓库，且经历调研、设计、任务拆解、开发测试、Review 等多个阶段。

**Dojo 是一个 CLI 工具**，它不是 AI agent，而是为各种 AI coding 工具提供工作台：

- **多仓库管理** — 统一管理业务仓库、工具仓库、知识库仓库
- **开发会话** — 每个需求迭代都有独立的分支、产物目录和状态追踪
- **结构化上下文** — 动态生成上下文文档，让 AI 接手工作时能快速理解全局
- **命令模板** — 预定义的 prompt 模板（PRD、调研、设计、拆解、开发、Review、提交），覆盖完整开发生命周期

## 快速开始

```bash
# 安装
npm install -g dojo-cli

# 创建工作区（二选一）
mkdir my-workspace && cd my-workspace && dojo init   # 在当前目录初始化
# 或：dojo create [名称]                            # 在当前路径下新建子目录并初始化

# 添加仓库
dojo repo add git@github.com:org/backend-service.git
dojo repo add --local ./existing-repo

# 创建开发会话
dojo session new

# 启动 AI 工具
dojo start
```

## 工作流程

```
dojo init          初始化工作区
     ↓
dojo repo add      添加仓库
     ↓
dojo start         启动 AI 工具
     ↓
/dojo-init-context 让 AI 扫描仓库：详细说明写入 docs/，AGENTS.md 保持短索引
     ↓
dojo session new   创建开发会话（自动创建分支）
     ↓
┌─ /dojo-think-and-clarify  澄清需求前先提问
├─ /dojo-prd            梳理需求
├─ /dojo-research       项目调研
├─ /dojo-tech-design    技术方案
├─ /dojo-task-decompose 任务拆解
├─ /dojo-dev-loop       开发测试循环
├─ /dojo-review         代码 Review
├─ /dojo-commit         提交代码
└─ /dojo-gen-doc        生成文档
     ↓
dojo session resume 切换/恢复会话
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `dojo init` | 在当前目录初始化工作区（交互式） |
| `dojo create [name]` | 新建子目录并初始化（流程与 init 一致） |
| `dojo repo add <url>` | 克隆并注册仓库 |
| `dojo repo add --local <path>` | 注册本地已有仓库 |
| `dojo repo remove <name>` | 移除仓库 |
| `dojo repo sync [name]` | 同步仓库代码 |
| `dojo session new` | 新建开发会话 |
| `dojo session resume <id>` | 恢复已有会话 |
| `dojo context reload` | 刷新上下文和命令模板 |
| `dojo start [tool]` | 刷新上下文并启动 AI 工具 |

## AI 命令模板

在 AI 工具中触发，覆盖完整开发生命周期：

| 命令 | 阶段 | 可改代码 |
|------|------|---------|
| `/dojo-init-context` | 初始化索引与 docs | ❌ |
| `/dojo-think-and-clarify` | 澄清与提问 | ❌ |
| `/dojo-prd` | 需求 | ❌ |
| `/dojo-research` | 调研 | ❌ |
| `/dojo-tech-design` | 设计 | ❌ |
| `/dojo-task-decompose` | 拆解 | ❌ |
| `/dojo-dev-loop` | 开发 | ✅ |
| `/dojo-review` | 审查 | ❌ |
| `/dojo-commit` | 提交 | ❌ |
| `/dojo-gen-doc` | 文档 | ❌ |

## 工作区结构

```
my-workspace/
├── .dojo/
│   ├── config.json          # 工作区配置
│   ├── state.json           # 当前状态（gitignored）
│   ├── context.md           # 动态上下文（gitignored）
│   ├── commands/            # 命令模板源文件
│   └── sessions/            # 会话产物
│       └── <session-id>/
│           ├── state.json
│           ├── product-requirements/
│           ├── research/
│           ├── tech-design/
│           └── tasks/
│               ├── manifest.json
│               └── <task-name>/
├── .agents/commands/        # 生成的命令文件（源）
├── .claude/commands/        # dojo-*.md → 指向 .agents/commands 同名文件（文件级软链）
├── .trae/commands/          # 同上（若配置 Trae）
├── repos/                   # Git 仓库
├── docs/                    # 项目文档
└── AGENTS.md                # AI 工作区入口
```

## 支持的 AI 工具

- Claude Code
- Codex (OpenAI)
- Cursor
- Trae

Claude / Trae：对 `dojo-*.md` 使用**文件级**软链指向 `.agents/commands`；Codex / Cursor 直接使用 `.agents/commands`。无活跃会话时仍会生成「无会话版」commands（部分命令含占位提示）。

## 开发

```bash
git clone https://github.com/org/dojo.git
cd dojo
npm install
npm test
./scripts/dev-link.sh  # 编译并链接到全局
```

## License

MIT
