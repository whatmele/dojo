# Dojo - AI Coding Workspace Manager

> Agent Workspace CLI：管理多仓库工作区、开发会话生命周期与 AI Agent 上下文的命令行工具

## 一、项目定位

### 1.1 问题

现有 AI coding 工具（Claude Code、Codex、Cursor、Trae 等）只能在单个 workspace 目录下工作。实际研发场景中，一个需求经常跨越多个 Git 仓库（业务服务、工具链、知识库），且开发过程涉及需求梳理、调研、设计、任务拆解、开发测试、Review、提交等多个阶段。目前缺少一个工具来：

1. **统一管理多仓库工作区** —— 让 AI agent 知道有哪些仓库、它们之间的关系
2. **维护开发会话生命周期状态** —— 当前在做什么需求、进展到哪个阶段、有哪些任务
3. **为 AI agent 提供结构化上下文** —— 动态生成包含当前状态的上下文文档，让 agent 接手工作时能快速理解全局

### 1.2 定位

Dojo **不是** AI agent，**不做**流程编排。它是一个 CLI 工具，为各种 AI coding 工具提供 harness（工作台）：

- 管理多仓库的添加、移除、同步
- 管理 Session（开发会话）的生命周期和状态
- 生成适配不同 AI 工具的 command 文件：`.agents/commands` 为生成目标；Claude / Trae 侧对 `dojo-*.md` 使用**文件级**软链指向同名生成文件
- 动态生成上下文文档，让 AI agent 每次启动时获取最新状态

### 1.3 与现有工具的关系

```
┌──────────────────────────────────────────────────┐
│                AI Coding Tools                   │
│  Claude Code │ Codex │ Cursor │ Trae │ ...       │
│      ▲           ▲       ▲       ▲              │
│      │           │       │       │               │
│  .claude/    .agents/  .cursor/  .trae/          │
│  commands/   commands/  commands/ commands/       │
│ (dojo-*.md   (生成源)   (读源目录) (dojo-*.md     │
│  →文件链)                        →文件链)        │
└──────┬───────────┬───────┬───────┬───────────────┘
       │           │       │       │
       └───────────┴───┬───┴───────┘
                       │
              ┌────────▼────────┐
              │    dojo CLI     │
              │                 │
              │  - 多仓库管理    │
              │  - Session 状态  │
              │  - 上下文生成    │
              │  - Command 分发  │
              └─────────────────┘
```

## 二、核心概念

### 2.1 Workspace（工作区）

一个 Dojo 工作区是一个目录，包含多个 Git 仓库和 Dojo 管理文件。工作区本身也是一个 Git 仓库，用于版本管理工作区配置和会话产物（PRD、调研、技术方案、任务拆解等），不存储业务代码。业务仓库通过 `.gitignore` 排除。

工作区仓库**不按 Session 分支**——所有 Session 的产物按目录隔离（`.dojo/sessions/<session-id>/`），天然不冲突。工作区仓库始终保持完整历史。只有业务仓库才按 Session 创建 feature 分支。

### 2.2 Repo（仓库）

工作区内的 Git 仓库，统一放在 `repos/` 目录下，按类型分组：

| 类型 | 说明 | 示例 |
|------|------|------|
| `biz` | 业务仓库，会上线的代码 | 后端服务、前端项目 |
| `dev` | 开发工具仓库 | debug-server、日志 dump 工具 |
| `wiki` | 知识库仓库，只读参考 | 开源框架源码、设计规范 |

### 2.3 Session（开发会话）

Session 代表一次完整的开发迭代周期。一个 Session 关联：

- 会话元信息（ID、描述、关联链接）
- 参与的仓库及其对应 feature 分支
- 开发各阶段的产物文档（PRD、调研、技术方案、任务拆解）
- 当前状态

#### Session 状态机

```
状态枚举：active | suspended | completed

                   ┌──────────────────────────────┐
                   │                              │
                   ▼                              │
  session new → [active] ◄── session resume ── [suspended]
                   │                              ▲
                   │   创建新 session /            │
                   │   resume 其他 session         │
                   ├──────────────────────────────►┘
                   │
                   │  所有 task 完成后用户确认
                   ▼
              [completed]
```

- `dojo session new` → 新 session 状态为 `active`；当前 active session（如有）自动变为 `suspended`
- `dojo session resume <id>` → 目标 session 变为 `active`；当前 active session 变为 `suspended`
- 所有 task 完成后，`dojo session new` 时会提示用户是否将当前 session 标记为 `completed`

#### Session 核心特点

