import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves `patient_data/trials/` at /protocol-docs, so an uploaded Clinical Study
 * Protocol can be opened from the app without duplicating a 3 MB PDF into the
 * frontend bundle. In production the backend serves these.
 *
 * Mounted on both the dev server and `vite preview`. The dev server is heavy
 * and the OS can reap it under memory pressure, so preview has to be a
 * complete fallback rather than a degraded one.
 */
function protocolDocs(): Plugin {
  const root = resolve(process.cwd(), '..', 'patient_data', 'trials');
  const TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  function serve(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
    if (!name) return next();
    // Resolve, then confirm the result is still inside data/trials. String
    // checks on the raw path miss encodings; comparing resolved paths does not.
    const path = resolve(join(root, name));
    if (path !== root && !path.startsWith(root + sep)) return next();
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return next();
      res.setHeader('content-type', TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('content-length', String(stat.size));
      createReadStream(path).pipe(res);
    } catch {
      next();
    }
  }

  return {
    name: 'protocol-docs',
    configureServer(server) {
      server.middlewares.use('/protocol-docs', serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/protocol-docs', serve);
    },
  };
}

export default defineConfig({
  plugins: [react(), protocolDocs()],
  server: {
    port: 5173,
    // Reachable through the ngrok tunnel: the Host header is the ngrok domain,
    // which Vite's host check would otherwise reject with a 403.
    host: true,
    allowedHosts: ['.ngrok-free.app'],
    // The fixtures live in the repo's patient_data/ directory, one level up.
    fs: { allow: ['..'] },
  },
  preview: { port: 5173, strictPort: true },
});
