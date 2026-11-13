import Schema from '@deepseek-ai/schemastery';

export const DEFAULT_MODELS = Object.freeze([]);

// Keep equivalent to client.js; tests compare Config validation with the form.
// Reserve one :: separator for provider scoping; slashes and single colons are ID characters.
export const MODEL_EXPRESSION_PATTERN = /^(?!.*\s)(?:(?!::)\S)+(?:::(?:(?!::)\S)+)?$/u;

/** Whole-list references keep arbitrary model additions editable without remounting. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  models: Schema.array(Schema.string().pattern(MODEL_EXPRESSION_PATTERN).required())
    .default([...DEFAULT_MODELS]).volatile(),
});

/** The dedicated settings section is the only editor; keep the native config store. */
export function registerSettingsPresentation(ctx) {
  return ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
}