- **隔离性**：每个 Session 有独立的产物目录和 Git 分支
- **可恢复性**：通过 `dojo session resume` 可随时恢复到某个 Session 的工作现场
- **上下文连贯性**：Session 内各阶段产物逐步积累，后续阶段自动继承前序产物作为上下文

### 2.4 Command（命令模板）

Command 是预定义的 prompt 模板，存放在 `.dojo/commands/` 目录下（`.md` 文件）。在 `dojo init` / `dojo create` 结束、`dojo session new`、`dojo session resume`、`dojo context reload`、`dojo start`（含无活跃会话）时，会重新从源生成到 `.agents/commands/`。

有活跃 Session 时，`${dojo_current_session_id}` 替换为当前 Session ID；**无活跃 Session** 时，对 `dojo-gen-doc`、`dojo-init-context` 等模板使用条件块生成「无会话版」；其余会话强依赖型模板会带提示且占位为 `no-active-session`。模板内可用 `<!-- DOJO_SESSION_ONLY -->` / `<!-- DOJO_NO_SESSION_ONLY -->` 控制段落。`$ARGUMENTS` 仍由 AI 工具替换，Dojo 不处理。

用户在 AI agent 中手动触发 Command，指导 AI 执行特定的工作流。

## 三、工作区目录结构

```
my-workspace/                        # 工作区根目录（本身是一个 Git 仓库）
├── .dojo/                           # Dojo 管理目录
│   ├── config.json                  # 工作区配置（名称、AI 工具、仓库清单）
│   ├── context.md                   # 当前工作区动态上下文（自动生成）
│   ├── state.json                   # 工作区级状态（当前活跃 session 等）
│   ├── sessions/                    # 会话产物目录
│   │   └── <session-id>/
│   │       ├── state.json           # 会话状态
│   │       ├── product-requirements/# PRD 产物
│   │       ├── research/            # 调研产物
│   │       ├── tech-design/         # 技术方案产物
│   │       └── tasks/               # 任务定义和记录
│   │           ├── <task-name-A>/
│   │           │   ├── task-implementation.md  # 任务实现方案
│   │           │   ├── task-acceptance.md      # 任务验收标准
│   │           │   └── state.json             # { "is_completed": false }
│   │           └── <task-name-B>/
│   │               ├── task-implementation.md
│   │               ├── task-acceptance.md
│   │               └── state.json
│   └── commands/                    # Command 源文件（含占位符）
│       ├── dojo-prd.md
│       ├── dojo-research.md
│       ├── dojo-tech-design.md
│       ├── dojo-task-decompose.md
│       ├── dojo-dev-loop.md
│       ├── dojo-review.md
│       ├── dojo-commit.md
│       ├── dojo-gen-doc.md
│       ├── dojo-init-context.md
│       └── dojo-think-and-clarify.md
│
├── .agents/commands/                # ← 生成的目标目录（占位符已替换）
├── .claude/commands/                # ← 仅 dojo-*.md 为指向 .agents/commands 同名文件的软链
├── .trae/commands/                  # ← 同上（若启用 Trae）
│
├── docs/                            # 业务知识文档（仓库间依赖、通信协议等）
├── repos/                           # 所有仓库的父目录
│   ├── biz/                         # 业务仓库
│   │   ├── agent-skill-app/         # 独立 Git 仓库
│   │   └── agent-skill-plugin/      # 独立 Git 仓库
│   ├── dev/                         # 开发工具仓库
│   │   └── debug-server/            # 独立 Git 仓库
│   └── wiki/                        # 知识库仓库
│       └── some-framework/          # 独立 Git 仓库
│
├── AGENTS.md                        # 工作区说明（静态部分 + 动态索引）
└── .gitignore                       # 忽略 repos/ 下的 Git 仓库
```

## 四、核心文件格式

### 4.1 `.dojo/config.json`

```json
{
  "workspace": {
    "name": "my-project",
    "description": "XXX 项目工作区"
  },
  "agents": ["claude-code", "codex"],
  "repos": [
    {
      "name": "agent-skill-app",
      "type": "biz",
      "git": "git@github.com:org/agent-skill-app.git",
      "path": "repos/biz/agent-skill-app",
      "default_branch": "main",
      "description": "Agent 技能前端应用"
    },
    {
      "name": "debug-server",
      "type": "dev",
      "git": "git@github.com:org/debug-server.git",
      "path": "repos/dev/debug-server",
      "default_branch": "main",
      "description": "本地调试服务器"
    },
    {
      "name": "some-framework",
      "type": "wiki",
      "git": "git@github.com:open-source/framework.git",
      "path": "repos/wiki/some-framework",
      "default_branch": "main",
      "description": "参考框架源码"
    }
  ]
}
```

### 4.2 `.dojo/state.json`（工作区级状态）

