# Cloudflare Tunnel — phone access for the voice UI

Expose the voice server (`voice/server.js`, port **8787**) on a public HTTPS URL so a
phone can open the call screen. HTTPS matters: `getUserMedia` (the microphone) is
only available in a secure context, so `http://<your-LAN-IP>:8787` will **not**
work on a phone. A tunnel fixes that without touching the router.

The computer's own browser keeps using `http://localhost:8787`; only the phone
needs the tunnel. Both hit the same server, so they share the same call session.

## Quick start

```bash
# 1. Start the voice server (in the repo root, another terminal)
cd voice && node server.js          # → http://localhost:8787

# 2. Start a Quick Tunnel
cd api/cloudflare
./tunnel.sh                          # prints https://<random>.trycloudflare.com
```

Open the printed `https://…trycloudflare.com` URL on the phone, allow the
microphone, pick the participant, and tap the green call button.

`tunnel.sh` downloads `cloudflared` into `./bin/` on first run (no sudo, nothing
installed system-wide). Run `./install-cloudflared.sh` on its own if you prefer.

## Files

| File | Purpose |
|------|---------|
| `tunnel.sh` | Starts a Quick Tunnel to `http://localhost:8787` (override with `--port` / `--url`) |
| `install-cloudflared.sh` | Downloads `cloudflared` into `./bin/` (skips if already installed) |
| `config.yml.example` | Template for a **named** tunnel with a stable hostname |
| `.gitignore` | Keeps the downloaded binary and logs out of git |

## Quick Tunnel vs named tunnel

- **Quick Tunnel** (`tunnel.sh`) — no account, one command, random
  `*.trycloudflare.com` URL that **changes every run**. Perfect for a demo.
- **Named tunnel** (`config.yml.example`) — needs a Cloudflare account and a
  domain on Cloudflare; gives a stable hostname. Use it if you need the same URL
  across restarts.

## Security

A Quick Tunnel is **public** and has no authentication. Anyone with the URL can
reach the server (including patient data and the call endpoints). The random
subdomain is hard to guess, but treat the link as a secret:

- share it only with the phone you're demoing on;
- stop the tunnel (`Ctrl-C`) as soon as you're done.

## Troubleshooting

- **No microphone on the phone** — you're on `http://`, not the `https://` tunnel
  URL, or the browser blocked the mic. Confirm the URL starts with `https://`.
- **The call drops after a while** — Cloudflare's free tier closes *idle*
  WebSocket connections after ~100 s. The mic streams continuously while
  unmuted, so this is rarely hit; Deepgram also closes a silent stream after
  ~10 s. If you see drops, keep the mute button off while the agent is quiet.
- **`cloudflared: command not found`** — run `./install-cloudflared.sh`, or call
  `./bin/cloudflared` directly.
- **404 / blank page** — make sure the voice server is running on 8787 and that
  you passed the right `--port`.
