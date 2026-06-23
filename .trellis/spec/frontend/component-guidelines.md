# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

- Shared visual semantics belong in `src/components/common/` when they are used
  by more than one page.
- Provider/model identity icons are centralized in
  `src/components/common/ProviderModelIcon.tsx`.

---

## Props Conventions

- Components that render model identity should accept the normalized
  `ModelInfo` shape when available, and may accept a string model id for manual
  API-key flows.

---

## Styling Patterns

- Use Tailwind utility classes and semantic color tokens.
- Icon components should accept `className` and default to stable `h-4 w-4`
  sizing so Select triggers, badges, and list rows do not shift layout.

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

- Do not duplicate provider/model string matching in page components. Add or
  adjust the mapping in `ProviderModelIcon.tsx`, then render with
  `ProviderIcon`, `ProviderIconLabel`, `ModelIcon`, or `ModelIconLabel`.
- Do not load provider/model icons from the network at runtime; keep them local
  so the desktop app works offline.