```json
{
  "active_session": "user-auth-refactor"
}
```

`active_session` 为 `null` 时表示无活跃会话。

### 4.3 Session `state.json`

路径：`.dojo/sessions/<session-id>/state.json`

```json
{
  "id": "user-auth-refactor",
  "description": "用户认证模块重构，支持 OAuth2.0",
  "external_link": "https://meego.example.com/issue/12345",
  "created_at": "2026-04-04T10:00:00+08:00",
  "status": "active",
  "repo_branches": {
    "agent-skill-app": "feature/user-auth",
    "agent-skill-plugin": "feature/user-auth"
  }
}
```

`status` 取值：`active` | `suspended` | `completed`

### 4.4 Task `state.json`

路径：`.dojo/sessions/<session-id>/tasks/<task-name>/state.json`

```json
{
  "is_completed": false
}
```

简洁的布尔值设计。Task 的执行者是 AI agent（通过 `dojo-dev-loop`），更细粒度的状态（进行中、阻塞等）通过 `task-implementation.md` 和 AI 对话历史推断即可，不需要在状态模型中体现。

### 4.5 `.dojo/context.md`（自动生成）

```markdown
# 工作区上下文

目前这个工作区正在进行 **用户认证模块重构** 需求的开发

## 当前会话
- Session ID: user-auth-refactor
- 状态: active
- 关联链接: https://meego.example.com/issue/12345

## 文件索引

### PRD
- .dojo/sessions/user-auth-refactor/product-requirements/prd.md

### 调研
- .dojo/sessions/user-auth-refactor/research/oauth2-flow.md

### 技术方案
- .dojo/sessions/user-auth-refactor/tech-design/auth-module-design.md

### 任务列表
| 任务 | 状态 |
|------|------|
| auth-interface-refactor | ✅ 已完成 |
| oauth-gateway | ⬜ 未完成 |
| integration-test | ⬜ 未完成 |

## 参与仓库
| 仓库 | 类型 | 分支 |
|------|------|------|
| agent-skill-app | biz | feature/user-auth |
| agent-skill-plugin | biz | feature/user-auth |
```

### 4.6 `AGENTS.md`

```markdown
# My Project Workspace

## 工作区概述
[静态，人工维护] 项目背景和工作区用途简介。

## 仓库一览
[短表] 各仓库一行说明；**详细扫描与构建命令**见 `docs/`（如 `docs/workspace-overview.md`）。

## 详细文档
- [docs/workspace-overview.md](./docs/workspace-overview.md)（路径以实际生成为准）

## 常用 Dojo 命令
- `dojo-init-context` — 更新本索引与 docs
- `dojo-think-and-clarify` — 澄清前先提问
- `dojo-prd` — 梳理需求，输出 PRD 文档
- `dojo-research` — 项目调研，输出调研报告
- `dojo-tech-design` — 技术方案设计
- `dojo-task-decompose` — 任务拆解为原子任务
- `dojo-dev-loop` — 开发测试循环
- `dojo-review` — 代码 Review
- `dojo-commit` — 生成 commit 并提交
- `dojo-gen-doc` — 生成/更新文档

## 当前状态
<!-- DOJO:CONTEXT:START -->
（由 dojo context reload 自动更新，内容来自 .dojo/context.md）
<!-- DOJO:CONTEXT:END -->
```

`DOJO:CONTEXT:START` 和 `DOJO:CONTEXT:END` 之间的内容由 `dojo context reload` 动态替换。其余部分为静态内容，人工维护或 AI 辅助生成。

## 五、CLI 命令设计

### 5.1 工作区初始化

| 命令 | 说明 |
|------|------|
| `dojo init` | 在当前目录初始化工作区（交互式配置名称、描述、AI 工具等）；生成 `.dojo/`、`AGENTS.md`、`.gitignore`、`docs/` 等；首次 `distributeCommands(null)`；初始化 Git |
| `dojo create [name]` | 新建子目录并初始化（流程与 `init` 一致；名称无默认时可交互输入） |

### 5.2 仓库管理

| 命令 | 说明 |
|------|------|
| `dojo repo add <git-url>` | 添加仓库：交互式选择类型（biz/dev/wiki）、填写描述；克隆到 `repos/<type>/<name>/`；更新 `config.json` 的 repos 列表；更新 `.gitignore` |
| `dojo repo remove <name>` | 移除仓库：从 `config.json` 中删除记录；交互确认是否删除本地目录 |
| `dojo repo sync [repo-name]` | 同步仓库代码：对各仓库执行 `git pull`（拉取当前所在分支的远端最新）。不指定 repo 名则同步所有仓库。合并冲突由 git 报告，用户自行解决 |

