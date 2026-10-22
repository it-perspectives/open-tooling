# Releases and publication

## Consumer releases

All releases pass the shared Node 22/24 verification workflow. Only the Node 24 artifact is uploaded, and downstream jobs depend on the entire matrix. There is no rebuild in a publishing job.

| Tag | Version/notes source | Optional registry publication |
| --- | --- | --- |
| `specification-vX.Y.Z` | Root package and `CHANGELOG.md` | npm |
| `extension-vX.Y.Z` | Extension package and sibling `CHANGELOG.md` | Marketplace and/or Open VSX |
| `website-vX.Y.Z` | Website package and sibling `CHANGELOG.md` | GHCR image |

Every tag creates a GitHub release containing the full configured product bundle. A tag must match its component metadata exactly. Notes are extracted from exactly one `## X.Y.Z` heading; missing, empty, duplicate or Unreleased entries fail. Version changes and tags are prepared in the consumer repository. The tooling does not make commits, bump versions, push tags or deploy hosting infrastructure.

The caller grants `contents: write`, `id-token: write` and `packages: write` to the release workflow as shown in the template. Verification jobs retain read-only contents permissions. Registry jobs run only for explicitly configured destinations, and the GitHub release is finalized only after all requested registry jobs succeed.

```json
{
  "publishing": {
    "npm": true,
    "marketplace": true,
    "openVSX": true,
    "image": "ghcr.io/it-perspectives/opensomething-website"
  }
}
```

Omit fields or set booleans to false to keep registry publication off. The saved inventory carries the publication plan; publishing does not reread a mutable consumer branch.

## Registry prerequisites

- npm: configure the package's trusted publisher for the **calling consumer workflow**, following [npm's reusable-workflow/OIDC requirements](https://docs.npmjs.com/trusted-publishers/). The job uses Node 24/npm with `npm publish TARBALL --provenance`; no long-lived npm token is passed. Existing versions are accepted only if their `dist.integrity` matches the tarball.
- Marketplace: configure trusted publishing for the publisher/workflow, then enable `marketplace`. The shared job uses pinned `@vscode/vsce@4.0.0` and publishes the exact VSIX with `--oidc`.
- Open VSX: configure trusted publishing for the namespace/workflow, then enable `openVSX`. The job uses pinned `ovsx@1.2.0` with `--trusted-publishing`.
- GHCR: grant the caller repository package write access. The job authenticates using its GitHub token, loads the tested Docker tar, verifies the image ID, and publishes `REGISTRY:WEBSITE_VERSION`. An existing different image at that version is rejected.

Service-side identity setup and a real successful publication are separate from local verification. First-time npm package/publisher creation may need a bootstrap publication according to the registry's account rules. Static site hosting is an infrastructure concern; the tooling provides the static archive and optionally the tested image.

## Retry behavior

GitHub publication creates a draft, uploads missing assets, downloads them and verifies the entire inventory before making the release public. Retrying a partial draft does not overwrite existing assets; conflicting bytes fail. An existing public release is accepted only when all files match. npm and GHCR also check existing version contents.

Marketplace/Open VSX publishing currently delegates duplicate-version behavior to their pinned CLIs. If one registry succeeds and another fails, rerun only the failed matrix job; do not rebuild or bump the already published version. Automatic resume of an already published extension destination is not implemented in v1.

## Releasing open-tooling itself

The reusable workflows are distributed by Git commit; npm publication is optional. Prepare the root package/lockfile and changelog version, run `npm run verify` and `node scripts/smoke-package.js`, commit/push, then push `vX.Y.Z` for this repository. Its own `publish-tooling.yml` verifies the tag and packages the CLI. GitHub Releases receives that tarball. npm publication additionally requires trusted publishing and the repository variable `OPEN_TOOLING_PUBLISH_NPM=true`.

After the commit is available on GitHub, use its full SHA in both the consumer `uses: ...@SHA` and `tooling-ref: SHA`. Update those pins together through normal review. A major CLI/manifest change is introduced as a new tooling version/contract; consumers keep working on their existing pins.

GitHub's permission and call semantics are documented in [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) and [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
