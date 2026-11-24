import test from 'node:test';
import assert from 'node:assert/strict';
import { presentRequest, selected } from '../policy.js';

const identity = 'You are an AI agent powered by DeepSeek Harness.';
const neutral = 'You are an AI assistant.';
const heading = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.';
const block = text => ({type:'text',text});
const sys = text => ({role:'system',source:{kind:'system-prompt'},content:[block(text)]});
const run = message => presentRequest({messages:[message]}).messages[0];
const snapshot = sections => ({role:'user',source:{kind:'runtime-context',form:'snapshot',sections},
  content:[block([heading, ...sections.map(s => s.text)].join('\n\n'))]});
const sourceValue = 'Current DeepSeek Harness implementation checkout: "E:\\\\work\\\\DeepSeek Harness".';
const webValue = 'Current DeepSeek Harness Web GUI URL: "https://example.invalid/".';
const freeze = obj => { if (obj && typeof obj === 'object') { Object.values(obj).forEach(freeze); Object.freeze(obj); } return obj; };

test('exact matching uses the final model ID and optional provider, never a prefix or glob', () => {
  const route = {provider:'main', model:'vendor/model'};
  for (const rule of ['vendor/model', 'main::vendor/model']) assert.ok(selected(true,[rule],route));
  for (const rule of ['model','vendor/*','Vendor/model','other::vendor/model','*']) assert.ok(!selected(true,[rule],route));
  assert.ok(!selected(false,['vendor/model'],route));
  assert.ok(!selected(true,[],route));
  assert.ok(!selected(true,['main::vendor/model'],{provider:'other',model:'main::vendor/model'}));
});

test('sessionless calls and arbitrary callers keep their own prompts, evidence and descriptions', () => {
  for (const sessionId of [undefined,'team/42','background-1']) {
    const request = freeze({sessionId,system:identity,messages:[
      {role:'system',source:{kind:'plugin',plugin:'example'},content:[block(identity)]},
      {role:'system',content:[block(identity)]},
      ...['user','assistant','developer','tool'].map(role=>({role,content:[block(identity)]})),
      {role:'user',source:{kind:'skill-catalog',form:'catalog'},content:[block(identity)]}
    ],tools:[{name:'inspect',description:identity,parameters:{description:identity}}],toolHistory:{tools:[]},
    reasoningEffort:'high',cacheKey:'test'});
    assert.strictEqual(presentRequest(request),request);
    const mixed = {...request,messages:[sys(identity),...request.messages]};
    const result = presentRequest(mixed);
    assert.equal(result.messages[0].content[0].text,neutral);
    for (const field of ['system','tools','toolHistory','sessionId','cacheKey','reasoningEffort']) assert.strictEqual(result[field],request[field]);
    assert.ok(request.messages.every((m,i)=>result.messages[i+1]===m));
  }
});

test('only a stock section opening changes; custom paths, requirements, quotes and code survive', () => {
  const custom = ['Discuss DeepSeek Harness before touching E:\\work\\DeepSeek Harness\\README.md.',
    'Approval remains mandatory. DSH must sign off.','Quoted text:\n'+identity,
    '~~~~md\n\n'+identity+'\n\n~~~~', '    '+identity].join('\n\n');
  const msg = sys([custom,identity+' Request confirmation before publishing.',custom].join('\r\n\r\n'));
  const changed = run(msg);
  assert.equal(changed.content[0].text,[custom,neutral+' Request confirmation before publishing.',custom].join('\r\n\r\n'));
  assert.strictEqual(run(changed),changed);
});

test('named location lines are removed while multiline and identical third-party sections remain literal', () => {
  const other = {name:'integration:note',text:sourceValue};
  const msg = snapshot([{name:'harness:source',text:sourceValue+'\nExtra rule.\n\nSecond paragraph.'},other,
    {name:'app:web-surface',text:webValue}]);
  const req = freeze({messages:[msg]});
  const result = presentRequest(req), cleaned = result.messages[0];
  assert.equal(cleaned.content[0].text,[heading,'Extra rule.\n\nSecond paragraph.',sourceValue].join('\n\n'));
  assert.strictEqual(cleaned.source.sections[1],other);
  for (const val of [result,result.messages,cleaned,cleaned.content,cleaned.content[0],cleaned.source,cleaned.source.sections,cleaned.source.sections[0]]) assert.ok(Object.isFrozen(val));
  assert.equal(req.messages[0].source.sections.length,3);
  assert.strictEqual(presentRequest(result),result);
  const emptied = run(snapshot([{name:'app:web-surface',text:webValue}]));
  assert.equal(emptied.content[0].text,'Current runtime context: none. Earlier runtime-context snapshots no longer apply.');
  assert.deepEqual(emptied.source.sections,[]);
});

