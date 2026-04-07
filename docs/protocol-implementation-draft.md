# Dojo Protocol Implementation Draft

This draft turns the simplified runtime model into concrete structures and algorithms.

## 1. Working assumptions

The implementation assumes:

- the workspace root branch switches with the active session
- `.dojo/context.md` is startup/handoff context, not a live mirror
- artifact behavior is defined by artifact plugins
- template structure is expressed mainly in the template body
- `dojo template lint` and runtime rendering share the same validation rules

## 2. `config.json` draft

Recommended shape:

```json
{
  "workspace": {
    "name": "my-workspace",
    "description": "Cross-repo AI coding workspace"
  },
  "agents": ["codex", "claude-code"],
  "agent_commands": {
    "codex": "codex",
    "claude-code": "claude"
  },
  "repos": [
    {
      "name": "backend-service",
      "type": "biz",
      "git": "git@github.com:org/backend-service.git",
      "path": "repos/biz/backend-service",
      "default_branch": "main",
      "description": "Core backend API"
    }
  ],
  "context": {
    "artifacts": [
      "product-requirement",
      "research",
      "tech-design",
      "tasks",
      "workspace-doc"
    ]
  }
}
```

`context.artifacts` is the only ordering field.

It controls:

- context section order after the fixed header
- artifact plugin call order during context generation

## 3. Artifact plugin draft type

```ts
export interface ArtifactPlugin {
  id: string;
  dir: string | null;
  description?: string;
  renderContext: ArtifactRenderFunction;
}

export interface ArtifactRenderInput {
  root: string;
  config: WorkspaceConfig;
  session: SessionState;
  artifact: ArtifactPlugin;
  dir: string | null;
  helpers: ArtifactPluginHelpers;
}

export interface ArtifactPluginHelpers {
  resolveArtifactDir(id: string): string | null;
  listMarkdownFiles(dir: string | null): string[];
  listDirs(dir: string | null): string[];
  readText(filePath: string, maxChars?: number): string;
  readJSON<T>(filePath: string): T | null;
  relative(filePath: string): string;
  pickPreferred(files: string[], preferredNames: string[]): string | null;
}
```

## 4. Template syntax draft

Supported placeholders:

- `${session_id}`
- `${context_path}`
- `${artifact_dir:<id>}`
- `${artifact_description:<id>}`

Supported session markers:

- `<!-- DOJO_SESSION_ONLY -->`
- `<!-- /DOJO_SESSION_ONLY -->`
- `<!-- DOJO_NO_SESSION_ONLY -->`
- `<!-- /DOJO_NO_SESSION_ONLY -->`

Supported directives:

- `<dojo_read_block artifacts="research,tasks" />`
- `<dojo_write_block artifact="tech-design" />`

## 5. Template validation pseudocode

```ts
async function validateTemplateContent(root: string, content: string): Promise<string[]> {
  const issues: string[] = [];

  issues.push(...validateDirectiveSyntax(content));
  issues.push(...validatePlaceholderSyntax(content));
  issues.push(...validateSessionMarkers(content));

  const refs = extractTemplateArtifactRefs(content);
  const plugins = await loadArtifactPlugins(root);

  for (const id of refs.all) {
    if (id && !plugins[id]) {
      issues.push(`Unknown artifact id referenced in template: ${id}`);
    }
  }

  return unique(issues);
}
```

CLI shape:

```bash
dojo template lint
dojo template lint dojo-tech-design
dojo template lint .dojo/commands/dojo-tech-design.md
```

## 6. Command materialization pseudocode

```ts
async function materializeTemplate(root, file, sessionId, config) {
  const source = readText(file);
  const issues = await validateTemplateContent(root, source);
  if (issues.length > 0) throw new Error(issues[0]);

  let content = source;
  content = applySessionBlocks(content, sessionId);
  content = replaceSessionAndContextPlaceholders(content, sessionId);
  content = await expandArtifactPlaceholders(content, root, config, sessionId);
  content = await expandReadWriteDirectives(content, root, config, sessionId);

  writeText(renderedPath, content);
}
```

## 7. Context generation pseudocode

```ts
async function buildContextMarkdown(root, session, config) {
  const plugins = await loadArtifactPlugins(root);
  const order = getContextArtifactOrder(config, plugins);
  const blocks = [renderHeader(session, config)];

  for (const artifactId of order) {
    const artifact = plugins[artifactId];
    if (!artifact) continue;

    const dir = resolveArtifactDir(artifact, { sessionId: session.id });
    const block = await artifact.renderContext({
      root,
      config,
      session,
      artifact,
      dir: dir ? join(root, dir) : null,
      helpers,
    });

    if (block && block.trim()) {
      blocks.push(block.trim());
    }
  }

  return blocks.join('\n\n') + '\n';
}
```

## 8. `dojo init` provisioning draft

`dojo init` should copy these starter assets into the workspace:

- `.dojo/commands/` from `src/starter/commands/`
- `.dojo/artifacts/` from `src/builtins/artifacts/`
- `.dojo/skills/` from `src/skills/`

That makes the workspace self-contained for both humans and AI tools.

## 9. Built-in artifact set

The current built-in artifact plugins are:

- `product-requirement`
- `research`
- `tech-design`
- `tasks`
- `workspace-doc`

These are enough to support the starter workflow, and users can extend them by adding more files under `.dojo/artifacts/`.

## 10. Refresh timing

Dojo should refresh commands and context:

- during `dojo session new`
- during `dojo session resume`
- during `dojo context reload`
- before `dojo start` launches the coding tool

Dojo should not depend on live reinjection of `.dojo/context.md` into an already-running AI session.

## 11. Code map

The current implementation is centered in:

- `src/core/protocol.ts`
- `src/core/command-distributor.ts`
- `src/core/context-generator.ts`
- `src/core/builtins.ts`
- `src/commands/template.ts`
- `src/commands/artifact.ts`
- `src/commands/init.ts`
