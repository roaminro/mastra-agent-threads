import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { registerApiRoute } from '@mastra/core/server';

// Serves the built web app at /ui, next to the API and Studio. `pnpm build`
// writes it to src/mastra/public/ui, which `mastra build` copies next to the
// server; both `mastra dev` and the built server run from that folder.

export const WEB_BASE = '/ui';
const root = path.resolve('ui');

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serve(requestPath: string) {
  const relative = requestPath.slice(WEB_BASE.length).replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  // Anything that isn't a file inside the app folder gets the page itself.
  if (relative && file.startsWith(root + path.sep) && path.extname(file)) {
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
          // Vite puts a content hash in asset names, so they never change.
          'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
  try {
    const html = await readFile(path.join(root, 'index.html'));
    return new Response(html, { headers: { 'Content-Type': types['.html'], 'Cache-Control': 'no-cache' } });
  } catch {
    return new Response('The web app is not built. Run `pnpm build`.', { status: 404 });
  }
}

// Public so the sign-in page loads; every API call it makes still needs a token.
export const webRoutes = [WEB_BASE, `${WEB_BASE}/*`].map(route =>
  registerApiRoute(route, {
    method: 'GET',
    requiresAuth: false,
    handler: c => serve(c.req.path),
  }),
);
