import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlueprint, presets, MAX_BLUEPRINT_BYTES} from '../blueprint.mjs';

const parse = value => parseBlueprint(JSON.stringify(value));
test('all bundled scenarios validate and preserve Unicode', () => {
  for (const value of Object.values(presets)) assert.equal(parse(value).title, value.title);
});
test('rejects unsupported steps, fields and credential injection', () => {
  assert.throws(() => parse({...presets.blank, steps: [{step: 'runJS', code: 'process.exit()'}]}), /不支持/);
  assert.throws(() => parse({...presets.blank, steps: [{step: 'setSiteOptions', options: {jwt_secret: 'bad'}}]}), /尚不支持/);
  assert.throws(() => parse({...presets.blank, version: 2}), /版本/);
});
test('rejects redirect escapes and unsafe article slugs', () => {
  for (const landingPage of ['//example.org', '/\\example.org', '/%2fexample.org', 'https://example.org']) {
    assert.throws(() => parse({...presets.blank, landingPage}), /站内路径/);
  }
  const post = presets.writing.steps[1];
  assert.throws(() => parse({...presets.blank, steps: [{...post, pathname: '../admin'}]}), /pathname/);
});
test('rejects duplicate paths before starting a runtime', () => {
  const post = presets.writing.steps[1];
  assert.throws(() => parse({...presets.blank, steps: [post, post]}), /重复/);
});
test('enforces import limits and fails malformed JSON with a useful message', () => {
  assert.throws(() => parseBlueprint('x'.repeat(MAX_BLUEPRINT_BYTES + 1)), /256 KiB/);
  assert.throws(() => parseBlueprint('{'), /JSON 格式/);
  assert.throws(() => parse({...presets.blank, login: 'yes'}), /布尔值/);
});
