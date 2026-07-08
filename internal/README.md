# Internal — maintainer-only

> ⚠️ **Not part of the action's public usage surface.** External users of this action can ignore
> this entire folder. Nothing here is needed to *use* `LynxTrac/deploy-action`.

This folder holds the **internal development & end-to-end (E2E) harness** for the action's
maintainers. It exercises the real trigger flow — *source repo → workflow → action → backend* —
without needing a live LynxTrac server, by standing up a tiny mock backend locally.

## Contents

| Path | Purpose |
|---|---|
| [`github/test.js`](github/test.js) | Manual runner for the **GitHub** entry: sets `INPUT_*` env vars and calls `src/github.js`. |
| [`github/test.yml`](github/test.yml) | Sample GitHub *consuming* workflow (the `workflow → action` half). |
| [`bitbucket/test.js`](bitbucket/test.js) | Manual runner for the **Bitbucket** entry: sets env vars and calls `src/bitbucket.js`. |
| [`bitbucket/test.yml`](bitbucket/test.yml) | Sample `bitbucket-pipelines.yml` invoking the action via `npx lynxtrac-deploy`. |
| [`e2e/mock-backend.js`](e2e/mock-backend.js) | Minimal HTTP server mimicking `POST /api/external/deploy/release`. |
| [`e2e/run-local.sh`](e2e/run-local.sh) | Builds nothing — runs the bundled `dist/index.js` (GitHub entry) against the mock and asserts the outputs. |
| [`e2e/workflow.sample.yml`](e2e/workflow.sample.yml) | A sample *consuming* workflow showing the action used as a CI step. |

The `github/` and `bitbucket/` subfolders hold the per-provider manual runners; both drive the same
shared processing unit (`src/core.js`), so a green run on one is representative of the other.

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
