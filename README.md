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
| `lynxserver` | | Target server. Empty → `app.lynxtrac.com`. Aliases: `app`/`beta`/`qa` → `<alias>.lynxtrac.com`, `local`/`dev` → `http://localhost:5566`. Or a full `http(s)` URL. |
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
| `release-status` | Release lifecycle status — `APPROVED` after a successful trigger. |
| `created` | JSON `{ tasks, files }` counts created. |
| `slots` | JSON map of resolved `slot_key -> link`. |

## `deploy-modal` alias

If you prefer a single JSON blob, use `deploy-modal` instead of the named inputs:

```yaml
- uses: LynxTrac/deploy-action@v1
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
