import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
// Plain ESM modules shared with the production server.
// @ts-expect-error untyped server module
import { createCensus } from './server/census.mjs';
// @ts-expect-error untyped server module
import { createApi } from './server/api.mjs';
// @ts-expect-error untyped server module
import { createRooms } from './server/rooms.mjs';

// The real game server inside Vite's (dev and preview), so `npm run dev` is the whole app on one
// port: the same API and Census forwarder as server/server.mjs. Rooms live in this process: a
// restart of the dev server ends the local games.
function server(): Plugin {
  const census = createCensus({ site: 'yksi' });
  const games = createRooms();
  const api = createApi({ games });
  const ticker = setInterval(() => games.tick(), 5000);
  ticker.unref();

  const middleware = async (req: any, res: any, next: (error?: unknown) => void) => {
    try {
      if (await census(req, res)) return;
      if (await api.handle(req, res)) return;
      next();
    } catch (error) {
      next(error);
    }
  };
  return {
    name: 'yksi-server',
    configureServer: (s) => void s.middlewares.use(middleware),
    configurePreviewServer: (s) => void s.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [svelte(), server()],
  // Local previews only; the NAS port is in development/.claude/skills/portainer/ports.json.
  server: { port: 6710, strictPort: true },
  preview: { port: 6711, strictPort: true },
  build: {
    target: 'es2022',
    cssTarget: ['chrome123', 'safari17.5', 'firefox120'],
    // The dice's chunk is three.js and cannon-es (about 165 KB compressed), loaded after the first screen.
    chunkSizeWarningLimit: 700,
  },
});
