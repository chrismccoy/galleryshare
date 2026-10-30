import { positiveInt } from '../../lib/params.js';
import { notFound } from '../view/respond.js';

export function useIdParam(router, name = 'id', key = 'idParam') {
  router.param(name, (req, res, next, value) => {
    const id = positiveInt(value);
    if (!id) return notFound(res);
    req[key] = id;
    return next();
  });
}
