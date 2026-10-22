# New open-* repository scaffold

Replace the identity/version/path values in `.open-project.json`, implement the required npm hooks, and add the required domain files. See [the project contract](../../docs/project-contract.md) and [migration guide](../../docs/migration.md).

The full product set is the default. Until an extension or website is implemented, use `{ "enabled": false, "reason": "Specific migration reason." }` and a temporary `require-complete: false` caller setting. A successful partial build is explicitly marked incomplete.

For the workflows, replace every `TOOLING_COMMIT_SHA` with one real published full SHA. The repository's own CI verifies the rendered templates with a synthetic SHA; the checked-in placeholders are deliberate and cannot be used as a live dependency.
