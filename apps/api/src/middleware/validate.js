import { badRequest } from '../utils/AppError.js';

/**
 * Validate req[source] with a Zod schema and replace it with the parsed value.
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return next(badRequest('Validation failed', fields));
  }
  if (source === 'body') req.body = result.data;
  else req.validated = { ...(req.validated || {}), [source]: result.data };
  return next();
};
