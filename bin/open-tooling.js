#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { loadProject, productSummary, buildProject, verifyArtifacts, toolingVersion, publicationPlan, publishGitHub, publishRegistry } from '../src/index.js';

const help = `open-tooling ${toolingVersion}

Usage:
  open-tooling check [--project DIR] [--manifest FILE] [--complete] [--json]
  open-tooling build [--project DIR] [--manifest FILE] [--complete] [--tag TAG] [--json]
  open-tooling verify-artifacts --artifacts DIR [--commit SHA] [--tag TAG] [--repository OWNER/REPO] [--github-output] [--json]
  open-tooling publish github|npm|marketplace|openVSX|image --artifacts DIR --commit SHA --tag TAG --repository OWNER/REPO

Build output: dist/open-tooling/ (managed by this tool).
Publishing uses existing artifacts and never executes project hooks.
`;

function main(args) {
  if (args.length === 1 && args[0] === '--version') { console.log(toolingVersion); return; }
  if (!args.length || args[0] === '--help') { console.log(help); return; }
  const command = args.shift();
  const destination = command === 'publish' ? args.shift() : undefined;
  const flags = {};
  const boolean = new Set(['complete', 'json', 'github-output']);
  const valued = new Set(['project', 'manifest', 'tag', 'artifacts', 'commit', 'repository']);
  const allowed = {
    check: ['project', 'manifest', 'complete', 'json'],
    build: ['project', 'manifest', 'complete', 'json', 'tag'],
    'verify-artifacts': ['artifacts', 'commit', 'tag', 'repository', 'github-output', 'json'],
    publish: ['artifacts', 'commit', 'tag', 'repository'],
  }[command];
  if (!allowed) throw new Error(`Unknown command: ${command}`);
  while (args.length) {
    const option = args.shift();
    if (!option.startsWith('--')) throw new Error(`Expected an option: ${option}`);
    const key = option.slice(2);
    if (!allowed.includes(key) || Object.hasOwn(flags, key)) throw new Error(`Unknown or duplicate option: ${key}`);
    if (boolean.has(key)) flags[key] = true;
    else if (valued.has(key)) {
      if (!args[0] || args[0].startsWith('--')) throw new Error(`Missing value for --${key}`);
      flags[key] = args.shift();
    }
  }
  let result;
  if (command === 'check') result = productSummary(loadProject(flags.project, flags.manifest, flags));
  if (command === 'build') result = buildProject(flags.project, flags);
  if (command === 'verify-artifacts' || command === 'publish') {
    if (!flags.artifacts) throw new Error('--artifacts is required.');
    if (command === 'publish') {
      for (const key of ['commit', 'tag', 'repository']) if (!flags[key]) throw new Error(`Publishing requires --${key}.`);
      if (destination === 'github') publishGitHub(flags.artifacts, flags);
      else publishRegistry(flags.artifacts, destination, flags);
    }
    result = verifyArtifacts(flags.artifacts, flags);
    if (flags['github-output']) {
      if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set.');
      const plan = publicationPlan(result);
      appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${command}: ${result.project} ${result.version ?? result.versions.specification} — OK`);
    for (const omission of result.omissions ?? []) console.log(`  ${omission.product}: pending — ${omission.reason}`);
    if (result.directory) console.log(`  ${result.directory}`);
  }
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(`open-tooling: ${error.message}`); process.exitCode = 1; }
