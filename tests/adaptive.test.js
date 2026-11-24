import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemplateCatalog } from '../adaptive.js';
import { apply } from '../index.js';

const section = (text, name = 'harness:identity', extra = {}) => ({ name, text, ...extra });
const assembly = sections => ({ sections, contexts: [], tools: [], variables: {} });
const observe = (catalog, sections) => catalog.observe(undefined, {}, async () => assembly(sections));

// Same around-middleware dispatch as Cordis: arguments remain fixed and each
// listener returns the next listener's authoritative result.
function waterfall(listeners, initial, context, terminal = async () => initial) {
  const callbacks = [...listeners];
  const next = () => (callbacks.shift() ?? terminal)(initial, context, next);
  return next();
}

test('observer preserves the authoritative assembly and upstream/downstream waterfall values', async () => {
  const catalog = createTemplateCatalog(), context = { scope: 'a' };
  const initial = assembly([section('initial')]);
  const final = Object.freeze(assembly(Object.freeze([Object.freeze(section('resolved'))])));
  const calls = [];
  const result = await waterfall([
    async (input, current, next) => {
      assert.strictEqual(input, initial); assert.strictEqual(current, context);
      calls.push('before');
      const value = await next();
      assert.strictEqual(value, final); calls.push('after'); return value;
    },
    catalog.observe,
    async (input, current, next) => {
      assert.strictEqual(input, initial); assert.strictEqual(current, context);
      calls.push('downstream');
      assert.strictEqual(await next(), initial);
      return final;
    },
  ], initial, context);
  assert.strictEqual(result, final);
  assert.deepEqual(calls, ['before', 'downstream', 'after']);
  assert.deepEqual(catalog.snapshot(), ['resolved']);
  assert.deepEqual(initial.sections, [section('initial')]);
  assert.ok(Object.isFrozen(catalog.snapshot()));
});

test('concurrent assemblies retain each exact variant instead of replacing the latest template', async () => {
  const catalog = createTemplateCatalog();
  let finishA;
  const pending = catalog.observe(null, { scope: 'a' }, () => new Promise(resolve => { finishA = resolve; }));
  const b = assembly([section('scope b')]);
  assert.strictEqual(await catalog.observe(null, { scope: 'b' }, async () => b), b);
  finishA(assembly([section('scope a')]));
  await pending;
  await observe(catalog, [section('scope b'), section('scope a', 'harness:source')]);
  assert.deepEqual(catalog.snapshot(), ['scope b', 'scope a']);
});

test('only named resolved sections enter the catalog; interpolated templates and providers do not', async () => {
  const catalog = createTemplateCatalog();
  let invoked = false;
  const result = assembly([
    section('identity'), section('source', 'harness:source'), section('web', 'app:web-surface'),
    section('custom', 'deployment:persona-prefix'), section('tool', 'tools:write'),
    section(() => { invoked = true; return 'provider'; }),
    section('dynamic {{value}}'), section('multiline {{\nvalue\n}}', 'harness:source'),
    section('literal {{value}}', 'app:web-surface', { interpolate: false }),
    section(''), section(null), null,
  ]);
  result.contexts.push(section('context text'));
  assert.strictEqual(await catalog.observe(null, {}, async () => result), result);
  assert.equal(invoked, false);
  assert.deepEqual(catalog.snapshot(), ['identity', 'source', 'web', 'literal {{value}}']);
  await catalog.observe(null, {}, async () => ({ sections: 'unknown' }));
  assert.equal(catalog.snapshot().length, 4);
});

test('count and UTF-8 byte budgets stop additions without evicting old exact templates', async () => {
  const count = createTemplateCatalog();
  await observe(count, Array.from({ length: 129 }, (_, n) => section(`template ${n}`)));
  const stable = count.snapshot();
  assert.equal(stable.length, 128);
  await observe(count, [section('template 128'), section('template 0')]);
  assert.strictEqual(count.snapshot(), stable);

  const bytes = createTemplateCatalog();
  const text = '界'.repeat(Math.floor((256 * 1024) / 3));
  await observe(bytes, [section(text), section('abc')]);
  assert.deepEqual(bytes.snapshot(), [text]);
  await observe(bytes, [section(text)]);
  assert.equal(bytes.snapshot().length, 1);
});