### 5.3 会话管理

| 命令 | 说明 |
|------|------|
| `dojo session new` | 新建开发会话（详见下方流程） |
| `dojo session resume <session-id>` | 恢复已有会话（详见下方流程） |

#### `dojo session new` 详细流程

1. **检查工作区干净度**：检查工作区仓库 + 当前 active session 所有参与仓库是否有未提交变更。如有，打印警告列出脏仓库，询问是否继续（`--force` 跳过）
2. **处理当前 session**：如果存在 active session，将其状态设为 `suspended`；如果该 session 所有 task 均已完成，提示用户是否标记为 `completed`
3. **交互式填写信息**：Session ID、描述、关联链接（可选）、选择参与仓库、分支名
4. **创建分支**：为参与仓库依次创建并推送 feature 分支。**顺序执行，某个仓库失败则报告已成功和失败的仓库并停止**，用户修复后重新执行
5. **初始化目录**：创建 `.dojo/sessions/<session-id>/` 及子目录（product-requirements/、research/、tech-design/、tasks/）
6. **更新状态**：写入 session `state.json`（status: active）、更新工作区 `state.json`（active_session）
7. **刷新 commands**：从 `.dojo/commands/` 读取源文件，替换 `${dojo_current_session_id}` 为实际 session ID，输出到 `.agents/commands/`
8. **刷新 context**：生成 `.dojo/context.md`，更新 `AGENTS.md` 动态段

#### `dojo session resume <session-id>` 详细流程

1. **检查工作区干净度**：同 `session new`
2. **处理当前 session**：同 `session new`
3. **切换分支**：将目标 session 参与的所有仓库切换到对应的 feature 分支
4. **更新状态**：目标 session status 设为 `active`，更新工作区 `state.json`
5. **刷新 commands**：同 `session new`
6. **刷新 context**：同 `session new`

### 5.4 上下文管理

| 命令 | 说明 |
|------|------|
| `dojo context reload` | 有活跃会话：刷新 context、重新生成 `.agents/commands/`（含会话占位符）。无活跃会话：仍刷新无会话版 commands，并清空 `context.md` |

### 5.5 启动 AI 工具

| 命令 | 说明 |
|------|------|
| `dojo start [tool]` | ① 有 active session：刷新带会话的 commands 与 context；无则刷新无会话版 commands 并清空 context ② 启动指定的 AI coding 工具（默认取 `config.json` 中 agents 列表第一个） |

## 六、Command 定义

所有 Command 源文件存放在 `.dojo/commands/` 目录下，为 `.md` 格式。

### 6.1 dojo-prd

| 属性 | 内容 |
|------|------|
| **目的** | 按照用户要求梳理出一份明确的 PRD 文档 |
| **用户输入** | `$ARGUMENTS` — 需求描述 |
| **输入校验** | 目的是否明确：知道具体要做什么功能、功能的需求背景。不满足时向用户进一步确认 |
| **输出位置** | `.dojo/sessions/${dojo_current_session_id}/product-requirements/` |
| **约束** | 不修改业务代码 |

### 6.2 dojo-research

| 属性 | 内容 |
|------|------|
| **目的** | 按照用户要求进行项目调研 |
| **用户输入** | `$ARGUMENTS` — 调研主题 |
| **输入校验** | ① 调研目的明确 ② 所需资源明确（仓库地址、目录等）。不满足时向用户进一步确认 |
| **输出位置** | `.dojo/sessions/${dojo_current_session_id}/research/` |
| **约束** | 不修改业务代码 |

### 6.3 dojo-tech-design

| 属性 | 内容 |
|------|------|
| **目的** | 对某个功能进行详细的技术方案设计 |
| **用户输入** | `$ARGUMENTS` — 功能描述（可以是飞书文档链接、md 文件路径、纯语言描述） |
| **会话上下文**（自动读取，可能不存在） | PRD: `.dojo/sessions/${dojo_current_session_id}/product-requirements/` <br> 调研: `.dojo/sessions/${dojo_current_session_id}/research/` |
| **输入校验** | 通过用户输入 + 会话上下文，能明确要实现哪些功能。不满足时向用户进一步确认 |
| **输出位置** | `.dojo/sessions/${dojo_current_session_id}/tech-design/` |
| **输出要求** | 描述清楚：整体模块交互流程、数据协议、类 & 接口模块设计。使用 PlantUML 等语言绘制流程图和类图 |
| **约束** | 不修改业务代码 |

### 6.4 dojo-task-decompose

