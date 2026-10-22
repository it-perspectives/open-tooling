import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

export const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
export function change(root, path, update) {
  const value = JSON.parse(readFileSync(join(root, path), 'utf8'));
  update(value);
  write(root, path, value);
}

export function fixture({ full = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'open-tooling-fixture-'));
  const manifest = {
    openProject: 1, id: 'openfixture', title: 'Open Fixture', repository: 'it-perspectives/open-fixture',
    specification: { version: '1.2.3', key: 'openfixture', schema: 'schemas/openfixture-1.2.3.schema.json', examples: { json: 'examples/openfixture.json', yaml: 'examples/openfixture.yaml' }, invalidExamples: ['examples/invalid.json'] },
    source: ['.open-project.json', 'package.json', 'package-lock.json', 'README.md', 'SPEC.md', 'CHANGELOG.md', 'LICENSE', 'schemas', 'examples', 'src', 'bin', 'test', 'hooks.mjs'],
    checks: { verify: 'verify' },
    products: {
      npm: { name: '@open-tooling-test/fixture', verify: 'verify:npm' },
      vscode: { enabled: false, reason: 'Extension is planned for the next milestone.' },
      website: { enabled: false, reason: 'Website is planned for the next milestone.' },
    },
    publishing: {},
  };
  const schemaId = 'https://raw.githubusercontent.com/it-perspectives/open-fixture/specification-v1.2.3/schemas/openfixture-1.2.3.schema.json';
  write(root, manifest.specification.schema, {
    $schema: 'http://json-schema.org/draft-07/schema#', $id: schemaId, type: 'object', additionalProperties: false,
    required: ['openfixture', 'value'], properties: { openfixture: { const: '1.2.3' }, value: { type: 'string' }, $schema: { const: schemaId } },
  });
  write(root, manifest.specification.examples.json, { openfixture: '1.2.3', value: 'hello' });
  write(root, manifest.specification.examples.yaml, 'openfixture: "1.2.3"\nvalue: hello\n');
  write(root, 'examples/invalid.json', { openfixture: '1.2.3', value: 42 });
  write(root, 'README.md', '# Open Fixture\n');
  write(root, 'SPEC.md', '# Open Fixture specification\n');
  write(root, 'LICENSE', 'MIT\n');
  write(root, 'CHANGELOG.md', '# Changelog\n\n## 1.2.3 — Initial\n\nA working fixture.\n\n## 1.2.2\n\nPrevious version.\n');
  write(root, 'src/index.js', 'export const specificationVersion = "1.2.3";\n');
  write(root, 'test/contract.test.js', 'import assert from "node:assert/strict"; assert.ok(true);\n');
  write(root, 'bin/fixture.js', '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
  const pkg = {
    name: manifest.products.npm.name, version: '1.2.3', type: 'module', license: 'MIT',
    exports: { '.': './src/index.js', './schema': `./${manifest.specification.schema}` },
    bin: { fixture: 'bin/fixture.js' }, files: ['src', 'bin', 'schemas'],
    scripts: { verify: 'node hooks.mjs verify', 'verify:npm': 'node hooks.mjs npm' },
  };
  if (full) {
    manifest.products.vscode = { enabled: true, packageJson: 'extensions/vscode/package.json', build: 'vscode:build', verify: 'vscode:verify', vsix: 'dist/fixture.vsix', minimumVersion: '1.100.0' };
    manifest.products.website = {
      enabled: true, packageJson: 'website/package.json', build: 'website:build', verify: 'website:verify', directory: 'website/dist', routes: ['/', '/contract/'],
      assets: [manifest.specification.schema, ...Object.values(manifest.specification.examples)].map(source => ({ source, path: source.split('/').at(-1) })),
    };
    manifest.source.push('website', 'extensions');
    for (const command of ['vscode:build', 'vscode:verify', 'website:build', 'website:verify']) pkg.scripts[command] = `node hooks.mjs ${command}`;
    write(root, 'extensions/vscode/package.json', { publisher: 'fixture', name: 'openfixture', version: '2.3.4', engines: { vscode: '^1.100.0' }, main: './extension.cjs' });
    write(root, 'extensions/vscode/extension.cjs', 'exports.activate = () => {};\n');
    write(root, 'extensions/vscode/CHANGELOG.md', '# Changes\n\n## 2.3.4\n\nExtension changes.\n');
    write(root, 'website/package.json', { name: 'fixture-website', private: true, version: '3.4.5' });
    write(root, 'website/CHANGELOG.md', '# Changes\n\n## 3.4.5\n\nWebsite changes.\n');
  }
  write(root, '.open-project.json', manifest);
  write(root, 'package.json', pkg);
  write(root, 'package-lock.json', { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version, license: 'MIT', bin: pkg.bin } } });
  write(root, 'hooks.mjs', `
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const command = process.argv[2];
appendFileSync('trace.log', command + ':' + (process.env.OPEN_TOOLING_VSCODE_VERSION ?? '') + '\\n');
if (command === 'npm') assert.ok(existsSync(process.env.OPEN_TOOLING_NPM_TARBALL));
if (command === 'vscode:build') {
  mkdirSync('dist/vsix-input/extension', { recursive: true });
  copyFileSync('extensions/vscode/package.json', 'dist/vsix-input/extension/package.json');
  copyFileSync('extensions/vscode/extension.cjs', 'dist/vsix-input/extension/extension.cjs');
  rmSync('dist/fixture.vsix', { force: true });
  execFileSync('zip', ['-q', '-r', resolve('dist/fixture.vsix'), 'extension'], { cwd: 'dist/vsix-input' });
}
if (command === 'vscode:verify') {
  assert.ok(['1.100.0', 'stable'].includes(process.env.OPEN_TOOLING_VSCODE_VERSION));
  assert.ok(existsSync(process.env.OPEN_TOOLING_VSIX));
}
if (command === 'website:build') {
  mkdirSync('website/dist/contract', { recursive: true });
  for (const path of ['index.html', 'contract/index.html']) {
    const { writeFileSync } = await import('node:fs'); writeFileSync('website/dist/' + path, '<h1>Fixture</h1>');
  }
  for (const asset of JSON.parse(readFileSync('.open-project.json')).products.website.assets) copyFileSync(asset.source, 'website/dist/' + asset.path);
}
if (command === 'website:verify' && process.env.FIXTURE_STALE) {
  const { writeFileSync } = await import('node:fs'); writeFileSync('website/dist/openfixture-1.2.3.schema.json', '{}');
}
`);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Initial fixture'], { cwd: root });
  return root;
}
