# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

## Scenario: Structured AI utility responses

### 1. Scope / Trigger

- Trigger: a frontend utility asks a model for JSON-shaped data through the
  Unified Gateway and renders or persists the result.

### 2. Signatures

- Transport functions return `Promise<string>`, never a trusted domain type.
- A feature-owned parser converts the raw string into a typed result:

```typescript
function parseFeatureResult(text: string): FeatureResult;
```

### 3. Contracts

- Prompt builders request one JSON object and state the exact schema.
- Parsers accept `unknown` after `JSON.parse`, then validate every required
  field and business invariant before returning a domain type.
- UI components receive normalized domain values and do not inspect raw model
  payloads.
- A format-repair retry is limited to one attempt and uses the same parser.

### 4. Validation & Error Matrix

- Missing JSON object -> structured-response error.
- Wrong field type or empty required string -> field-specific error.
- Business invariant violation, such as duplicate items or a wrong array
  length -> invariant-specific error.
- First parse failure -> one format-repair request.
- Repair parse failure -> surface a retryable error and preserve current user
  input.
- Transport failure -> surface directly; do not spend a repair request.

### 5. Good/Base/Bad Cases

- Good: `{"items":[{"text":"umbrella","kind":"thing"},{"text":"trust","kind":"concept"}]}`.
- Base: JSON inside a Markdown `json` fence may be extracted before validation.
- Bad: casting `JSON.parse(text) as FeatureResult` or rendering the raw text.

### 6. Tests Required

- Assert pure JSON and fenced JSON parse to the same domain value.
- Assert missing fields, duplicate values, invalid enums, and wrong lengths
  fail with specific errors.
- Assert invalid first output triggers exactly one repair call.
- Assert transport errors trigger no repair call.
- Assert a failed request does not clear the current prompt or user answer.

### 7. Wrong vs Correct

Wrong:

```typescript
const result = JSON.parse(response.content) as FeatureResult;
setResult(result);
```

Correct:

```typescript
const raw = await complete(messages);
const result = parseFeatureResult(raw);
setResult(result);
```

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

(To be filled by the team)

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
