// Run with: node tests/models.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync('shared.js', 'utf8').replaceAll('export ', ''), context);
vm.runInContext(fs.readFileSync('background.js', 'utf8').slice(fs.readFileSync('background.js', 'utf8').indexOf('function prepareRequestBody(')), context);
const prepare = context.prepareRequestBody;
const config = { apiBaseUrl: 'https://api.openai.com/v1', reasoningEffort: 'high' };
const params = { messages: [{ role: 'user', content: 'Hello' }], temperature: 0.7, max_tokens: 1000, stream: true };
for (const model of ['gpt-6', 'gpt-6.1', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.2-pro']) {
  const body = prepare(model, params, config);
  assert.equal(body.model, model);
  assert.equal(body.max_completion_tokens, 1000);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.stream, true);
  assert.equal('max_tokens' in body, false);
  assert.equal('temperature' in body, false);
  assert.equal(prepare(model, params, { ...config, reasoningEffort: 'none' }).reasoning_effort, undefined);
}
assert.equal(prepare('gpt-6.1-sol', params, { ...config, reasoningEffort: 'minimal' }).reasoning_effort, 'low');
assert.equal(prepare('gpt-4.1', params, config).temperature, 0.7);
assert.equal(prepare('gpt-4.1', params, config).max_tokens, 1000);
assert.equal(prepare('gpt-4.1', params, config).reasoning_effort, undefined);
assert.equal(params.temperature, 0.7);

const utils = vm.createContext({ URL });
vm.runInContext(fs.readFileSync('utils.js', 'utf8'), utils);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.migrateLegacyApiConfig({}))),
  JSON.parse(JSON.stringify(utils.migrateLegacyApiConfig({})))
);
for (const model of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol']) {
  assert.ok(context.migrateLegacyApiConfig({}).models.includes(model));
}
console.log('Model compatibility checks passed');
