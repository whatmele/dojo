# Dojo — AI Coding Workspace Manager

## 项目概述

Dojo 是一个 CLI 工具，为 AI coding 工具（Claude Code、Codex、Cursor、Trae 等）提供多仓库工作区管理、开发会话生命周期管理和结构化上下文生成能力。

**核心定位**：Dojo 不是 AI agent，不做流程编排。它是工作台（harness），让 AI agent 在多仓库、多阶段的研发场景中有章可循。

## 技术栈

- TypeScript + Node.js（`package.json` 要求 >=18，建议 20+）
- CLI 框架：Commander.js
- 交互式输入：@inquirer/prompts
- Git 操作：simple-git
- 测试：vitest

## 目录结构

```
bin/dojo.ts              # CLI 入口
src/
├── commands/            # CLI 命令处理器（薄层）
│   ├── init.ts          # dojo init / dojo create
│   ├── repo.ts          # dojo repo add/remove/sync
│   ├── session.ts       # dojo session new/resume
│   ├── context.ts       # dojo context reload
│   └── start.ts         # dojo start
├── core/                # 核心业务逻辑
│   ├── config.ts        # config.json 读写
│   ├── state.ts         # 各级 state.json + manifest.json 读写
│   ├── git.ts           # Git 操作封装
│   ├── workspace.ts     # 工作区校验和路径解析
│   ├── context-generator.ts  # 生成 context.md
│   └── command-distributor.ts # 模板占位符、条件块、dojo-*.md 文件级软链
├── templates/           # 默认模板（编译时拷贝到 dist）
│   ├── commands/        # 英文 dojo-*.md；中文归档见 commands/zh-CN/
│   ├── zh-CN/AGENTS.md  # 中文 AGENTS 模板归档
│   ├── AGENTS.md        # 默认工作区 AGENTS.md 模板（英文）
│   └── gitignore        # .gitignore 模板
├── types.ts             # 所有类型定义
└── utils/
    ├── fs.ts            # 文件系统辅助
    └── logger.ts        # 控制台输出 + banner
tests/
├── core/                # 单元测试
└── e2e/                 # 端到端生命周期测试
```

## 构建与测试

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 开发模式（编译+链接到全局）
./scripts/dev-link.sh

# 类型检查
npx tsc --noEmit
```

## 文档

- 中文归档：`docs/zh/product-requirement.md`、`docs/zh/tech-design.md`
- 英文主文档（为准）：`docs/product-requirement.md`、`docs/tech-design.md`

## 当前状态

若本仓库也是 Dojo 工作区，可阅读 `@.dojo/context.md`（若存在）。
