# ngrok — phone access for the voice UI

Exposes the voice server (`voice/server.js`, port **8787**) on an HTTPS URL so a
phone can open the call screen, and optionally the coordinator dashboard
(`frontend/`, port **5173**).

HTTPS matters: `getUserMedia` (the microphone) only works in a secure context,
so `http://<your-LAN-IP>:8787` will not work on a phone.

> Why ngrok and not Cloudflare Tunnel? This network blocks outbound port 7844,
> which cloudflared's edge requires (both QUIC and HTTP/2), so no Cloudflare
> tunnel can connect from here. ngrok's agent uses 443, which is allowed.
> `api/cloudflare/` is kept for networks where 7844 is open.

## One-time setup

```bash
./install-ngrok.sh                       # downloads ngrok into ./bin (no sudo)
./bin/ngrok config add-authtoken <TOKEN> # from https://dashboard.ngrok.com/get-started/your-authtoken
```

The authtoken is stored in `~/.config/ngrok/ngrok.yml` and is never committed.

## Run

```bash
# Voice call UI (phone) -> the static domain
cd voice && node server.js               # http://localhost:8787
cd ../api/ngrok && ./tunnel.sh           # https://modest-exactly-asp.ngrok-free.app

# Coordinator dashboard (computer) -> a random ngrok URL
cd frontend && npm run dev               # http://localhost:5173
cd ../api/ngrok && ./dashboard.sh        # prints https://<random>.ngrok-free.app
```

| File | Purpose |
|------|---------|
| `install-ngrok.sh` | Downloads the ngrok agent into `./bin` (skips if present) |
| `tunnel.sh` | Tunnels the voice UI; uses `NGROK_DOMAIN` (default `modest-exactly-asp.ngrok-free.app`) |
| `dashboard.sh` | Tunnels the dashboard on a random URL |
| `.gitignore` | Keeps the downloaded binary and logs out of git |

## Phone steps

1. Open the voice URL on the phone.
2. ngrok's free tier shows a **"You are about to visit…"** page once — tap
   **Visit** (a cookie suppresses it for 7 days).
3. Allow the microphone, pick the participant, tap the green call button.
   Narrow screens auto-enter phone mode (the iPhone-style call screen).

## Notes

- **Public and unauthenticated.** Anyone with the link can reach the server
  (patient data + call endpoints) and spend your model keys. Share the link
  privately and stop the tunnel when you're done.
- The dashboard is **mock-driven**; its "Start call" does not drive the voice
  agent, so it will not reflect the phone's live call.
- Vite's host check rejects the ngrok Host header unless
  `server.allowedHosts` includes `.ngrok-free.app` (already set in
  `frontend/vite.config.ts`).
