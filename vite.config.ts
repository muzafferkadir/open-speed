import { defineConfig } from 'vite';

export default defineConfig({
 // assets/ holds the generated 3D models the game loads; raw sources stay outside the repo.
 publicDir: 'assets',
 // model.html is the agent-facing model viewer (four fixed views + measured summary).
 build: { outDir: 'build/dist', rollupOptions: { input: { index: 'index.html', model: 'model.html' } } },
 // npm run dev:host binds every interface; Vite rejects unknown Host headers, so the
 // tailnet names have to be listed here or the tab loads a blocked-request error.
 // MagicDNS serves both the short name and the full one, and a phone may use either.
 server: { allowedHosts: ['.ts.net', 'macbook-air'] },
});
