import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, sep, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument } from 'yaml';

export const toolingVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
export const projectSchema = JSON.parse(readFileSync(new URL('../schemas/open-project.schema.json', import.meta.url)));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(projectSchema);
const validateInventory = ajv.compile(json(new URL('../schemas/release.schema.json', import.meta.url)));
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function checkInventory(value) {
  assert.ok(validateInventory(value), `Invalid release inventory: ${ajv.errorsText(validateInventory.errors, { separator: '\n' })}`);
}

// Every configured path stays in the project, including through symlinks.
export function projectPath(root, path, { exists = true } = {}) {
  assert.equal(typeof path, 'string', 'A project-relative path is required.');
  assert.match(path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, `Invalid path: ${path}`);
  assert.ok(!path.split('/').some(p => ['.', '..', '.git', 'node_modules', '.npmrc'].includes(p) || p === '.env' || p.startsWith('.env.')), `Forbidden path: ${path}`);
  const result = resolve(root, path);
  const inside = target => { const rel = relative(realpathSync(root), target); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
  if (exists) assert.ok(inside(realpathSync(result)), `Path escapes project: ${path}`);
  return result;
}

export function filesIn(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!lstatSync(path).isSymbolicLink(), `Symlinks are not distributable: ${path}`);
    if (entry.isDirectory()) files.push(...filesIn(path));
    else { assert.ok(entry.isFile(), `Not a regular file: ${path}`); files.push(path); }
  }
  return files.sort();
}

export function sourceFiles(root, paths) {
  const found = new Set();
  const visit = path => {
    const name = path.split('/').at(-1);
    if (['dist', 'node_modules', '.git', '.astro', '.vscode-test'].includes(name) || name === '.env' || name.startsWith('.env.')) return;
    const absolute = projectPath(root, path);
    assert.ok(!lstatSync(absolute).isSymbolicLink(), `Source symlink is not supported: ${path}`);
    if (statSync(absolute).isDirectory()) for (const entry of readdirSync(absolute)) visit(`${path}/${entry}`);
    else found.add(path);
  };
  for (const path of paths) visit(path);
  return [...found].sort();
}

function example(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return JSON.parse(text);
  const document = parseDocument(text, { version: '1.2', uniqueKeys: true, merge: false });
  assert.equal(document.errors.length, 0, document.errors.map(e => e.message).join('; '));
  assert.equal(document.warnings.length, 0, document.warnings.map(e => e.message).join('; '));
  return document.toJS({ maxAliasCount: 0 });
}

export function releaseNotes(text, version) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headings = lines.flatMap((line, i) => /^##\s+/.test(line) ? [i] : []);
  const matches = headings.filter(i => new RegExp(`^## (?:\\[)?${version.replaceAll('.', '\\.')}\\]?(?:\\s|$)`).test(lines[i]));
  assert.equal(matches.length, 1, `CHANGELOG.md must contain exactly one ## ${version} entry.`);
  const start = matches[0];
  const body = lines.slice(start + 1, headings.find(i => i > start) ?? lines.length).join('\n').trim();
  assert.ok(body && !/^<!--[^]*-->$/.test(body), `Release notes for ${version} are empty.`);
  assert.ok(!/unreleased/i.test(lines[start]), `Version ${version} is still marked Unreleased.`);
  return `${body}\n`;
}

