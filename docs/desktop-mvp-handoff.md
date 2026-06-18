# Dojo Desktop MVP Handoff

This document captures the current product requirement, implementation state, test plan, and open design direction for the Dojo Desktop MVP. It is intended for a follow-up Codex session to continue the work without relying on chat history.

## Goal

Dojo is currently a CLI workspace runtime for AI coding. The MVP explored here adds a desktop shell around Dojo so a user can manage multiple Codex CLI terminal conversations in one workspace, similar to a VS Code integrated terminal plus a conversation tree.

The immediate goal is not to replace Codex CLI behavior. The desktop app should preserve Codex's native terminal/TUI capability as much as possible by running Codex through a real PTY, with the same cwd and login-shell environment the user would get from a normal terminal.

## Current Scope

Implemented MVP scope:

- Electron desktop app using React, Vite, Tailwind CSS, xterm.js, node-pty, lucide-react, and React Flow.
- Folder selection and minimal Dojo workspace initialization.
- Dojo session creation and activation.
- Real PTY terminals backed by `node-pty`.
- Workspace shell terminals for maintenance commands.
- Codex conversation instances grouped under the active Dojo session.
- Codex instance tree rendering through React Flow.
- Transcript persistence under `.dojo/desktop/`.
- PTY lifecycle events and visible exit/error footers.
- Codex CLI preflight checks before starting a Codex conversation.
- Basic input pipeline scaffold for future composer and slash commands.

Intentionally deferred scope:

- Claude Code and Gemini support.
- ACP/xiterm protocol integration.
- Full Codex hook integration beyond event logging scaffolding.
- Direct context injection into an already-running Codex CLI process.
- Work Item runtime commands.
- Desktop packaging/signing.

## Current Files

Desktop app:

- `desktop/electron/main.cjs`
- `desktop/electron/runtime.cjs`
- `desktop/electron/preload.cjs`
- `desktop/electron/codex-hook.cjs`
- `desktop/renderer/index.html`
- `desktop/renderer/src/App.tsx`
- `desktop/renderer/src/components/TerminalView.tsx`
- `desktop/renderer/src/components/InstanceCanvas.tsx`
- `desktop/renderer/src/lib/inputPipeline.ts`
- `desktop/renderer/src/styles.css`
- `desktop/vite.config.ts`

Tests:

- `tests/desktop/runtime.test.ts`

Package updates:

- `package.json`
- `package-lock.json`
- `tailwind.config.cjs`
- `.gitignore`

## Data Model

The desktop runtime stores instance state inside the selected Dojo workspace:

```text
.dojo/
├── config.json
├── state.json
├── sessions/
│   └── <dojo_session_id>/
│       └── state.json
└── desktop/
    └── sessions/
        └── <dojo_session_id>/
            ├── instances.json
            ├── events.jsonl
            └── instances/
                └── <instance_id>/
                    └── transcript.log
```

Terminal instance fields currently include:

- `id`
- `title`
- `kind`: `shell` or `codex`
- `dojo_session_id`
- `parent_instance_id`
- `cwd`
- `command`
- `pid`
- `status`
- `exit_code`
- `exit_signal`
- `ended_at`
- `exit_reason`
- `last_error`
- `codex_session_id`
- `codex_session_source`
- `created_at`
- `updated_at`
- `transcript_path`

`shell` instances are shown as workspace tools. `codex` instances are shown under the active Dojo session and on the session canvas.

## Terminal Architecture

The desktop app does not simulate terminal output with stdout pipes. It starts real PTYs through `node-pty`.

Renderer:

- `TerminalView.tsx` owns the xterm.js terminal instance.
- It loads prior transcript content when a terminal is selected.
- It writes keyboard input directly to the PTY through IPC.
- It resizes the PTY using xterm's fit addon.
- It avoids re-creating xterm on every state update, which previously caused flicker.

Main process:

- `main.cjs` owns the active PTY map.
- PTY data is appended to transcript files and forwarded to the renderer.
- PTY exit updates instance state and appends a visible footer to the transcript.
- PTY spawn errors are recorded as instance errors and rendered as transcript footer text.

Runtime helpers:

- `runtime.cjs` centralizes workspace/session persistence, PTY environment construction, Codex command construction, Codex preflight, and transcript/event writing.

## Environment Parity

The terminal runtime attempts to match a normal macOS terminal by:

- Starting shell terminals as the user's login shell with `-l`.
- Resolving the Electron GUI environment through the user's login shell.
- Refreshing the login shell environment for each spawn.
- Preserving variables such as `HOME`, `SHELL`, `PATH`, `LANG`, and user Node/npm paths.
- Setting `TERM=xterm-256color`.
- Setting `COLORTERM=truecolor`.
- Setting `TERM_PROGRAM=Dojo Desktop`.
- Normalizing unsupported `C.UTF-8` locale values to `en_US.UTF-8`.
- Ensuring the macOS node-pty `spawn-helper` binary is executable.

