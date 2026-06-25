# Skill Management Contracts

## Scenario: Skill Filesystem Sync

### 1. Scope / Trigger

- Trigger: frontend skill records are deployed through a Tauri filesystem command.
- Applies when changing skill target paths, sync payloads, generated `SKILL.md`, or the `sync_skills_to_targets` command.
- The contract spans UI state, local JSON storage, Tauri command serialization, filesystem writes, and sync result rendering.

### 2. Signatures

Frontend command wrapper:

```typescript
syncSkillsToTargets(request: SyncSkillsRequest): Promise<SyncSkillResult[]>
```

Tauri command:

```rust
fn sync_skills_to_targets(
    app: tauri::AppHandle,
    request: SyncSkillsRequest,
) -> Result<Vec<SyncSkillResult>, String>
```

Stored entities:

```typescript
interface Skill {
  agentKeys?: SkillAgentKey[];
  syncMode?: "copy" | "symlink";
}

interface SkillProjectConfig {
  name: string;
  projectPath: string;
  agentKeys: SkillAgentKey[];
  skillIds: string[];
  syncMode: "copy" | "symlink";
  enabled: boolean;
}
```

### 3. Contracts

`SyncSkillsRequest` fields:

- `mode`: `"copy"` or `"symlink"`.
- `skills`: enabled skills to deploy.
- `targets`: resolved filesystem targets. Global targets use the target's `globalSkillsDir`; project targets use `<projectPath>/<projectSkillsDir>`.

`SyncSkillResult` fields:

- `skillId`, `skillName`: source skill identity.
- `agentKey`, `agentName`: target agent identity.
- `scope`: `"global"` or `"project"`.
- `targetPath`: final skill directory path, including the generated folder name.
- `status`: `"success"` or `"error"`.
- `error`: user-facing error text for failed rows.

Generated folder contract:

- Every deployed skill directory must contain `SKILL.md`.
- `SKILL.md` frontmatter must include `name` and `description`.
- Tags are optional frontmatter metadata.

### 4. Validation & Error Matrix

- Unknown `mode` -> command-level error.
- Blank skill name -> per-target error.
- Disabled skill sent to command -> per-target error.
- Missing or unwritable target parent directory -> per-target error.
- Symlink creation failure -> per-target error.
- Non-Tauri browser runtime -> frontend wrapper throws before invoking.

### 5. Good / Base / Bad Cases

- Good: an enabled skill assigned to Codex syncs to `~/.codex/skills/<slug-id>/SKILL.md`.
- Base: a project config for Hermes syncs to `<project>/.hermes/skills/<slug-id>/SKILL.md`.
- Bad: a disabled skill is sent to the command; it returns an error row and does not write files.

### 6. Tests Required

- Type/build check must cover frontend payload shapes.
- Rust check must cover Tauri command compilation.
- Browser verification should create a skill with at least two agents and a project config with at least two agents.
- Filesystem behavior should be manually verified in Tauri runtime when changing write, overwrite, or symlink semantics.

### 7. Wrong vs Correct

#### Wrong

```typescript
const targetDir = `${projectPath}/.codex/skills`;
```

This duplicates target path knowledge in UI code and misses agents with different global/project paths.

#### Correct

```typescript
const target = getSkillTarget("codex");
const dir = target ? projectTargetDir(projectPath, target) : "";
```

Agent paths live in `src/lib/skillTargets.ts`, and UI code only resolves through the registry.

## Dialog Layout Rule

Long operational dialogs must keep the footer reachable at the default desktop viewport. Use a constrained content region such as `max-h-[68vh] overflow-y-auto` while keeping actions outside the scroll area.
