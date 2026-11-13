import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const catalog = {
  ok: true,
  value: {
    groups: [
      { id: 'provider-a', name: 'Alpha Provider', models: [{ id: 'shared/id', name: 'Shared Display' }, { id: 'unique-a', name: 'Only Alpha' }] },
      { id: 'provider-b', name: 'Beta Provider', models: [{ id: 'shared/id', name: 'Other Display' }] },
    ],
    failures: [],
  },
};

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

function hookRuntime() {
  let active;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useId: () => 'picker-test',
    useState(initial) {
      const owner = active;
      const index = owner.index++;
      if (!(index in owner.hooks)) owner.hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [owner.hooks[index], (value) => { owner.hooks[index] = typeof value === 'function' ? value(owner.hooks[index]) : value; }];
    },
    useEffect(effect, dependencies) {
      const owner = active;
      const index = owner.index++;
      const previous = owner.hooks[index];
      if (previous && dependencies?.every((value, at) => Object.is(value, previous.dependencies[at]))) return;
      owner.effects.push(() => {
        previous?.cleanup?.();
        owner.hooks[index] = { dependencies, cleanup: effect() };
      });
    },
    useCallback: (callback) => callback,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  return {
    React,
    renderer(component) {
      const owner = { hooks: [], effects: [], index: 0 };
      return {
        render(props) {
          owner.index = 0;
          active = owner;
          const tree = component(props);
          active = undefined;
          for (const run of owner.effects.splice(0)) run();
          return tree;
        },
        unmount() { for (const hook of owner.hooks) hook?.cleanup?.(); },
      };
    },
  };
}

async function pickerHarness(initial = [], loadCatalog = async () => catalog) {
  const runtime = hookRuntime();
  let entry;
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (value) => { entry = value; } } },
  });
  const plugin = entry.factory((name) => {
    assert.equal(name, 'react');
    return runtime.React;
  });
  const sections = [];
  const form = {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'ready', writable: true, revision: 2, value: { enabled: true, models: initial } }),
  };
  plugin.apply({
    effect: (effect) => effect(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, setup) => setup(),
      register: (options, component) => { if (options.name === 'settings.section') sections.push(component); return () => {}; },
    },
    configForms: { get: () => form, whileServed: (_names, setup) => setup() },
  });
  assert.equal(sections.length, 1, 'the real bundle registers one dedicated settings section');
  const section = runtime.renderer(sections[0]);
  const tree = section.render({ form, loadCatalog, t: (key) => key });
  const picker = nodes(tree, (node) => node.type?.name === 'ModelRules')[0];
  assert.ok(picker, 'the registered settings section mounts the real ModelRules component');
  const renderer = runtime.renderer(picker.type);
  const changes = [];
  let selected = [...initial];
  const props = { ...picker.props, loadCatalog, disabled: false, t: (key) => key,
    onChange(value) { selected = [...value]; changes.push(selected); } };
  return {
    changes,
    selected: () => selected,
    render: (patch = {}) => renderer.render({ ...props, models: selected, ...patch }),
    unmount: () => renderer.unmount(),
  };
}

const settle = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
const inputs = (tree, type) => nodes(tree, (node) => node.type === 'input' && (!type || node.props.type === type));
const buttons = (tree, label) => nodes(tree, (node) => node.type === 'button' && node.props.children.includes(label));
const textIncludes = (tree, value) => nodes(tree, (node) => node.props?.children?.some((child) => typeof child === 'string' && child.includes(value))).length > 0;