| 属性 | 内容 |
|------|------|
| **目的** | 将技术方案拆解为可执行、可量化的原子任务 |
| **用户输入** | `$ARGUMENTS` |
| **会话上下文**（自动读取，可能不存在） | PRD / 调研 / 技术方案 |
| **输入校验** | ① 功能和技术方案流程明确 ② 上下文足以拆分出符合要求的原子任务。不满足时向用户确认或调研代码后明确 |
| **输出位置** | `.dojo/sessions/${dojo_current_session_id}/tasks/` |
| **输出格式** | 每个子任务一个目录（如 `user-auth/`、`intent-refactor/`），包含三个文件：<br> - `task-implementation.md`：实现方案，详细到每一步，说明前置任务依赖 <br> - `task-acceptance.md`：验收标准，描述如何检验任务确实完成 <br> - `state.json`：`{ "is_completed": false }` |
| **约束** | 不修改业务代码。拆解结果可能不符合用户期望，用户可多次调整 |

### 6.5 dojo-dev-loop

| 属性 | 内容 |
|------|------|
| **目的** | 对某个开发任务执行「编写测试 → 开发功能 → 执行测试 → 修复」循环，直到通过验收 |
| **用户输入** | `$ARGUMENTS` — 可以是任务描述、对应 task 目录名、文档链接等 |
| **会话上下文**（自动读取，可能不存在） | PRD / 调研 / 技术方案 / 任务列表 |
| **输入校验** | 能获取到明确的任务实现方案和测试验收方案。**测试方案必须明确后才能开始开发**。不满足时向用户确认 |
| **执行流程** | ① 按验收标准编写测试代码、构建测试环境 ② 开发功能代码 ③ 执行测试 ④ 不通过则调整代码重试 ⑤ 通过则标记完成 ⑥ 如用户提供了 task 目录路径，更新对应 `state.json` 为 `{ "is_completed": true }` |
| **约束** | **可以修改业务代码**。反复尝试多次无果后应停止并报告问题，寻求用户帮助。发现需求或方案不合理时可随时停止告知用户 |

### 6.6 dojo-review

| 属性 | 内容 |
|------|------|
| **目的** | 对代码改动进行 review，包括暂存区改动和分支 diff |
| **用户输入** | `$ARGUMENTS` — 可指定 review 范围（某个仓库、某次提交等） |
| **会话上下文**（自动读取，可能不存在） | PRD / 调研 / 技术方案 / 任务列表 |
| **输出** | 代码 review 意见 |
| **约束** | 不修改业务代码 |

### 6.7 dojo-commit

| 属性 | 内容 |
|------|------|
| **目的** | 对代码改动进行提交，生成详尽的 commit message |
| **用户输入** | `$ARGUMENTS` — 可指定提交范围、可复用 review 结果 |
| **会话上下文**（自动读取，可能不存在） | PRD / 调研 / 技术方案 / 任务列表 |
| **输出** | 执行 git add + git commit（AI agent 根据上下文自行判断 commit 哪些仓库的改动，用户可通过 `$ARGUMENTS` 明确指定） |
| **约束** | 仅执行 git 操作，不修改业务代码逻辑 |

### 6.8 dojo-gen-doc

| 属性 | 内容 |
|------|------|
| **目的** | 根据当前会话上下文生成或更新项目文档 |
| **用户输入** | `$ARGUMENTS` — 要生成什么文档 |
| **会话上下文**（自动读取，可能不存在） | 有会话时可利用 `.dojo/sessions/<id>/`；无会话时依模板「无会话」分支仅依赖 AGENTS 与仓库实况 |
| **输出位置** | `./docs/` 目录 |
| **约束** | 不修改业务代码 |

### 6.9 dojo-init-context

| 属性 | 内容 |
|------|------|
| **目的** | 扫描各仓库，更新短 **`AGENTS.md` 索引**，将详细说明写入 **`docs/`**（如 `docs/workspace-overview.md`） |
| **用户输入** | `$ARGUMENTS` — 可选补充要求 |
| **约束** | 不修改业务代码；勿把长篇扫描结果只堆在 `AGENTS.md` |

### 6.10 dojo-think-and-clarify

| 属性 | 内容 |
|------|------|
| **目的** | 在动手前归纳理解并提出若干澄清问题 |
| **用户输入** | `$ARGUMENTS` |
| **约束** | 以提问与理解为主，不代替用户做实现决策 |

## 七、Command 分发机制

```
.dojo/commands/*.md        ← 源文件（含 ${dojo_current_session_id} 占位符）
       │
       │  init/create 结束、session new/resume、context reload、start 时
       │  读取源文件 → 替换占位符与条件块 → 输出到 ↓
       ▼
.agents/commands/*.md      ← 生成的目标文件
       │
       ├── 各 dojo-*.md 的文件级 symlink → .claude/commands/dojo-*.md
       └── 各 dojo-*.md 的文件级 symlink → .trae/commands/dojo-*.md（若配置）
```

