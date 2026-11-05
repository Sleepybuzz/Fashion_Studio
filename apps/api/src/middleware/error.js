import { env } from '../config/env.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}` } });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Upload failed';
    return res.status(400).json({ error: { message } });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { message: 'A record with these details already exists' } });
  }
  if (err.isOperational) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  // Unknown errors: log server-side, never leak internals.
  console.error('[error]', err.message, env.isProd ? '' : err.stack);
  return res.status(500).json({ error: { message: 'Internal server error' } });
};
