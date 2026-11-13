import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { Config, DEFAULT_MODELS, registerSettingsPresentation } from '../settings.js';

test('Config exposes live whole-list settings with independent defaults', () => {
  const a = Config({});
  const b = Config({});
  assert.equal(a.enabled.get(), true);
  assert.deepEqual(DEFAULT_MODELS, []);
  assert.deepEqual(a.models.get(), [...DEFAULT_MODELS]);
  assert.notEqual(a.models.get(), b.models.get());
  assert.equal(Config.dict.models.meta.volatile, true);
  assert.equal(Config.dict.models.inner.meta.volatile, undefined);
  assert.deepEqual(Config({ models: [] }).models.get(), []);
  assert.deepEqual(Config({ models: ['custom-model', 'provider-alpha::family/custom-model'] }).models.get(), ['custom-model', 'provider-alpha::family/custom-model']);
  assert.throws(() => Config({ models: ['contains space'] }));
  assert.throws(() => Config({ models: [null] }));
  assert.throws(() => Config({ models: ['model-with-newline\n'] }));
});

test('presentation is scoped to the owning fiber and optional settings service', () => {
  const owner = {};
  const dispose = () => {};
  let registered;
  const ctx = {
    fiber: owner,
    inject(names, callback) {
      assert.deepEqual(names, ['settings']);
      callback({
        effect: (factory) => { assert.equal(factory(), dispose); },
        settings: { configure: (policy, fiber) => { registered = { policy, fiber }; return dispose; } },
      });
      return dispose;
    },
  };
  assert.equal(registerSettingsPresentation(ctx), dispose);
  assert.deepEqual(registered.policy, { auto: false });
  assert.equal(registered.fiber, owner);
});

async function settingsHarness() {
  const effects=[], slots=new Map(), hooks=[];
  let i, registered, currentLocale='zh', state={status:'ready',value:{enabled:true,models:['old-model']},revision:9,writable:true}, accept=true;
  const calls=[];
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useId:()=> 'page-test', useCallback:f=>f, useSyncExternalStore:(_sub,snap)=>snap(),
    useState(value){const n=i++;if(!(n in hooks))hooks[n]=value;return [hooks[n],val=>{hooks[n]=val;}];}};
  let descriptor;
  vm.runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>{descriptor=d;}}}});
  assert.equal(descriptor.id,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).name);
  const client=descriptor.factory(id=>{assert.equal(id,'react');return React;});
  const form={getSnapshot:()=>state,subscribe:()=>()=>{},async mutate(ops,revision){
    calls.push({ops:JSON.parse(JSON.stringify(ops)),revision});return accept;
  }};
  const ctx={effect:setup=>effects.push(setup()),
    slots:{inject:(_name,setup)=>setup(),register:(meta,component)=>{
      assert.ok(!slots.has(meta.name));slots.set(meta.name,{meta,component});return ()=>slots.delete(meta.name);
    }}, configForms:{get(ns){assert.equal(ns,'unbrand');return form;},
      whileServed(names,setup){assert.deepEqual([...names],['unbrand']);return setup();}},
    locale:{register(ns,dict){assert.equal(ns,'unbrand');registered=dict;return ()=>{};},
      bind:()=>key=>registered[currentLocale][key]},remote:{session:{modelCatalog:async()=>({ok:true,value:{groups:[]}})}}};
  client.apply(ctx);
  function render(){i=0;const {meta,component}=slots.get('settings.section');return component({...meta.inject(),t:key=>key});}
  function find(tree,match){if (!tree||typeof tree!=='object') return undefined;
    if(match(tree))return tree;for(const child of tree.props.children){const found=find(child,match);if(found)return found;}}
  return {slots,render,calls,form,find, setLocale(x){currentLocale=x;}, setAccept(x){accept=x;},
    patchState(p){state={...state,...p};},dispose(){for(const stop of effects.reverse())stop();}};
}

const pickerIn=(ui,tree)=>ui.find(tree,n=>n.type?.name==='ModelRules');
const button=(ui,tree,key)=>ui.find(tree,n=>n.type==='button'&&n.props.children.includes(key));

test('only the stand-alone section and its icon register; both follow the served namespace', async()=>{
  const ui=await settingsHarness();
  assert.deepEqual([...ui.slots.keys()],['settings.section','settings.section.icon']);
  const {meta}=ui.slots.get('settings.section');
  assert.equal(meta.id,ui.slots.get('settings.section.icon').meta.id);
  assert.equal(meta.label(),'隐标');ui.setLocale('en');assert.equal(meta.label(),'Unbrand');
  assert.equal(meta.inject().form,ui.form);
  assert.ok((await meta.inject().loadCatalog()).ok);
  ui.dispose();assert.equal(ui.slots.size,0);
});

test('old values load; changing models and switch performs one revision-fenced save', async()=>{
  const ui=await settingsHarness();let tree=ui.render();
  assert.deepEqual(pickerIn(ui,tree).props.models,['old-model']);
  pickerIn(ui,tree).props.onChange(['old-model','gateway::family/new']);tree=ui.render();
  ui.find(tree,n=>n.props.role==='switch').props.onChange({target:{checked:false}});
  assert.equal(ui.calls.length,0);
  tree=ui.render();
  assert.ok(ui.find(tree,n=>n.props.children.includes('disabledDraft')), 'turning off explains that Save is still required');
  assert.deepEqual(pickerIn(ui,tree).props.models,['old-model','gateway::family/new'], 'turning off retains the selected models');
  await button(ui,tree,'save').props.onClick();
  assert.deepEqual(ui.calls,[{revision:9,ops:[{op:'set',path:['enabled'],value:false},{op:'set',path:['models'],value:['old-model','gateway::family/new']}]}]);
  assert.ok(button(ui,ui.render(),'save').props.disabled);ui.dispose();
});

test('concurrent updates keep draft and original revision; discard restores remote values', async()=>{
  const ui=await settingsHarness();let tree=ui.render();ui.setAccept(false);
  pickerIn(ui,tree).props.onChange(['gateway::draft']);
  ui.patchState({revision:10,value:{enabled:true,models:['elsewhere']}});
  await button(ui,ui.render(),'save').props.onClick();tree=ui.render();
  assert.equal(ui.calls[0].revision,9);assert.deepEqual(pickerIn(ui,tree).props.models,['gateway::draft']);
  assert.ok(ui.find(tree,n=>n.props.role==='alert'));
  button(ui,tree,'discard').props.onClick();tree=ui.render();assert.deepEqual(pickerIn(ui,tree).props.models,['elsewhere']);
  ui.patchState({writable:false});tree=ui.render();assert.equal(pickerIn(ui,tree).props.disabled,true);
  ui.patchState({status:'loading',value:undefined});tree=ui.render();assert.equal(tree.props.role,'status');ui.dispose();
});
