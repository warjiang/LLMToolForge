# Selective model addition from fetched candidates

## Goal

Improve model-fetch workflows so users can browse all fetched candidate models and selectively add only the models they want to expose, instead of fetching a large list into the selected model set and removing unwanted entries one by one.

## Requirements

- In the API Key edit/create dialog, clicking "Fetch Models" must fetch and display the returned model ids as candidates.
- Fetched candidates must not be automatically added to the saved/selected `models` list.
- Users must be able to add an individual candidate to the selected model list.
- Candidates already present in the selected model list should be visibly marked as selected or disabled to avoid duplicate additions.
- Manual model id entry must continue to work.
- Saving an API Key must continue to persist only the selected model list, not every fetched candidate.
- Existing validation for missing Base URL, missing key, and fetch failures must remain intact.
- In non-manual provider detail pages (Volcengine and OpenAI-compatible gateway providers such as New API, LiteLLM, and DMX), clicking "Fetch Models" must also show fetched results as candidates instead of immediately replacing the saved model list.
- Non-manual provider candidate models must support individual add actions.
- Non-manual provider saved models must support deleting a specific model.

## Acceptance Criteria

### Manual API Key dialog

- [x] Fetching models shows a candidate list without changing the selected model list.
- [x] Clicking a candidate add action appends that model to the selected model list exactly once.
- [x] Existing selected models still render as removable badges.
- [x] Manual model entry and removal behavior still works.
- [x] Unit/component tests cover the selective-add behavior.
- [x] Relevant tests and build/type checks pass.

### Non-manual provider pages

- [x] Gateway provider model fetch shows a candidate list without changing the selected model list.
- [x] Gateway provider candidates can be added one by one and saved to the connection.
- [x] Gateway provider saved models can be deleted one by one.
- [x] Volcengine model fetch shows a candidate list without changing the selected model list.
- [x] Volcengine candidates can be added one by one and saved to the credential.
- [x] Volcengine saved models can be deleted one by one.
- [x] Unit/component tests cover non-manual selective-add and delete behavior.
- [x] Relevant tests and build/type checks pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
