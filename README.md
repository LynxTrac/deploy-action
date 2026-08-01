# LynxTrac Deploy Action

Register a **LynxTrac release** straight from your CI pipeline. The action takes a few small
inputs — a deployment **blueprint** code, a **version**, and the build's **artifact links** — and
calls LynxTrac to create the release (version + tasks + files) for you.

> **What this does**
> It creates a **release** in LynxTrac from a blueprint and **auto-approves** it. If the product has
> a configured on-demand rollout, approval triggers it (a deployment request is created). If no
> rollout is configured, the release is created + approved and nothing deploys. See
> [Behavior & limitations](#behavior--limitations).

## Quick start

```yaml
- name: Register LynxTrac release
  uses: LynxTrac/deploy-action@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    trigger_environment: ''        # '' -> app.lynxtrac.com (production)
    blueprint: 'LRB12'             # blueprint code (auto-generated in LynxTrac, e.g. LRB12)
    version: '2.5.0'
    artifacts: |                   # { slot_key -> artifact link }
      {
        "app-bundle": "https://your-ci/artifacts/app-2.5.0.zip",
        "db-migrate": "https://your-ci/artifacts/migrate-2.5.0.sql"
      }
```

The set of **slot keys** (`app-bundle`, `db-migrate`, …) comes from your blueprint. Open the
blueprint in LynxTrac and use **Preview → Copy YAML** to generate this block with the exact slots.

## Inputs

| Input | Required | Description |
|---|---|---|
| `apikey` | ✅ | LynxTrac API key. Sent as `Authorization: Api-Key <key>`. **Store it as a secret.** |
| `trigger_environment` | | Target LynxTrac environment. Empty → `app.lynxtrac.com`. Aliases: `app`/`beta`/`qa` → `<alias>.lynxtrac.com`, `local`/`dev` → `http://localhost:5566`. Or a full `http(s)` URL. |
| `blueprint` | | Release blueprint code (auto-generated in LynxTrac, e.g. `LRB12`; holds the release structure). Required unless supplied via `deploy_manifest`. |
| `version` | | Semver version for the release (e.g. `2.5.0`). |
| `artifacts` | | JSON object mapping blueprint slot keys to a value. Each value is either a link string, or an object `{ "link": "...", "checksum": "...", "checksumType": "sha256" }` to also record an integrity hash. SFTP/FTP slots take the remote path instead of a URL. |
| `release_name` | | Human-readable release name (defaults to the version). |
| `description` | | Release description. |
| `deploy_manifest` | | Alias: one JSON object `{ blueprint, version, artifacts, release: { name, description } }`. Named inputs win if both are set. |
| `segment` | | **Multi-source blueprints only.** The blueprint task **code** this pipeline contributes to the shared release version. Omit for a normal (single-trigger) blueprint. See [Multi-source assembly](#multi-source-assembly-blueprint-streams). |
| `auto_approve` | | Approve the release once it is complete? Omit to use the blueprint's default; set to `false` to create (or contribute a segment) **without** approving it (no rollout fires — approve later in the console). |
| `commit` | | Commit SHA for provenance (defaults to the triggering commit). |
| `branch` | | Branch/ref for provenance (defaults to the triggering ref). |

## Outputs

| Output | Description |
|---|---|
| `release-id` | ID of the created (or already-existing) release. |
| `status` | `CREATED` \| `ASSEMBLING` \| `ALREADY_EXISTS` \| `VALIDATION_FAILED` \| `CONFLICT`. |
| `release-status` | Release lifecycle status — `APPROVED` after a successful trigger. |
| `created` | JSON `{ tasks, files }` counts created. |
| `slots` | JSON map of resolved `slot_key -> link`. |

## Workflow log

On success the step prints a detailed, human-readable summary — the target environment and
blueprint, the release id and status, a per-task/per-file breakdown (action, origin, destination
link, checksum), and which slots were **resolved / omitted / added as extras** — so you can see
exactly what the release contains without opening LynxTrac. Failures print the backend error
`code` and message on a single line and fail the step.

## Bitbucket Pipelines

The same action works from **Bitbucket Pipelines**. There it is installed from git and run as
`npx lynxtrac-deploy`; since Bitbucket has no `with:` inputs, inputs are supplied as environment
variables (uppercase, snake_case — the same argument names as the GitHub inputs):

```yaml
image: node:22 # requires Node.js 18+
pipelines:
  default:
    - step:
        name: Register LynxTrac release
        script:
          - npm install git+https://github.com/LynxTrac/deploy-action.git
          # APIKEY (and optional TRIGGER_ENVIRONMENT) come from Repository variables.
          # commit/branch auto-fill from Bitbucket's BITBUCKET_COMMIT / BITBUCKET_BRANCH.
          - >
            BLUEPRINT='LRB12'
            VERSION='2.5.0'
            ARTIFACTS='{ "app-bundle": "https://your-ci/app-2.5.0.zip" }'
            npx lynxtrac-deploy
```

> **Node.js 18+ required.** The action uses the global `fetch`, which exists on Node 18 and newer.
> Pin a modern Node image (e.g. `node:22`) — on an older runtime the step fails fast with a clear
> version error. (GitHub Actions is unaffected: `action.yml` pins its runtime to `node20`.)

Env vars: `APIKEY`, `TRIGGER_ENVIRONMENT`, `BLUEPRINT`, `VERSION`, `ARTIFACTS`, `RELEASE_NAME`,
`DESCRIPTION`, `DEPLOY_MANIFEST` (plus `COMMIT` / `BRANCH`, which default from `BITBUCKET_COMMIT` /
`BITBUCKET_BRANCH`). The behavior, validation, and detailed summary are identical to GitHub — both
providers share one processing unit. See [`examples/bitbucket-pipelines.yml`](examples/bitbucket-pipelines.yml).

## `deploy_manifest` alias

If you prefer a single JSON blob, use `deploy_manifest` instead of the named inputs:

```yaml
- uses: LynxTrac/deploy-action@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    trigger_environment: 'beta'
    deploy_manifest: |
      {
        "blueprint": "web-prod",
        "version": "2.5.0",
        "artifacts": { "app-bundle": "https://your-ci/app-2.5.0.zip" },
        "release": { "name": "Web 2.5.0", "description": "CI build" }
      }
```

(On Bitbucket, pass the same JSON via the `DEPLOY_MANIFEST` environment variable.)

## Multi-source assembly (Blueprint Streams)

A **multi-source** blueprint assembles ONE release version from several independent pipelines — each
contributing one blueprint task (a **segment**), identified by its task `code`. Use it when a product's
release is built from several repositories/pipelines.

- Every pipeline sends the **same** `blueprint` + `version`, plus its own `segment` (the task code) and only
  that segment's `artifacts`.
- Triggers can run in any order, even days apart. The release is created **incomplete** on the first trigger
  and completes once every expected segment has been contributed.
- On completion the release is auto-approved (and any configured rollout fires) **unless** you pass
  `auto_approve: 'false'`, in which case it waits for a manual approval in the console.
- Re-running a pipeline is safe (idempotent). Adding a **new** segment to an already-approved release — or a
  version already owned by a different/manual release — is rejected with a clear `CONFLICT`.
- A later trigger for a segment that already exists can **add files** to it (when the blueprint allows extra
  files, or to fill a slot omitted earlier under "allow missing files").

Example — three repositories, one release `2.5.0` (blueprint `LRB12` with task codes `app`, `db`, `web`).
Give each repository's pipeline its own snippet (the blueprint editor's **Copy CI YAML** generates one per
segment):

```yaml
# 'app' repository pipeline
- uses: LynxTrac/deploy-action@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    blueprint: 'LRB12'
    version: '2.5.0'
    segment: 'app'
    artifacts: |
      { "app-bundle": "https://your-ci/app-2.5.0.zip" }
```

```yaml
# 'db' repository pipeline — same blueprint + version, segment 'db', only its slots
- uses: LynxTrac/deploy-action@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    blueprint: 'LRB12'
    version: '2.5.0'
    segment: 'db'
    artifacts: |
      { "db-migrate": "https://your-ci/migrate-2.5.0.sql" }
```

The `web` pipeline follows the same shape with `segment: 'web'`. When the last of the three runs, release
`2.5.0` is complete and (by default) approved.

## Idempotency

Re-running the same build is safe. A single-trigger release is unique per `(vendor, product, version)`; a
repeat call returns `status: ALREADY_EXISTS` with the existing `release-id` and creates nothing new. For a
multi-source blueprint, re-sending a segment that is already present is likewise a no-op.

## Selecting an environment (`trigger_environment`)

- empty / `app` → `https://app.lynxtrac.com` (production)
- `beta` → `https://beta.lynxtrac.com`
- `qa` → `https://qa.lynxtrac.com`
- `local` / `dev` → `http://localhost:5566` (local backend)
- a full `http(s)` URL → used as-is (the action warns if the host isn't `*.lynxtrac.com`/localhost, since it sends the API key there)

Unknown short names are rejected — use one of the aliases above or a full URL.

## Behavior & limitations

- The release is created and **auto-approved**. Whether anything **deploys** is gated by admin
  config: deployment happens only if the product has a configured **on-demand rollout** (which
  approval triggers → a deployment request). No rollout configured ⇒ created + approved, no deploy.
- **Sources:** `DIRECT_LINK` (slot value = http(s) URL), `SFTP`/`FTP` (slot value = remote path).
  `DIRECT_UPLOAD` is not supported from CI.
- **Checksums:** optional, via `{ "link": "...", "checksum": "...", "checksumType": "sha256" }`.
- **Not yet supported:** variable-count file slots (one file per slot); `HOTFIX`/`REMOTE_SCRIPT`.
- Re-running a version whose release exists but was **not** approved will re-attempt approval
  (self-healing); an already-approved version is a safe `ALREADY_EXISTS` no-op.

More examples live in [`examples/`](examples/). See the server repo's
`docs/lt-8787-ci-deploy-known-limitations.md` for the full matrix.

## Development

This is a JavaScript action (**requires Node.js 18+** — it uses the global `fetch`) with two thin
entry points over one shared processing unit:

- `src/lib.js` — pure helpers (URL resolution, request build, summary formatting; no network / no I/O).
- `src/core.js` — the **common processing unit**: build → POST → map response → report, provider-agnostic.
- `src/github.js` — **GitHub Actions** entry (reads `INPUT_*` via `@actions/core`). Bundled by ncc into the
  committed `dist/index.js`, which is what GitHub actually runs (`action.yml` `main`).
- `src/bitbucket.js` — **Bitbucket Pipelines** entry (`bin: lynxtrac-deploy`; reads env vars). Run straight from
  the git-installed package — no bundle needed.

After editing `src/`:

```bash
npm install
npm test          # node --test  (lib, core, github, bitbucket)
npm run build     # rebuilds dist/index.js from src/github.js with @vercel/ncc — commit the result
```

> Outputs (`release-id`, `status`, …) are a GitHub Actions concept and are only set on the GitHub path;
> the Bitbucket entry prints the same detailed summary and fails the step (exit 1) on error.

> Maintainers: the `internal/` folder holds an internal dev/E2E harness and is **not** part of the
> action's public usage surface — external users can ignore it.

## License

[Apache-2.0](LICENSE)
