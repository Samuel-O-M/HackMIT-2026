<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Cloudflare Tunnel — phone access for the voice UI

> Expose the voice server (`voice/server.js`, port **8787**) on a public HTTPS
> URL so a phone can open the call screen.

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites.

HTTPS matters: `getUserMedia` (the microphone) is only available in a secure
context, so `http://<your-LAN-IP>:8787` will **not** work on a phone. A tunnel
fixes that without touching the router.

The computer's own browser keeps using `http://localhost:8787`; only the phone
needs the tunnel. Both hit the same server, so they share the same call session.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#quick-start">Quick start</a></li>
    <li><a href="#files">Files</a></li>
    <li><a href="#quick-tunnel-vs-named-tunnel">Quick Tunnel vs named tunnel</a></li>
    <li><a href="#security">Security</a></li>
    <li><a href="#troubleshooting">Troubleshooting</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

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
- **Tunnel will not connect at all** — the network may be blocking cloudflared's
  edge port (7844). Use [`api/ngrok/`](../ngrok/README.md) instead.

## License

Distributed under the MIT License. See [`../../LICENSE`](../../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
