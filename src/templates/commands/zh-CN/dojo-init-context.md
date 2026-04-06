你是一个工作区初始化助手。你的任务是扫描当前工作区各仓库，更新**入口索引**并把**详细说明**落到 `docs/`，而不是把长文全部塞进 `AGENTS.md`。

## 必读上下文

在开始扫描前，请先阅读：

1. **`AGENTS.md`**（若存在）：当前入口长什么样，便于增量更新或收敛篇幅
2. **`.dojo/config.json`**（若存在）：工作区名称、描述与各仓库路径、类型、描述

**请勿**将 **`.dojo/context.md`** 作为本命令的前置必读材料：该文件由会话流程维护，易过期；本命令以配置与仓库实况为准。

## 背景

- **`AGENTS.md`**：给 AI 的**总览索引**——工作区叫什么、有哪些仓库（各一两句话）、常用 Dojo 命令列表、**指向 `docs/` 里详细文档的链接**、如何阅读 `.dojo/context.md`（见下方会话相关说明）。
- **`docs/`**：**探索仓库、模块说明、构建与测试命令、架构与设计类长文**的归宿。扫描结果的主体应写在这里（例如 `docs/workspace-overview.md`，或按仓库拆成 `docs/repos/<name>.md`）。

## 你需要做的事

### 1. 读取工作区配置

阅读 `.dojo/config.json`，获取工作区名称、描述与各仓库信息。

### 2. 扫描每个仓库

对 `repos/` 下每个仓库：README、顶层结构、技术栈、构建/测试命令（package.json、Makefile 等）、核心模块（只记关键路径，不必逐文件）。

### 3. 写入 `docs/`（详细）

将扫描得到的**详细**内容写入 `docs/`，至少包含：

- 各仓库的路径、类型、技术栈、核心目录说明
- 各仓库的安装 / 构建 / 测试 / 运行命令（可复制粘贴的代码块）
- 仓库之间的依赖或协作关系（若有）

可使用 `docs/workspace-overview.md` 单文件长文，或拆分多文件；在文中自洽即可。

### 4. 更新根目录 `AGENTS.md`（总览，保持短小）

`AGENTS.md` **只保留索引级内容**，建议结构如下（可适当增删，但不要恢复成长篇扫描报告）：

```markdown
# {工作区名称}

> {工作区描述，一两句}

## 仓库一览

| 仓库 | 类型 | 路径 | 说明 |
|------|------|------|------|
| … | … | … | 各一行 |

## 详细文档

- 工作区与仓库详情见：**[docs/workspace-overview.md](./docs/workspace-overview.md)**（若你使用了其他文件名，此处改为实际路径）

## 常用 Dojo 命令

- `dojo-think-and-clarify` — 澄清需求前先向用户提问
- `dojo-prd` — 梳理需求，输出 PRD 文档
- `dojo-research` — 项目调研，输出调研报告
- `dojo-tech-design` — 技术方案设计
- `dojo-task-decompose` — 任务拆解为原子任务
- `dojo-dev-loop` — 开发测试循环
- `dojo-review` — 代码 Review
- `dojo-commit` — 生成 commit 并提交
- `dojo-gen-doc` — 生成/更新文档
- `dojo-init-context` — 重新扫描仓库并更新本索引与 docs

## 当前状态

（根据工作区是否已有**活跃会话**二选一撰写，勿两段并存：有会话则引导阅读 `.dojo/context.md`；无会话则说明可先执行 `dojo session new`，勿捏造会话状态。）
```

<!-- DOJO_SESSION_ONLY -->
执行本命令时：在最终写入的 `AGENTS.md` 里，「当前状态」小节应引导阅读 `@.dojo/context.md`（与上方示例括号中的「有会话」分支一致）。
<!-- /DOJO_SESSION_ONLY -->

<!-- DOJO_NO_SESSION_ONLY -->
执行本命令时：在最终写入的 `AGENTS.md` 里，「当前状态」小节应明确当前无活跃会话，可提示用户执行 `dojo session new`（与上方示例括号中的「无会话」分支一致）。
<!-- /DOJO_NO_SESSION_ONLY -->

## 用户补充说明（可选）

$ARGUMENTS

## 约束

- **禁止**把本应在 `docs/` 的长篇扫描结果只写在 `AGENTS.md` 里；`AGENTS.md` 必须短、可扫读。
- 不修改任何业务代码（应用与业务测试代码等）。
- 若 `docs/` 下已有文档，可合并更新并在 `AGENTS.md` 的「详细文档」中列出链接。
