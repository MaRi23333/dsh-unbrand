#!/usr/bin/env node
/** Pack the real archive, enforce its entire file list, and load its runtime offline. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = [
  'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE', 'README.en.md', 'README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
  'assets/settings-en.png', 'assets/settings-zh.png',
  'client.js', 'cordis.patch.yml', 'icon.svg', 'index.js',
  'locale/en.json', 'locale/zh.json', 'package.json', 'policy.js', 'settings.js',
].sort();
const work = fs.mkdtempSync(path.join(tmpdir(), 'dsh-unbrand-pack-'));

function npmPack() {
  const nodeDir = path.dirname(process.execPath);
  const cli = [
    process.env.npm_execpath,
    path.join(nodeDir, 'node_modules/npm/bin/npm-cli.js'),
    path.join(nodeDir, '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find(candidate => candidate && path.basename(candidate) === 'npm-cli.js' && fs.existsSync(candidate));
  assert.ok(cli, 'Cannot locate npm-cli.js; run with npm run check:pack');
  const result = spawnSync(process.execPath, [cli, 'pack', '--json', '--ignore-scripts', '--pack-destination', work], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'npm pack failed');
  const [pack] = JSON.parse(result.stdout);
  assert.deepEqual(pack.files.map(file => file.path).sort(), expected, 'npm pack file whitelist changed');
  assert.equal(path.basename(pack.filename), pack.filename, 'Unexpected tarball name');
  return pack;
}

// npm emits a simple tar archive for these short ASCII filenames. Reject links,
// extensions and unexpected entries rather than extracting an unreviewed format.
function unpack(filename) {
  const tar = gunzipSync(fs.readFileSync(filename));
  const files = new Map();
  const field = (header, offset, length) => header.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/su, '');
  let offset = 0, terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { terminated = true; break; }
    const storedChecksum = field(header, 148, 8).trim();
    assert.match(storedChecksum, /^[0-7]+$/u, 'Invalid tar checksum');
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, Number.parseInt(storedChecksum, 8), 'Tar header checksum mismatch');
    const prefix = field(header, 345, 155);
    const name = (prefix ? prefix + '/' : '') + field(header, 0, 100);
    assert.ok(name.startsWith('package/'), 'Tar member must be under package/');
    const relative = name.slice('package/'.length);
    assert.ok(expected.includes(relative) && !files.has(relative), 'Unexpected or duplicate tar member: ' + name);
    assert.ok(header[156] === 0 || header[156] === 48, 'Tar member must be a regular file: ' + name);
    const sizeText = field(header, 124, 12).trim();
    assert.match(sizeText, /^[0-7]+$/u, 'Invalid tar file size');
    const size = Number.parseInt(sizeText, 8);
    const start = offset + 512;
    assert.ok(Number.isSafeInteger(size) && start + size <= tar.length, 'Truncated tar member');
    files.set(relative, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  assert.ok(terminated && tar.subarray(offset).every(byte => byte === 0), 'Invalid tar trailer');
  assert.deepEqual([...files.keys()].sort(), expected, 'Actual archive file whitelist changed');
  const directory = path.join(work, 'package');
  for (const [name, bytes] of files) {
    // Names have already passed the exact whitelist, before any filesystem write.
    const destination = path.join(directory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  return directory;
}

function checkIcon(svg) {
  // The icon contract is an SVG made of ordinary, quoted-attribute elements.
  // This deliberately rejects scripts, external resources and XML extensions.
  const tags = svg.match(/<[^>]+>/gu) ?? [];
  assert.equal(svg.replace(/<[^>]+>/gu, '').trim(), '', 'SVG must contain element markup only');
  assert.match(tags[0] ?? '', /^<svg\s/u, 'Missing SVG root');
  assert.match(tags[0], /\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(tags[0], /\bviewBox="[^"]+"/u);
  const stack = [];
  for (const tag of tags) {
    const close = tag.match(/^<\/([a-zA-Z][\w:-]*)\s*>$/u);
    if (close) { assert.equal(stack.pop(), close[1], 'Unbalanced SVG elements'); continue; }
    const open = tag.match(/^<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*\/?>$/u);
    assert.ok(open, 'Malformed SVG element or attribute');
    assert.ok(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'].includes(open[1]), 'Unsupported SVG element');
    assert.ok(!/\bon\w+\s*=|\bhref\s*=/iu.test(open[2]), 'Active SVG content is not allowed');
    if (!tag.endsWith('/>')) stack.push(open[1]);
  }
  assert.deepEqual(stack, [], 'Unclosed SVG elements');
  assert.equal(tags.at(-1), '</svg>');
}

async function smoke(directory) {
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.name, 'dsh-unbrand');
  assert.notEqual(manifest.private, true);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  assert.equal(manifest.repository.url, 'git+https://github.com/MaRi23333/dsh-unbrand.git');
  assert.equal(manifest.engines.node, '>=22.19.0');
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  const exports = {
    '.': './index.js', './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml',
    './client': './client.js', './locale/*.json': './locale/*.json', './icon': './icon.svg',
  };
  assert.deepEqual(manifest.exports, exports, 'Package export contract changed');
  assert.deepEqual(Object.keys(manifest.dependencies), ['@deepseek-ai/schemastery']);
  // Reuse only the locked dependencies from npm ci; the plugin modules themselves
  // are imported from the extracted tarball, outside the source checkout.
  // Copy rather than link so ordinary Windows accounts need no symlink privilege.
  fs.cpSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), { recursive: true, dereference: true });
  const entry = await import(pathToFileURL(path.join(directory, 'index.js')).href);
  assert.equal(entry.name, 'unbrand');
  assert.equal(typeof entry.apply, 'function');
  assert.deepEqual(entry.inject, ['llm']);
  const config = entry.Config({});
  assert.equal(config.enabled.get(), true);
  assert.deepEqual(config.models.get(), []);
  assert.deepEqual(entry.Config({ models: ['provider::family/model'] }).models.get(), ['provider::family/model']);
  assert.throws(() => entry.Config({ models: ['bad model'] }));
  class FakeLlm { forAdapter(options, _adapter) { return options; } }
  const llm = new FakeLlm(), hostDisposers = [], fiber = {};
  entry.apply({
    llm, fiber,
    effect(setup) { hostDisposers.push(setup()); },
    inject(names, setup) {
      assert.deepEqual(names, ['settings']);
      return setup({
        effect(effect) { hostDisposers.push(effect()); },
        settings: { configure(policy, owner) { assert.deepEqual(policy, { auto: false }); assert.equal(owner, fiber); return () => {}; } },
      });
    },
  }, config);
  assert.ok(Object.hasOwn(llm, 'forAdapter'), 'Packed host entry installs its instance projection');
  const unchanged = { provider: 'synthetic-provider', model: 'synthetic-model', messages: [] };
  assert.equal(llm.forAdapter(unchanged, {}), unchanged, 'Default empty rules preserve the request');
  for (const stop of hostDisposers.reverse()) stop();
  assert.equal(Object.hasOwn(llm, 'forAdapter'), false, 'Packed host entry restores its instance boundary');
  // This bundle has a single fixed YAML insert contract, not arbitrary YAML.
  assert.equal(read('cordis.patch.yml').replace(/\r\n/gu, '\n').trim(),
    '- insert:\n    - id: unbrand\n      name: dsh-unbrand\n      config: {}', 'Patch ID/package/default config contract changed');
  for (const language of ['zh', 'en']) {
    const locale = JSON.parse(read('locale/' + language + '.json'));
    assert.equal(typeof locale.meta.title, 'string');
    assert.ok(locale.meta.title.length > 0 && locale.meta.description.length > 0);
    const png = fs.readFileSync(path.join(directory, 'assets/settings-' + language + '.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.subarray(12, 16).toString(), 'IHDR');
    assert.ok(png.length >= 33 && png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  }
  assert.ok(read('README.md').includes('assets/settings-zh.png'));
  assert.ok(read('README.en.md').includes('assets/settings-en.png'));
  for (const document of expected.filter(name => name.endsWith('.md'))) {
    for (const match of read(document).matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/gu)) {
      const href = match[1] ?? match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(href)) continue;
      const target = decodeURIComponent(href.split(/[?#]/u)[0]);
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(document), target));
      assert.ok(expected.includes(relative), 'Broken packed documentation link: ' + document + ' -> ' + href);
      assert.ok(fs.statSync(path.join(directory, relative)).isFile(), 'Documentation link must point to a packed file');
    }
  }
  checkIcon(read('icon.svg'));
  let descriptor;
  vm.runInNewContext(read('client.js'), {
    window: { __ModuleLoader__: { load(value) { assert.equal(descriptor, undefined); descriptor = value; } } },
  }, { timeout: 1000, filename: 'packed-client.js' });
  assert.equal(descriptor.id, manifest.name);
  const client = descriptor.factory(name => {
    assert.equal(name, 'react');
    return { createElement: (type, props, ...children) => ({ type, props, children }) };
  });
  const disposers = [], slots = new Map();
  let dictionaries;
  client.apply({
    effect(setup) { disposers.push(setup()); },
    locale: {
      register(namespace, value) { assert.equal(namespace, entry.name); dictionaries = value; return () => {}; },
      bind: namespace => { assert.equal(namespace, entry.name); return key => dictionaries.en[key]; },
    },
    configForms: {
      get(namespace) { assert.equal(namespace, entry.name); return {}; },
      whileServed(names, setup) { assert.deepEqual([...names], [entry.name]); return setup(); },
    },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) } },
    slots: {
      inject: (_name, setup) => setup(),
      register(meta, component) {
        assert.equal(meta.id, entry.name);
        assert.ok(!slots.has(meta.name));
        slots.set(meta.name, { meta, component });
        return () => slots.delete(meta.name);
      },
    },
  });
  assert.deepEqual([...slots.keys()], ['settings.section', 'settings.section.icon']);
  for (const language of ['zh', 'en']) assert.ok(dictionaries[language].title);
  const icon = slots.get('settings.section.icon').component({ size: 24 });
  assert.equal(icon.type, 'svg');
  assert.equal(icon.props.width, 24);
  assert.equal(slots.get('settings.section').meta.label(), dictionaries.en.title);
  for (const stop of disposers.reverse()) stop();
  assert.equal(slots.size, 0, 'Client unload must remove the section and icon');
}

try {
  const pack = npmPack();
  await smoke(unpack(path.join(work, pack.filename)));
  console.log('Pack whitelist and extracted-runtime smoke OK (' + expected.length + ' files, ' + pack.size + ' bytes).');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
