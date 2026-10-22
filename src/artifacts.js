import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkInventory, filesIn, gitCommit, json, loadProject, projectPath, releaseNotes, releaseTarget, sourceFiles, sourceIsDirty, toolingVersion } from './project.js';

export const outputDirectory = 'dist/open-tooling';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function run(command, args, { cwd, env = {}, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? 'pipe' : ['ignore', 2, 2],
  });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`);
  return result.stdout;
}

function archive(cwd, destination, entries) {
  run('tar', ['-czf', destination, '--', ...entries], { cwd, env: { COPYFILE_DISABLE: '1' } });
  const names = run('tar', ['-tzf', destination], { capture: true });
  assert.ok(names.trim(), 'Archive is empty.');
  for (const name of names.trim().split('\n')) assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), `Unsafe archive entry: ${name}`);
}

function verifySite(project) {
  const settings = project.config.products.website;
  const directory = projectPath(project.root, settings.directory);
  assert.ok(filesIn(directory).length, 'Website output is empty.');
  for (const route of settings.routes) {
    const path = projectPath(project.root, `${settings.directory}/${route.slice(1)}index.html`);
    assert.ok(readFileSync(path, 'utf8').trim(), `Empty website route: ${route}`);
  }
  for (const asset of settings.assets) {
    assert.deepEqual(readFileSync(projectPath(project.root, `${settings.directory}/${asset.path}`)), readFileSync(projectPath(project.root, asset.source)), `Stale website asset: ${asset.path}`);
  }
  return directory;
}

function verifyVSIX(project, file) {
  const expected = json(projectPath(project.root, project.config.products.vscode.packageJson));
  const packaged = JSON.parse(run('unzip', ['-p', file, 'extension/package.json'], { capture: true }));
  for (const key of ['publisher', 'name', 'version', 'engines', 'main']) assert.deepEqual(packaged[key], expected[key], `VSIX ${key} disagrees with source.`);
  assert.ok(packaged.main && !packaged.main.split('/').includes('..'), 'VSIX needs a packaged extension entry point.');
  const entry = packaged.main.replace(/^\.\//, '');
  assert.ok(run('unzip', ['-p', file, `extension/${entry}`], { capture: true }).length, 'VSIX extension entry point is empty.');
}

function smokeNpm(project, tarball, directory) {
  const consumer = join(directory, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  run('npm', ['install', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', tarball], { cwd: consumer, env: { npm_config_cache: join(directory, 'consumer-cache'), npm_config_fetch_retries: '0', npm_config_fetch_timeout: '30000' } });
  writeFileSync(join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
const api = await import(${JSON.stringify(project.pkg.name)});
assert.ok(Object.keys(api).length, 'The installed package exports no API.');
const { default: schema } = await import(${JSON.stringify(`${project.pkg.name}/schema`)}, { with: { type: 'json' } });
assert.equal(schema.properties[${JSON.stringify(project.config.specification.key)}].const, ${JSON.stringify(project.versions.specification)});
`);
  run(process.execPath, ['check.mjs'], { cwd: consumer });
  const bins = typeof project.pkg.bin === 'string' ? { [project.pkg.name.split('/').at(-1)]: project.pkg.bin } : project.pkg.bin;
  assert.ok(bins && Object.keys(bins).length, 'npm package must provide a CLI.');
  for (const name of Object.keys(bins)) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/);
    assert.equal(run(join(consumer, 'node_modules', '.bin', name), ['--version'], { cwd: consumer, capture: true }).trim(), project.versions.npm, 'Installed CLI version disagrees.');
  }
}

