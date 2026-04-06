# Dojo CLI 技术方案

## 一、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      CLI Layer                          │
│  src/commands/                                          │
│  ┌──────┐ ┌──────┐ ┌─────────┐ ┌─────────┐ ┌───────┐  │
│  │ init │ │ repo │ │ session │ │ context │ │ start │  │
│  └──┬───┘ └──┬───┘ └────┬────┘ └────┬────┘ └───┬───┘  │
│     │        │          │           │           │      │
└─────┼────────┼──────────┼───────────┼───────────┼──────┘
      │        │          │           │           │
┌─────┼────────┼──────────┼───────────┼───────────┼──────┐
│     ▼        ▼          ▼           ▼           ▼      │
│                    Core Layer                          │
│  src/core/                                             │
│  ┌────────┐ ┌───────┐ ┌─────┐ ┌───────────┐           │
│  │ config │ │ state │ │ git │ │ workspace │           │
│  └────────┘ └───────┘ └─────┘ └───────────┘           │
│  ┌───────────────────┐ ┌──────────────────────┐        │
│  │ context-generator │ │ command-distributor  │        │
│  └───────────────────┘ └──────────────────────┘        │
│                                                        │
│                    Util Layer                           │
│  src/utils/                                            │
│  ┌────────┐ ┌────────┐                                 │
│  │   fs   │ │ logger │                                 │
│  └────────┘ └────────┘                                 │
└────────────────────────────────────────────────────────┘
```

## 二、源码目录结构

```
dojo/                            # 项目根目录
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── dojo.ts                  # CLI 入口（#!/usr/bin/env node）
├── src/
│   ├── commands/                # CLI 命令定义（薄层，调用 core）
│   │   ├── init.ts
│   │   ├── repo.ts
│   │   ├── session.ts
│   │   ├── context.ts
│   │   └── start.ts
│   ├── core/                    # 核心业务逻辑
│   │   ├── config.ts            # config.json 读写
│   │   ├── state.ts             # state.json 读写（工作区级 + session 级 + task 级）
│   │   ├── git.ts               # Git 操作封装
│   │   ├── workspace.ts         # 工作区校验和路径解析
│   │   ├── context-generator.ts # 生成 context.md + 更新 AGENTS.md
│   │   └── command-distributor.ts # 模板处理 + 软链接管理
│   ├── templates/               # 默认模板文件（编译时打包）
│   │   ├── commands/
│   │   │   ├── dojo-prd.md
│   │   │   ├── dojo-research.md
│   │   │   ├── dojo-tech-design.md
│   │   │   ├── dojo-task-decompose.md
│   │   │   ├── dojo-dev-loop.md
│   │   │   ├── dojo-review.md
│   │   │   ├── dojo-commit.md
│   │   │   └── dojo-gen-doc.md
│   │   ├── AGENTS.md
│   │   └── gitignore
│   ├── types.ts                 # 所有类型定义
│   └── utils/
│       ├── fs.ts                # 文件系统辅助
│       └── logger.ts            # 控制台输出格式化
├── tests/
│   ├── core/                    # 核心模块单元测试
│   │   ├── config.test.ts
│   │   ├── state.test.ts
│   │   ├── context-generator.test.ts
│   │   └── command-distributor.test.ts
│   ├── commands/                # CLI 命令集成测试
│   │   ├── init.test.ts
│   │   ├── repo.test.ts
│   │   ├── session.test.ts
│   │   └── context.test.ts
│   └── e2e/                     # 端到端测试
│       └── lifecycle.test.ts
└── docs/
    └── tech-design.md           # 本文档
```

## 三、类型定义

```typescript
// src/types.ts

export type RepoType = 'biz' | 'dev' | 'wiki';
export type SessionStatus = 'active' | 'suspended' | 'completed';
export type AgentTool = 'claude-code' | 'codex' | 'cursor' | 'trae';

export interface RepoConfig {
  name: string;
  type: RepoType;
  git: string;
  path: string;
  default_branch: string;
  description: string;
}

