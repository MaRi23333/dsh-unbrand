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
import { compileFunction, createContext } from 'node:vm';

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
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-harness-dev-context', '@deepseek-ai/dsh-sandbox-policy', '@deepseek-ai/dsh-sandbox', '@deepseek-ai/dsh-agent-instructions', '@deepseek-ai/dsh-home-paths']) extractPackage(name);
// rc.3 imports this peer at runtime; earlier cores do not contain or need it.
// Presence is only an extraction choice, never a compatibility verdict.
if (header.files?.dsh?.files?.node_modules?.files?.['@deepseek-ai']?.files?.['dsh-error']) extractPackage('@deepseek-ai/dsh-error');
// Only legacy prose lacks a public generator. Current prose is generated below
// against synthetic services, without activating the web app or desktop entry.
const fixtureSource = readEntry('dsh/node_modules/@deepseek-ai/dsh-harness-dev-context/lib/index.js').toString('utf8');
function legacyConstant(name) {
  const literal = fixtureSource.match(new RegExp('const ' + name + ' = \\{\\s*prefix: ("(?:\\\\.|[^"\\\\])*"),\\s*suffix: ("(?:\\\\.|[^"\\\\])*")\\s*\\};'));
  assert.ok(literal, `Re-audit the official ${name} literals`);
  return { prefix: JSON.parse(literal[1]), suffix: JSON.parse(literal[2]) };
}
// These archived legacy paragraphs have no public generator. Accept only the
// simple literal object above; never eval source text or guess at new shapes.
const legacySource = legacyConstant('LEGACY_SOURCE');
const legacyWeb = legacyConstant('LEGACY_WEB_SURFACE');
// AgentLoop owns the current reminder producer; joinContextSections below is
// only the legacy renderer. Read this private class without importing AgentLoop
// (which would activate a much larger runtime dependency graph).
const runtimeProjectionPath = 'dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js';
const runtimeProjectionModule = readEntry(runtimeProjectionPath).toString('utf8');
const runtimeProjectionManifest = JSON.parse(readEntry('dsh/node_modules/@deepseek-ai/dsh-agent-loop/package.json'));
assert.equal(runtimeProjectionManifest.name, '@deepseek-ai/dsh-agent-loop');
assert.equal(runtimeProjectionManifest.version, extracted.get('@deepseek-ai/dsh-llm'));
function uniqueArchiveLiteral(name) {
  assert.equal((runtimeProjectionModule.match(new RegExp('^const ' + name + ' = ', 'gm')) ?? []).length, 1, `Re-audit AgentLoop ${name}: ambiguous declaration`);
  const matches = [...runtimeProjectionModule.matchAll(new RegExp('^const ' + name + ' = ("(?:\\\\.|[^"\\\\])*");$', 'gm'))];
  assert.equal(matches.length, 1, `Re-audit AgentLoop ${name}: expected one JSON string constant`);
  return JSON.parse(matches[0][1]);
}
const runtimeSourceKind = uniqueArchiveLiteral('SOURCE');
const runtimeCleared = uniqueArchiveLiteral('CLEARED');
assert.equal(runtimeSourceKind, 'runtime-context');
assert.equal(runtimeCleared, '<system-reminder>\nCurrent runtime context: none. Earlier runtime-context snapshots no longer apply.\n</system-reminder>');
const runtimeClassStart = 'var RuntimeContextProjection = class {';
assert.equal(runtimeProjectionModule.split(runtimeClassStart).length, 2, 'Re-audit AgentLoop: expected one RuntimeContextProjection declaration');
const runtimeClassOffset = runtimeProjectionModule.indexOf(runtimeClassStart);
const runtimeClassEnd = runtimeProjectionModule.indexOf('\n//#endregion', runtimeClassOffset);
assert.ok(runtimeClassEnd > runtimeClassOffset, 'Re-audit AgentLoop: missing class region boundary');
const runtimeClassSource = runtimeProjectionModule.slice(runtimeClassOffset, runtimeClassEnd);
assert.ok(runtimeClassSource.endsWith('\n};'), 'Re-audit AgentLoop: class must end at its region boundary');
assert.equal((runtimeClassSource.match(/^\tproject\(sections\) \{$/gm) ?? []).length, 1, 'Re-audit AgentLoop project signature');
assert.equal((runtimeClassSource.match(/^var /gm) ?? []).length, 1, 'Re-audit AgentLoop class region shape');
extractPackage('@deepseek-ai/dsh-util-values');
fs.closeSync(fd);
fd = undefined;
const hostImport = (name) => import(pathToFileURL(path.join(hostRoot, 'dsh/node_modules', name, 'lib/index.js')).href);
const { Context } = await hostImport('@deepseek-ai/cordis');
const { SystemPrompt, renderPrompt, renderContextSnapshot, joinContextSections } = await hostImport('@deepseek-ai/dsh-system-prompt');
const { LlmRuntime, LlmAdapter, freezeMessage, createUserMessage } = await hostImport('@deepseek-ai/dsh-llm');
const { deepEqualJson } = await hostImport('@deepseek-ai/dsh-util-values');
const { apply: applyDevContext } = await hostImport('@deepseek-ai/dsh-harness-dev-context');
const { SandboxPolicyService } = await hostImport('@deepseek-ai/dsh-sandbox-policy');
const { renderAgentInstructions } = await hostImport('@deepseek-ai/dsh-agent-instructions');
// Test-only execution of the exact archived class. The context supplies no
// process, require, imports, timers or I/O. Skip its eventful constructor and
// exercise only project() with explicit synthetic retained state.
const runtimeClass = compileFunction('"use strict";\n' + runtimeClassSource + '\nreturn RuntimeContextProjection;',
  ['createUserMessage', 'deepEqualJson', 'SOURCE', 'CLEARED'], {
    filename: runtimeProjectionPath,
    parsingContext: createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } }),
  })(createUserMessage, deepEqualJson, runtimeSourceKind, runtimeCleared);