### 分发策略

- `.agents/commands/` 是生成目标，存放占位符已替换的 `.md` 文件
- 仅为 `config.json` 中声明的 Claude / Trae 创建 **dojo-*.md 文件级**软链；目录本身为真实目录，便于与非 Dojo 的 command 文件共存
- MVP 先支持 Claude Code + Codex（两者的 commands 目录均接受 `.md` 文件、均用 `$ARGUMENTS` 接收用户输入）
- 不兼容的工具在后续版本中通过转换层适配

### 占位符说明

| 占位符 | 替换者 | 替换时机 |
|--------|--------|----------|
| `${dojo_current_session_id}` | Dojo CLI | 上述分发触发时机；无会话时按模板策略替换或剥离会话段落 |
| `$ARGUMENTS` | AI 工具 | 用户在 AI agent 中触发 command 时 |

## 八、动态上下文生成（dojo context reload）

### 输入

1. `.dojo/state.json` → 当前活跃 session ID
2. `.dojo/sessions/<active_session>/state.json` → 会话状态、参与仓库和分支
3. `.dojo/sessions/<active_session>/` 下的产物目录 → 扫描 product-requirements/、research/、tech-design/ 中的文件列表
4. `.dojo/sessions/<active_session>/tasks/` → 扫描各 task 子目录及其 `state.json`，统计完成状态
5. `.dojo/config.json` → 仓库信息

### 输出

1. **`.dojo/context.md`**：当前工作区的完整上下文摘要
   - 当前 Session 描述和状态
   - 产物文件索引（列出 PRD、调研、技术方案文档的相对路径）
   - 任务列表及完成状态
   - 参与仓库及当前分支

2. **`AGENTS.md` 动态段更新**：替换 `DOJO:CONTEXT:START` 和 `DOJO:CONTEXT:END` 之间的内容为 `context.md` 的精简版本

3. **`.agents/commands/` 刷新**：从 `.dojo/commands/` 重新生成（替换占位符）

### 触发时机

| 时机 | 触发方式 |
|------|----------|
| `dojo session new` | 自动执行（步骤 7-8） |
| `dojo session resume` | 自动执行（步骤 5-6） |
| `dojo start` | 自动刷新 commands（及 context，若有会话） |
| `dojo init` / `dojo create` | 生成无会话版 commands |
| `dojo context reload` | 手动执行 |

## 九、错误处理策略

MVP 采用**顺序执行 + 失败即停 + 报告进度**策略，不做自动回滚。

| 场景 | 处理方式 |
|------|---------|
| `session new` 创建分支：repo A 成功、repo B 失败 | 报告已成功和失败的仓库，停止后续操作。用户修复后重新执行 |
| `repo add` 克隆失败 | 不写入 `config.json`，报告错误 |
| `repo sync` 合并冲突 | 打印 git 冲突信息，用户自行解决 |
| `session new/resume` 工作区有未提交变更 | 打印警告并列出脏仓库，询问用户是否继续。`--force` 跳过询问 |
| `dojo start` 无 active session | 同步无会话版 commands、清空 context.md，仍启动 AI 工具 |

## 十、设计约束

1. **不做流程编排**：Commands 是用户手动触发的 prompt 模板，不存在自动流转
2. **不侵入子仓库**：子仓库通过 `.gitignore` 排除，工作区仓库只存管理文件和会话产物
3. **Agent 无关**：不绑定任何特定 AI 工具，通过统一 command 格式 + 软链接支持多工具
4. **状态最小化**：状态全部存文件（JSON + Markdown），不引入数据库
5. **产物即上下文**：command 执行产生的文档存入 session 目录，`context reload` 时自动索引为上下文的一部分
6. **Session 隔离**：切换 Session 时检查工作区是否干净，防止丢失未提交工作
7. **工作区仓库不分支**：Session 产物按目录隔离，工作区 Git 仓库始终在主分支

## 十一、MVP 范围

### P0（第一版）

| 功能 | 说明 |
|------|------|
| `dojo init` | 初始化工作区，生成完整目录结构和模板文件 |
| `dojo repo add` | 添加仓库（交互式） |
| `dojo repo remove` | 移除仓库 |
| `dojo repo sync` | 同步仓库代码 |
| `dojo session new` | 新建会话，创建分支，刷新 commands 和 context |
| `dojo session resume` | 恢复会话，切换分支，刷新 commands 和 context |
| `dojo context reload` | 刷新上下文和 commands |
| `dojo start` | context reload + 启动 AI 工具 |
| 默认 commands | 内置 init-context、think-and-clarify、prd、research、tech-design、task-decompose、dev-loop、review、commit、gen-doc 等模板 |