test('configured models search by provider, display name, and ID; selections remain provider-scoped', async () => {
  const ui = await pickerHarness();
  let tree = ui.render();
  await settle();
  tree = ui.render();
  assert.equal(inputs(tree, 'checkbox').length, 3);
  assert.equal(nodes(tree, node => node.type === 'details')[0].props.open, undefined, 'manual syntax stays secondary when the catalog is available');
  inputs(tree, 'checkbox')[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(ui.selected(), ['provider-a::shared/id']);
  tree = ui.render();
  assert.equal(inputs(tree, 'checkbox')[2].props.checked, false, 'the same model ID at another provider remains unselected');
  const selectedRow = nodes(tree, node => node.props['data-expression'] === 'provider-a::shared/id')[0];
  assert.ok(textIncludes(selectedRow, 'Shared Display'));
  assert.ok(textIncludes(selectedRow, 'Alpha Provider'), 'the selected model also identifies its provider');
  assert.ok(textIncludes(selectedRow, 'provider-a::shared/id'), 'the exact saved expression remains inspectable');
  for (const [query, count] of [['beta', 1], ['Only Alpha', 1], ['shared/id', 2], ['unknown', 0]]) {
    inputs(tree, 'search')[0].props.onChange({ target: { value: query } });
    tree = ui.render();
    assert.equal(inputs(tree, 'checkbox').length, count, query);
  }
  inputs(tree, 'search')[0].props.onChange({ target: { value: '' } });
  tree = ui.render();
  inputs(tree, 'checkbox')[0].props.onChange({ target: { checked: false } });
  assert.deepEqual(ui.selected(), []);
  ui.unmount();
});

test('bare-ID rules cover every matching route and remain removable alongside missing catalog entries', async () => {
  const ui = await pickerHarness(['shared/id', 'removed-provider::old-model']);
  ui.render();
  await settle();
  let tree = ui.render();
  const checkboxes = inputs(tree, 'checkbox');
  for (const index of [0, 2]) {
    assert.equal(checkboxes[index].props.checked, true);
    assert.equal(checkboxes[index].props.disabled, true);
  }
  assert.ok(textIncludes(tree, 'coveredRule'));
  assert.ok(textIncludes(tree, 'removed-provider::old-model'));
  buttons(tree, 'removeRule')[0].props.onClick();
  assert.deepEqual(ui.selected(), ['removed-provider::old-model']);
  tree = ui.render();
  assert.equal(inputs(tree, 'checkbox')[0].props.disabled, false);
  assert.equal(inputs(tree, 'checkbox')[0].props.checked, false);
  ui.unmount();
});

test('manual fallback validates, deduplicates, and respects IME composition and read-only state', async () => {
  const ui = await pickerHarness(['existing']);
  let tree = ui.render();
  const manual = () => inputs(tree).find((node) => node.props.id?.endsWith('-manual'));
  for (const invalid of ['bad model', 'provider::', '::model', 'p::m::extra']) {
    manual().props.onChange({ target: { value: invalid } });
    tree = ui.render();
    assert.equal(manual().props['aria-invalid'], true, invalid);
    assert.equal(buttons(tree, 'addRule')[0].props.disabled, true);
  }
  manual().props.onChange({ target: { value: ' provider-z::family/model ' } });
  tree = ui.render();
  let prevented = 0;
  manual().props.onKeyDown({ key: 'Enter', isComposing: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 0);
  assert.deepEqual(ui.selected(), ['existing']);
  manual().props.onKeyDown({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.deepEqual(ui.selected(), ['existing', 'provider-z::family/model']);
  tree = ui.render();
  manual().props.onChange({ target: { value: 'existing' } });
  tree = ui.render();
  buttons(tree, 'addRule')[0].props.onClick();
  assert.deepEqual(ui.selected(), ['existing', 'provider-z::family/model']);
  tree = ui.render({ disabled: true });
  assert.equal(manual().props.disabled, true);
  assert.ok(buttons(tree, 'removeRule').every((node) => node.props.disabled));
  const before = ui.changes.length;
  buttons(tree, 'removeRule')[0].props.onClick();
  assert.equal(ui.changes.length, before, 'disabled handlers also reject mutation');
  ui.unmount();
});

test('directory failures never clear rules and retry can recover a partial catalog', async () => {
  let calls = 0;
  const ui = await pickerHarness(['kept'], async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { ...catalog, value: { ...catalog.value, failures: [{ id: 'provider-c' }] } };
  });
  ui.render();
  await settle();
  let tree = ui.render();
  assert.ok(textIncludes(tree, 'catalogError'));
  assert.ok(!textIncludes(tree, 'catalogEmpty'), 'a failed catalog is not also described as empty');
  assert.equal(nodes(tree, node => node.type === 'details')[0].props.open, true, 'manual fallback opens when the catalog cannot be loaded');
  assert.deepEqual(ui.selected(), ['kept']);
  assert.equal(ui.changes.length, 0);
  buttons(tree, 'catalogRetry')[0].props.onClick();
  ui.render();
  await settle();
  tree = ui.render();
  assert.equal(calls, 2);
  assert.ok(textIncludes(tree, 'catalogPartial'));
  assert.equal(inputs(tree, 'checkbox').length, 3);
  assert.deepEqual(ui.selected(), ['kept']);
  assert.equal(ui.changes.length, 0);
  ui.unmount();
});

test('large catalogs remain bounded and search reaches models beyond the visible subset', async () => {
  const ui = await pickerHarness([], async () => ({ ok: true, value: {
    groups: [{ id: 'many', name: 'Many', models: Array.from({ length: 120 }, (_, index) => ({ id: `model-${index}`, name: `Display ${index}` })) }], failures: [],
  } }));
  ui.render();
  await settle();
  let tree = ui.render();
  assert.equal(inputs(tree, 'checkbox').length, 80);
  assert.ok(textIncludes(tree, 'catalogMore'));
  inputs(tree, 'search')[0].props.onChange({ target: { value: 'model-119' } });
  tree = ui.render();
  assert.equal(inputs(tree, 'checkbox').length, 1);
  inputs(tree, 'checkbox')[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(ui.selected(), ['many::model-119']);
  ui.unmount();
});
