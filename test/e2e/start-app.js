import { seed } from './seed.js';

await seed();
const { startServer } = await import('../../server.js');
await startServer();
