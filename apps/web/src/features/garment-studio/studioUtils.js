/** Pure helpers shared by the studio, saved designs and the admin preview. */

/** First value of every option = default selection. @returns {Record<string,string>} */
export function defaultSelections(options) {
  return Object.fromEntries(options.map((o) => [o.key, o.values[0]?.key]));
}

/** Ordered show/hide rules for the currently selected option values. */
export function buildVisibilityRules(options, selections) {
  const rules = [];
  for (const o of options) {
    const v = o.values.find((x) => x.key === selections[o.key]) || o.values[0];
    if (v) rules.push({ show: v.show || [], hide: v.hide || [] });
  }
  return rules;
}

/**
 * Turn a saved configuration into valid studio state, silently dropping anything the product
 * no longer offers. `dropped` is true when something had to be reset.
 */
export function resolveConfig(config, studio) {
  const colorOk = config?.colorKey && studio.colors.some((c) => c.key === config.colorKey);
  const materialOk = config?.materialKey && studio.materials.some((m) => m.key === config.materialKey);
  const selections = defaultSelections(studio.options);
  let dropped = !!((config?.colorKey && !colorOk) || (config?.materialKey && !materialOk));
  for (const [k, v] of Object.entries(config?.options || {})) {
    const opt = studio.options.find((o) => o.key === k);
    if (opt && opt.values.some((x) => x.key === v)) selections[k] = v;
    else dropped = true;
  }
  return { colorKey: colorOk ? config.colorKey : null, materialKey: materialOk ? config.materialKey : null, selections, dropped };
}

export const stateSignature = (s) => JSON.stringify({ c: s.colorKey, m: s.materialKey, o: s.selections });