Known caveat: this is close to VS Code/iTerm behavior, but not guaranteed to be identical for every shell customization. The shell parity tests should compare `pwd`, `env`, `which codex`, `echo $SHELL`, interactive input, colors, and resize behavior against the user's normal terminal.

## Codex Launch Policy

The MVP originally attempted to start Codex directly. The current implementation starts Codex via the user's login shell:

```text
<user-shell> -ilc <codex startup script>
```

The script:

1. Changes to the workspace cwd.
2. Resolves `codex` with `command -v codex`.
3. Verifies `codex --version`.
4. Starts Codex with `check_for_update_on_startup=false`.
5. Prints a visible footer when Codex exits.

The runtime intentionally disables Codex startup update checks:

```bash
codex -c check_for_update_on_startup=false --cd <workspace>
```

Reason: Codex's own update path can run npm installation steps and then exit or require restart. In a managed PTY tree this produced confusing half-installed states. Dojo Desktop should not silently update Codex inside a conversation instance. Users should update Codex explicitly from a normal shell or from the workspace shell tool.

## Codex CLI Preflight

Before creating a Codex conversation, the runtime checks:

- `command -v codex` from the login shell.
- Whether the resolved binary points at the bundled `/Applications/Codex.app/Contents/Resources/codex`.
- Whether global npm package `@openai/codex` is installed.
- Whether `codex --version` runs successfully.

If the shell resolves the Codex.app bundled binary, the app currently rejects it and asks the user to install the npm Codex CLI:

```bash
npm install -g @openai/codex@latest
```

This was a deliberate product decision during the MVP: the desktop wrapper should manage the normal CLI package rather than relying on the Codex desktop app's bundled internal binary.

## UI Behavior

Current layout:

- Left sidebar:
  - Workspace identity and switch folder action.
  - Workspace tools section with `Open shell`.
  - Session list.
  - Active session's Codex conversation list.
- Main pane:
  - Topbar showing active session and selected instance state.
  - Canvas view when no specific instance is selected.
  - Full terminal view when an instance is selected.
- Canvas:
  - Shows Codex instances as a tree.
  - Parent/child relation uses `parent_instance_id`.
  - Nodes show title, kind/status, and a transcript preview.

The bottom composer was intentionally de-emphasized during debugging. Direct xterm input is the primary interaction path for now. The `inputPipeline.ts` scaffold remains for future composer commands such as:

- `/new-shell`
- `/new-codex`
- `/fork`
- `/canvas`

## Lifecycle Behavior

When a Codex process exits:

- The PTY is removed from the active PTY map.
- The transcript receives a Dojo footer with exit code, signal, and restart guidance.
- The instance state changes to `exited` or `error`.
- The UI can show a restart action for closed Codex instances.

The intended behavior is that a killed Codex conversation should not turn into a normal shell. It should stay closed and visible as a completed/error conversation, with a clear recovery action. This avoids letting a closed Codex conversation continue as an unrelated shell process.

## Hook Direction

`desktop/electron/codex-hook.cjs` exists as scaffolding for future Codex hook integration.

MVP hook policy:

- Observe/log only.
- Record hook payloads to `.dojo/desktop/sessions/<session>/events.jsonl`.
- If a hook payload exposes a Codex session id, bind it to the instance.
- Do not inject, intercept, rewrite, or proxy Codex behavior.

Current understanding of Codex CLI context extension:

- There is no stable public API for injecting arbitrary live context into an already-running Codex CLI TUI.
- Startup/handoff context should use `AGENTS.md`, `.codex/config.toml`, CLI flags, skills, MCP, and initial prompts.
- Hooks should be treated as lifecycle observation and validation points unless Codex documents a stronger contract.

## Work Item And Dojo-Context Direction

The product model likely needs to evolve beyond the current Dojo `session` concept.

Current proposed future hierarchy:

1. Workspace
2. Work Item
3. Dojo-Context documents and tasks
4. Agent Run / Codex conversation

Important naming decision:

- The task document directory should be called `Dojo-Context`.
- Avoid `dox`, `.dojo-workitem`, or generic `docs` for this purpose.
- These files are AI coding runtime context records, not normal product docs and not business repo documentation.

Suggested manual structure for real-world experimentation:

```text
<big-workspace>/
└── Dojo-Context/
    └── WI-20260619-example/
        ├── manifest.md
        ├── requirement.md
        ├── tech-design.md
        ├── task-breakdown.md
        ├── todo.md
        └── agent-runs/
            ├── RUN-001.md
            └── RUN-002.md
```

For a more isolated future model:

```text
<dojo-work-items-root>/
└── WI-20260619-example/
    ├── workspace/
    │   ├── AGENTS.md
    │   ├── Dojo-Context/
    │   └── repos/
    │       ├── target-repo/    # writable git worktree
    │       └── reference-repo/ # symlink or read-only reference
    └── control/
        └── runtime.json
```

