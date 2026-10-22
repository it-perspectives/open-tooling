import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { filesIn } from './project.js';
import { run, sha256, verifyArtifacts } from './artifacts.js';

export function publicationPlan(inventory) {
  const settings = inventory.publishing;
  return {
    npm: inventory.component === 'specification' && settings.npm === true,
    marketplace: inventory.component === 'vscode' && settings.marketplace === true,
    openVSX: inventory.component === 'vscode' && settings.openVSX === true,
    image: inventory.component === 'website' && Boolean(settings.image),
  };
}

function payload(inventory, directory, kind) {
  const matches = inventory.artifacts.filter(a => a.kind === kind);
  assert.equal(matches.length, 1, `Expected one ${kind} artifact.`);
  return resolve(directory, matches[0].path);
}

export function publishRegistry(directory, destination, expected) {
  const inventory = verifyArtifacts(directory, expected);
  assert.equal(inventory.sourceDirty, false, 'Cannot publish artifacts built from uncommitted source changes.');
  assert.ok(publicationPlan(inventory)[destination], `Publication to ${destination} is not enabled for this release.`);
  if (destination === 'npm') {
    const tarball = payload(inventory, directory, 'npm');
    const identity = `${inventory.npm.name}@${inventory.versions.npm}`;
    const result = spawnSync('npm', ['view', identity, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org/'], { encoding: 'utf8' });
    if (result.status === 0) {
      const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
      assert.equal(JSON.parse(result.stdout), integrity, `Published ${identity} has different bytes.`);
      return;
    }
    assert.ok(/E404/.test(result.stderr ?? ''), `Cannot check npm publication: ${result.stderr ?? result.error}`);
    run('npm', ['publish', tarball, '--ignore-scripts', '--access', 'public', '--provenance', '--registry=https://registry.npmjs.org/']);
  } else if (destination === 'marketplace') {
    run('vsce', ['publish', '--packagePath', payload(inventory, directory, 'vscode'), '--oidc']);
  } else if (destination === 'openVSX') {
    run('ovsx', ['publish', payload(inventory, directory, 'vscode'), '--trusted-publishing']);
  } else if (destination === 'image') {
    const reference = `${inventory.publishing.image}:${inventory.versions.website}`;
    assert.match(reference, /^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*:\d+\.\d+\.\d+$/);
    run('docker', ['load', '--input', payload(inventory, directory, 'website-image')]);
    const actualId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', inventory.image.reference], { capture: true }).trim();
    assert.equal(actualId, inventory.image.imageId, 'Loaded Docker image disagrees with inventory.');
    // A version tag must never replace a different image.
    const remote = spawnSync('docker', ['manifest', 'inspect', reference], { encoding: 'utf8' });
    if (remote.status === 0) {
      assert.equal(JSON.parse(remote.stdout).config?.digest, actualId, `Image tag ${reference} already points to different bytes.`);
      return;
    }
    assert.ok(/manifest unknown|no such manifest|not found/i.test(remote.stderr ?? ''), `Cannot check registry image: ${remote.stderr ?? remote.error}`);
    run('docker', ['tag', inventory.image.reference, reference]);
    run('docker', ['push', reference]);
  } else throw new Error(`Unknown registry: ${destination}`);
}

// Draft first, then upload and verify every byte before exposing the GitHub release.
// A retry can finish a partial draft; an existing public release must match exactly.
export function publishGitHub(directory, expected) {
  const inventory = verifyArtifacts(directory, expected);
  assert.equal(inventory.sourceDirty, false, 'Cannot publish artifacts built from uncommitted source changes.');
  assert.ok(inventory.tag, 'A tag build is required for publication.');
  const repository = inventory.repository;
  const tag = inventory.tag;
  const gh = args => run('gh', [...args, '--repo', repository], { capture: true });
  const viewed = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,tagName,assets'], { encoding: 'utf8' });
  let release;
  if (viewed.status === 0) release = JSON.parse(viewed.stdout);
  else {
    assert.ok(/release not found|HTTP 404/i.test(viewed.stderr ?? ''), `Cannot inspect GitHub release: ${viewed.stderr ?? viewed.error}`);
    gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', `${inventory.project} ${inventory.component} ${inventory.version}`, '--notes-file', resolve(directory, 'release-notes.md')]);
    release = { isDraft: true, assets: [] };
  }
  const temporary = mkdtempSync(join(tmpdir(), 'open-tooling-download-'));
  try {
    const local = filesIn(directory).map(path => basename(path));
    for (const asset of release.assets) {
      assert.ok(local.includes(asset.name), `Unexpected existing release asset: ${asset.name}`);
      gh(['release', 'download', tag, '--pattern', asset.name, '--dir', temporary]);
      assert.equal(sha256(readFileSync(join(temporary, asset.name))), sha256(readFileSync(join(directory, asset.name))), `Existing release asset differs: ${asset.name}`);
    }
    if (!release.isDraft) {
      verifyArtifacts(temporary, expected);
      return;
    }
    const missing = local.filter(name => !existsSync(join(temporary, name)));
    // Upload separately so a partial upload is recoverable without overwriting assets.
    for (const name of missing) gh(['release', 'upload', tag, resolve(directory, name)]);
    gh(['release', 'download', tag, '--dir', temporary, '--clobber']);
    verifyArtifacts(temporary, expected);
    gh(['release', 'edit', tag, '--draft=false']);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
