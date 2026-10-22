# Open Tooling changelog

## 0.1.0 — Initial shared tooling

- Define the v1 open-project manifest and validate specification-family repository composition.
- Build and verify schema/npm/VSIX/website/source distributables with independent product versions.
- Record closed artifact inventories, source/tooling identity and SHA-256 checksums.
- Support Node 22/24/26 in the package metadata, verification and tag release workflows consuming the same saved products.
- Use Node 24 GitHub Actions runtimes and pin all jobs to Ubuntu 24.04.
- Publish GitHub release bundles and optionally npm, Marketplace, Open VSX and GHCR products.
- Prepare OpenENV/OpenSite pilot manifests, hook adapters and consumer workflow templates.
