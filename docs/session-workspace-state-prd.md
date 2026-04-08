# Archived Design Note

This file previously described a heavier Dojo design centered on:

- workspace/root branch switching
- per-repo branch bindings
- reconciliation and switch safety
- Git-aware status surfaces

That is **not** the current product direction on this branch.

The current MVP intentionally removes branch control and keeps Dojo focused on:

- session activation
- template scope switching
- artifact-aware command rendering
- startup and handoff context generation

Use these documents as the current source of truth instead:

- [README.md](../README.md)
- [runtime-design.md](./runtime-design.md)
- [tech-design.md](./tech-design.md)
- [template-protocol.md](./template-protocol.md)