test('disposal releases candidates and pending observations cannot repopulate them', async () => {
  const catalog = createTemplateCatalog();
  await observe(catalog, [section('old')]);
  let finish;
  const pending = catalog.observe(null, {}, () => new Promise(resolve => { finish = resolve; }));
  catalog.dispose();
  const late = assembly([section('late')]); finish(late);
  assert.strictEqual(await pending, late);
  await observe(catalog, [section('later')]);
  assert.deepEqual(catalog.snapshot(), []);
});

function activate({ available = true } = {}) {
  const effects = [], listeners = [];
  let enabled = true, models = ['selected'];
  class Host { forAdapter(request, adapter) { assert.equal(adapter, 'adapter'); return request; } }
  const host = new Host();
  const ctx = {
    llm: host,
    effect: setup => effects.push(setup()),
    inject(names, callback) {
      if (names[0] === 'systemPrompt' && available) {
        callback({ on(event, handler) {
          assert.equal(event, 'system-prompt/assemble'); listeners.push(handler);
        } });
      }
    },
  };
  apply(ctx, { enabled: { get: () => enabled }, models: { get: () => models } });
  return {
    host, listeners,
    enabled: value => { enabled = value; }, models: value => { models = value; },
    async assemble(value) { return waterfall(listeners, value, {}); },
    close() { for (const dispose of effects.reverse()) dispose(); listeners.length = 0; },
  };
}
function request(text, model = 'selected', provider = 'provider') {
  return { model, provider, messages: [{ role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] }] };
}

test('adapter uses observed candidates while retaining live enabled/model route settings', async () => {
  const runtime = activate();
  const stock = 'This next-version DeepSeek Harness identity is assembled by the host.';
  const input = request(stock);
  assert.strictEqual(runtime.host.forAdapter(input, 'adapter'), input);
  const value = assembly([section(stock)]);
  assert.strictEqual(await runtime.assemble(value), value);
  const presented = runtime.host.forAdapter(input, 'adapter');
  assert.notEqual(presented, input);
  assert.ok(!presented.messages[0].content[0].text.includes('DeepSeek Harness'));
  assert.equal(input.messages[0].content[0].text, stock);
  assert.deepEqual(runtime.host.forAdapter(input, 'adapter'), presented);
  runtime.enabled(false);
  assert.strictEqual(runtime.host.forAdapter(input, 'adapter'), input);
  runtime.enabled(true); runtime.models(['other::selected']);
  assert.strictEqual(runtime.host.forAdapter(input, 'adapter'), input);
  runtime.models(['provider::selected']);
  assert.deepEqual(runtime.host.forAdapter(input, 'adapter'), presented);
  const unmatched = request(stock, 'other');
  assert.strictEqual(runtime.host.forAdapter(unmatched, 'adapter'), unmatched);
  const intercepted = runtime.host.forAdapter;
  runtime.close();
  assert.equal(Object.hasOwn(runtime.host, 'forAdapter'), false);
  assert.strictEqual(intercepted.call(runtime.host, input, 'adapter'), input);
});

test('missing optional systemPrompt and unobserved text retain existing known-rule behavior', () => {
  const runtime = activate({ available: false });
  const stock = request('You are an AI agent powered by DeepSeek Harness.');
  assert.equal(runtime.host.forAdapter(stock, 'adapter').messages[0].content[0].text, 'You are an AI assistant.');
  const unknown = request('Future DeepSeek Harness identity.');
  assert.strictEqual(runtime.host.forAdapter(unknown, 'adapter'), unknown);
  assert.deepEqual(runtime.listeners, []);
  runtime.close();
});
