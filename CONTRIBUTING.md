# Contributing

Supported Node versions are 22, 24 and 26. Install with `npm ci --ignore-scripts`, run `npm run verify`, and check the installed tarball with `node scripts/smoke-package.js` on each supported major. If installed, run `actionlint .github/workflows/*.yml` after workflow changes.

Keep the manifest schema, runtime validation, CLI help and docs in agreement. Test artifact behavior using real archives and isolated npm consumers; negative cases must cover composition drift, wrong identity, corrupt or extra files and failed hooks. Publishing tests use fake service CLIs and must never publish to a real registry.

Changes to a shared workflow affect consumers when they update their pinned SHA. Preserve contract compatibility within v1, and document intentional changes. Keep domain-specific logic in consumer hooks. Do not replace required checks with existence-only tests or mark disabled products complete.
