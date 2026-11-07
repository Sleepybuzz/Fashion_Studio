// pm2: `pm2 start deploy/ecosystem.config.cjs && pm2 save`. Secrets stay in apps/api/.env, not here.
module.exports = { apps: [{ name: 'afs-api', cwd: 'apps/api', script: 'src/server.js', instances: 1, env: { NODE_ENV: 'production' }, max_memory_restart: '512M' }] };