export interface WorkspaceConfig {
  workspace: {
    name: string;
    description: string;
  };
  agents: AgentTool[];
  repos: RepoConfig[];
}

export interface WorkspaceState {
  active_session: string | null;
}

export interface SessionState {
  id: string;
  description: string;
  external_link?: string;
  created_at: string;
  status: SessionStatus;
  repo_branches: Record<string, string>; // repo name → branch name
}

export interface TaskState {
  is_completed: boolean;
}
```

## 四、核心模块设计

### 4.1 config.ts — 配置管理

```typescript
// 职责：.dojo/config.json 的 CRUD
export function readConfig(workspaceRoot: string): WorkspaceConfig;
export function writeConfig(workspaceRoot: string, config: WorkspaceConfig): void;
export function addRepo(workspaceRoot: string, repo: RepoConfig): void;
export function removeRepo(workspaceRoot: string, repoName: string): void;
```

### 4.2 state.ts — 状态管理

```typescript
// 职责：各级 state.json 的读写
export function readWorkspaceState(workspaceRoot: string): WorkspaceState;
export function writeWorkspaceState(workspaceRoot: string, state: WorkspaceState): void;

export function readSessionState(workspaceRoot: string, sessionId: string): SessionState;
export function writeSessionState(workspaceRoot: string, sessionId: string, state: SessionState): void;

export function readTaskState(workspaceRoot: string, sessionId: string, taskName: string): TaskState;
export function writeTaskState(workspaceRoot: string, sessionId: string, taskName: string, state: TaskState): void;

export function listSessions(workspaceRoot: string): SessionState[];
export function getActiveSession(workspaceRoot: string): SessionState | null;
```

### 4.3 git.ts — Git 操作

```typescript
import simpleGit from 'simple-git';

// 职责：对 simple-git 的业务封装
export async function cloneRepo(gitUrl: string, targetPath: string): Promise<void>;
export async function createBranch(repoPath: string, branchName: string): Promise<void>;
export async function pushBranch(repoPath: string, branchName: string): Promise<void>;
export async function checkoutBranch(repoPath: string, branchName: string): Promise<void>;
export async function pullCurrent(repoPath: string): Promise<void>;
export async function isDirty(repoPath: string): Promise<boolean>;
export async function getCurrentBranch(repoPath: string): Promise<string>;
export async function initRepo(path: string): Promise<void>;
```

### 4.4 workspace.ts — 工作区校验

```typescript
// 职责：路径解析、工作区校验
export function findWorkspaceRoot(): string;  // 从 cwd 向上查找 .dojo/ 目录
export function isDojoWorkspace(dir: string): boolean;
export function getDojoDir(workspaceRoot: string): string;
export function getSessionDir(workspaceRoot: string, sessionId: string): string;
export function getTaskDir(workspaceRoot: string, sessionId: string, taskName: string): string;

// 检查工作区干净度：工作区仓库 + session 参与仓库
export async function checkWorkspaceClean(
  workspaceRoot: string,
  session: SessionState | null,
  config: WorkspaceConfig
): Promise<{ clean: boolean; dirtyRepos: string[] }>;
```

### 4.5 context-generator.ts — 上下文生成

```typescript
// 职责：扫描 session 产物 → 生成 context.md → 更新 AGENTS.md

export async function generateContext(
  workspaceRoot: string,
  session: SessionState,
  config: WorkspaceConfig
): Promise<void>;

// 内部步骤：
// 1. 扫描 product-requirements/ research/ tech-design/ 下的文件列表
// 2. 扫描 tasks/ 下各子目录的 state.json，统计完成情况
// 3. 渲染 context.md 模板，写入 .dojo/context.md
// 4. 读取 AGENTS.md，替换 DOJO:CONTEXT:START/END 之间的内容
```

### 4.6 command-distributor.ts — Command 分发

```typescript
// 职责：模板占位符替换 + 按文件的软链接

export function distributeCommands(
  workspaceRoot: string,
  sessionId: string | null,
  agents: AgentTool[],
): void;

