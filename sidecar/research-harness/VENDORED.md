# Vendored: research-harness

This directory is a vendored copy of the `research-harness` Python project,
copied into LLMToolForge so the ResearchAgent works on any checkout without an
external absolute path.

- Source repo: warjiang/research-harness
- Vendored from commit: 719110c3eb11eb781f29549580f8c4497b33d54c
- Contents: `research_harness/` package, `scripts/` collectors, `schemas/`,
  `templates/`, `tests/`, `pyproject.toml`, `Makefile`, `README.md`.
- Runtime prerequisite: `python3 >= 3.10` on the host. No pip dependencies.

Do not edit generated data here. Research session data is written under the
session workspace root passed via `--root`, not into this vendored copy.
