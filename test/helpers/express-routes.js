import { buildContext } from './context.js';
import { createApp } from '../../server.js';


function routesOf(stack, out = []) {
  for (const layer of stack) {
    if (layer.route) {
      out.push({
        method: Object.keys(layer.route.methods).join(',').toUpperCase(),
        path: layer.route.path,
        handlers: layer.route.stack.map((routeLayer) => routeLayer.handle),
      });
    } else if (layer.handle?.stack) routesOf(layer.handle.stack, out);
  }
  return out;
}

export function appRoutes() {
  const { db, context } = buildContext();
  try {
    return routesOf(createApp(context.app).router.stack);
  } finally {
    db.close();
  }
}