test('unknown layouts or upstream redactions are never rebuilt from private metadata', () => {
  const msg = snapshot([{name:'app:web-surface',text:webValue},{name:'rules',text:'PRIVATE'}]);
  msg.content[0].text = heading+'\n\n[redacted]\n\nPUBLIC';
  assert.strictEqual(run(msg),msg);
  for (const invalid of [sourceValue.replace('checkout','directory'),sourceValue+' accidental suffix',sourceValue.replace(/"/g,"'")]) {
    const custom = snapshot([{name:'harness:source',text:invalid}]);
    // Unknown attribution stays intact except its prose product name; quoted
    // paths and unexpected trailing constraints must not be discarded.
    assert.equal(run(custom).source.sections[0].text, invalid.replace('Current DeepSeek Harness', 'Current the application'));
  }
});

test('runtime provenance aligns old, current and future wrappers without relying on heading wording', () => {
  const extra = {name:'subagent:identity',text:'Keep role, parent and collaboration instructions.'};
  const paths = {name:'working-directory:current',text:'Workspace: "/work/DeepSeek Harness".'};
  for (const intro of [
    'The following information describes your current session:',
    'The following information describes your current session. It replaces earlier versions of this context, including any retained in conversation summaries.',
    'Updated environment for DeepSeek Harness, using a new heading.',
  ]) {
    const before = snapshot([paths, extra, {name:'harness:source',text:sourceValue},{name:'app:web-surface',text:webValue}]);
    const body = before.source.sections.map(s=>s.text).join('\n\n');
    const lead = '<system-reminder>\n'+intro+'\n\n', tail = '\n</system-reminder>';
    before.content[0].text = lead + body + tail;
    freeze(before);
    const after = run(before);
    assert.equal(after.content[0].text, lead.replace('DeepSeek Harness','the application') + paths.text+'\n\n'+extra.text+tail);
    assert.strictEqual(after.source.sections[0],paths);
    assert.strictEqual(after.source.sections[1],extra);
    assert.strictEqual(run(after),after);
    assert.equal(before.content[0].text,lead+body+tail);
    const emptied = snapshot([{name:'app:web-surface',text:webValue}]);
    emptied.content[0].text = lead+webValue+tail;
    assert.ok(run(emptied).content[0].text.includes('Earlier runtime-context snapshots no longer apply.'));
    assert.ok(run(emptied).content[0].text.endsWith(tail));
  }
});

test('whole-body alignment preserves producer escaping and rejects redaction and ambiguous bodies', () => {
  const text = 'Keep </SYSTEM-REMINDER  > & <tag> literal.';
  const msg = snapshot([{name:'rules',text},{name:'app:web-surface',text:webValue}]);
  const escaped = msg.source.sections.map(s=>s.text).join('\n\n').replace(/<\/system-reminder\s*>/gi,t=>'<\\'+t.slice(1));
  msg.content[0].text = '<system-reminder>\nChanged heading\n\n'+escaped+'\n</system-reminder>';
  assert.equal(run(msg).content[0].text, msg.content[0].text.replace('\n\n'+webValue,''));
  assert.equal(run(msg).source.sections[0].text,text);
  const ambiguous = snapshot([{name:'app:web-surface',text:webValue}]);
  ambiguous.content[0].text += '\n\n'+webValue;
  assert.strictEqual(run(ambiguous),ambiguous);
  msg.content[0].text = '<system-reminder>\n[REDACTED]\n</system-reminder>';
  assert.strictEqual(run(msg),msg);
});

test('learned host sections cover new branding prose without changing user messages, tools, code or unrelated sections', () => {
  const brand = 'A new DeepSeek Harness introduction. Keep approval before writes.';
  const data = 'Discuss DeepSeek Harness in the user documentation.';
  const request = freeze({messages:[sys(brand+'\n\n'+data),{role:'user',content:[block(brand)]}],
    tools:[{name:'inspect',description:brand}]});
  const output = presentRequest(request,[brand]);
  assert.equal(output.messages[0].content[0].text,brand.replace('DeepSeek Harness','the application')+'\n\n'+data);
  assert.strictEqual(output.messages[1],request.messages[1]);
  assert.strictEqual(output.tools,request.tools);
  assert.strictEqual(presentRequest(output,[brand]),output);
  const protectedText = 'A new DeepSeek Harness runtime. Read "/work/DeepSeek Harness/AGENTS.md" and `DeepSeek Harness`.';
  assert.equal(presentRequest({messages:[sys(protectedText)]},[protectedText]).messages[0].content[0].text,
    'A new the application runtime. Read "/work/DeepSeek Harness/AGENTS.md" and `DeepSeek Harness`.');
  const quote = sys('```text\n\n'+brand+'\n\n```');
  assert.strictEqual(presentRequest({messages:[quote]},[brand]).messages[0],quote);
  const twice = sys(brand+'\n\n'+brand);
  assert.strictEqual(presentRequest({messages:[twice]},[brand]).messages[0],twice);
  assert.equal(presentRequest({messages:[sys(identity)]},[identity]).messages[0].content[0].text,neutral);
});

test('fallback preserves indented code, exact backtick delimiters and product-named relative paths', () => {
  const intro = 'Future DeepSeek Harness documentation.';
  const examples = [
    '    echo "DeepSeek Harness"',
    '\techo "DeepSeek Harness"',
    '`echo ``DeepSeek Harness`` now`',
    '``echo `DeepSeek Harness` now``',
    'Read DeepSeek Harness/README.md before making changes.',
    'Read docs/DeepSeek Harness before making changes.',
    'Read DeepSeek Harness.json before making changes.',
  ];
  for (const example of examples) {
    const text = intro+'\n\n'+example;
    assert.equal(presentRequest({messages:[sys(text)]},[text]).messages[0].content[0].text,
      intro.replace('DeepSeek Harness','the application')+'\n\n'+example);
  }
});

test('learning overlapping factory ranges never restores branding from an older range', () => {
  const parts = ['A DeepSeek Harness.', 'B DeepSeek Harness.', 'C DeepSeek Harness.'];
  const text = parts.join('\n\n'), older = parts.slice(1).join('\n\n'), newer = parts.slice(0,2).join('\n\n');
  const req = {messages:[sys(text)]};
  const prior = presentRequest(req,[older]).messages[0].content[0].text;
  assert.equal(prior, parts[0]+'\n\n'+older.replaceAll('DeepSeek Harness','the application'));
  const now = presentRequest(req,[older,newer]).messages[0].content[0].text;
  assert.equal(now, text.replaceAll('DeepSeek Harness','the application'));
  assert.equal(presentRequest(req,[newer,older]).messages[0].content[0].text,now);
});

test('unrecognized host copy and future text-block shapes pass through without interrupting a request', () => {
  const futureIdentity = 'Under DeepSeek Harness, you work as a project assistant.';
  const msg = sys(futureIdentity);
  msg.content.push(null, {type:'text',text:{value:futureIdentity}}, {type:'new-block',body:futureIdentity});
  const runtime = snapshot([{name:'app:web-surface',text:webValue}]);
  runtime.content = [{type:'text',text:[{value:'future encoding'}]}];
  const request = freeze({messages:[msg,runtime]});
  assert.strictEqual(presentRequest(request),request);
});

test('sandbox branding is removed only from the stock opening, never from permissions or paths', () => {
  const shared = 'Current DSH file policy: ';
  const modes = [
    ['read-only. Any available operation enforced by the ', 'cannot modify files in the standing mode. Follow escalation guidance.'],
    ['workspace-write. Any available operation enforced by the ', 'may modify files under the session workspace: "/work/DSH file sandbox". Additional writable directories: ["/DSH data"].'],
    ['danger-full-access. The ', 'does not restrict file modifications by available operations.'],
  ];
  for (const [mode,tail] of modes) {
    const body = shared + mode + 'DSH file sandbox ' + tail + '\nKeep custom DSH instructions.';
    const msg = freeze(snapshot([{name:'sandbox:policy',text:body}]));
    const result = run(msg);
    const expected = 'Current file policy: ' + mode + 'file sandbox ' + tail + '\nKeep custom DSH instructions.';
    assert.equal(result.source.sections[0].text, expected);
    assert.equal(result.content[0].text, heading+'\n\n'+expected);
    assert.strictEqual(run(result), result);
    assert.equal(msg.source.sections[0].text, body);
    for (const unchanged of [snapshot([{name:'third-party:policy',text:body}]),
      snapshot([{name:'sandbox:policy',text:body.replace('file policy:', 'custom policy:')}])]) {
      assert.strictEqual(run(unchanged), unchanged);
    }
  }
});

test('only the proven leading user-global instruction heading changes; instructions and provenance remain intact', () => {
  const intro = 'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.';
  for (const path of ['~/.dsh/AGENTS.md', '$DSH_HOME/AGENTS.md']) {
    const src = {kind:'agent-instructions',form:'instructions',baseline:true,changes:[{action:'set',scope:'user-global\0AGENTS.md',path}]};
    const header = 'Instructions from: '+path;
    const tail = '\n\nKeep the real path '+path+' for editing.\n\n'+header+'\n\nA literal example.\n\nInstructions from: AGENTS.md\n\nProject rules.\n</system-reminder>';
    const make = (lead, source=src) => ({role:'user',source,content:[block(lead+header+tail)]});
    for (const prefix of ['', 'This complete workspace instruction baseline replaces all earlier workspace instruction baselines. ']) {
      const lead = '<system-reminder>\n'+prefix+intro+'\n\n';
      const msg = freeze(make(lead)), result = run(msg);
      assert.equal(result.content[0].text,lead+'User-global instructions (AGENTS.md):'+tail);
      assert.strictEqual(result.source, msg.source);
      assert.equal(msg.content[0].text,lead+header+tail);
      assert.strictEqual(run(result),result);
      for (const other of [make(lead,{...src,baseline:false}),make(lead,{...src,changes:[]}),
        make(lead,{...src,changes:[{...src.changes[0],scope:'.\0AGENTS.md'}]}),
        make(lead+'Instructions from: AGENTS.md\n\n'),make('[redacted]\n\n')]) assert.strictEqual(run(other),other);
    }
  }
});