// 内部步骤：
// 1. 读取 .dojo/commands/*.md
// 2. 替换 ${dojo_current_session_id}（无会话时：可选模板走空串 + 条件块；会话型模板加提示并替换为占位）
// 3. 处理 <!-- DOJO_SESSION_ONLY --> / <!-- DOJO_NO_SESSION_ONLY --> 条件块
// 4. 写入 .agents/commands/*.md
// 5. 对 claude-code / trae：在 .claude/commands、.trae/commands 下仅为 dojo-*.md 创建指向 .agents/commands 同名文件的软链（非整目录链接）；旧版整目录软链在首次分发时迁移

export function applyCommandSessionPlaceholders(content: string, sessionId: string | null): string;

// codex / cursor → 直接使用 .agents/commands，无额外软链
```

## 五、CLI 命令实现

### 5.1 dojo init

```
输入：交互式（inquirer）
  - workspace name
  - workspace description
  - 选择 AI 工具（多选）

流程：
  1. 创建 .dojo/ 及子目录（sessions/, commands/）
  2. 写入 config.json（workspace info + agents，repos 初始为空）
  3. 写入 state.json（active_session: null）
  4. 复制默认 command 模板到 .dojo/commands/
  5. 生成 AGENTS.md（从模板，替换 workspace name）
  6. 生成 .gitignore（repos/）
  7. 创建 docs/ 目录
  8. 创建 repos/ 目录
  9. git init + 首次 commit
  10. distributeCommands(root, null, agents) — 生成无会话版 .agents/commands 并同步文件级软链
```

### 5.2 dojo repo add <git-url>

```
输入：git-url（位置参数）+ 交互式
  - repo type（biz/dev/wiki）
  - description

流程：
  1. 校验是否在 dojo 工作区内
  2. 从 git url 解析 repo name
  3. 确定目标路径 repos/<type>/<name>/
  4. git clone
  5. 成功后更新 config.json 的 repos 列表
  6. 更新 .gitignore
```

### 5.3 dojo repo remove <name>

```
输入：repo name（位置参数）

流程：
  1. 从 config.json 查找 repo
  2. 交互确认是否删除本地目录
  3. 从 config.json 移除
  4. 可选删除本地目录
```

### 5.4 dojo repo sync [repo-name]

```
输入：repo name（可选）

流程：
  1. 不指定 name → 同步所有 repos
  2. 对每个 repo：打印当前分支 → git pull → 报告结果
  3. 如有冲突，打印 git 信息
```

### 5.5 dojo session new

```
输入：交互式
  - session ID（kebab-case）
  - description
  - external link（可选）
  - 选择参与仓库（从 config.repos 多选）
  - branch name pattern（默认 feature/<session-id>）

流程：见 PRD 5.3 详细流程（8 步）
```

### 5.6 dojo session resume <session-id>

```
输入：session-id（位置参数）

流程：见 PRD 5.3 详细流程（6 步）
```

### 5.7 dojo context reload

```
无输入

流程：
  1. 读取 active session
  2. 无 active session → distributeCommands(root, null)、清空 context.md（AGENTS.md 动态段若实现则一并处理）
  3. 有 active session → distributeCommands(root, sessionId) + context-generator
```

### 5.8 dojo start [tool]

```
输入：tool name（可选，默认取 config.agents[0]）

流程：
  1. 有 active session → distributeCommands(sessionId) + generateContext；无则 distributeCommands(null) 并清空 context.md
  2. 确定启动命令（claude-code → "claude", codex → "codex" 等）
  3. spawn 子进程启动 AI 工具
