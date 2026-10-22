import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { projectSchema } from '../src/index.js';
import { parse } from 'yaml';

const workflow = name => parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
test('consumer workflow templates render to matching immutable workflow/tooling pins', () => {
  const sha = 'a'.repeat(40);
  for (const name of ['ci', 'release']) {
    const text = readFileSync(new URL(`../templates/project/.github/workflows/${name}.yml`, import.meta.url), 'utf8').replaceAll('TOOLING_COMMIT_SHA', sha);
    const value = parse(text);
    const job = Object.values(value.jobs)[0];
    assert.ok(job.uses.endsWith(`@${sha}`));
    assert.equal(job.with['tooling-ref'], sha);
    assert.equal(job.with['require-complete'], true);
  }
});
test('pilot manifests and scaffold validate against the public project schema', () => {
  const validate = new Ajv({ strict: false }).compile(projectSchema);
  for (const file of ['examples/open-env.open-project.json', 'examples/open-site.open-project.json', 'templates/project/.open-project.json']) {
    assert.ok(validate(JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url)))), `${file}: ${JSON.stringify(validate.errors)}`);
  }
});
test('shared verification gates the saved Node 24 artifact behind all builds', () => {
  const value = workflow('verify');
  assert.ok(value.on.workflow_call);
  assert.equal(value.on.workflow_call.inputs['require-complete'].default, true);
  for (const job of [value.jobs.verify, workflow('ci').jobs.test, workflow('publish-tooling').jobs.test]) {
    assert.deepEqual(job.strategy.matrix.node, [22, 24, 26]);
  }
  assert.equal(value.permissions.contents, 'read');
  const upload = value.jobs.verify.steps.find(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.if, 'matrix.node == 24');
  assert.equal(upload.with.path, 'dist/open-tooling/');
});
test('release only publishes downloaded, identity-checked assets after every verification job', () => {
  const value = workflow('release');
  assert.equal(value.jobs.verify.uses, './.github/workflows/verify.yml');
  assert.equal(value.jobs.plan.needs, 'verify');
  assert.equal(value.jobs.registries.needs, 'plan');
  assert.deepEqual(value.jobs.github.needs, ['plan', 'registries']);
  assert.match(value.jobs.github.if, /needs\.plan\.result == 'success'/);
  for (const job of [value.jobs.plan, value.jobs.registries, value.jobs.github]) {
    assert.ok(job.steps.some(s => s.uses?.startsWith('actions/download-artifact@')));
    assert.ok(!job.steps.some(s => /open-tooling\.js build/.test(s.run ?? '')));
    assert.ok(job.steps.some(s => /--commit.*--tag.*--repository/.test(s.run ?? '')));
  }
  assert.equal(value.jobs.registries.permissions['id-token'], 'write');
  assert.equal(value.jobs.github.permissions.contents, 'write');
  assert.equal(value.concurrency['cancel-in-progress'], false);
});
