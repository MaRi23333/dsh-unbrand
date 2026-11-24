const FACTORY_SECTIONS = new Set(['harness:identity', 'harness:source', 'app:web-surface']);
const MAX_TEMPLATES = 128;
const MAX_BYTES = 256 * 1024;

/** Passive, bounded catalog of exact factory section text already assembled by the host. */
export function createTemplateCatalog() {
  let live = true, bytes = 0, templates = Object.freeze([]);
  const seen = new Set();
  return {
    snapshot: () => templates,
    async observe(_assembly, _context, next) {
      // The waterfall's returned assembly is authoritative; never reassemble
      // or invoke a registered provider to discover its contents.
      const assembled = await next();
      if (live && Array.isArray(assembled?.sections)) {
        for (const section of assembled.sections) {
          if (!FACTORY_SECTIONS.has(section?.name) || typeof section.text !== 'string') continue;
          const text = section.text;
          if (!text || seen.has(text) || (section.interpolate !== false && /\{\{[\s\S]*?\}\}/u.test(text))) continue;
          const size = Buffer.byteLength(text, 'utf8');
          // Keep old exact templates so concurrent scopes and repeated requests
          // retain stable projections even when later assemblies differ.
          if (templates.length >= MAX_TEMPLATES || bytes + size > MAX_BYTES) continue;
          seen.add(text);
          bytes += size;
          templates = Object.freeze([...templates, text]);
        }
      }
      return assembled;
    },
    dispose() {
      live = false;
      bytes = 0;
      seen.clear();
      templates = Object.freeze([]);
    },
  };
}
