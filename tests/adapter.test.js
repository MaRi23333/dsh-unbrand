import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, Config } from '../index.js';

function activate(llm) {
  let dispose;
  apply({llm, effect(setup) { dispose = setup(); }, inject() {}}, Config({models:['selected']}));
  return dispose;
}

test('a compatible host can supply optional adapter arguments without losing them', () => {
  const marker = {};
  class Host {
    forAdapter(request, adapter, future = null) {
      assert.strictEqual(this, host);
      assert.strictEqual(adapter, marker);
      assert.strictEqual(future, marker);
      return request;
    }
  }
  const host = new Host();
  const close = activate(host);
  try {
    const unchanged = {model:'selected', messages:[]};
    assert.strictEqual(host.forAdapter(unchanged, marker, marker), unchanged);
  } finally { close(); }
  assert.equal(Object.hasOwn(host, 'forAdapter'), false);
});

test('missing, incompatible, or already-owned host interfaces are left intact', () => {
  class Changed { forAdapter(options) { return options; } }
  for (const llm of [{}, new Changed(), {forAdapter(options, adapter) { return adapter ?? options; }}]) {
    const original = Object.getOwnPropertyDescriptor(llm, 'forAdapter');
    assert.throws(() => activate(llm), /Unsupported or already customized/);
    assert.deepEqual(Object.getOwnPropertyDescriptor(llm,'forAdapter'), original);
  }
});
