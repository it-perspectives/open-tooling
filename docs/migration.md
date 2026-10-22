# Pilot migration

The sibling working trees contain `.open-project.json` and minimal environment adapters for their existing npm smoke tests. OpenENV's host runner reads `OPEN_TOOLING_VSCODE_VERSION` before its legacy variable; its container smoke test can read `OPEN_TOOLING_IMAGE`. Existing commands still work unchanged without these variables.

## OpenENV

```sh
node ../open-tooling/bin/open-tooling.js check --complete
node ../open-tooling/bin/open-tooling.js build --complete
```

The manifest uses specification/npm 0.1.0, extension 0.2.0 and website 0.1.0. Its historical schema URL is explicitly retained. The full build starts real VS Code host tests and Docker, so run it in a suitable environment; a composition check alone does not demonstrate host/container acceptance.

The manifest enables container building but leaves all registry publishing disabled. Enable each destination only after its trusted publisher or package permissions are configured. Website versions have a separate `website/CHANGELOG.md`.

## OpenSite

```sh
node ../open-tooling/bin/open-tooling.js check
node ../open-tooling/bin/open-tooling.js build
```

The manifest uses specification/npm 0.1.0 and explicitly declares the missing editor and website. `check --complete` must fail until those products exist. In a temporary migration caller, set `require-complete: false` for both verification and release; remove that exception once the two products are implemented.

## Switch workflows after publication

1. Publish a reviewed commit of open-tooling. The shared workflows use this checkout directly and do not require npm publication.
2. Replace both tooling placeholders in the [CI](../templates/project/.github/workflows/ci.yml) and [release](../templates/project/.github/workflows/release.yml) templates with that commit SHA.
3. Replace the consumer's corresponding workflows; remove obsolete duplicate specification/extension/website release triggers so a tag has only one publisher. Keep unrelated checks and align the existing local deploy scripts with the component tag conventions.
4. Run a real pull-request pipeline and inspect `open-products/release.json`. Compare outputs and checks with the old pipeline before enabling registry destinations.
5. Release a new component version and verify the GitHub assets and requested registries. Do not reuse an already published historical tag.

The current working-tree changes intentionally stop before step 1: no commit/push, tag, registry publication, or consumer workflow switch has been performed.

## Starting another open-* project

Use `templates/project/.open-project.json` as a composition checklist. Replace the example project identity, versions, file paths and hook names; implement the domain contract/API/CLI/tests, editor host tests and website checks. Disabled products need an explicit migration reason and cannot pass the default full CI.

The template is a scaffold, not a replacement for the shared implementation. Updates to common behavior live in open-tooling and reach consumers by changing the pinned SHA, without copying scripts into every repository.