export function loadProject(directory = '.', manifest = '.open-project.json', { complete = false } = {}) {
  const root = realpathSync(directory);
  const config = json(projectPath(root, manifest));
  assert.ok(validate(config), `Invalid project manifest:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
  for (const path of [config.specification.schema, ...Object.values(config.specification.examples), ...(config.specification.invalidExamples ?? [])]) projectPath(root, path);
  const pkg = json(projectPath(root, 'package.json'));
  const lock = json(projectPath(root, 'package-lock.json'));
  assert.equal(pkg.name, config.products.npm.name, 'npm package name disagrees with manifest.');
  assert.equal(pkg.version, config.specification.version, 'npm and specification versions must match.');
  assert.ok(pkg.private !== true, 'The distributable root npm package must be public.');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock.json root version disagrees.');
  assert.equal(lock.packages?.['']?.name, pkg.name, 'package-lock.json root name disagrees.');
  for (const path of ['README.md', 'SPEC.md', 'CHANGELOG.md', 'LICENSE', 'src', 'test']) projectPath(root, path);
  assert.ok(readdirSync(projectPath(root, 'src')).length, 'src/ must not be empty.');
  assert.ok(filesIn(projectPath(root, 'test')).length, 'test/ must not be empty.');
  for (const path of config.source) {
    const absolute = projectPath(root, path);
    assert.ok(!path.split('/').includes('dist'), `Generated dist cannot be a source: ${path}`);
    if (!statSync(absolute).isDirectory()) assert.ok(statSync(absolute).isFile(), `Not a source file: ${path}`);
  }
  sourceFiles(root, config.source);
  for (const required of [manifest, 'package.json', 'package-lock.json', 'README.md', 'SPEC.md', 'CHANGELOG.md', 'LICENSE', 'src', 'test', config.specification.schema, ...Object.values(config.specification.examples)]) {
    assert.ok(config.source.some(path => required === path || required.startsWith(`${path}/`)), `Source archive must include ${required}.`);
  }
  const scripts = [config.checks.verify, config.products.npm.verify];
  const versions = { specification: pkg.version, npm: pkg.version };
  const omissions = [];
  for (const product of ['vscode', 'website']) {
    const settings = config.products[product];
    if (!settings.enabled) {
      omissions.push({ product, reason: settings.reason });
      assert.ok(!complete, `Full product set required: ${product} is disabled (${settings.reason}).`);
      continue;
    }
    const metadata = json(projectPath(root, settings.packageJson));
    assert.match(metadata.version, versionPattern, `Invalid ${product} version.`);
    versions[product] = metadata.version;
    scripts.push(settings.build, settings.verify);
    if (product === 'vscode') {
      assert.match(metadata.publisher ?? '', /^[a-zA-Z0-9][a-zA-Z0-9-]*$/, 'A VS Code publisher is required.');
      assert.match(metadata.name ?? '', /^[a-zA-Z0-9][a-zA-Z0-9-]*$/, 'A VS Code extension name is required.');
      assert.equal(metadata.engines?.vscode, `^${settings.minimumVersion}`, 'VS Code engines must declare the tested minimum version.');
      projectPath(root, settings.vsix, { exists: false });
    } else {
      projectPath(root, settings.directory, { exists: false });
      for (const asset of settings.assets) {
        projectPath(root, asset.source);
        projectPath(root, `${settings.directory}/${asset.path}`, { exists: false });
      }
      for (const source of [config.specification.schema, ...Object.values(config.specification.examples)]) {
        assert.ok(settings.assets.some(asset => asset.source === source), `Website must distribute ${source}.`);
      }
      if (settings.image) { projectPath(root, settings.image.dockerfile); scripts.push(settings.image.verify); }
    }
  }
  for (const script of scripts) assert.ok(typeof pkg.scripts?.[script] === 'string' && pkg.scripts[script].trim(), `Missing npm script: ${script}`);
  const publishing = config.publishing ?? {};
  if (publishing.marketplace || publishing.openVSX) assert.ok(config.products.vscode.enabled, 'Cannot publish a disabled extension.');
  if (publishing.image) assert.ok(config.products.website.enabled && config.products.website.image, 'Cannot publish an unconfigured website image.');
  const spec = config.specification;
  const schema = json(projectPath(root, spec.schema));
  const schemaTag = spec.legacySchemaTag ?? `specification-v${spec.version}`;
  if (spec.legacySchemaTag) assert.equal(schemaTag, `v${spec.version}`, 'Historical schema tag must match specification version.');
  assert.equal(schema.$id, `https://raw.githubusercontent.com/${config.repository}/${schemaTag}/${spec.schema}`, 'Schema $id must use the immutable specification tag.');
  assert.equal(schema.properties?.[spec.key]?.const, spec.version, 'Schema format version disagrees.');
  assert.equal(schema.properties?.$schema?.const, schema.$id, 'Document $schema must match the immutable schema $id.');
  const SchemaValidator = schema.$schema === 'https://json-schema.org/draft/2020-12/schema' ? Ajv2020 : Ajv;
  const validator = new SchemaValidator({ allErrors: true, strict: false });
  addFormats(validator);
  const check = validator.compile(schema);
  const positive = Object.values(spec.examples).map(path => example(projectPath(root, path)));
  for (const document of positive) assert.ok(check(document), `Invalid positive example: ${validator.errorsText(check.errors)}`);
  assert.deepEqual(positive[0], positive[1], 'JSON and YAML reference examples must describe the same document.');
  for (const path of spec.invalidExamples ?? []) assert.ok(!check(example(projectPath(root, path))), `Negative example unexpectedly passed: ${path}`);
  const notes = releaseNotes(readFileSync(projectPath(root, 'CHANGELOG.md'), 'utf8'), spec.version);
  return { root, config, pkg, schema, versions, omissions, notes, manifest };
}

export function gitCommit(root) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.match(commit, /^[a-f0-9]{40,64}$/);
  return commit;
}

export function sourceIsDirty(root, sources) {
  return Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourceFiles(root, sources)], { cwd: root, encoding: 'utf8' }).trim());
}

export function releaseTarget(project, tag) {
  const match = /^(specification|extension|website)-v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  assert.ok(match && versionPattern.test(match[2]), 'Expected specification-vX.Y.Z, extension-vX.Y.Z or website-vX.Y.Z.');
  const product = { specification: 'specification', extension: 'vscode', website: 'website' }[match[1]];
  assert.equal(project.versions[product], match[2], `Tag ${tag} disagrees with ${product} version.`);
  return { component: product, version: match[2], tag };
}

export function productSummary(project) {
  return { project: project.config.id, versions: project.versions, complete: !project.omissions.length, omissions: project.omissions };
}
