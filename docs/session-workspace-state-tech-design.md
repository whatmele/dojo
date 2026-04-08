# Archived Design Note

This file previously described a branch-aware control plane for Dojo, including:

- branch planning and execution
- repo observation and reconciliation
- expected-vs-actual Git alignment
- fail-closed branch switching

That design is archived on this branch.

The current implementation is a lighter MVP:

- sessions are runtime namespaces, not branch layouts
- repos are registry entries, not branch bindings
- `dojo start` refreshes runtime state and launches the tool
- context generation focuses on active session + artifacts, not Git state

Use these documents for the current implementation:

- [README.md](../README.md)
- [runtime-design.md](./runtime-design.md)
- [tech-design.md](./tech-design.md)
- [template-protocol.md](./template-protocol.md)