assert.deepEqual(Object.getOwnPropertyNames(runtimeClass.prototype), ['constructor', 'project'], 'Re-audit AgentLoop class methods');
function currentRuntimeMessage(id, sections, retained) {
  const projection = Object.create(runtimeClass.prototype);
  projection.retained = retained;
  const message = projection.project(sections);
  if (message === undefined) return undefined;
  assert.equal(message.source.kind, runtimeSourceKind);
  assert.equal(message.source.form, 'snapshot');
  assert.deepEqual(JSON.parse(JSON.stringify(message.source.sections)), sections, 'Actual producer must retain the supplied section contributions');
  return freezeMessage({ ...JSON.parse(JSON.stringify(message)), id });
}

const provider = 'offline-provider';
const targetModel = 'example-vendor/model-a';
const otherModel = 'other-model';
const models = [targetModel];
const cases = [];
const ctx = new Context();
// Synthetic projection state only: no profile, instruction file, or session log.
ctx.provide('sessionProjections', { register: async spec => ({ stateOf: session => spec.key === 'sandboxMode' ? session.offlineMode : spec.init() }) });
const llmFiber = ctx.plugin(LlmRuntime);
const promptFiber = ctx.plugin(SystemPrompt, {});
await Promise.all([llmFiber, promptFiber]);
await applyDevContext({
  systemPrompt: ctx.systemPrompt,
  sessionProjections: ctx.sessionProjections,
  webApp: { getAdvertisedUrl: () => 'https://offline.invalid/PRIVATE_WEB_MARKER' },
});
const sandboxFiber = ctx.plugin(SandboxPolicyService, {
  mode: 'read-only', workspaceRoot: path.resolve(tempRoot, 'DSH-workspace'),
  additionalWritableRoots: [path.resolve(tempRoot, 'DeepSeek Harness-extra')],
});
await sandboxFiber;
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
const sourceLegacyText = legacySource.prefix + JSON.stringify('PRIVATE_LEGACY_SOURCE') + legacySource.suffix;
const webLegacyText = legacyWeb.prefix + JSON.stringify('PRIVATE_LEGACY_WEB') + legacyWeb.suffix;
ctx.systemPrompt.section({ name: 'safety:policy', order: 100, text: 'DSH requires confirmation before destructive writes.' });
ctx.systemPrompt.context({ name: 'approval:policy', order: 115, required: true, text: 'Preserve approval requirements.' });
ctx.systemPrompt.tools(() => ({ schemas: [{
  name: 'offline_inspect', description: 'Inspect a path through DeepSeek Harness. Keep paths unchanged.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'A path in DSH.' } }, required: ['path'] },
}] }));
const assemble = (model = targetModel) => ctx.systemPrompt.assemble({ modelSelection: { provider, model } });
const baselineAssembly = await assemble();
function uniqueText(items, name) {
  const matches = items.filter(item => item.name === name);
  assert.equal(matches.length, 1, `Unsupported host prompt shape: expected one ${name}`);
  assert.equal(typeof matches[0].text, 'string', `Unsupported host prompt text: ${name}`);
  return matches[0].text;
}
const identity = uniqueText(baselineAssembly.sections, 'harness:identity');
assert.equal(identity, 'You are an AI agent powered by DeepSeek Harness.', 'Unsupported host identity prose; re-audit projection');
const sourcePrompt = uniqueText(baselineAssembly.sections, 'harness:source');
const webPrompt = uniqueText(baselineAssembly.sections, 'app:web-surface');
const sourceLine = uniqueText(baselineAssembly.contexts, 'harness:source');
const webLine = uniqueText(baselineAssembly.contexts, 'app:web-surface');
assert.match(sourceLine, /^Current DeepSeek Harness implementation checkout: "(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"\.$/, 'Unsupported source location prose');
assert.match(webLine, /^Current DeepSeek Harness Web GUI URL: "(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"\.$/, 'Unsupported web location prose');
function replaceOnce(text, from, to, label) {
  assert.equal(text.split(from).length, 2, `Unsupported ${label} prose; expected one recognized target`);
  return text.replace(from, to);
}
function expectedDevPrompt(text, kind, legacy = false) {
  const source = kind === 'source';
  let expected = replaceOnce(text,
    legacy ? (source ? legacySource.prefix + JSON.stringify('PRIVATE_LEGACY_SOURCE') + '.' : legacyWeb.prefix + JSON.stringify('PRIVATE_LEGACY_WEB') + '.')
      : source ? 'The runtime context names the DeepSeek Harness implementation checkout.' : 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.',
    source ? 'Treat the application source and the workspace as distinct locations.' : 'The user is interacting through a web interface.', kind + ' opening');
  expected = replaceOnce(expected,
    source ? 'Use this checkout only to inspect or extend DSH itself.' : 'because only dsh web injects window.__DSH_BOOT__.',
    source ? 'Use this checkout only to inspect or extend the application itself.' : 'because its boot data is supplied by the running application.', kind + ' body');
  assert.ok(!/DeepSeek Harness|\bDSH\b|__DSH_BOOT__/.test(expected), `Unsupported additional branding in ${kind} prose; re-audit projection`);
  return expected;
}
const expectedSource = expectedDevPrompt(sourcePrompt, 'source');
const expectedWeb = expectedDevPrompt(webPrompt, 'web');
const expectedLegacySource = expectedDevPrompt(sourceLegacyText, 'source', true);
const expectedLegacyWeb = expectedDevPrompt(webLegacyText, 'web', true);
const appendedConstraint = '\nKeep the additional DSH sandbox approval constraint.';
const sandboxTexts = [];
for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) {
  const assembly = await ctx.systemPrompt.assemble({ agent: { session: { id: 'offline-policy', header: {}, offlineMode: mode } } });
  const text = uniqueText(assembly.contexts, 'sandbox:policy');
  const opening = mode === 'danger-full-access'
    ? 'Current DSH file policy: danger-full-access. The DSH file sandbox'
    : `Current DSH file policy: ${mode}. Any available operation enforced by the DSH file sandbox`;
  assert.ok(text.startsWith(opening + ' '), `Unsupported ${mode} sandbox opening; re-audit projection`);
  sandboxTexts.push({ mode, text, expected: opening.replaceAll('DSH ', '') + text.slice(opening.length) });
}
const instructionBody = 'Preserve DSH instructions, ~/.dsh/AGENTS.md, and Instructions from: ~/.dsh/AGENTS.md.\nAdditional caller approval constraint.';
const instructionFixtures = [];
for (const displayPath of ['~/.dsh/AGENTS.md', '$DSH_HOME/AGENTS.md']) {
  for (const replacePreviousBaseline of [false, true]) {
    const rendered = renderAgentInstructions([
      { absolutePath: path.resolve(tempRoot, 'global-AGENTS.md'), displayPath, content: instructionBody },
      { absolutePath: path.resolve(tempRoot, 'project-AGENTS.md'), displayPath: 'AGENTS.md', content: 'Keep project DSH instructions.' },
    ], { maxBytes: 100000, replacePreviousBaseline });
    assert.deepEqual(rendered.omitted, []);
    assert.deepEqual(rendered.truncated, []);
    const intro = 'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.';
    const lead = '<system-reminder>\n' + (replacePreviousBaseline ? 'This complete workspace instruction baseline replaces all earlier workspace instruction baselines. ' : '') + intro + '\n\n';
    const header = 'Instructions from: ' + displayPath;
    assert.ok(rendered.text.startsWith(lead + header + '\n\n'), 'Unsupported global AGENTS introduction/heading; re-audit projection');
    instructionFixtures.push({ text: rendered.text, expected: lead + 'User-global instructions (AGENTS.md):' + rendered.text.slice((lead + header).length), displayPath });
  }
}
assert.ok(renderPrompt(baselineAssembly).includes(identity));
assert.ok(renderContextSnapshot(baselineAssembly).includes(sourceLine));
const oldSnapshotSections = [
  { name: 'approval:policy', text: 'Preserve approval requirements.' },
  { name: 'harness:source', text: sourceLine + '\nKeep the additional source approval constraint.' },
  { name: 'app:web-surface', text: webLine },
  { name: 'custom:note', text: 'Current DeepSeek Harness Web GUI URL: unquoted caller prose must remain.' },
];
const customSystem = 'DSH requires confirmation before destructive writes. Discussing DeepSeek Harness as data must remain literal.';
const projectedSnapshotSections = [oldSnapshotSections[0], { name: 'harness:source', text: 'Keep the additional source approval constraint.' }, oldSnapshotSections[3]];
const currentRuntimeFixtures = [];
function addCurrentRuntime(id, sections, retained, expectedSections, expectedText) {
  const message = currentRuntimeMessage(id, sections, retained);
  assert.ok(message, `${id}: actual AgentLoop producer must emit a snapshot`);
  currentRuntimeFixtures.push({ message, expectedSections, expectedText: expectedText(message.content[0].text) });
}
for (const [id, retained, intro] of [
  ['runtime-first', undefined, 'The following information describes your current session:'],
  ['runtime-replaces-dropped', null, 'The following information describes your current session. It replaces earlier versions of this context, including any retained in conversation summaries.'],
  ['runtime-replaces-retained', { seq: 1, sections: [{ name: 'previous', text: 'Earlier context.' }] }, 'The following information describes your current session. It replaces earlier versions of this context, including any retained in conversation summaries.'],
]) {
  addCurrentRuntime(id, oldSnapshotSections, retained, projectedSnapshotSections, text => {
    assert.ok(text.startsWith('<system-reminder>\n' + intro + '\n\n'), `${id}: actual current reminder introduction`);
    return replaceOnce(text, oldSnapshotSections.map(section => section.text).join('\n\n'), projectedSnapshotSections.map(section => section.text).join('\n\n'), id + ' complete context body');
  });
}
assert.equal(currentRuntimeMessage('runtime-empty-first', [], undefined), undefined, 'No first empty snapshot');
assert.equal(currentRuntimeMessage('runtime-unchanged', oldSnapshotSections, { seq: 1, sections: structuredClone(oldSnapshotSections) }), undefined, 'Equal retained context emits no message');
assert.equal(currentRuntimeMessage('runtime-unchanged-empty', [], { seq: 1, sections: [] }), undefined, 'Equal retained empty context emits no message');
addCurrentRuntime('runtime-cleared', [], { seq: 1, sections: oldSnapshotSections }, [], text => {
  assert.equal(text, runtimeCleared, 'Actual AgentLoop clear snapshot');
  assert.ok(!text.includes(sourceLine) && !text.includes(webLine), 'Clearing must never leak the previous context');
  return text;
});
const locationsOnly = [{ name: 'harness:source', text: sourceLine }, { name: 'app:web-surface', text: webLine }];
addCurrentRuntime('runtime-locations-cleared', locationsOnly, undefined, [], text =>
  replaceOnce(text, locationsOnly.map(section => section.text).join('\n\n'), runtimeCleared.slice('<system-reminder>\n'.length, -'\n</system-reminder>'.length), 'current location-only body'));