export function buildProject(directory = '.', { manifest, complete = false, tag } = {}) {
  const project = loadProject(directory, manifest, { complete });
  const { root, config, versions } = project;
  const commit = gitCommit(root);
  const target = tag ? releaseTarget(project, tag) : { component: 'specification', version: versions.specification, tag: null };
  const notes = target.component === 'specification' ? project.notes : releaseNotes(readFileSync(projectPath(root, config.products[target.component].packageJson.replace(/package\.json$/, 'CHANGELOG.md')), 'utf8'), target.version);
  const staging = mkdtempSync(join(tmpdir(), 'open-tooling-build-'));
  const payload = join(staging, 'artifacts');
  mkdirSync(payload);
  const artifacts = [];
  const hook = (script, extra = {}) => run('npm', ['run', script], { cwd: root, env: { OPEN_TOOLING_OUTPUT: payload, ...extra } });
  const add = (file, kind, name = basename(file)) => {
    assert.match(name, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    assert.ok(!artifacts.some(a => a.path.toLowerCase() === name.toLowerCase()), `Duplicate artifact: ${name}`);
    const destination = join(payload, name);
    if (resolve(file) !== resolve(destination)) copyFileSync(file, destination);
    assert.ok(statSync(destination).size, `Empty artifact: ${name}`);
    artifacts.push({ path: name, kind, size: statSync(destination).size, sha256: sha256(readFileSync(destination)) });
  };
  let image;
  try {
    hook(config.checks.verify);
    const spec = config.specification;
    add(projectPath(root, spec.schema), 'schema', `${config.id}-${versions.specification}.schema.json`);
    add(projectPath(root, 'SPEC.md'), 'specification', `${config.id}-${versions.specification}-SPEC.md`);
    for (const [format, path] of Object.entries(spec.examples)) add(projectPath(root, path), 'example', `${config.id}-${versions.specification}.${format}`);
    add(projectPath(root, 'CHANGELOG.md'), 'changelog');

    const cache = join(staging, 'npm-cache');
    const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--cache', cache, '--pack-destination', payload], { cwd: root, capture: true }));
    const metadata = Array.isArray(packed) ? packed.find(p => p.name === project.pkg.name) : packed[project.pkg.name];
    assert.ok(metadata && metadata.version === versions.npm && basename(metadata.filename) === metadata.filename, 'Unexpected npm pack result.');
    const tarball = join(payload, metadata.filename);
    add(tarball, 'npm');
    smokeNpm(project, tarball, staging);
    hook(config.products.npm.verify, { OPEN_TOOLING_NPM_TARBALL: tarball });

    if (config.products.vscode.enabled) {
      const settings = config.products.vscode;
      hook(settings.build);
      const vsix = projectPath(root, settings.vsix);
      verifyVSIX(project, vsix);
      for (const version of [settings.minimumVersion, 'stable']) hook(settings.verify, { OPEN_TOOLING_VSCODE_VERSION: version, OPEN_TOOLING_VSIX: vsix });
      add(vsix, 'vscode', `${config.id}-${versions.vscode}.vsix`);
    }
    if (config.products.website.enabled) {
      const settings = config.products.website;
      hook(settings.build);
      hook(settings.verify);
      const site = verifySite(project);
      const name = `${config.id}-website-${versions.website}.tar.gz`;
      archive(site, join(payload, name), readdirNames(site));
      add(join(payload, name), 'website');
      if (settings.image) {
        const reference = `open-tooling-${config.id}:${commit}`;
        run('docker', ['build', '--platform', 'linux/amd64', '--file', settings.image.dockerfile, '--tag', reference, '.'], { cwd: root });
        hook(settings.image.verify, { OPEN_TOOLING_IMAGE: reference });
        const imageId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', reference], { capture: true }).trim();
        assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
        const imageArchive = `${config.id}-website-${versions.website}-linux-amd64.docker.tar`;
        run('docker', ['save', '--output', join(payload, imageArchive), reference]);
        add(join(payload, imageArchive), 'website-image');
        image = { reference, imageId, platform: 'linux/amd64' };
      }
    }
    // Include all configured sources; generated outputs and the runtime checkout are never inferred.
    const sourceName = `${config.id}-${target.component}-${target.version}-source.tar.gz`;
    const sources = sourceFiles(root, config.source);
    const list = join(staging, 'sources.list');
    writeFileSync(list, sources.map(path => `${path}\0`).join(''));
    run('tar', ['-czf', join(payload, sourceName), '--null', '-T', list], { cwd: root, env: { COPYFILE_DISABLE: '1' } });
    add(join(payload, sourceName), 'source');
    writeFileSync(join(payload, 'release-notes.md'), notes);
    add(join(payload, 'release-notes.md'), 'notes');
    // Hooks cannot silently rewrite product identity or the contract during a build.
    const after = loadProject(root, project.manifest, { complete });
    assert.deepEqual(after.config, config, 'Project manifest changed during build.');
    assert.deepEqual(after.versions, versions, 'Product versions changed during build.');
    assert.equal(gitCommit(root), commit, 'Git HEAD changed during build.');
    const inventory = {
      manifestVersion: 1, project: config.id, repository: config.repository, commit,
      sourceDirty: sourceIsDirty(root, config.source),
      tooling: { version: toolingVersion, commit: process.env.OPEN_TOOLING_COMMIT ?? null },
      ...target, versions, complete: !project.omissions.length, omissions: project.omissions,
      publishing: config.publishing ?? {}, npm: { name: project.pkg.name },
      ...(config.products.vscode.enabled ? { vscode: pickVSCode(project) } : {}),
      ...(image ? { image } : {}), artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    };
    writeFileSync(join(payload, 'release.json'), `${JSON.stringify(inventory, null, 2)}\n`);
    writeFileSync(join(payload, 'SHA256SUMS'), checksumFile(payload));
    verifyArtifacts(payload, { commit });
    const output = projectPath(root, outputDirectory, { exists: false });
    mkdirSync(join(root, 'dist'), { recursive: true });
    assert.ok(!lstatSync(join(root, 'dist')).isSymbolicLink(), 'dist/ cannot be a symlink.');
    if (existsSync(output)) {
      assert.ok(!lstatSync(output).isSymbolicLink() && json(join(output, 'release.json')).manifestVersion === 1, 'Refusing to replace an unmanaged output directory.');
      rmSync(output, { recursive: true });
    }
    // Staging can reside on another filesystem.
    mkdirSync(output);
    for (const path of filesIn(payload)) copyFileSync(path, join(output, basename(path)));
    return { ...inventory, directory: output };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function readdirNames(directory) {
  // Archive paths relative to the site, including hidden public files.
  return [...new Set(filesIn(directory).map(file => relative(directory, file).split('/')[0]))].sort();
}

function pickVSCode(project) {
  const { publisher, name, version } = json(projectPath(project.root, project.config.products.vscode.packageJson));
  return { publisher, name, version };
}

function checksumFile(directory) {
  return filesIn(directory).filter(path => basename(path) !== 'SHA256SUMS').map(path => `${sha256(readFileSync(path))}  ${basename(path)}\n`).sort().join('');
}

export function verifyArtifacts(directory, { commit, tag, repository } = {}) {
  const inventory = json(join(directory, 'release.json'));
  checkInventory(inventory);
  assert.equal(inventory.versions.npm, inventory.versions.specification, 'npm and specification versions disagree.');
  assert.equal(inventory.version, inventory.versions[inventory.component], 'Release component version disagrees.');
  if (inventory.tag !== null) assert.equal(inventory.tag, `${inventory.component === 'vscode' ? 'extension' : inventory.component}-v${inventory.version}`, 'Release component tag disagrees.');
  assert.equal(inventory.complete, Boolean(inventory.versions.vscode && inventory.versions.website), 'Completeness disagrees with product set.');
  assert.deepEqual(inventory.omissions.map(o => o.product).sort(), ['vscode', 'website'].filter(product => !inventory.versions[product]).sort(), 'Omissions disagree with product set.');
  assert.equal(inventory.manifestVersion, 1, 'Unknown release inventory version.');
  assert.match(inventory.commit, /^[a-f0-9]{40,64}$/);
  assert.match(inventory.project, /^[a-z][a-z0-9-]*$/);
  assert.match(inventory.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.ok(['specification', 'vscode', 'website'].includes(inventory.component), 'Invalid release component.');
  if (commit) assert.equal(inventory.commit, commit, 'Artifacts belong to a different commit.');
  if (tag) assert.equal(inventory.tag, tag, 'Artifacts belong to a different tag.');
  if (repository) assert.equal(inventory.repository.toLowerCase(), repository.toLowerCase(), 'Artifacts belong to a different repository.');
  assert.ok(Array.isArray(inventory.artifacts) && inventory.artifacts.length, 'Empty inventory.');
  const names = new Set(['release.json', 'sha256sums']);
  const kinds = new Set();
  for (const artifact of inventory.artifacts) {
    assert.match(artifact.path, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
    assert.ok(!names.has(artifact.path.toLowerCase()), `Duplicate inventory path: ${artifact.path}`);
    names.add(artifact.path.toLowerCase());
    assert.ok(['schema', 'specification', 'example', 'changelog', 'npm', 'vscode', 'website', 'website-image', 'source', 'notes'].includes(artifact.kind), 'Invalid artifact kind.');
    kinds.add(artifact.kind);
    const bytes = readFileSync(join(directory, artifact.path));
    assert.equal(bytes.length, artifact.size, `Wrong size: ${artifact.path}`);
    assert.equal(sha256(bytes), artifact.sha256, `Checksum mismatch: ${artifact.path}`);
  }
  for (const kind of ['schema', 'specification', 'example', 'changelog', 'npm', 'source', 'notes']) assert.ok(kinds.has(kind), `Missing ${kind} artifact.`);
  for (const kind of ['schema', 'specification', 'changelog', 'npm', 'source', 'notes', ...(inventory.versions.vscode ? ['vscode'] : []), ...(inventory.versions.website ? ['website'] : []), ...(inventory.image ? ['website-image'] : [])]) assert.equal(inventory.artifacts.filter(a => a.kind === kind).length, 1, `Expected exactly one ${kind} artifact.`);
  assert.equal(inventory.artifacts.filter(a => a.kind === 'example').length, 2, 'Expected JSON and YAML reference examples.');
  if (inventory.versions.vscode) assert.ok(kinds.has('vscode'), 'Missing VSIX.');
  else assert.ok(!kinds.has('vscode') && !inventory.vscode, 'Unexpected VSIX for a disabled product.');
  if (inventory.versions.website) assert.ok(kinds.has('website'), 'Missing website archive.');
  else assert.ok(!kinds.has('website'), 'Unexpected website archive for a disabled product.');
  if (inventory.image) assert.ok(kinds.has('website-image'), 'Missing website image.');
  else assert.ok(!kinds.has('website-image'), 'Unexpected website image.');
  const actual = filesIn(directory).map(path => relative(directory, path)).sort();
  assert.deepEqual(actual, [...inventory.artifacts.map(a => a.path), 'release.json', 'SHA256SUMS'].sort(), 'Unexpected or missing release files.');
  assert.equal(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), checksumFile(directory), 'SHA256SUMS disagrees with release payload.');
  const npmFile = inventory.artifacts.find(a => a.kind === 'npm').path;
  const metadata = JSON.parse(run('tar', ['-xOzf', join(directory, npmFile), 'package/package.json'], { capture: true }));
  assert.equal(metadata.name, inventory.npm.name, 'npm tarball identity disagrees with inventory.');
  assert.equal(metadata.version, inventory.versions.npm, 'npm tarball version disagrees with inventory.');
  if (inventory.vscode) {
    assert.equal(inventory.vscode.version, inventory.versions.vscode);
    const vsix = inventory.artifacts.find(a => a.kind === 'vscode').path;
    const packaged = JSON.parse(run('unzip', ['-p', join(directory, vsix), 'extension/package.json'], { capture: true }));
    for (const key of ['publisher', 'name', 'version']) assert.equal(packaged[key], inventory.vscode[key], `VSIX ${key} disagrees with inventory.`);
  }
  return inventory;
}
