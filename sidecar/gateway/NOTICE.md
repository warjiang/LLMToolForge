# Third-party notices

This sidecar embeds a trimmed copy of the **Portkey AI Gateway**.

- Project: Portkey AI Gateway (`portkey-ai/gateway`)
- Version: v1.15.2 (see `portkey/PORTKEY_VERSION`)
- License: MIT — full text in `portkey/LICENSE`
- Copyright (c) 2024 Portkey, Inc

The vendored source lives under `portkey/` and is used unmodified except for:

- `portkey/src/index.ts` — added `'bun'` to the compression skip-list so the
  bun-compiled binary does not gzip Server-Sent Event responses.
- `portkey/plugins/index.ts` — a local stub exporting no guardrail plugins.
- `portkey/package.json` — a minimal manifest exposing only the `version` field
  required by an internal Portkey import.

All other files under `portkey/` are copied verbatim from the upstream release.
