import { badRequest } from '../../utils/AppError.js';
import { COLOR_KEYS, MATERIAL_KEYS } from './garments.presets.js';

/**
 * Pure helpers for saved-design configurations (no database access, easy to test).
 *
 * A configuration is: { colorKey: string|null, materialKey: string|null, options: { [optionKey]: valueKey } }
 * `null` colour/material means "keep the model's original look".
 * `options` here is the product's current option list: [{ key, values: [{ key }] }]
 */

/** Collect everything wrong with a configuration. Returns a map of field -> message (empty when valid). */
export function findConfigProblems(config, options) {
  const problems = {};
  if (config.colorKey != null && !COLOR_KEYS.has(config.colorKey)) problems.colorKey = 'Unknown colour';
  if (config.materialKey != null && !MATERIAL_KEYS.has(config.materialKey)) problems.materialKey = 'Unknown material';
  const byKey = new Map(options.map((o) => [o.key, o]));
  for (const [optKey, valKey] of Object.entries(config.options || {})) {
    const opt = byKey.get(optKey);
    if (!opt) problems[`options.${optKey}`] = 'This option is not available for the product';
    else if (!opt.values.some((v) => v.key === valKey)) problems[`options.${optKey}`] = 'Unknown value for this option';
  }
  return problems;
}

/**
 * Validate a client configuration against the product's real options and return a normalised copy
 * with a value for every option (first value is the default).
 * @throws {import('../../utils/AppError.js').AppError} 400 listing the invalid fields
 */
export function normalizeConfig(config, options) {
  const problems = findConfigProblems(config, options);
  if (Object.keys(problems).length) throw badRequest('Invalid customization', problems);
  const selected = {};
  for (const opt of options) selected[opt.key] = config.options?.[opt.key] ?? opt.values[0].key;
  return { colorKey: config.colorKey ?? null, materialKey: config.materialKey ?? null, options: selected };
}