```

## 六、模块依赖关系

```
init ──→ config, git, workspace, command-distributor
repo ──→ config, git, workspace
session ──→ config, state, git, workspace, context-generator, command-distributor
context ──→ state, workspace, context-generator, command-distributor
start ──→ state, workspace, context-generator, command-distributor
```

## 七、测试方案

### 7.1 测试框架

使用 vitest：TypeScript 原生支持、速度快、API 与 Jest 兼容。

### 7.2 测试分层

| 层级 | 目标 | 方法 |
|------|------|------|
| 单元测试 | core/ 模块的纯逻辑 | 在 tmp 目录创建文件结构，验证读写正确性 |
| 集成测试 | CLI 命令的完整流程 | 在 tmp 目录模拟完整工作区，通过 execa 调用 CLI |
| E2E 测试 | 完整生命周期 | 一个测试走完 init → repo add → session new → context reload |

### 7.3 单元测试用例

#### config.test.ts
| 用例 | 验证点 |
|------|--------|
| readConfig 读取合法 config | 返回正确的 WorkspaceConfig 对象 |
| writeConfig 写入后再读取 | 内容一致 |
| addRepo 添加新仓库 | repos 列表增加一条，其他字段不变 |
| removeRepo 移除仓库 | repos 列表减少一条 |
| readConfig 文件不存在 | 抛出明确错误 |

#### state.test.ts
| 用例 | 验证点 |
|------|--------|
| readWorkspaceState | 正确解析 active_session |
| writeWorkspaceState | 写入后 active_session 正确 |
| readSessionState | 正确解析所有字段 |
| listSessions | 扫描 sessions/ 目录返回所有 session |
| getActiveSession | active_session 存在时返回对应 SessionState |
| getActiveSession | active_session 为 null 时返回 null |
| readTaskState / writeTaskState | is_completed 读写正确 |

#### context-generator.test.ts
| 用例 | 验证点 |
|------|--------|
| 空 session（无产物） | context.md 正确生成，任务列表为空 |
| 有 PRD + research 文件 | 文件索引列出正确路径 |
| 有 tasks 且部分完成 | 任务列表状态正确 |
| 更新 AGENTS.md 动态段 | START/END 之间内容被替换，其余不变 |
| AGENTS.md 无动态段标记 | 不修改文件（或追加） |

#### command-distributor.test.ts
| 用例 | 验证点 |
|------|--------|
| 替换占位符 | ${dojo_current_session_id} 被替换为实际 ID |
| $ARGUMENTS 不被替换 | 保持原样 |
| 生成到 .agents/commands/ | 文件存在且内容正确 |
| 软链接创建 | `.claude/commands/dojo-*.md` 等为指向 `.agents/commands` 同名文件的文件级 symlink；`.claude/commands` 本身为真实目录 |
| 更新时覆盖旧文件 | 重复执行不报错，内容为最新 |

### 7.4 集成测试用例

#### init.test.ts
| 用例 | 验证点 |
|------|--------|
| 正常初始化 | .dojo/ 目录结构完整，config.json 内容正确，AGENTS.md 存在，git repo 已初始化 |
| 重复初始化 | 报错提示已存在 |

#### repo.test.ts
| 用例 | 验证点 |
|------|--------|
| add 本地仓库 | 克隆成功，config.json 更新，.gitignore 包含路径 |
| remove 仓库 | config.json 更新，可选删除目录 |
| sync 所有仓库 | 各仓库执行 pull |

#### session.test.ts
| 用例 | 验证点 |
|------|--------|
| new 首个 session | state 正确，目录结构创建，commands 刷新，context 生成 |
| new 时挂起当前 session | 旧 session 变 suspended |
| resume 已有 session | 目标变 active，分支切换，commands/context 刷新 |
| resume 不存在的 session | 报错 |

### 7.5 E2E 生命周期测试

```
步骤：
  1. dojo init → 验证目录结构
  2. dojo repo add (用本地 bare repo 模拟) → 验证 clone 和 config
  3. dojo session new → 验证分支、目录、commands、context
  4. 手动写入 session 产物文件（模拟 AI agent 工作）
  5. dojo context reload → 验证 context.md 包含产物索引
  6. dojo session new (第二个) → 验证旧 session suspended
  7. dojo session resume (第一个) → 验证切换回来
```

### 7.6 测试辅助

- 每个测试用例在 `os.tmpdir()` 下创建隔离的临时目录
- 需要 git remote 的场景用 `git init --bare` 创建本地 bare repo 模拟
- 使用 `afterEach` 清理临时目录