### P1（第二版）

| 功能 | 说明 |
|------|------|
| `dojo session list` | 列出所有 Session 及其状态 |
| `dojo session status` | 查看当前 Session 详细状态（任务进度、仓库分支状态） |
| `dojo session complete` | 手动将 session 标记为 completed |
| `dojo status` | 查看所有仓库的分支和工作区状态 |
| 更多工具适配 | Cursor、Trae 等工具的 command 格式转换层 |

### P2（后续迭代）

| 功能 | 说明 |
|------|------|
| `dojo publish` | 为 active session 参与的所有仓库创建 MR/PR |
| 批量分支操作 | `dojo checkout`、`dojo push` |
| Hook 集成 | AI 工具 SessionStart 时自动 context reload |
| Team 共享 | workspace 仓库的团队协作模式 |
| Plugin 打包 | 将 commands 打包为可分发的 plugin |

## 十二、技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (Node.js) | 目标用户大概率有 Node 环境，npm 生态丰富 |
| CLI 框架 | Commander.js | 轻量，适合 MVP 快速开发 |
| 交互式输入 | @inquirer/prompts | session new、repo add 等交互场景 |
| 模板引擎 | 字符串替换（`String.replace`） | 只需替换 `${dojo_current_session_id}`，无需模板引擎 |
| Git 操作 | simple-git | Node.js 成熟的 Git 操作封装 |
| 发布 | npm | `npm install -g dojo-cli` 或 `npx dojo-cli init` |

## 十三、用户完整生命周期

