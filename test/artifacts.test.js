import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProject, verifyArtifacts, publicationPlan } from '../src/index.js';
import { fixture, change } from './fixture.js';

const cli = fileURLToPath(new URL('../bin/open-tooling.js', import.meta.url));
test('builds real npm, source, VSIX and website archives, then detects corruption', t => {
  const root = fixture({ full: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const built = buildProject(root, { complete: true, tag: 'specification-v1.2.3' });
  assert.equal(built.complete, true);
  assert.equal(built.sourceDirty, false);
  const inventory = verifyArtifacts(built.directory, { commit: built.commit, tag: built.tag, repository: 'IT-Perspectives/open-fixture' });
  for (const kind of ['schema', 'npm', 'source', 'vscode', 'website', 'notes']) assert.ok(inventory.artifacts.some(a => a.kind === kind));
  assert.equal(readFileSync(join(built.directory, 'release-notes.md'), 'utf8'), 'A working fixture.\n');
  const trace = readFileSync(join(root, 'trace.log'), 'utf8');
  assert.match(trace, /vscode:verify:1\.100\.0/);
  assert.match(trace, /vscode:verify:stable/);
  const source = inventory.artifacts.find(a => a.kind === 'source');
  const members = execFileSync('tar', ['-tzf', join(built.directory, source.path)], { encoding: 'utf8' }).split('\n');
  assert.ok(members.includes('.open-project.json'));
  assert.ok(!members.some(p => p.includes('/dist/') || p.includes('node_modules') || p.includes('.git/')));
  const archive = inventory.artifacts.find(a => a.kind === 'website');
  assert.match(execFileSync('tar', ['-tzf', join(built.directory, archive.path)], { encoding: 'utf8' }), /contract\/index\.html/);
  assert.equal(spawnSync(process.execPath, [cli, 'verify-artifacts', '--artifacts', built.directory, '--commit', built.commit, '--json'], { encoding: 'utf8' }).status, 0);
  assert.throws(() => verifyArtifacts(built.directory, { commit: 'f'.repeat(40) }), /different commit/);
  assert.throws(() => verifyArtifacts(built.directory, { tag: 'specification-v9.9.9' }), /different tag/);
  assert.throws(() => verifyArtifacts(built.directory, { repository: 'other/repo' }), /different repository/);
  writeFileSync(join(built.directory, 'extra.txt'), 'stale');
  assert.throws(() => verifyArtifacts(built.directory), /Unexpected or missing/);
  rmSync(join(built.directory, 'extra.txt'));
  const schema = inventory.artifacts.find(a => a.kind === 'schema');
  const bytes = readFileSync(join(built.directory, schema.path));
  writeFileSync(join(built.directory, schema.path), Buffer.alloc(bytes.length, 'x'));
  assert.throws(() => verifyArtifacts(built.directory), /Checksum mismatch/);
  writeFileSync(join(built.directory, schema.path), bytes);
  writeFileSync(join(built.directory, 'SHA256SUMS'), 'wrong\n');
  assert.throws(() => verifyArtifacts(built.directory), /SHA256SUMS/);
});

test('a failed build preserves previous output; partial projects cannot pass --complete', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = spawnSync(process.execPath, [cli, 'build', '--project', root, '--json'], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  const built = JSON.parse(command.stdout);
  assert.equal(built.complete, false);
  assert.equal(built.sourceDirty, false);
  const before = readFileSync(join(built.directory, 'release.json'));
  assert.throws(() => buildProject(root, { complete: true }), /Full product set/);
  change(root, 'package.json', p => { p.scripts.verify = 'node -e "process.exit(23)"'; });
  assert.throws(() => buildProject(root), /failed/);
  assert.deepEqual(readFileSync(join(built.directory, 'release.json')), before);
});

test('rejects stale website assets after build hooks', t => {
  const root = fixture({ full: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  process.env.FIXTURE_STALE = '1';
  try { assert.throws(() => buildProject(root), /Stale website asset/); }
  finally { delete process.env.FIXTURE_STALE; }
  assert.ok(!existsSync(join(root, 'dist/open-tooling')));
});

test('registry plan follows component tags and explicit publication opt-in', () => {
  const base = { publishing: { npm: true, marketplace: true, openVSX: true, image: 'ghcr.io/test/fixture' } };
  assert.deepEqual(publicationPlan({ ...base, component: 'specification' }), { npm: true, marketplace: false, openVSX: false, image: false });
  assert.deepEqual(publicationPlan({ ...base, component: 'vscode' }), { npm: false, marketplace: true, openVSX: true, image: false });
  assert.deepEqual(publicationPlan({ ...base, component: 'website' }), { npm: false, marketplace: false, openVSX: false, image: true });
});

test('CLI rejects unknown commands, malformed flags and unsafe publication', () => {
  for (const args of [['nope'], ['check', '--manifest'], ['check', '--typo'], ['check', '--json', '--json'], ['publish', 'github'], ['publish', 'npm', '--artifacts', '/tmp']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /open-tooling:/);
  }
  assert.match(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }), /^0\.1\.0\n$/);
});
