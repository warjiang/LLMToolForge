# Manual Acceptance

Date: 2026-08-18

## Completed

- Browser opened `http://127.0.0.1:5173/agent` successfully and reported no
  application console errors.
- Prompt manager and picker interaction contracts are covered by component
  tests: empty-library create path, CRUD refresh, validation, delete
  confirmation, search, keyboard selection, Escape, loading/error states, and
  focus/selection restoration.
- Prompt sync contracts are covered by tests: encrypted resource registration,
  tombstones, snapshots, plaintext-manifest privacy, restore, and visible store
  reload.

## Blocked By Local Environment

- The local browser profile has no configured model connection. The Agent route
  shows the existing "no available connections" state before mounting the
  Composer, so a live direct/Pi/external-Agent turn and attachment interaction
  could not be exercised.
- This is not a Prompt feature error. Re-run the remaining manual checks after
  configuring any usable model connection:
  - apply a Prompt in a live Composer and verify text, caret/selection, and
    attachments;
  - send the first templated message and inspect the derived title;
  - run direct, Pi, and external-Agent turns with the expanded visible text;
  - verify real object-storage synchronization between two terminals.
