# LynxTrac Deploy Action

Register a **LynxTrac release** straight from your CI pipeline. The action takes a few small
inputs — a deployment **blueprint** code, a **version**, and the build's **artifact links** — and
calls LynxTrac to create the release (version + tasks + files) for you.

> **What this does (and does not) do in v1**
> It **registers a release** in LynxTrac. It does **not** deploy to any devices — a human still
> reviews and approves the rollout inside LynxTrac. See [Known limitations](#known-limitations).

## Quick start

```yaml
- name: Register LynxTrac release
  uses: bees-tracker/trigger-deploy@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    lynxserver: ''                 # '' -> app.lynxtrac.com (production)
    blueprint: 'web-prod'          # blueprint code configured in LynxTrac
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
| `lynxserver` | | Target server. Empty → `app.lynxtrac.com`. Aliases: `app`, `beta`, `qa` → `<alias>.lynxtrac.com`. Or a full `http(s)` URL for local/dev. |
| `blueprint` | | Release blueprint code (holds the release structure). Required unless supplied via `deploy-modal`. |
| `version` | | Semver version for the release (e.g. `2.5.0`). |
| `artifacts` | | JSON object mapping blueprint slot keys to a value. Each value is either a link string, or an object `{ "link": "...", "checksum": "...", "checksumType": "sha256" }` to also record an integrity hash. SFTP/FTP slots take the remote path instead of a URL. |
| `release-name` | | Human-readable release name (defaults to the version). |
| `description` | | Release description. |
| `deploy-modal` | | Alias: one JSON object `{ blueprint, version, artifacts, release: { name, description } }`. Named inputs win if both are set. |
| `commit` | | Commit SHA for provenance (defaults to the triggering commit). |
| `branch` | | Branch/ref for provenance (defaults to the triggering ref). |

## Outputs

| Output | Description |
|---|---|
| `release-id` | ID of the created (or already-existing) release. |
| `status` | `CREATED` \| `ALREADY_EXISTS` \| `VALIDATION_FAILED`. |
| `release-status` | Release lifecycle status (v1: `REQUESTED` — awaiting approval). |
| `created` | JSON `{ tasks, files }` counts created. |
| `slots` | JSON map of resolved `slot_key -> link`. |

## `deploy-modal` alias

If you prefer a single JSON blob, use `deploy-modal` instead of the named inputs:

```yaml
- uses: bees-tracker/trigger-deploy@v1
  with:
    apikey: ${{ secrets.LYNXTRAC_API_KEY }}
    lynxserver: 'beta'
    deploy-modal: |
      {
        "blueprint": "web-prod",
        "version": "2.5.0",
        "artifacts": { "app-bundle": "https://your-ci/app-2.5.0.zip" },
        "release": { "name": "Web 2.5.0", "description": "CI build" }
      }
```

## Idempotency

Re-running the same build is safe. A release is unique per `(vendor, product, version)`; a repeat
call returns `status: ALREADY_EXISTS` with the existing `release-id` and creates nothing new.

## Selecting a server (`lynxserver`)

- empty / `app` → `https://app.lynxtrac.com` (production)
- `beta` → `https://beta.lynxtrac.com`
- `qa` → `https://qa.lynxtrac.com`
- a full `http(s)` URL → used as-is (local/dev testing)

Unknown short names are rejected — use one of the aliases above or a full URL.

## Known limitations

This initial version intentionally scopes to **release registration**:

- It does **not** create a deployment request or roll out to devices — approval/rollout happens in
  LynxTrac.
- `artifacts` is **link-only** (each slot → one URL). Variable-count file slots and CI-supplied
  checksums are not yet supported.
- The release is created as `REQUESTED` (no auto-approval from CI).

More examples live in [`examples/`](examples/).

## Development

This is a JavaScript (Node 20) action. Source is in `src/`; the committed `dist/` bundle is what
runs. After editing `src/`:

```bash
npm install
npm test          # node --test
npm run build     # rebuilds dist/ with @vercel/ncc — commit the result
```

> Maintainers: the `internal/` folder holds an internal dev/E2E harness and is **not** part of the
> action's public usage surface — external users can ignore it.

## License

[Apache-2.0](LICENSE)
