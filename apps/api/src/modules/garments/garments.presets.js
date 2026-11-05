/**
 * Colour and material presets offered in the 3D studio. Single source of truth: the API sends these
 * to the web app and validates saved configurations against them.
 *
 * Material presets are PBR parameter approximations (roughness / metalness / sheen). They do NOT
 * simulate fabric weave, drape or physics.
 */

export const COLOR_PRESETS = [
  { key: 'ivory', label: 'Ivory', hex: '#F2EDE3' },
  { key: 'sand', label: 'Sand', hex: '#D8CFC4' },
  { key: 'stone', label: 'Stone', hex: '#9A948C' },
  { key: 'charcoal', label: 'Charcoal', hex: '#3A3A3C' },
  { key: 'black', label: 'Black', hex: '#1A1A1A' },
  { key: 'navy', label: 'Navy', hex: '#1F2D4D' },
  { key: 'sky', label: 'Sky', hex: '#7FA8D1' },
  { key: 'forest', label: 'Forest', hex: '#2F5D46' },
  { key: 'sage', label: 'Sage', hex: '#A3B59A' },
  { key: 'burgundy', label: 'Burgundy', hex: '#6E2432' },
  { key: 'terracotta', label: 'Terracotta', hex: '#B8603E' },
  { key: 'mustard', label: 'Mustard', hex: '#D1A23B' },
  { key: 'blush', label: 'Blush', hex: '#E3B7B0' },
  { key: 'lavender', label: 'Lavender', hex: '#A08BC4' },
];

export const MATERIAL_PRESETS = [
  { key: 'cotton', label: 'Cotton', description: 'Matte, soft finish', roughness: 0.9, metalness: 0, sheen: 0.2, sheenRoughness: 0.9 },
  { key: 'linen', label: 'Linen', description: 'Very matte, dry look', roughness: 0.97, metalness: 0, sheen: 0, sheenRoughness: 1 },
  { key: 'wool', label: 'Wool', description: 'Matte with a soft fuzzy edge', roughness: 1, metalness: 0, sheen: 0.6, sheenRoughness: 0.8 },
  { key: 'denim', label: 'Denim', description: 'Dense, slightly rough', roughness: 0.85, metalness: 0, sheen: 0.1, sheenRoughness: 0.9 },
  { key: 'satin', label: 'Satin', description: 'Smooth with a soft sheen', roughness: 0.35, metalness: 0, sheen: 1, sheenRoughness: 0.35 },
  { key: 'leather', label: 'Leather', description: 'Semi-gloss finish', roughness: 0.5, metalness: 0.05, sheen: 0, sheenRoughness: 1 },
];

export const COLOR_KEYS = new Set(COLOR_PRESETS.map((c) => c.key));
export const MATERIAL_KEYS = new Set(MATERIAL_PRESETS.map((m) => m.key));
export const colorLabel = (key) => COLOR_PRESETS.find((c) => c.key === key)?.label ?? null;
export const materialLabel = (key) => MATERIAL_PRESETS.find((m) => m.key === key)?.label ?? null;
