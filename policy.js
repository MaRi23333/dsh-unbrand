// The model route and the host's own message provenance are the only selectors.
export function selected(enabled, rules, route) {
  if (!enabled || typeof route?.model !== 'string' || !Array.isArray(rules)) return false;
  return rules.some(rule => typeof rule === 'string' && (rule.includes('::')
    ? typeof route.provider === 'string' && rule === route.provider + '::' + route.model
    : rule === route.model));
}

const identity = 'You are an AI agent powered by DeepSeek Harness.';
const sourceIntro = 'The runtime context names the DeepSeek Harness implementation checkout.';
const webIntro = 'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.';
const sourceTail = 'Use this checkout only to inspect or extend DSH itself.';
const webTail = 'because only dsh web injects window.__DSH_BOOT__.';
const legacySource = /^The DeepSeek Harness implementation checkout is at (?:"(?:\\.|[^"\\])*"|(?:(?!\. )[^\r\n])+?)\.(?= The checkout location and current working directory are separate values)/;
const legacyWeb = /^You are interacting with the user through the DeepSeek Harness Web GUI at (?:"(?:\\.|[^"\\])*"|https?:\/\/\S+?)\.(?= When the user refers to "this page")/;
const starts = (line, sentence) => line.startsWith(sentence) && (line.length === sentence.length || /^\s/.test(line[sentence.length]));

function projectLine(line) {
  if (starts(line, identity)) return 'You are an AI assistant.' + line.slice(identity.length);
  let rest;
  if (starts(line, sourceIntro) || legacySource.test(line)) {
    rest = line.startsWith(sourceIntro) ? line.slice(sourceIntro.length) : line.replace(legacySource, '');
    return 'Treat the application source and the workspace as distinct locations.' +
      rest.replace(sourceTail, 'Use this checkout only to inspect or extend the application itself.');
  }
  if (starts(line, webIntro) || legacyWeb.test(line)) {
    rest = line.startsWith(webIntro) ? line.slice(webIntro.length) : line.replace(legacyWeb, '');
    return 'The user is interacting through a web interface.' +
      rest.replace(webTail, 'because its boot data is supplied by the running application.');
  }
  return line;
}

function systemText(text) {
  if (!text.includes('DeepSeek Harness')) return text;
  // Rendered sections are separated by blank lines. Do not rewrite quotations
  // in the middle of another paragraph, indented commands, or fenced examples.
  let fresh = true, fence;
  return text.replace(/[^\r\n]+|\r\n|\n|\r/g, (line, offset) => {
    if (line === '\r\n' || line === '\n' || line === '\r') {
      if (offset === 0 || /[\r\n]/.test(text[offset - 1])) fresh = true;
      return line;
    }
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      fresh = false;
      return line;
    }
    if (marker) fence = marker[1];
    const projected = fresh && !marker ? projectLine(line) : line;
    fresh = !line.trim();
    return projected;
  });
}

const heading = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.';
const cleared = 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.';
// Match the first line as actually emitted: a specific attribution, a
// JSON-encoded string, and a full stop. Never remove an entire context by name.
const locations = new Map([
  ['harness:source', /^Current DeepSeek Harness implementation checkout: "(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"\.(?:\r?\n|$)/],
  ['app:web-surface', /^Current DeepSeek Harness Web GUI URL: "(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"\.(?:\r?\n|$)/],
]);
// Only the stock opening carries the two branding tokens. A workspace path,
// additional writable roots or appended policy text can contain the same words.
const sandboxOpening = /^Current DSH file policy: (?:(?:read-only|workspace-write)\. Any available operation enforced by the DSH file sandbox|danger-full-access\. The DSH file sandbox)(?= )/;
function projectSection(name, text) {
  if (name === 'sandbox:policy') {
    return text.replace(sandboxOpening, opening => opening.replaceAll('DSH ', ''));
  }
  const pattern = locations.get(name);
  return pattern ? text.replace(pattern, '') : text;
}

