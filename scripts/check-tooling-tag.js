import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { releaseNotes } from '../src/project.js';
const { version } = JSON.parse(readFileSync('package.json'));
assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'A tag event is required.');
assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'Tooling tag and package version disagree.');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/release-notes.md', releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version));
