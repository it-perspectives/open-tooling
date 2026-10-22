# Project contract v1

The normative shape is [open-project.schema.json](../schemas/open-project.schema.json). The manifest is JSON and is stored at `.open-project.json`. Paths are relative to the consumer repository. Only local files are loaded; symlink escapes, parent traversal, `.git`, credentials files and dependency directories are rejected. Schema `$ref` resolution is local to the supplied schema; the builder does not fetch remote schemas.

## Required repository contents

`README.md`, `SPEC.md`, `CHANGELOG.md`, `LICENSE`, `package.json`, `package-lock.json`, nonempty `src/` and `test/`, a versioned schema and equivalent JSON/YAML examples. Root npm package name and version must match the manifest; the lockfile must match. `source` explicitly lists the files/directories needed to rebuild, including the manifest, tests, scripts, workflows and enabled products. Nested `node_modules`, `dist`, `.git`, `.astro`, `.vscode-test` and `.env*` are excluded from source archives. Other source symlinks are rejected.

The specification schema declares `properties[specification.key].const` and `properties.$schema.const`. Its `$id` is:

```text
https://raw.githubusercontent.com/OWNER/REPO/specification-vX.Y.Z/PATH
```

`legacySchemaTag: "vX.Y.Z"` explicitly preserves an already published historical URL such as OpenENV 0.1.0. It is not a way to point at a branch or another version.

`specification.invalidExamples` contains optional negative JSON/YAML fixtures. Their syntax must be valid, but schema validation must fail. Semantic constraints beyond JSON Schema belong in the project verifier and its tests. The tooling checks that required hooks exist and executes them; it cannot prove that a project's custom tests cover every promised behavior.

## npm hooks

Hook values are names from the root `package.json` scripts, not arbitrary shell fragments in the manifest. They execute with the consumer as the working directory. npm lifecycle scripts are disabled during dependency installation and tarball creation. Required lifecycle work must be explicit in a hook.

| Field | Responsibility | Additional environment |
| --- | --- | --- |
| `checks.verify` | Domain tests, types, lint and cross-section consistency | `OPEN_TOOLING_OUTPUT` |
| `products.npm.verify` | Project-specific checks against the installed/packed API | `OPEN_TOOLING_NPM_TARBALL` |
| `products.vscode.build` | Build/package a fresh VSIX at `vsix` | `OPEN_TOOLING_OUTPUT` |
| `products.vscode.verify` | Install/test the given VSIX in a real extension host | `OPEN_TOOLING_VSIX`, `OPEN_TOOLING_VSCODE_VERSION` |
| `products.website.build` | Recreate the static site at `directory` | `OPEN_TOOLING_OUTPUT` |
| `products.website.verify` | Types, rendered content and project-specific checks | `OPEN_TOOLING_OUTPUT` |
| `products.website.image.verify` | Start/check/stop the supplied container | `OPEN_TOOLING_IMAGE` |

The host verifier runs twice: `minimumVersion` and `stable`. `engines.vscode` must be `^minimumVersion`. Hooks must fail on errors, generate fresh outputs and avoid changing source/version metadata. `build` is executable project code; use it in the verification job with read permissions. The publishing job consumes only the saved artifact directory.

For npm, common verification installs the real tarball in a temporary project, imports the root API and `/schema`, and checks every provided CLI with `--version`. ESM packages with a JSON `/schema` export and a CLI are the v1 family interface. A consumer can use additional dependencies and workspaces; keep all package identities synchronized in its lockfile.

## Website and extension contents

Each enabled product has its own `packageJson` and stable `X.Y.Z` version. The static website declares `/` and every required trailing-slash route; each must contain a nonempty `index.html`. `assets` must distribute the current schema and both reference examples and must match their source bytes. Project hooks cover richer browser behavior. A Dockerfile is optional; configured images are built for `linux/amd64`, smoke-tested, and exported with `docker save`. `imageId` is the local image/config digest, not a registry manifest digest.

The common VSIX check reads the actual ZIP manifest and packaged entry point. Publisher, name, version, engines and entry point must agree with source. Actual validation/completion/preview behavior is tested by the host hook.

## Output and inventory

The dedicated `dist/open-tooling/` directory contains only inventoried files, `release.json` and `SHA256SUMS`. It is intentionally flat so the same files can be downloaded directly from GitHub Releases. Artifact names contain project and product versions; `kind` provides the common classification independent of filenames.

`release.json` records contract version, project/repository, source commit and `sourceDirty`, tooling version and optional pinned tooling commit, component/tag, product versions, omissions, publication settings, npm/extension identity, optional Docker image identity, and each artifact's path/kind/size/SHA-256. Local builds may include uncommitted sources; publication rejects these artifacts. `SHA256SUMS` covers every payload file and `release.json`; it excludes itself. The JSON inventory does not recursively hash itself.

Checksums detect corruption and accidental composition drift. They are not signatures. In CI, artifact provenance also depends on downloading from the same workflow run and matching the expected source commit, tag and repository.

The builder rejects duplicate artifact names, unexpected files, empty payloads, bad checksums and incomplete inventories. A failed verification/build does not replace an existing managed output. Repeated successful builds replace that dedicated directory; other `dist/` files are preserved. Dependencies must be installed before running the builder.
