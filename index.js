import { registerSettingsPresentation } from './settings.js';
import { presentRequest, selected } from './policy.js';
import { createTemplateCatalog } from './adaptive.js';
export { Config } from './settings.js';

export const name = 'unbrand';
export const inject = ['llm'];

// The public stream hook cannot replace its arguments. Intercept only the
// per-instance final presentation function when the host exposes its known shape.
// No provider re-registration, nested call, prototype patch or transport change.
function installProjection(service, matches, templates) {
  const key = 'forAdapter', proto = Object.getPrototypeOf(service);
  const original = Object.getOwnPropertyDescriptor(proto, key)?.value;
  if (Object.hasOwn(service, key) || typeof original !== 'function' || original.length !== 2) {
    throw new Error('Unsupported or already customized LLM adapter boundary. Context privacy was not activated.');
  }
  let live = true;
  function present(options, adapter) {
    const ready = Reflect.apply(original, this, arguments);
    return live && matches(ready) ? presentRequest(ready, templates.snapshot()) : ready;
  }
  Object.defineProperty(service, key, { configurable: true, writable: true, value: present });
  return () => {
    live = false;
    if (Object.getOwnPropertyDescriptor(service, key)?.value === present) delete service[key];
  };
}

export function apply(ctx, config) {
  const matches = route => selected(config.enabled.get(), config.models.get(), route);
  const templates = createTemplateCatalog();
  ctx.effect(() => {
    const dispose = installProjection(ctx.llm, matches, templates);
    return () => { templates.dispose(); dispose(); };
  });
  // Optional service: existing behavior remains available on hosts without it.
  // The injected child's event listener follows the plugin/service lifetime.
  ctx.inject(['systemPrompt'], (child) => {
    child.on('system-prompt/assemble', templates.observe);
  });
  registerSettingsPresentation(ctx);
}
