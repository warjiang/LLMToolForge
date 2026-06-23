# Playground Compact Composer Redesign Technical Design

## Boundaries

- Main implementation target: `src/pages/playground/PlaygroundPage.tsx`.
- Shared UI addition: add a checkbox item wrapper to `src/components/ui/dropdown-menu.tsx` for compact multi-select menus.
- No changes to chat repository, provider adapters, model capability types, or persisted settings schema.

## Data Flow

- Composer controls call the existing `updateSettings` helper.
- Connection changes update `connKey`; existing model hydration effects keep `models` and `modelId` aligned with the selected connection.
- Model refresh calls the existing `fetchModels` helper and stores fetched models through existing provider stores.
- Skill/MCP menus update `enabledSkillIds` and `enabledMcpServerIds`; `activeSkills`, `activeMcp`, and `toolDefinitions()` continue using those settings.

## UI Design

- The main conversation pane follows the Codex Desktop reference: messages, inline errors, and composer are centered in one width-limited column.
- The composer is one bordered `bg-background` surface inside the existing footer band.
- The textarea sits above one compact toolbar row; attach, connection, model, refresh, Skill, MCP, and send/stop controls share that row on desktop.
- The toolbar wraps only when viewport width requires it and contains compact selects plus icon-only tool buttons.
- Skill/MCP controls use dropdown checkbox menus with active counts in the button label.
- Pending attachment pills render between textarea and toolbar inside the same surface.
- The textarea is borderless and focus is represented by the composer surface, avoiding nested input borders.

## Compatibility

- Keyboard behavior, send/stop behavior, file picker behavior, model feature title tooltips, and provider/model icon rendering remain unchanged.
- The advanced rail remains optional through the existing `configOpen` toggle and no longer owns Skill/MCP selection.