const quotedExtras = [
  { name: 'harness:source', text: sourceLine + '\nKeep the DSH quoted-source approval constraint.' },
  { name: 'app:web-surface', text: webLine + '\nKeep the DSH quoted-web approval constraint.' },
];
const projectedQuotedExtras = quotedExtras.map(section => ({ ...section, text: section.text.slice(section.text.indexOf('\n') + 1) }));
addCurrentRuntime('runtime-quoted-extra-constraints', quotedExtras, null, projectedQuotedExtras, text =>
  replaceOnce(text, quotedExtras.map(section => section.text).join('\n\n'), projectedQuotedExtras.map(section => section.text).join('\n\n'), 'quoted locations with appended constraints'));
const escapedSection = { name: 'approval:literal', text: 'Preserve </system-reminder> and </SYSTEM-REMINDER  > literally.\n' + sourceLine };
const escapedSections = [locationsOnly[0], escapedSection, locationsOnly[1]];
addCurrentRuntime('runtime-closing-tag-escape', escapedSections, null, [escapedSection], text => {
  assert.ok(text.includes('<\\/system-reminder>') && text.includes('<\\/SYSTEM-REMINDER  >'), 'Actual producer escapes every body closing tag');
  assert.equal(text.split('\n</system-reminder>').length, 2, 'Exactly one unescaped wrapper closing tag');
  // Match the complete generated body, not a guessed heading or first location.
  const escapedBody = escapedSection.text.replace('</system-reminder>', '<\\/system-reminder>').replace('</SYSTEM-REMINDER  >', '<\\/SYSTEM-REMINDER  >');
  return replaceOnce(text, sourceLine + '\n\n' + escapedBody + '\n\n' + webLine, escapedBody, 'escaped complete body');
});
for (const { mode, text, expected } of sandboxTexts) {
  const sections = [{ name: 'sandbox:policy', text: text + appendedConstraint }, { name: 'approval:policy', text: customSystem }];
  const expectedSections = [{ name: 'sandbox:policy', text: expected + appendedConstraint }, sections[1]];
  addCurrentRuntime('runtime-sandbox-' + mode, sections, undefined, expectedSections, reminder =>
    replaceOnce(reminder, text, expected, mode + ' current sandbox body'));
}
// The wrapper may acquire unrelated caller text. Keep that text exact while
// locating only the full section body emitted by the real archived producer.
const wrappedFixture = currentRuntimeFixtures.find(({ message }) => message.id === 'runtime-first');
currentRuntimeFixtures.push({
  ...wrappedFixture,
  message: freezeMessage({ ...wrappedFixture.message, id: 'runtime-with-wrapper-prose', content: [{ type: 'text', text: 'Keep the outer DSH approval preface.\n' + wrappedFixture.message.content[0].text + '\nKeep the outer DSH approval suffix.' }] }),
  expectedText: 'Keep the outer DSH approval preface.\n' + wrappedFixture.expectedText + '\nKeep the outer DSH approval suffix.',
});
const hostBody = [identity, sourcePrompt, webPrompt, sourceLegacyText + '\nKeep the additional system source constraint.', webLegacyText + '\nKeep the additional system web constraint.', customSystem].join('\n\n');
const fixtureMessages = [
  { id: 'official-source', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: sourcePrompt }] },
  { id: 'official-web', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: webPrompt }] },
  { id: 'pure-old-identity', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: identity }] },
  { id: 'old-system', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: hostBody }] },
  { id: 'old-context', role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: oldSnapshotSections }, content: [{ type: 'text', text: joinContextSections(oldSnapshotSections) }] },
  { id: 'old-locations-cleared', role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections: locationsOnly }, content: [{ type: 'text', text: joinContextSections(locationsOnly) }] },
  ...currentRuntimeFixtures.map(({ message }) => message),
  ...sandboxTexts.map(({ mode, text }) => {
    const sections = [{ name: 'sandbox:policy', text: text + appendedConstraint }, { name: 'approval:policy', text: customSystem }];
    return { id: 'sandbox-' + mode, role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections }, content: [{ type: 'text', text: joinContextSections(sections) }] };
  }),
  ...instructionFixtures.map(({ text, displayPath }, index) => ({ id: 'instructions-' + index, role: 'user', source: { kind: 'agent-instructions', form: 'instructions', baseline: true, changes: [{ scope: 'user-global\0AGENTS.md', path: displayPath, action: 'set' }] }, content: [{ type: 'text', text }] })),
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
  assert.equal(hostText, ['You are an AI assistant.', expectedSource, expectedWeb, expectedLegacySource + '\nKeep the additional system source constraint.', expectedLegacyWeb + '\nKeep the additional system web constraint.', customSystem].join('\n\n'), 'All official prose changes are exact; the complete remaining body is preserved');
  assert.ok(!hostText.includes(identity));
  assert.ok(!hostText.includes('The runtime context names the DeepSeek Harness implementation checkout.'));
  assert.ok(!hostText.includes('You are interacting with the user through the DeepSeek Harness Web GUI'));
  assert.ok(!/PRIVATE_LEGACY_SOURCE|PRIVATE_LEGACY_WEB/.test(hostText));
  for (const guidance of ['Use pwd to determine the current working directory.', 'The browser provides no implicit DOM, route, or screenshot context.', 'Do not start a replacement server unless the user asks', 'verify that watcher before promising automatic updates.', 'requires rebuilding the affected Web artifacts']) assert.ok(hostText.includes(guidance), guidance);
  const officialSource = message('official-source').content[0].text;
  const officialWeb = message('official-web').content[0].text;
  assert.equal(officialSource, expectedSource, 'Current source body is preserved exactly outside the recognized targets');
  assert.equal(officialWeb, expectedWeb, 'Current web body is preserved exactly outside the recognized targets');
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
  assert.deepEqual(message('old-context').source.sections, projectedSnapshotSections);
  assert.equal(message('old-locations-cleared').content[0].text, 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.', 'Legacy location-only clear keeps its original output without the legacy heading or stale context');
  assert.deepEqual(message('old-locations-cleared').source.sections, []);
  for (const { message: original, expectedSections, expectedText } of currentRuntimeFixtures) {
    const projected = message(original.id);
    assert.equal(projected.content[0].text, expectedText, original.id + ': exact real AgentLoop reminder body and wrapper preservation');
    assert.deepEqual(projected.source, { ...original.source, sections: expectedSections }, original.id + ': current producer provenance');
  }
  for (const { mode, expected } of sandboxTexts) {
    const projected = message('sandbox-' + mode);
    const sections = [{ name: 'sandbox:policy', text: expected + appendedConstraint }, { name: 'approval:policy', text: customSystem }];
    assert.deepEqual(projected.source.sections, sections, `${mode}: only the fixed sandbox opening changes; paths, roots, platform guidance and extra constraints stay literal`);
    assert.equal(projected.content[0].text, joinContextSections(sections));
  }
  for (const [index, { expected }] of instructionFixtures.entries()) {
    const projected = message('instructions-' + index);
    assert.equal(projected.content[0].text, expected, 'Only the first global AGENTS heading changes; intro, file body and project heading stay literal');
    assert.deepEqual(projected.source, fixtureMessages.find(m => m.id === projected.id).source, 'Instruction provenance remains unchanged');
  }
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
  cases.push('archive-generated prose: identity, source/web bodies and location lines, all three sandbox modes, both global AGENTS introductions and paths; exact remaining text preserved');
  cases.push('actual AgentLoop RuntimeContextProjection.project: first, retained and dropped replacement, clear, unchanged/empty, location-only clear, quoted-location appended constraints, closing-tag escapes, all sandbox modes and outer wrapper prose; legacy joinContextSections compatibility retained');
  const retry = await run(request(), true);
  assertProjected(retry.seen);
  assert.equal(JSON.stringify(retry.seen), JSON.stringify(first.seen), 'Equal effective input retains a stable serialized prefix');
  cases.push('retry: structurally and byte-for-byte stable input projection');
  const futureIdentity = 'This assistant operates through DeepSeek Harness. Keep every approval requirement.';
  const removeFutureTemplate = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    return {...assembly, sections: assembly.sections.map(section =>
      section.name === 'harness:identity' ? {...section, text:futureIdentity, interpolate:false} : section)};
  });
  try {
    const futureAssembly = await assemble();
    const text = renderPrompt(futureAssembly);
    assert.ok(text.includes(futureIdentity), 'The observer must not modify host assembly');
    const messages = [freezeMessage({id:'future-factory', role:'system', source:{kind:'system-prompt'}, content:[{type:'text',text}]})];
    const futureInput = request(targetModel, {messages});
    const futureSeen = (await run(futureInput)).seen;
    assert.ok(futureSeen.messages[0].content[0].text.includes(futureIdentity.replace('DeepSeek Harness','the application')));
    assert.ok(futureSeen.messages[0].content[0].text.includes('DSH requires confirmation before destructive writes.'));
    assert.equal(futureInput.messages[0].content[0].text, text);
    assert.deepEqual((await run(request(otherModel,{messages}))).seen, request(otherModel,{messages}));
    assert.equal(JSON.stringify((await run(futureInput)).seen), JSON.stringify(futureSeen));
    cases.push('adaptive template: actual assemble waterfall learns changed factory identity without rewriting assembly, nonselected routes or stable retries');
  } finally { removeFutureTemplate(); }
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
    fixtureSource: 'Real SystemPrompt identity, dev-context apply, SandboxPolicyService, renderAgentInstructions and actual private AgentLoop RuntimeContextProjection.project from supplied app.asar; legacy literals parsed as strict JSON objects without eval',
    runtimeContextProducer: { path: runtimeProjectionPath, version: runtimeProjectionManifest.version, classLine: runtimeProjectionModule.slice(0, runtimeClassOffset).split('\n').length, execution: 'Exact complete archived class compiled in a test-only VM; constructor skipped; actual createUserMessage/deepEqualJson and parsed SOURCE/CLEARED injected; no AgentLoop module import', fixtures: currentRuntimeFixtures.map(({ message }) => message.id) },
    packages: Object.fromEntries(extracted), cases,
    adapter: { type: 'in-memory fake adapter', preparations, dispatches, waterfallEntries, networkCalls: 0, blockedNetworkAttempts },
    boundary: 'Real core services from supplied app.asar; no desktop entrypoint, real config, plugin installation, desktop restart, provider serialization, or real model call. Settings updates use isolated Cordis fiber updates.',
  };
  if (args.has('--out')) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (privacyFiber) await privacyFiber.dispose();
  unregister();
  await sandboxFiber.dispose();
  await promptFiber.dispose();
  await llmFiber.dispose();
}
} finally {
  if (fd !== undefined) fs.closeSync(fd);
  fs.rmSync(hostRoot, { recursive: true, force: true });
  if (!args.has('--out')) fs.rmSync(tempRoot, { recursive: true, force: true });
}