Key design correction: do not treat the top-level Dojo workspace as one giant git worktree. A Work Item workspace should be assembled from selected repos. Each selected repo can be a git worktree, and non-selected/reference repos can be symlinked. This avoids mixing Dojo runtime metadata, business `docs`, `docker` folders, and unrelated large workspace content.

Recommended next product step:

- Do not immediately refactor the core CLI model.
- First run several real Work Items manually with `Dojo-Context/WI-*`.
- Record which context files are necessary, which agent-run records are useful, and which repo isolation operations are repetitive.
- Then add focused CLI commands such as:

```bash
dojo work-item create
dojo work-item repo add --mode worktree
dojo work-item repo add --mode symlink
dojo work-item task create
dojo work-item agent start --agent codex --task <task-id>
```

## Development Commands

Install dependencies:

```bash
npm install
```

Run desktop app:

```bash
npm run desktop:dev
```

Run desktop app with Chromium DevTools protocol:

```bash
npm run desktop:dev:debug
```

Build renderer:

```bash
npm run desktop:build
```

Run all tests:

```bash
npm test
```

Run desktop runtime tests:

```bash
npx vitest run tests/desktop/runtime.test.ts
```

Type-check:

```bash
npm run lint
```

## Test Plan

Phase 1: app skeleton

- Start Electron with `npm run desktop:dev`.
- Confirm the window opens without repeated flicker.
- Confirm folder picker works.
- Open a non-Dojo directory and confirm minimal `.dojo` initialization.
- Open an existing Dojo directory and confirm sessions are listed.
- Create a Dojo session and verify `.dojo/sessions/<id>/state.json`.

Phase 2: xterm and PTY validation

- Create a workspace shell from the sidebar.
- Confirm shell prompt appears.
- Type directly into xterm:
  - `pwd`
  - `echo hello`
  - `ls`
  - `which codex`
  - `echo $SHELL`
- Confirm output matches the user's normal terminal.
- Resize the window and confirm terminal dimensions remain correct.
- Test interactive commands:
  - `node`
  - `less package.json`
  - `vim --version`
- Confirm keyboard input, Ctrl+C, escape/quit keys, scrollback, and color rendering.

Phase 3: Codex preflight and launch

- With no npm Codex CLI installed, confirm the setup notice appears.
- If `command -v codex` resolves to Codex.app bundled binary, confirm the app rejects it.
- Install npm Codex CLI explicitly:

```bash
npm install -g @openai/codex@latest
```

- Recheck preflight.
- Create a Codex conversation.
- Confirm the real Codex TUI renders with colors.
- Confirm direct xterm input works.
- Confirm Codex slash commands and approval flows work inside xterm.
- Kill Codex with Ctrl+C and confirm the Dojo exit footer appears.
- Confirm the instance is marked `exited` or `error`.
- Confirm Restart creates a new Codex process rather than converting the old one to shell.

Phase 4: instance tree

- Create multiple Codex conversations.
- Create a child conversation from a parent.
- Confirm canvas shows parent/child edges.
- Click a canvas node and confirm it opens the corresponding terminal.
- Confirm transcript previews appear on nodes.
- Confirm exited conversations remain visible with their transcript.

Phase 5: persistence smoke

- Open a workspace.
- Create a session.
- Create a shell instance.
- Create a Codex instance.
- Exit the app.
- Reopen the app.
- Confirm workspace path, sessions, instance records, transcript paths, and canvas tree are restored.
- Confirm old running instances are normalized to exited when the desktop app restarts.

## Current Automated Verification

The current test file validates:

- Workspace initialization.
- Session creation.
- Instance persistence.
- Transcript writing.
- Codex command generation for new/fork/resume.
- Login shell command generation.
- Locale normalization.
- Exit footer formatting.
- Composer input pipeline command detection.

Run:

```bash
npx vitest run tests/desktop/runtime.test.ts
npm run lint
npm run desktop:build
```

## Known Risks

- xterm.js is reliable as a browser terminal renderer, but parity with VS Code requires sustained testing across shells, TUIs, resize, colors, IME, clipboard, and long scrollback.
- Codex CLI update behavior can still surprise users if they update from inside a managed terminal. Current policy is explicit external update through workspace shell.
- The current Codex `fork` and `resume` support depends on public CLI behavior and available session ids. Hook-based session id binding is still incomplete.
- The desktop data model is still session-centric. The future Work Item model should not be rushed into core Dojo until it has been validated on real projects.
- The current UI is an MVP shell, not a polished production desktop experience.

## Recommended Next Tasks

1. Verify terminal reliability manually with the test plan above.
2. Improve Codex CLI setup flow and npm install/update guidance.
3. Complete hook observation and Codex session id binding if supported by the current Codex CLI.
4. Add Playwright or Electron-level smoke tests for terminal creation and basic input.
5. Run several real Work Items manually using `Dojo-Context/WI-*` before changing core Dojo abstractions.
6. Design a small CLI-only Work Item runtime after the manual workflow stabilizes.
7. Only then reconnect the desktop app to the Work Item runtime.
