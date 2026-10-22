# Open Tooling

Shared build contract, CLI and GitHub Actions workflows for the `open-*` specification family.

[Русский](README.ru.md) · [Project contract](docs/project-contract.md) · [Releases](docs/releases.md) · [Migration](docs/migration.md)

Each specification stays in its own repository. This repository owns the common composition checks, packaging, artifact inventory and release orchestration. Domain validators, editor behavior and website content stay with their projects.

Requires Node.js 22 or 24, npm, Git, `tar`, `zip` and `unzip`. A website image additionally needs Docker. Linux extension-host checks run under Xvfb in the shared workflow. The tooling uses JSON Schema draft 7 for its manifest and accepts draft 7 or 2020-12 project schemas.

## Local development

```sh
npm ci --ignore-scripts
npm run verify
node scripts/smoke-package.js
```

Until the first tooling release, use the sibling checkout directly:

```sh
node ../open-tooling/bin/open-tooling.js check --complete
node ../open-tooling/bin/open-tooling.js build
node ../open-tooling/bin/open-tooling.js verify-artifacts --artifacts dist/open-tooling
```

Run these commands from the consumer repository. `check` reads `.open-project.json` and validates the project composition, package/lockfile versions, scripts, immutable schema URLs, examples and source archive inputs. `build` runs domain checks, creates and tests the distributables, and replaces its managed `dist/open-tooling/` directory only after validation succeeds.

## Products

| Product | Common checks | Output |
| --- | --- | --- |
| Specification | Schema compiles; JSON/YAML examples match and validate; negative fixtures fail | Schema, specification, examples |
| npm | Real tarball installed in a separate consumer; API, schema export, CLI and project smoke test | `.tgz` |
| VS Code | VSIX identity and entry point; project host tests on minimum and stable VS Code | `.vsix` |
| Website | Project checks; required pages; schema/examples match source byte for byte | Static `.tar.gz` |
| Website container | Built for `linux/amd64`; project container smoke test | Docker `.tar` and local image identity |
| Release | Closed inventory, source archive, matching component notes, sizes and hashes | `release.json`, `SHA256SUMS` |

Every manifest declares npm, VS Code and website products. During migration, a missing extension or website must have `enabled: false` and a reason. Such a build reports `complete: false`; `--complete` and the default shared CI reject it. A Docker image is optional.

## Shared CI/CD

Use the [consumer templates](templates/project/.github/workflows). Replace **both** occurrences of `TOOLING_COMMIT_SHA` with the same published 40-character commit SHA; no fabricated ref is checked into a consumer workflow.

```yaml
jobs:
  verify:
    uses: it-perspectives/open-tooling/.github/workflows/verify.yml@TOOLING_COMMIT_SHA
    with:
      tooling-ref: TOOLING_COMMIT_SHA
```

`verify.yml` builds on Node 22 and 24 and saves the Node 24 artifact only for a successful matrix. `release.yml` uses that same verification, downloads the saved products, validates their commit/tag/repository and publishes without rebuilding or executing consumer hooks in publishing jobs.

Supported release tags are `specification-vX.Y.Z`, `extension-vX.Y.Z` and `website-vX.Y.Z`. Specification and npm versions match; editor and website versions are independent. A release includes the full configured product set; the tag selects its title, version, notes and registry destinations. Registry publication is explicitly enabled in the manifest and defaults to off. GitHub Releases always receives the complete artifact set. Static hosting/deployment is handled by the consuming infrastructure.

GitHub supports calling a public reusable workflow from public or private repositories. A public consumer cannot call a private workflow repository. Pinning to a full SHA follows [GitHub's reusable-workflow guidance](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

## Current pilots

- `examples/open-env.open-project.json`: all products, including the existing website container; preserves the historical `v0.1.0` schema URL.
- `examples/open-site.open-project.json`: specification/npm ready; editor and website explicitly pending.

Matching manifests and hook adapters are prepared in the sibling working trees. Existing consumer workflows remain active until this repository has a published commit SHA. Nothing is published by running `check`, `build`, or the tests.
