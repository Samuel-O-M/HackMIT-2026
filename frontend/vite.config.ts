import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serve `data/trials/` at /protocol-docs in dev, so an uploaded
 * Clinical Study Protocol can be opened from the app without duplicating a
 * 3 MB PDF into the frontend bundle. In production the backend serves these.
 */
function protocolDocs(): Plugin {
  const root = resolve(process.cwd(), '..', 'data', 'trials');
  const TYPES: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  return {
    name: 'protocol-docs',
    configureServer(server) {
      server.middlewares.use('/protocol-docs', (req, res, next) => {
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
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), protocolDocs()],
  server: {
    port: 5173,
    // The fixtures live in the repo's data/ directory, one level up.
    fs: { allow: ['..'] },
  },
});
