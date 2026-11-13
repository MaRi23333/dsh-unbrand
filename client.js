window.__ModuleLoader__.load({
  id: 'dsh-unbrand',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'unbrand';
    const MODEL_EXPRESSION_PATTERN = /^(?!.*\s)(?:(?!::)\S)+(?:::(?:(?!::)\S)+)?$/u;

    const pickerCopy = {
      zh: {
        catalogSearch: '选择模型', catalogSearchHint: '按名称、ID 或供应商搜索；只对勾选的供应商生效。', catalogPlaceholder: '搜索模型或供应商',
        catalogLoading: '正在读取模型目录…', catalogError: '模型目录暂不可用，已选模型仍保留，可手动添加。',
        catalogPartial: '部分供应商读取失败，已选模型仍保留。', catalogEmpty: '没有可选模型，可手动添加模型 ID。',
        catalogNoMatch: '没有匹配的模型。', catalogMore: '仅显示前 80 项，请继续搜索缩小范围。', catalogRetry: '刷新目录',
        selectedRules: '已选模型', selectedEmpty: '尚未选择模型，请在上方勾选。', selectedEmptyManual: '尚未选择模型，可在下方手动添加。', removeRule: '移除',
        manualRule: '找不到模型？手动添加', manualLabel: '模型 ID', manualHint: '仅填模型 ID 会匹配所有供应商。限定供应商请填写 供应商ID::模型ID；不支持通配符。',
        addRule: '添加', manualInvalid: '请输入有效的模型 ID 或 供应商ID::模型ID，不含空白字符。',
        broadRule: '所有供应商', routeRule: '指定供应商', coveredRule: '此模型已选择所有供应商。先在下方移除，再单独选择供应商。',
      },
      en: {
        catalogSearch: 'Choose models', catalogSearchHint: 'Search by name, ID, or provider. Only the checked providers are affected.', catalogPlaceholder: 'Search models or providers',
        catalogLoading: 'Loading model catalog…', catalogError: 'Model catalog is unavailable. Your selections are kept; you can add IDs manually.',
        catalogPartial: 'Some providers could not be loaded. Your selections are kept.', catalogEmpty: 'No models are available. You can add a model ID manually.',
        catalogNoMatch: 'No matching models.', catalogMore: 'Showing the first 80 results. Refine your search to find more.', catalogRetry: 'Refresh catalog',
        selectedRules: 'Selected models', selectedEmpty: 'No models selected. Check a model above.', selectedEmptyManual: 'No models selected. Add an ID below.', removeRule: 'Remove',
        manualRule: 'Model missing? Add it manually', manualLabel: 'Model ID', manualHint: 'A model ID alone matches all providers. Use provider::model to limit it to one provider. Wildcards are not supported.',
        addRule: 'Add', manualInvalid: 'Enter a valid model ID or provider::model without whitespace.',
        broadRule: 'All providers', routeRule: 'One provider', coveredRule: 'Selected for all providers. Remove it below to choose individual providers.',
      },
    };
    const pickerCss = `
      .mcp-picker{display:flex;flex-direction:column;gap:14px;min-width:0}
      .mcp-picker-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600}
      .mcp-picker-heading .mcp-settings-button{padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-weight:400}
      .mcp-picker-input{box-sizing:border-box;min-width:0;width:100%;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);padding:8px 10px;color:var(--dsw-alias-label-primary);font:inherit}
      .mcp-picker-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:1}
      .mcp-picker-list{max-height:256px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;min-width:0}
      .mcp-picker-option{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer;transition:background .12s}
      .mcp-picker-option+.mcp-picker-option{border-top:.5px solid var(--dsw-alias-border-l2)}
      .mcp-picker-option:has(input:checked){background:var(--dsw-alias-state-business-tertiary)}
      .mcp-picker-option input{margin:3px 0 0;flex:none;accent-color:var(--dsw-alias-state-business-primary)}
      .mcp-picker-name{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere}
      .mcp-picker-title{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;font-weight:500}
      .mcp-picker-provider{font-size:12px;font-weight:400;line-height:1.5;padding:0 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;max-width:100%}
      .mcp-picker-selected{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:180px;overflow:auto}
      .mcp-picker-rule{display:flex;gap:8px;align-items:center;min-width:0;padding:7px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px}
      .mcp-picker-rule .mcp-picker-name{flex:1}.mcp-picker-rule button{flex:none;padding:4px 8px}
      .mcp-picker-advanced{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;min-width:0}
      .mcp-picker-advanced>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;padding:2px 0}
      .mcp-picker-advanced[open]>summary{margin-bottom:10px}
      .mcp-picker-manual{display:flex;align-items:flex-start;flex-wrap:wrap;gap:8px;min-width:0}.mcp-picker-manual input{flex:1;min-width:120px;width:auto}.mcp-picker-manual button{flex:none}
      .mcp-picker-input:focus-visible,.mcp-picker-option input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .mcp-picker-input:disabled,.mcp-picker-option:has(input:disabled){opacity:.6}
    `;

    function ModelRules({ models, onChange, disabled, loadCatalog, t }) {
      const id = React.useId();
      const [query, setQuery] = React.useState('');
      const [manual, setManual] = React.useState('');
      const [catalog, setCatalog] = React.useState({ status: 'loading', entries: [] });
      const [refresh, setRefresh] = React.useState(0);
      React.useEffect(() => {
        let active = true;
        setCatalog((previous) => ({ ...previous, status: 'loading' }));
        Promise.resolve().then(() => loadCatalog()).then((result) => {
          if (!active) return;
          if (!result?.ok || !Array.isArray(result.value?.groups)) throw new Error('catalog unavailable');
          const entries = [];
          const seen = new Set();
          for (const group of result.value.groups) {
            if (typeof group?.id !== 'string' || !Array.isArray(group.models)) continue;
            for (const model of group.models) {
              if (typeof model?.id !== 'string') continue;
              const expression = `${group.id}::${model.id}`;
              if (!MODEL_EXPRESSION_PATTERN.test(expression) || seen.has(expression)) continue;
              seen.add(expression);
              entries.push({ expression, modelId: model.id, provider: typeof group.name === 'string' ? group.name : group.id,
                name: typeof model.name === 'string' ? model.name : model.id });
            }
          }
          setCatalog({ status: result.value.failures?.length ? 'partial' : 'ready', entries });
        }).catch(() => { if (active) setCatalog((previous) => ({ ...previous, status: 'error' })); });
        return () => { active = false; };
      }, [loadCatalog, refresh]);
      const selected = new Set(models);
      const search = query.trim().toLocaleLowerCase();
      const matches = catalog.entries.filter((entry) => `${entry.provider}\n${entry.name}\n${entry.expression}`.toLocaleLowerCase().includes(search));
      const manualValue = manual.trim();
      const invalid = manualValue !== '' && !MODEL_EXPRESSION_PATTERN.test(manualValue);
      const remove = (expression) => { if (!disabled) onChange(models.filter((model) => model !== expression)); };
      const add = (expression) => { if (!disabled && !selected.has(expression)) onChange([...models, expression]); };
      const addManual = () => {
        if (disabled || !manualValue || invalid) return;
        add(manualValue);
        setManual('');
      };
      return h('div', { className: 'mcp-picker' },
        h('div', { className: 'mcp-settings-field' },
          h('div', { className: 'mcp-picker-heading' },
            h('label', { htmlFor: `${id}-search` }, t('catalogSearch')),
            h('button', { type: 'button', className: 'mcp-settings-button', disabled: catalog.status === 'loading',
              onClick: () => setRefresh((value) => value + 1) }, t('catalogRetry'))),
          h('input', { id: `${id}-search`, className: 'mcp-picker-input', type: 'search', value: query,
            placeholder: t('catalogPlaceholder'),
            'aria-describedby': `${id}-search-hint`, onChange: (event) => setQuery(event.target.value) }),
          h('p', { id: `${id}-search-hint`, className: 'mcp-settings-hint' }, t('catalogSearchHint'))),
        catalog.status !== 'ready' && h('p', { role: 'status', className: 'mcp-settings-hint' },
          t(catalog.status === 'loading' ? 'catalogLoading' : catalog.status === 'partial' ? 'catalogPartial' : 'catalogError')),
        matches.length > 0 && h('div', { className: 'mcp-picker-list', role: 'group', 'aria-label': t('catalogSearch') },
          ...matches.slice(0, 80).map((entry) => h('label', { key: entry.expression, className: 'mcp-picker-option' },
            h('input', { type: 'checkbox', checked: selected.has(entry.expression) || selected.has(entry.modelId), disabled: disabled || selected.has(entry.modelId),
              onChange: (event) => event.target.checked ? add(entry.expression) : remove(entry.expression) }),
            h('span', { className: 'mcp-picker-name' }, h('span', { className: 'mcp-picker-title' }, entry.name,
              h('span', { className: 'mcp-picker-provider' }, entry.provider)),
              h('span', { className: 'mcp-settings-hint' }, entry.expression),
              selected.has(entry.modelId) && h('span', { className: 'mcp-settings-hint' }, t('coveredRule')))))),
        matches.length > 80 && h('p', { className: 'mcp-settings-hint', role: 'status' }, t('catalogMore')),
        matches.length === 0 && (catalog.entries.length > 0 || catalog.status === 'ready') && h('p', { className: 'mcp-settings-hint', role: 'status' },
          t(catalog.entries.length ? 'catalogNoMatch' : 'catalogEmpty')),
        h('div', { className: 'mcp-settings-field' },
          h('span', { id: `${id}-selected` }, `${t('selectedRules')} · ${models.length}`),
          models.length === 0 ? h('p', { className: 'mcp-settings-hint' }, t(catalog.entries.length === 0 && catalog.status !== 'loading' ? 'selectedEmptyManual' : 'selectedEmpty')) :
            h('ul', { className: 'mcp-picker-selected', 'aria-labelledby': `${id}-selected` },
              ...models.map((expression, index) => {
                const entry = catalog.entries.find((item) => item.expression === expression);
                return h('li', { key: `${index}:${expression}`, className: 'mcp-picker-rule', 'data-expression': expression },
                h('span', { className: 'mcp-picker-name' }, h('span', { className: 'mcp-picker-title' }, entry?.name ?? expression,
                  h('span', { className: 'mcp-picker-provider' }, entry?.provider ?? t(expression.includes('::') ? 'routeRule' : 'broadRule'))),
                  entry && h('span', { className: 'mcp-settings-hint' }, expression)),
                h('button', { type: 'button', className: 'mcp-settings-button', disabled,
                  'aria-label': `${t('removeRule')}: ${expression}`, onClick: () => remove(expression) }, t('removeRule')));
              }))),
        h('details', { className: 'mcp-picker-advanced', open: catalog.entries.length === 0 && catalog.status !== 'loading' ? true : undefined },
          h('summary', null, t('manualRule')),
          h('div', { className: 'mcp-settings-field' },
          h('label', { htmlFor: `${id}-manual` }, t('manualLabel')),
          h('div', { className: 'mcp-picker-manual' },
            h('input', { id: `${id}-manual`, className: 'mcp-picker-input', value: manual, disabled, spellCheck: false,
              'aria-invalid': invalid, 'aria-describedby': `${id}-manual-hint${invalid ? ` ${id}-manual-error` : ''}`,
              onChange: (event) => setManual(event.target.value),
              onKeyDown: (event) => {
                if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); addManual(); }
              } }),
            h('button', { type: 'button', className: 'mcp-settings-button', disabled: disabled || !manualValue || invalid,
              onClick: addManual }, t('addRule'))),
          h('p', { id: `${id}-manual-hint`, className: 'mcp-settings-hint' }, t('manualHint')),
          invalid && h('p', { id: `${id}-manual-error`, className: 'mcp-settings-error', role: 'alert' }, t('manualInvalid')))));
    }

    const dictionaries = {
      zh: { ...pickerCopy.zh, title: '隐标', enabled: '启用隐标',
        summary: '只为选定的模型替换宿主身份说明。未选模型保持原样。', save: '保存', saving: '正在保存…',
        discard: '放弃修改', loading: '正在读取设置…', unavailable: '设置暂不可用。',
        readonly: '当前配置只读。', unchanged: '暂无修改', draft: '有未保存的修改', saved: '已保存，下次模型请求时生效。',
        disabledDraft: '保存后将停止替换身份说明，已选模型仍保留。', disabledSaved: '隐标已关闭，已选模型仍保留。',
        failed: '未能保存。修改仍保留；如有配置冲突，请放弃修改以载入最新值。' },
      en: { ...pickerCopy.en, title: 'Unbrand', enabled: 'Enable Unbrand',
        summary: 'Replace the host identity for selected models. Other models keep their original context.',
        save: 'Save', saving: 'Saving…', discard: 'Discard changes', loading: 'Loading settings…',
        unavailable: 'Settings are unavailable.', readonly: 'This configuration is read-only.', unchanged: 'No changes', draft: 'Unsaved changes',
        saved: 'Saved. Changes apply to the next model request.',
        disabledDraft: 'Save to stop replacing the identity. Your model selections will be kept.', disabledSaved: 'Unbrand is off. Your model selections are kept.',
        failed: 'Could not save. Your changes are kept. If the configuration changed elsewhere, discard the draft to reload it.' },
    };

    const css = `
      .mcp-settings{display:flex;flex-direction:column;gap:16px;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5}
      .mcp-settings-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-weight:600}
      .mcp-settings-toggle{width:18px;height:18px;flex:none;accent-color:var(--dsw-alias-state-business-primary)}
      .mcp-settings-field{display:flex;flex-direction:column;gap:6px;min-width:0}
      .mcp-settings-field>label,.mcp-settings-field>span:first-child{font-weight:600}
      .mcp-settings-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45;overflow-wrap:anywhere}
      .mcp-settings-actions,.mcp-settings-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .mcp-settings-footer{position:sticky;bottom:0;z-index:1;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
      .mcp-settings-footer::after{content:"";position:absolute;top:100%;left:0;right:0;height:24px;background:var(--dsw-alias-bg-layer-2);pointer-events:none}
      .mcp-settings-footer>p{flex:1;min-width:120px}
      .mcp-settings-button{font:inherit;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 12px;cursor:pointer}
      .mcp-settings-button:disabled{opacity:.5;cursor:default}
      .mcp-settings-button{transition:background .12s,opacity .12s}
      .mcp-settings-button:not(:disabled):hover,.mcp-picker-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .mcp-picker-option:has(input:checked):hover{background:var(--dsw-alias-state-business-tertiary)}
      .mcp-settings-button.mcp-primary:not(:disabled){color:white;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,#416fe1));border-color:transparent}
      .mcp-settings-button:focus-visible,.mcp-settings-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .mcp-settings-error{margin:0;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
    ` + pickerCss;

    function SettingsPage({ form, loadCatalog, t }) {
      const id = React.useId();
      const state = React.useSyncExternalStore(
        React.useCallback((notify) => form.subscribe(notify), [form]),
        React.useCallback(() => form.getSnapshot(), [form]));
      const [draft, setDraft] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState(null);
      const ready = state.status === 'ready' && state.value !== undefined;
      if (!ready) return h('p', {role:'status'}, t(state.status === 'loading' ? 'loading' : 'unavailable'));
      const current = draft ?? {enabled: state.value.enabled ?? true, models: state.value.models ?? [], revision: state.revision};
      const writable = state.writable && !busy;
      function edit(change) {
        if (!writable) return;
        setDraft({...current, ...change});
        setNotice(null);
      }
      async function save() {
        if (!writable || !draft) return;
        setBusy(true);
        setNotice(null);
        try {
          const ok = await form.mutate([
            { op:'set', path:['enabled'], value:current.enabled },
            { op:'set', path:['models'], value:current.models },
          ], current.revision);
          if (ok) setDraft(null);
          setNotice(ok ? 'saved' : 'failed');
        } catch { setNotice('failed'); }
        finally { setBusy(false); }
      }
      return h('section', {className:'mcp-settings', 'aria-label':t('title'), 'aria-busy':busy},
        h('style',null,css),
        h('div', null,
          h('p',{className:'mcp-settings-hint'},t('summary')),
          h('label',{htmlFor:id, className:'mcp-settings-row'},t('enabled'),
            h('input',{id,className:'mcp-settings-toggle',type:'checkbox',role:'switch',checked:current.enabled,
              disabled:!writable, onChange:e=>edit({enabled:e.target.checked})})),
          !current.enabled && h('p',{className:'mcp-settings-hint',role:'status'},t(draft?'disabledDraft':'disabledSaved'))),
        !state.writable && h('p',{className:'mcp-settings-hint',role:'status'},t('readonly')),
        h(ModelRules,{models:current.models, onChange:models=>edit({models}), disabled:!writable, loadCatalog, t}),
        h('div',{className:'mcp-settings-footer','data-dirty':!!draft},
          h('button',{type:'button',className:'mcp-settings-button mcp-primary',disabled:!writable || !draft,onClick:save},t(busy?'saving':'save')),
          draft && h('button',{type:'button',className:'mcp-settings-button',disabled:busy,onClick:()=>{setDraft(null);setNotice(null);}},t('discard')),
          h('p',{className:notice==='failed'?'mcp-settings-error':'mcp-settings-hint',role:notice==='failed'?'alert':'status'},t(notice??(draft?'draft':'unchanged')))));
    }

    function NavIcon({ size = 16 }) {
      return h('svg', {width:size,height:size,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,
        strokeLinejoin:'round',strokeLinecap:'round','aria-hidden':true},
        h('path',{d:'M10 2 17 5v4.2c0 4.1-3.3 6.9-7 8.8-3.7-1.9-7-4.7-7-8.8V5Z'}),
        h('rect',{x:7.5,y:9,width:5,height:4,rx:.8}),h('path',{d:'M8.5 9V7.8a1.5 1.5 0 0 1 3 0V9'}));
    }

    return {
      inject: ['slots','locale','configForms','remote','remote.session'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries));
        const t = ctx.locale.bind(NS);
        const form = ctx.configForms.get(NS);
        const loadCatalog = () => ctx.remote.session.modelCatalog();
        ctx.effect(() => ctx.configForms.whileServed([NS], () => {
          const offPage = ctx.slots.inject('settings.section', () => ctx.slots.register({
            name:'settings.section', id:NS, order:70, locale:NS, label:()=>t('title'),
            inject:()=>({form,loadCatalog}),
          }, SettingsPage));
          const offIcon = ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name:'settings.section.icon', id:NS,
          }, NavIcon));
          return () => { offIcon(); offPage(); };
        }));
      },
    };
  },
});
