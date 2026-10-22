import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadProject, releaseTarget, releaseNotes } from '../src/index.js';
import { fixture, change, write } from './fixture.js';

function using(t, options) { const root = fixture(options); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test('specification-only projects explicitly report missing products', t => {
  const project = loadProject(using(t));
  assert.deepEqual(project.versions, { specification: '1.2.3', npm: '1.2.3' });
  assert.equal(project.omissions.length, 2);
  assert.throws(() => loadProject(project.root, undefined, { complete: true }), /Full product set/);
});
test('full projects retain independent product versions', t => {
  const project = loadProject(using(t, { full: true }), undefined, { complete: true });
  assert.deepEqual(project.versions, { specification: '1.2.3', npm: '1.2.3', vscode: '2.3.4', website: '3.4.5' });
  for (const tag of ['specification-v1.2.3', 'extension-v2.3.4', 'website-v3.4.5']) assert.equal(releaseTarget(project, tag).tag, tag);
  for (const tag of ['v1.2.3', 'extension-v1.2.3', 'specification-v01.2.3', 'website-v0.0.1', 'specification-v1.2.3-beta.1']) assert.throws(() => releaseTarget(project, tag));
});
const invalid = [
  ['unknown fields', c => { c.unknown = true; }, /Invalid project manifest/],
  ['traversal', c => { c.specification.schema = '../schema.json'; }, /Forbidden path/],
  ['fake missing products', c => { c.products.vscode = { enabled: false }; }, /Invalid project manifest/],
  ['missing test hook', c => { c.checks.verify = 'does:not:exist'; }, /Missing npm script/],
  ['missing npm smoke hook', c => { c.products.npm.verify = 'missing'; }, /Missing npm script/],
  ['incomplete source archive', c => { c.source = ['src']; }, /Source archive must include/],
  ['disabled extension publication', c => { c.publishing.marketplace = true; }, /disabled extension/],
  ['missing image publication', c => { c.publishing.image = 'ghcr.io/fixture/site'; }, /unconfigured website image/],
  ['wrong historical schema version', c => { c.specification.legacySchemaTag = 'v0.0.1'; }, /Historical schema tag/],
];
for (const [name, mutation, error] of invalid) test(`rejects ${name}`, t => {
  const root = using(t); change(root, '.open-project.json', mutation); assert.throws(() => loadProject(root), error);
});
test('rejects inconsistent lockfile, metadata, schemas and examples', t => {
  const root = using(t);
  change(root, 'package-lock.json', p => { p.packages[''].version = '9.9.9'; });
  assert.throws(() => loadProject(root), /lock.json root version/);
  change(root, 'package-lock.json', p => { p.packages[''].version = '1.2.3'; });
  change(root, 'schemas/openfixture-1.2.3.schema.json', p => { p.$id = 'https://example.invalid/main/schema.json'; });
  assert.throws(() => loadProject(root), /immutable specification tag/);
});
test('rejects positive JSON/YAML drift and accidentally valid negative examples', t => {
  const root = using(t);
  write(root, 'examples/openfixture.yaml', 'openfixture: "1.2.3"\nvalue: changed\n');
  assert.throws(() => loadProject(root), /same document/);
  write(root, 'examples/openfixture.yaml', 'openfixture: "1.2.3"\nvalue: hello\n');
  write(root, 'examples/invalid.json', { openfixture: '1.2.3', value: 'valid' });
  assert.throws(() => loadProject(root), /Negative example unexpectedly passed/);
});
test('rejects duplicate YAML keys and aliases', t => {
  const root = using(t);
  for (const yaml of ['openfixture: "1.2.3"\nvalue: hello\nvalue: other\n', 'openfixture: "1.2.3"\nvalue: &v hello\nother: *v\n']) {
    write(root, 'examples/openfixture.yaml', yaml); assert.throws(() => loadProject(root));
  }
});
test('rejects symlinks escaping the project', t => {
  const root = using(t);
  symlinkSync('/tmp', join(root, 'outside'));
  change(root, '.open-project.json', c => c.source.push('outside'));
  assert.throws(() => loadProject(root), /escapes project/);
});
test('checks exact changelog entry and excludes surrounding versions', () => {
  assert.equal(releaseNotes('# Changes\r\n\r\n## 1.2.3 — release\r\n\r\nHello.\r\n\r\n## 1.2.2\r\nOld.', '1.2.3'), 'Hello.\n');
  for (const text of ['## 1.2.30\nOther.', '## 1.2.3 Unreleased\nSoon.', '## 1.2.3\n', '## 1.2.3\nA.\n## 1.2.3\nB.']) assert.throws(() => releaseNotes(text, '1.2.3'));
});
