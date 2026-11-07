/**
 * Pure configuration checks (no imports, no I/O) so they can be unit-tested without a database or .env file.
 * Returns a list of human-readable problems; an empty list means the configuration is acceptable.
 * @param {{isProd:boolean, jwtSecret:string, frontendOrigins:string[], seed:{adminPassword:string}}} cfg
 * @returns {string[]}
 */
export function validateConfig(cfg) {
  const problems = [];
  const weak = /^(change.?me|secret|password|example|test|jwt.?secret|your[-_ ])/i;
  if (weak.test(cfg.jwtSecret) || /^(.)\1+$/.test(cfg.jwtSecret)) {
    problems.push('JWT_SECRET looks like a placeholder. Generate a random one (see apps/api/.env.example).');
  }
  for (const origin of cfg.frontendOrigins) {
    try {
      const u = new URL(origin);
      if (!['http:', 'https:'].includes(u.protocol)) problems.push(`FRONTEND_URL entry "${origin}" must start with http:// or https://`);
      if (cfg.isProd && u.protocol !== 'https:') {
        problems.push(`FRONTEND_URL entry "${origin}" must use https:// in production (camera access also requires HTTPS).`);
      }
      if (cfg.isProd && ['localhost', '127.0.0.1'].includes(u.hostname)) {
        problems.push(`FRONTEND_URL entry "${origin}" points at localhost in production.`);
      }
    } catch {
      problems.push(`FRONTEND_URL entry "${origin}" is not a valid URL.`);
    }
  }
  if (!cfg.frontendOrigins.length) problems.push('FRONTEND_URL is empty.');
  return problems;
}
