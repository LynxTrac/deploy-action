# Internal — maintainer-only

> ⚠️ **Not part of the action's public usage surface.** External users of this action can ignore
> this entire folder. Nothing here is needed to *use* `bees-tracker/trigger-deploy`.

This folder holds the **internal development & end-to-end (E2E) harness** for the action's
maintainers. It exercises the real trigger flow — *source repo → workflow → action → backend* —
without needing a live LynxTrac server, by standing up a tiny mock backend locally.

## Contents

| Path | Purpose |
|---|---|
| [`e2e/mock-backend.js`](e2e/mock-backend.js) | Minimal HTTP server mimicking `POST /api/external/deploy/release`. |
| [`e2e/run-local.sh`](e2e/run-local.sh) | Builds nothing — runs the bundled `dist/index.js` against the mock and asserts the outputs. |
| [`e2e/workflow.sample.yml`](e2e/workflow.sample.yml) | A sample *consuming* workflow showing the action used as a CI step (the `workflow → action` half). |

## Run the E2E harness locally

```bash
npm install
npm run build           # produce dist/index.js (the harness runs the built bundle)
bash internal/e2e/run-local.sh
```

Expected: the script starts the mock backend, invokes the action exactly as GitHub Actions would
(via `INPUT_*` env vars), and prints `E2E OK` after asserting a `CREATED` response.

This mirrors the production path: a CI workflow sets the same inputs, the action POSTs to the
LynxTrac backend, and the backend materializes the release. Here the backend is mocked so the loop
is fast and offline.
