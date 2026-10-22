import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildProject, publishGitHub, publishRegistry } from '../src/index.js';
import { fixture, change } from './fixture.js';

test('publication consumes saved bytes; GitHub resumes drafts and npm checks existing integrity', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  change(root, '.open-project.json', c => { c.publishing.npm = true; });
  execFileSync('git', ['add', '.open-project.json'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Enable publication'], { cwd: root });
  const built = buildProject(root, { tag: 'specification-v1.2.3' });
  const expected = { tag: built.tag, commit: built.commit, repository: built.repository };
  const mocks = join(root, 'mocks');
  const remote = join(root, 'remote');
  mkdirSync(mocks);
  const oldPath = process.env.PATH;
  process.env.PATH = `${mocks}:${oldPath}`;
  process.env.MOCK_REMOTE = remote;
  t.after(() => {
    process.env.PATH = oldPath;
    for (const key of ['MOCK_REMOTE', 'MOCK_FAIL_UPLOAD', 'MOCK_NPM_MODE', 'MOCK_NPM_INTEGRITY']) delete process.env[key];
  });
  writeFileSync(join(mocks, 'gh'), `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
const args = process.argv.slice(2);
const command = args[1];
const root = process.env.MOCK_REMOTE;
const state = root + '.json';
const value = key => args[args.indexOf(key) + 1];
function fail(text) { console.error(text); process.exit(1); }
if (command === 'view') {
  if (!existsSync(state)) fail('HTTP 404: release not found');
  console.log(JSON.stringify({ ...JSON.parse(readFileSync(state)), assets: readdirSync(root).map(name => ({ name })) }));
} else if (command === 'create') {
  if (!args.includes('--draft') || !args.includes('--verify-tag')) fail('draft and verify-tag are required');
  mkdirSync(root); writeFileSync(state, JSON.stringify({ isDraft: true }));
} else if (command === 'upload') {
  if (process.env.MOCK_FAIL_UPLOAD && readdirSync(root).length === 2) fail('simulated connection failure');
  copyFileSync(args[3], join(root, basename(args[3])));
} else if (command === 'download') {
  const directory = value('--dir'); mkdirSync(directory, { recursive: true });
  const names = args.includes('--pattern') ? [value('--pattern')] : readdirSync(root);
  for (const name of names) copyFileSync(join(root, name), join(directory, name));
} else if (command === 'edit') writeFileSync(state, JSON.stringify({ isDraft: false }));
else fail('unknown gh operation');
`, { mode: 0o755 });
  process.env.MOCK_FAIL_UPLOAD = '1';
  assert.throws(() => publishGitHub(built.directory, expected), /simulated connection failure/);
  assert.equal(JSON.parse(readFileSync(`${remote}.json`)).isDraft, true);
  delete process.env.MOCK_FAIL_UPLOAD;
  publishGitHub(built.directory, expected);
  assert.equal(JSON.parse(readFileSync(`${remote}.json`)).isDraft, false);
  publishGitHub(built.directory, expected);
  writeFileSync(join(remote, 'release-notes.md'), 'conflicting remote bytes');
  assert.throws(() => publishGitHub(built.directory, expected), /Existing release asset differs/);

  writeFileSync(join(mocks, 'npm'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'view') {
  if (process.env.MOCK_NPM_MODE === 'missing') { console.error('npm ERR! code E404'); process.exit(1); }
  if (process.env.MOCK_NPM_MODE === 'auth') { console.error('npm ERR! code E401'); process.exit(1); }
  console.log(JSON.stringify(process.env.MOCK_NPM_INTEGRITY));
} else if (args[0] === 'publish') writeFileSync(process.env.MOCK_REMOTE + '.npm', JSON.stringify(args));
else process.exit(2);
`, { mode: 0o755 });
  const tarball = join(built.directory, built.artifacts.find(a => a.kind === 'npm').path);
  process.env.MOCK_NPM_INTEGRITY = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  publishRegistry(built.directory, 'npm', expected);
  assert.ok(!existsSync(`${remote}.npm`));
  process.env.MOCK_NPM_INTEGRITY = 'sha512-different';
  assert.throws(() => publishRegistry(built.directory, 'npm', expected), /different bytes/);
  process.env.MOCK_NPM_MODE = 'auth';
  assert.throws(() => publishRegistry(built.directory, 'npm', expected), /Cannot check npm publication/);
  process.env.MOCK_NPM_MODE = 'missing';
  publishRegistry(built.directory, 'npm', expected);
  const published = JSON.parse(readFileSync(`${remote}.npm`));
  assert.equal(published[1], tarball);
  assert.ok(published.includes('--provenance'));
  assert.throws(() => publishRegistry(built.directory, 'marketplace', expected), /not enabled/);
  assert.throws(() => publishRegistry(built.directory, 'npm', { ...expected, tag: 'specification-v9.9.9' }), /different tag/);
});
