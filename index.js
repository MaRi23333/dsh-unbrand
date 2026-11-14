import { registerSettingsPresentation } from './settings.js';
import { presentRequest, selected } from './policy.js';
export { Config } from './settings.js';

export const name = 'unbrand';
export const inject = ['llm'];

// The public stream hook cannot replace its arguments. Intercept only the
// per-instance final presentation function when the host exposes its known shape.
// No provider re-registration, nested call, prototype patch or transport change.
function installProjection(service, matches) {
  const key = 'forAdapter', proto = Object.getPrototypeOf(service);
  const original = Object.getOwnPropertyDescriptor(proto, key)?.value;
  if (Object.hasOwn(service, key) || typeof original !== 'function' || original.length !== 2) {
    throw new Error('Unsupported or already customized LLM adapter boundary. Context privacy was not activated.');
  }
  let live = true;
  function present(options, adapter) {
    const ready = Reflect.apply(original, this, arguments);
    return live && matches(ready) ? presentRequest(ready) : ready;
  }
  Object.defineProperty(service, key, { configurable: true, writable: true, value: present });
  return () => {
    live = false;
    if (Object.getOwnPropertyDescriptor(service, key)?.value === present) delete service[key];
  };
}

export function apply(ctx, config) {
  const matches = route => selected(config.enabled.get(), config.models.get(), route);
  ctx.effect(() => installProjection(ctx.llm, matches));
  registerSettingsPresentation(ctx);
}
