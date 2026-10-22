import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const directory = mkdtempSync(join(tmpdir(), 'open-tooling-package-'));
try {
  const options = { cwd: directory, encoding: 'utf8', env: { ...process.env, npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000' } };
  const packed = JSON.parse(execFileSync('npm', ['pack', root, '--ignore-scripts', '--json', '--pack-destination', directory], options));
  const file = Array.isArray(packed) ? packed[0].filename : packed['@it-perspectives/open-tooling'].filename;
  writeFileSync(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, file)], options);
  writeFileSync(join(directory, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { toolingVersion, loadProject, buildProject, verifyArtifacts } from '@it-perspectives/open-tooling';
import schema from '@it-perspectives/open-tooling/schema' with { type: 'json' };
assert.equal(toolingVersion, ${JSON.stringify(version)});
assert.equal(schema.properties.openProject.const, 1);
for (const fn of [loadProject, buildProject, verifyArtifacts]) assert.equal(typeof fn, 'function');
`);
  execFileSync(process.execPath, ['consumer.mjs'], options);
  for (const path of ['schemas/release.schema.json', 'templates/project/.github/workflows/ci.yml', 'templates/project/.github/workflows/release.yml', 'templates/project/.open-project.json', 'examples/open-env.open-project.json', 'docs/project-contract.md']) {
    assert.ok(existsSync(join(directory, 'node_modules/@it-perspectives/open-tooling', path)), `Missing packaged support file: ${path}`);
  }
  assert.equal(execFileSync(join(directory, 'node_modules/.bin/open-tooling'), ['--version'], options).trim(), version);
  console.log('Installed tarball: API, schema export and CLI passed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