// Share untouched values. When the host supplies frozen envelopes, replacements
// have the same immutability without freezing or cloning unrelated caller data.
const like = (previous, next) => Object.isFrozen(previous) ? Object.freeze(next) : next;
function mapChanged(values, fn) {
  let out;
  for (let index = 0; index < values.length; index++) {
    const value = fn(values[index]);
    if (!out && value !== values[index]) out = values.slice(0, index);
    if (out && value !== undefined) out.push(value);
  }
  return out ? like(values, out) : values;
}

function runtimeSnapshot(msg) {
  const {sections, form} = msg.source;
  if (form !== 'snapshot' || !Array.isArray(sections) ||
      !sections.every(s => s && typeof s.text === 'string') ||
      !sections.some(s => s.name === 'sandbox:policy' || locations.has(s.name))) return msg;
  // The host emits one text block. If another middleware has changed its
  // shape, do not infer offsets or rebuild it from potentially unredacted metadata.
  if (msg.content.length !== 1 || msg.content[0]?.type !== 'text' || typeof msg.content[0].text !== 'string') return msg;
  const block = msg.content[0], prefix = heading + '\n\n';
  if (!block.text.startsWith(prefix)) return msg;
  const body = block.text.slice(prefix.length);
  if (sections.map(s => s.text).join('\n\n') !== body) {
    // Alignment is ambiguous after a redaction: leave the whole message as
    // supplied. Even identical text may belong to an unrelated section.
    return msg;
  }
  const kept = mapChanged(sections, s => {
    const value = projectSection(s.name, s.text);
    return value === s.text ? s : value ? like(s, {...s, text: value}) : undefined;
  });
  if (kept === sections) return msg;
  const text = kept.length ? prefix + kept.map(s => s.text).join('\n\n') : cleared;
  const content = like(msg.content, [like(block, {...block, text})]);
  return like(msg, {...msg, content, source: like(msg.source, {...msg.source, sections: kept})});
}

const instructionsIntro = 'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.';
const baselineIntros = [instructionsIntro, 'This complete workspace instruction baseline replaces all earlier workspace instruction baselines. ' + instructionsIntro];
function projectInstructionHeading(msg) {
  const { form, baseline, changes } = msg.source;
  const first = changes?.[0];
  if (form !== 'instructions' || baseline !== true || first?.scope !== 'user-global\0AGENTS.md' ||
      first.action !== 'set' || (first.path !== '~/.dsh/AGENTS.md' && first.path !== '$DSH_HOME/AGENTS.md')) return msg;
  const [block] = msg.content;
  if (msg.content.length !== 1 || block?.type !== 'text' || typeof block.text !== 'string') return msg;
  // Identify the first producer-written heading before any file body. Never
  // search the instructions themselves or rewrite a path used by a tool.
  for (const intro of baselineIntros) {
    const lead = '<system-reminder>\n' + intro + '\n\n';
    const header = lead + 'Instructions from: ' + first.path;
    if (!block.text.startsWith(header + '\n\n')) continue;
    const text = lead + 'User-global instructions (AGENTS.md):' + block.text.slice(header.length);
    return like(msg, {...msg, content: like(msg.content, [like(block, {...block, text})])});
  }
  return msg;
}

function projectMessage(msg) {
  if (!Array.isArray(msg?.content)) return msg;
  if (msg.role === 'user' && msg.source?.kind === 'runtime-context') return runtimeSnapshot(msg);
  if (msg.role === 'user' && msg.source?.kind === 'agent-instructions') return projectInstructionHeading(msg);
  if (msg.role !== 'system' || msg.source?.kind !== 'system-prompt') return msg;
  const content = mapChanged(msg.content, block => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block;
    const text = systemText(block.text);
    return text === block.text ? block : like(block, {...block, text});
  });
  return content === msg.content ? msg : like(msg, {...msg, content});
}

export function presentRequest(request) {
  if (!Array.isArray(request.messages)) return request;
  const messages = mapChanged(request.messages, projectMessage);
  return messages === request.messages ? request : like(request, {...request, messages});
}