```
┌──────────┐
│   开始   │
└────┬─────┘
     │
     ▼
┌─────────────────┐
│   dojo init     │  交互式配置：
│                 │  - 工作区名称/描述
│                 │  - 选择 AI 工具
│                 │  输出：
│                 │  - .dojo/ 目录结构
│                 │  - AGENTS.md 模板
│                 │  - 默认 commands
│                 │  - .gitignore
│                 │  - 初始化 git repo
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  dojo repo add  │  可多次执行
│                 │  交互式选择类型
│                 │  克隆到 repos/<type>/<name>/
│                 │  更新 config.json
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  人工编辑       │  维护 AGENTS.md 静态部分
│  AGENTS.md      │  编写 docs/ 业务文档
│  docs/          │
└────────┬────────┘
         │
         ▼
╔═══════════════════════════════════════════════════════════════════════════╗
║                        开 发 会 话 循 环                                 ║
║                                                                         ║
║  ┌──────────────────┐        ┌────────────────────┐                     ║
║  │ dojo session new │        │dojo session resume  │                     ║
║  │                  │   或   │ <session-id>        │                     ║
║  │ ① 检查工作区干净  │        │ ① 检查工作区干净     │                     ║
║  │ ② 挂起当前session│        │ ② 挂起当前session    │                     ║
║  │ ③ 填写会话信息    │        │ ③ 切换仓库分支       │                     ║
║  │ ④ 创建/推送分支   │        │ ④ 更新状态          │                     ║
║  │ ⑤ 初始化目录     │        │ ⑤ 刷新 commands     │                     ║
║  │ ⑥ 更新状态       │        │ ⑥ 刷新 context      │                     ║
║  │ ⑦ 刷新 commands  │        │                     │                     ║
║  │ ⑧ 刷新 context   │        │                     │                     ║
║  └────────┬─────────┘        └──────────┬──────────┘                     ║
║           └──────────┬──────────────────┘                                ║
║                      ▼                                                   ║
║            ┌─────────────────┐                                           ║
║            │   dojo start    │                                           ║
║            │ ① 检查 session  │                                           ║
║            │ ② context reload│                                           ║
║            │ ③ 启动 AI 工具  │                                           ║
║            └────────┬────────┘                                           ║
║                     ▼                                                    ║
║  ┌───────────────────────────────────────────────────────────────────┐   ║
║  │           AI Agent 工作流（用户手动触发 Commands）                  │   ║
║  │                                                                   │   ║
║  │  ┌────────────┐                                                   │   ║
║  │  │  dojo-prd  │  梳理需求                                         │   ║
║  │  │            │  → product-requirements/                          │   ║
║  │  └─────┬──────┘                                                   │   ║
║  │        ▼                                                          │   ║
║  │  ┌────────────────┐                                               │   ║
║  │  │ dojo-research  │  项目调研                                      │   ║
║  │  │                │  → research/                                  │   ║
║  │  └─────┬──────────┘                                               │   ║
║  │        ▼                                                          │   ║
║  │  ┌──────────────────┐                                             │   ║
║  │  │dojo-tech-design  │  技术方案（读取 PRD + 调研上下文）            │   ║
║  │  │                  │  含 PlantUML 流程图/类图                     │   ║
║  │  │                  │  → tech-design/                             │   ║
║  │  └─────┬────────────┘                                             │   ║
║  │        ▼                                                          │   ║
║  │  ┌──────────────────────┐                                         │   ║
║  │  │dojo-task-decompose   │  任务拆解（读取全部上下文）               │   ║
║  │  │                      │  → tasks/<task-name>/                   │   ║
║  │  │                      │    ├── task-implementation.md            │   ║
║  │  │                      │    ├── task-acceptance.md                │   ║
║  │  │                      │    └── state.json                       │   ║
║  │  └─────┬────────────────┘                                         │   ║
║  │        ▼                                                          │   ║
║  │  ┌────────────────────────────────────────────────┐               │   ║
║  │  │              dojo-dev-loop                     │               │   ║
║  │  │                                                │               │   ║
║  │  │  对每个 task 执行:                              │               │   ║
║  │  │  ┌────────────────┐                            │               │   ║
║  │  │  │ 编写测试代码    │                            │               │   ║
║  │  │  └───────┬────────┘                            │               │   ║
║  │  │          ▼                                     │               │   ║
║  │  │  ┌────────────────┐                            │               │   ║
║  │  │  │ 开发功能代码    │                            │               │   ║
║  │  │  └───────┬────────┘                            │               │   ║
║  │  │          ▼                                     │               │   ║
║  │  │  ┌────────────────┐  不通过    ┌────────────┐  │               │   ║
║  │  │  │ 执行测试       │──────────►│ 调整代码    │  │               │   ║
║  │  │  └───────┬────────┘           └─────┬──────┘  │               │   ║
║  │  │          │ 通过                     │ 重试    │               │   ║
║  │  │          │            ◄─────────────┘         │               │   ║
║  │  │          │    多次失败 → 停止, 报告问题求助     │               │   ║
║  │  │          ▼                                     │               │   ║
║  │  │  ┌─────────────────────┐                       │               │   ║
║  │  │  │ 更新 state.json     │                       │               │   ║
║  │  │  │ is_completed = true │                       │               │   ║
║  │  │  └─────────────────────┘                       │               │   ║
║  │  └────────────────────────────────────────────────┘               │   ║
║  │        │                                                          │   ║
║  │        ▼                                                          │   ║
║  │  ┌───────────────┐                                                │   ║
║  │  │  dojo-review  │  代码 Review（不改代码）                        │   ║
║  │  └─────┬─────────┘                                                │   ║
║  │        ▼                                                          │   ║
║  │  ┌───────────────┐                                                │   ║
║  │  │  dojo-commit  │  生成 commit message, 提交代码                  │   ║
║  │  └─────┬─────────┘                                                │   ║
║  │        ▼                                                          │   ║
║  │  ┌────────────────┐                                               │   ║
║  │  │  dojo-gen-doc  │  生成/更新文档到 docs/（可选）                  │   ║
║  │  └────────────────┘                                               │   ║
║  │                                                                   │   ║
║  │  注: 以上 command 不要求严格顺序执行，用户可按需跳过或重复           │   ║
║  └───────────────────────────────────────────────────────────────────┘   ║
║                     │                                                    ║
║                     ▼                                                    ║
║           ┌───────────────────────┐                                      ║
║           │  dojo context reload  │  随时可手动刷新                       ║
║           └───────────┬───────────┘                                      ║
║                       ▼                                                  ║
║             ┌───────────────────┐                                        ║
║             │ 继续开发？         │                                        ║
║             └──┬──────────┬─────┘                                        ║
║           是   │          │  否                                           ║
║                ▼          ▼                                               ║
║     回到 session          结束（session 标记 completed                    ║
║     new / resume          或保持 suspended）                              ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### 流程闭环说明

1. **初始化链路**：`init` → `repo add` → 人工编辑 AGENTS.md/docs → 工作区就绪
2. **会话链路**：`session new` → commands/context 自动就绪 → `start` 启动 AI 工具
3. **开发链路**：prd → research → tech-design → task-decompose → dev-loop → review → commit → gen-doc，每个阶段的产物自动成为后续阶段的上下文输入
4. **状态同步**：`context reload` 在 session new / resume / start 时自动触发，也可手动触发，确保 AI agent 任何时刻获取的上下文都是最新的
5. **会话切换**：suspend 当前 → resume 目标 → 分支自动切换 + context 自动刷新，无缝恢复工作现场
6. **终态收敛**：所有 task 完成 → 下次 session new 时提示标记 completed → session 归档
