#!/usr/bin/env node
/** Offline integration against the installed desktop archive. No desktop entrypoint is imported. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { tmpdir } from 'node:os';

const pluginDir = fileURLToPath(new URL('../', import.meta.url));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index], value = process.argv[index + 1];
  assert.ok(['--asar', '--out'].includes(flag) && !args.has(flag) && value && !value.startsWith('--'),
    'Usage: node scripts/verify-desktop.mjs --asar <app.asar> [--out <report directory>]');
  args.set(flag, value);
}
assert.ok(args.has('--asar'), 'Provide --asar <desktop app.asar> explicitly');
const asarFile = fs.realpathSync(path.resolve(args.get('--asar')));
assert.ok(fs.statSync(asarFile).isFile(), 'The supplied ASAR must be a regular file');
const tempRoot = args.has('--out') ? path.resolve(args.get('--out')) : fs.mkdtempSync(path.join(tmpdir(), 'dsh-unbrand-desktop-'));
fs.mkdirSync(tempRoot, { recursive: true });
const reportFile = path.join(tempRoot, 'REPORT.json');
// Never reuse extracted modules from an earlier archive or failed run.
const hostRoot = fs.mkdtempSync(path.join(tempRoot, 'host-'));
fs.rmSync(reportFile, { force: true });
let fd;
try {
let blockedNetworkAttempts = 0;
function denyNetwork() { blockedNetworkAttempts++; throw new Error('Offline verification forbids network I/O'); }
globalThis.fetch = denyNetwork;
if ('WebSocket' in globalThis) globalThis.WebSocket = class { constructor() { denyNetwork(); } };
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denyNetwork;
net.Socket.prototype.connect = denyNetwork;
syncBuiltinESMExports();

// Read only requested core packages and their declared runtime dependency closure.
// No bundle inventory, profiles, desktop entrypoint, or third-party plugin is read.
fd = fs.openSync(asarFile, 'r');
const archiveSize = fs.fstatSync(fd).size;
const prefix = Buffer.alloc(8);
assert.equal(fs.readSync(fd, prefix, 0, 8, 0), 8, 'Truncated ASAR prefix');
const headerSize = prefix.readUInt32LE(4);
assert.ok(headerSize > 0 && headerSize < 64 * 1024 * 1024 && 8 + headerSize <= archiveSize, 'Unexpected ASAR header');
const headerBytes = Buffer.alloc(headerSize);
assert.equal(fs.readSync(fd, headerBytes, 0, headerSize, 8), headerSize, 'Truncated ASAR header');
const headerText = headerBytes.toString('utf8');
const header = JSON.parse(headerText.slice(headerText.indexOf('{'), headerText.lastIndexOf('}') + 1));
const archiveBase = 8 + headerSize;
function safeSegments(name) {
  const segments = name.split('/');
  assert.ok(segments.every(segment => segment && segment !== '.' && segment !== '..'
    && !/[\\:<>"|?*\u0000-\u001f]/u.test(segment) && !/[. ]$/u.test(segment)), `Unsafe archive path: ${name}`);
  return segments;
}
function contained(root, name) {
  safeSegments(name);
  const destination = path.resolve(root, ...name.split('/'));
  const relative = path.relative(root, destination);
  assert.ok(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), `Archive path escapes extraction root: ${name}`);
  return destination;
}
function entry(name) {
  let node = header;
  for (const segment of safeSegments(name)) node = node?.files?.[segment];
  assert.ok(node, `Missing archive entry: ${name}`);
  return node;
}
function readEntry(name, node = entry(name)) {
  assert.ok(!node.files && !node.link, `Expected a regular archive file: ${name}`);
  if (node.unpacked) {
    const unpackedRoot = fs.realpathSync(asarFile + '.unpacked');
    const source = fs.realpathSync(contained(unpackedRoot, name));
    const relative = path.relative(unpackedRoot, source);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Unpacked file escapes archive sibling');
    return fs.readFileSync(source);
  }
  assert.ok(Number.isSafeInteger(node.size) && node.size >= 0 && node.size <= 64 * 1024 * 1024, `Unexpected archive file size: ${name}`);
  assert.match(String(node.offset), /^\d+$/, `Invalid archive offset: ${name}`);
  const offset = Number(node.offset);
  assert.ok(Number.isSafeInteger(offset) && archiveBase + offset + node.size <= archiveSize, `Archive file outside data region: ${name}`);
  const data = Buffer.alloc(node.size);
  assert.equal(fs.readSync(fd, data, 0, node.size, archiveBase + offset), node.size);
  return data;
}
const extracted = new Map();
function extractPackage(name) {
  if (extracted.has(name)) return;
  assert.match(name, /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/, 'Invalid package name');
  safeSegments(name);
  const archivePath = 'dsh/node_modules/' + name;
  const manifest = JSON.parse(readEntry(archivePath + '/package.json'));
  assert.equal(manifest.name, name);
  extracted.set(name, manifest.version);
  function copy(node, relative) {
    if (node.files) {
      for (const [leaf, child] of Object.entries(node.files)) {
        assert.equal(safeSegments(leaf).length, 1, 'Archive leaf must be a single segment');
        if (leaf !== 'node_modules') copy(child, relative + '/' + leaf);
      }
      return;
    }
    assert.ok(!node.link, `Archive links are not supported: ${relative}`);
    const destination = contained(hostRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, readEntry(relative, node));
  }
  copy(entry(archivePath), archivePath);
  for (const dependency of Object.keys(manifest.dependencies ?? {})) extractPackage(dependency);
}
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-llm']) extractPackage(name);
// Read fixed official prose without executing the dev-context plugin or web app.
const fixtureSource = readEntry('dsh/node_modules/@deepseek-ai/dsh-harness-dev-context/lib/index.js').toString('utf8');
function templateConstant(name) {
  const raw = fixtureSource.match(new RegExp('const ' + name + ' = `([^\\r\\n]+)`;'))?.[1];
  assert.ok(raw && !raw.includes('${') && !/\\(?!`)/.test(raw), `Re-audit the official ${name} literal`);
  return raw.replace(/\\`/g, '`');
}
function legacyConstant(name) {
  const literal = fixtureSource.match(new RegExp('const ' + name + ' = \\{\\s*prefix: ("(?:\\\\.|[^"\\\\])*"),\\s*suffix: ("(?:\\\\.|[^"\\\\])*")\\s*\\};'));
  assert.ok(literal, `Re-audit the official ${name} literals`);
  return { prefix: JSON.parse(literal[1]), suffix: JSON.parse(literal[2]) };
}
const sourcePrompt = templateConstant('HARNESS_SOURCE_PROMPT');
const webPrompt = templateConstant('WEB_SURFACE_PROMPT');
const legacySource = legacyConstant('LEGACY_SOURCE');
const legacyWeb = legacyConstant('LEGACY_WEB_SURFACE');
fs.closeSync(fd);
fd = undefined;
const hostImport = (name) => import(pathToFileURL(path.join(hostRoot, 'dsh/node_modules', name, 'lib/index.js')).href);
const { Context } = await hostImport('@deepseek-ai/cordis');
const { SystemPrompt, renderPrompt, renderContextSnapshot } = await hostImport('@deepseek-ai/dsh-system-prompt');
const { LlmRuntime, LlmAdapter, freezeMessage } = await hostImport('@deepseek-ai/dsh-llm');
assert.equal(extracted.get('@deepseek-ai/dsh-llm'), '0.2.2-rc.1', 'Re-audit the forAdapter boundary for a different host version');
const runtimeSource = fs.readFileSync(path.join(hostRoot, 'dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js'), 'utf8');
assert.ok(runtimeSource.includes('dispatch(this.forAdapter(projectedOptions, adapter))'), 'Expected final projection boundary is missing');


const provider = 'offline-provider';
const targetModel = 'example-vendor/model-a';
const otherModel = 'other-model';
const models = [targetModel];
const cases = [];
const ctx = new Context();
const llmFiber = ctx.plugin(LlmRuntime);
const promptFiber = ctx.plugin(SystemPrompt, {});
await Promise.all([llmFiber, promptFiber]);
const llm = ctx.llm;
const originalDescriptor = Object.getOwnPropertyDescriptor(llm, 'forAdapter');
const originalPrototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(llm), 'forAdapter');
const adapterCalls = [];
let preparations = 0, dispatches = 0, waterfallEntries = 0;
class OfflineAdapter extends LlmAdapter {
  async prepareCall(routeProvider, model) {
    const generation = ++preparations;
    await Promise.resolve(); // Allow the independent route-isolation case to interleave.
    return {
      model: { provider: routeProvider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
      stream(options) {
        dispatches++;
        assert.equal(options.provider, routeProvider);
        assert.equal(options.model, model);
        adapterCalls.push({ generation, options });
        // No HTTP client, provider SDK, credentials, or network implementation exists here.
        return (async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; })();
      },
    };
  }
}
const unregister = llm.registerAdapter([provider], new OfflineAdapter());
ctx.on('llm/stream', (_options, next) => { waterfallEntries++; return next(); });
const sourceLine = 'Current DeepSeek Harness implementation checkout: ' + JSON.stringify('PRIVATE_SOURCE_MARKER') + '.';
const webLine = 'Current DeepSeek Harness Web GUI URL: ' + JSON.stringify('PRIVATE_WEB_MARKER') + '.';
const sourceLegacyText = legacySource.prefix + JSON.stringify('PRIVATE_LEGACY_SOURCE') + legacySource.suffix;
const webLegacyText = legacyWeb.prefix + JSON.stringify('PRIVATE_LEGACY_WEB') + legacyWeb.suffix;
const identity = 'You are an AI agent powered by DeepSeek Harness.';
ctx.systemPrompt.section({ name: 'harness:source', order: 10000, interpolate: false, text: sourcePrompt });
ctx.systemPrompt.section({ name: 'app:web-surface', order: 10100, interpolate: false, text: webPrompt });
ctx.systemPrompt.section({ name: 'safety:policy', order: 100, text: 'DSH requires confirmation before destructive writes.' });
ctx.systemPrompt.context({ name: 'harness:source', order: 200, interpolate: false, text: sourceLine });
ctx.systemPrompt.context({ name: 'app:web-surface', order: 210, interpolate: false, text: webLine });
ctx.systemPrompt.context({ name: 'approval:policy', order: 115, required: true, text: 'Preserve approval requirements.' });
ctx.systemPrompt.tools(() => ({ schemas: [{
  name: 'offline_inspect', description: 'Inspect a path through DeepSeek Harness. Keep paths unchanged.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'A path in DSH.' } }, required: ['path'] },
}] }));
const assemble = (model = targetModel) => ctx.systemPrompt.assemble({ modelSelection: { provider, model } });
const baselineAssembly = await assemble();
assert.ok(renderPrompt(baselineAssembly).includes(identity));
assert.ok(renderContextSnapshot(baselineAssembly).includes(sourceLine));
const oldSnapshotSections = [
  { name: 'approval:policy', text: 'Preserve approval requirements.' },
  { name: 'harness:source', text: sourceLine + '\nKeep the additional source approval constraint.' },
  { name: 'app:web-surface', text: webLine },
  { name: 'custom:note', text: 'Current DeepSeek Harness Web GUI URL: unquoted caller prose must remain.' },
];
const customSystem = 'DSH requires confirmation before destructive writes. Discussing DeepSeek Harness as data must remain literal.';
const hostBody = [identity, sourcePrompt, webPrompt, sourceLegacyText + '\nKeep the additional system source constraint.', webLegacyText + '\nKeep the additional system web constraint.', customSystem].join('\n\n');
const fixtureMessages = [
  { id: 'official-source', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: sourcePrompt }] },
  { id: 'official-web', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: webPrompt }] },
  { id: 'pure-old-identity', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: identity }] },
  { id: 'old-system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: hostBody }] },
  { id: 'old-context', role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: oldSnapshotSections }, content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n' + oldSnapshotSections.map(s => s.text).join('\n\n') }] },
  { id: 'user', role: 'user', source: { kind: 'human' }, content: [{ type: 'text', text: 'User text: DeepSeek Harness, DSH, PRIVATE_SOURCE_MARKER.' }] },
  { id: 'assistant', role: 'assistant', source: { kind: 'model', provider, model: targetModel, replayState: { immutable: 'DSH opaque replay' } }, content: [{ type: 'text', text: 'Assistant text about DSH stays literal.' }] },
  { id: 'tool', role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', content: [{ type: 'text', text: 'Tool output: DeepSeek Harness stays literal.' }] },
  { id: 'skill-catalog', role: 'user', source: { kind: 'skill-catalog', form: 'catalog' }, content: [{ type: 'text', text: '- `dsh-skill`: DeepSeek Harness skill in DSH.' }] },
  { id: 'skill-body', role: 'user', source: { kind: 'skill' }, content: [{ type: 'text', text: hostBody }] },
  { id: 'unowned-system', role: 'system', content: [{ type: 'text', text: hostBody }] },
].map(freezeMessage);
const originalMessagesJSON = JSON.stringify(fixtureMessages);
function request(model = targetModel, overrides = {}) {
  const value = {
    provider, model, temperature: 0.27, maxTokens: 1234, reasoningEffort: 'high', stop: ['END'],
    sessionId: 'synthetic-stable-session', cacheKey: 'synthetic-stable-cache',
    messages: fixtureMessages, tools: baselineAssembly.tools,
    toolHistory: { tools: baselineAssembly.tools, updates: [{ messageId: 'old-tool-note', additions: baselineAssembly.tools, removals: [] }] },
    ...overrides,
  };
  function deepFreeze(v) { if (v && typeof v === 'object' && !Object.isFrozen(v)) { for (const item of Object.values(v)) deepFreeze(item); Object.freeze(v); } return v; }
  return deepFreeze(value);
}
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks));
}
function assertUnchangedControls(seen, options) {
  for (const key of ['provider', 'model', 'temperature', 'maxTokens', 'reasoningEffort', 'stop', 'sessionId', 'cacheKey', 'system', 'tools', 'toolHistory']) assert.deepEqual(seen[key], options[key], `${key} must not change`);
  assert.equal(JSON.stringify(fixtureMessages), originalMessagesJSON, 'Frozen session history remains unchanged');
}
async function run(options, prepared = false) {
  const before = { preparations, dispatches, waterfallEntries };
  const handle = prepared ? await llm.prepareCall(options) : undefined;
  await collect(handle ? handle.stream(options) : llm.stream(options));
  assert.equal(preparations - before.preparations, 1, 'Exactly one adapter preparation');
  assert.equal(dispatches - before.dispatches, 1, 'Exactly one adapter dispatch');
  assert.equal(waterfallEntries - before.waterfallEntries, 1, 'Exactly one host waterfall');
  const seen = adapterCalls.at(-1).options;
  assertUnchangedControls(seen, options);
  return { seen, handle };
}
function assertProjected(seen) {
  const message = id => seen.messages.find(m => m.id === id);
  assert.equal(message('pure-old-identity').content[0].text, 'You are an AI assistant.');
  const hostText = message('old-system').content[0].text;
  assert.ok(!hostText.includes(identity));
  assert.ok(!hostText.includes('The runtime context names the DeepSeek Harness implementation checkout.'));
  assert.ok(!hostText.includes('You are interacting with the user through the DeepSeek Harness Web GUI'));
  assert.ok(!/PRIVATE_LEGACY_SOURCE|PRIVATE_LEGACY_WEB/.test(hostText));
  for (const guidance of ['Use pwd to determine the current working directory.', 'The browser provides no implicit DOM, route, or screenshot context.', 'Do not start a replacement server unless the user asks', 'verify that watcher before promising automatic updates.', 'requires rebuilding the affected Web artifacts']) assert.ok(hostText.includes(guidance), guidance);
  const officialSource = message('official-source').content[0].text;
  const officialWeb = message('official-web').content[0].text;
  assert.ok(officialSource.includes('Use pwd to determine the current working directory.'));
  assert.ok(!officialSource.includes('Use this checkout only to inspect or extend DSH itself.'));
  assert.ok(!officialWeb.includes('only dsh web injects window.__DSH_BOOT__'));
  assert.ok(officialWeb.includes('The browser provides no implicit DOM, route, or screenshot context.'));
  assert.ok(officialWeb.includes('Do not start a replacement server unless the user asks'));
  for (const constraint of ['Keep the additional system source constraint.', 'Keep the additional system web constraint.', customSystem]) assert.ok(hostText.includes(constraint));
  const snapshotText = message('old-context').content[0].text;
  assert.ok(!snapshotText.includes(sourceLine) && !snapshotText.includes(webLine));
  assert.ok(snapshotText.includes('Keep the additional source approval constraint.'));
  assert.ok(snapshotText.includes('Preserve approval requirements.'));
  assert.ok(snapshotText.includes('Current DeepSeek Harness Web GUI URL: unquoted caller prose must remain.'));
  for (const id of ['user', 'assistant', 'tool', 'skill-catalog', 'skill-body', 'unowned-system']) assert.deepEqual(message(id), fixtureMessages.find(m => m.id === id), `${id} content and provenance remain unchanged`);
  assert.deepEqual(seen.tools, baselineAssembly.tools, 'Every tool/schema description remains literal');
}
let privacyFiber;
try {
  assert.deepEqual((await run(request())).seen, request());
  cases.push('baseline: official host prose and JSON-quoted runtime locations visible');
  const privacy = await import(pathToFileURL(path.join(pluginDir, 'index.js')).href);
  privacyFiber = ctx.plugin(privacy, { enabled: true, models });
  await privacyFiber;
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(llm), 'forAdapter'), originalPrototypeDescriptor, 'Activation never patches the prototype');
  assert.deepEqual(await assemble(), baselineAssembly, 'Projection never rewrites the admitted prompt assembly');
  assert.deepEqual(await assemble(otherModel), baselineAssembly);
  cases.push('assembly: unchanged for matched and unmatched routes');
  const first = await run(request(), true);
  assertProjected(first.seen);
  assert.throws(() => first.handle.stream(request()), /only be dispatched once/);
  cases.push('prepared call: owned prose projected once, extra constraints and all tools/skills preserved');
  const retry = await run(request(), true);
  assertProjected(retry.seen);
  assert.equal(JSON.stringify(retry.seen), JSON.stringify(first.seen), 'Equal effective input retains a stable serialized prefix');
  cases.push('retry: structurally and byte-for-byte stable input projection');
  assert.deepEqual((await run(request(otherModel), true)).seen, request(otherModel));
  const concurrentStart = { preparations, dispatches, waterfallEntries, calls: adapterCalls.length };
  const concurrentInputs = [request(targetModel, { sessionId: 'concurrent-a' }), request(otherModel, { sessionId: 'concurrent-b' })];
  await Promise.all(concurrentInputs.map(async input => { const call = await llm.prepareCall(input); await collect(call.stream(input)); }));
  assert.equal(preparations - concurrentStart.preparations, 2);
  assert.equal(dispatches - concurrentStart.dispatches, 2);
  assert.equal(waterfallEntries - concurrentStart.waterfallEntries, 2);
  for (const input of concurrentInputs) {
    const seen = adapterCalls.slice(concurrentStart.calls).find(call => call.options.sessionId === input.sessionId).options;
    assertUnchangedControls(seen, input);
    if (input.model === targetModel) assertProjected(seen); else assert.deepEqual(seen, input);
  }
  cases.push('concurrency: same-provider matched and unmatched model routes remain isolated');
  for (const sessionId of [undefined, 'anonymous-caller-a', 'anonymous-review-job-a', 'unrelated-caller-b']) {
    const input = request(targetModel, { sessionId, cacheKey: undefined });
    assertProjected((await run(input)).seen);
  }
  const rawSystem = request(targetModel, {
    system: hostBody,
    messages: [{ id: 'raw-user', role: 'user', content: [{ type: 'text', text: hostBody }] }],
    sessionId: undefined, cacheKey: undefined,
  });
  assert.deepEqual((await run(rawSystem)).seen, rawSystem, 'Unowned system/user content matching official prose remains completely literal');
  const toolsOnly = request(targetModel, { messages: [], system: hostBody, sessionId: undefined });
  assert.deepEqual((await run(toolsOnly)).seen, toolsOnly);
  cases.push('caller neutrality: session ID and anonymous caller do not change ownership rules; raw system/tools/skills stay literal');
  const beforeVeto = { preparations, dispatches };
  const vetoCall = await llm.prepareCall(request());
  const disposeVeto = ctx.on('llm/stream', () => (async function* () {})(), { prepend: true });
  try {
    const chunks = [];
    for await (const chunk of vetoCall.stream(request())) chunks.push(chunk);
    assert.deepEqual(chunks, []);
    assert.equal(preparations - beforeVeto.preparations, 1);
    assert.equal(dispatches, beforeVeto.dispatches, 'No-next middleware prevents adapter dispatch');
  } finally { await disposeVeto(); }
  cases.push('middleware veto: no-next prevents dispatch and extra preparation');
  await privacyFiber.update({ enabled: false, models }, true);
  assert.deepEqual((await run(request(), true)).seen, request());
  assert.deepEqual(await assemble(), baselineAssembly);
  cases.push('settings update: disabled adapter input equals baseline');
  await privacyFiber.update({ enabled: true, models: ['*'] }, true);
  assert.deepEqual((await run(request())).seen, request(), 'Asterisk is literal');
  await privacyFiber.update({ enabled: true, models: ['another-provider::' + targetModel] }, true);
  assert.deepEqual((await run(request())).seen, request(), 'Provider-qualified rules require the exact provider');
  await privacyFiber.update({ enabled: true, models: [provider + '::' + targetModel] }, true);
  assertProjected((await run(request())).seen);
  cases.push('settings update: literal asterisk, model slash, and provider::model matching');
  await privacyFiber.dispose();
  privacyFiber = undefined;
  assert.deepEqual(Object.getOwnPropertyDescriptor(llm, 'forAdapter'), originalDescriptor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(llm), 'forAdapter'), originalPrototypeDescriptor);
  assert.deepEqual((await run(request(), true)).seen, request());
  assert.deepEqual(await assemble(), baselineAssembly);
  cases.push('unload: own descriptor, prototype, adapter behavior, and assembly baseline restored');
  assert.equal(blockedNetworkAttempts, 0);
  const report = {
    hostVersion: extracted.get('@deepseek-ai/dsh-llm'),
    fixtureSource: '@deepseek-ai/dsh-harness-dev-context/lib/index.js from supplied app.asar',
    packages: Object.fromEntries(extracted), cases,
    adapter: { type: 'in-memory fake adapter', preparations, dispatches, waterfallEntries, networkCalls: 0, blockedNetworkAttempts },
    boundary: 'Real core services from supplied app.asar; no desktop entrypoint, real config, plugin installation, desktop restart, provider serialization, or real model call. Settings updates use isolated Cordis fiber updates.',
  };
  if (args.has('--out')) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (privacyFiber) await privacyFiber.dispose();
  unregister();
  await promptFiber.dispose();
  await llmFiber.dispose();
}
} finally {
  if (fd !== undefined) fs.closeSync(fd);
  fs.rmSync(hostRoot, { recursive: true, force: true });
  if (!args.has('--out')) fs.rmSync(tempRoot, { recursive: true, force: true });
}
