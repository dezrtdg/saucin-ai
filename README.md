# Saucin AI — Phase 1 Starter v0.3

Docker-ready foundation for the Saucin RP Discord/FiveM server intelligence system.

## Locked production URLs

Dashboard:

`https://ai.saucinrp.com`

Discord OAuth callback:

`https://ai.saucinrp.com/api/auth/callback`

The callback above is the exact URI to register in the Discord Developer Portal under **OAuth2 → Redirects**.

## What works now

- Watches Discord channels the bot can view.
- Stores monitored messages in PostgreSQL.
- Classifies messages as question / issue / suggestion / casual.
- Uses a low-cost AI classifier when `OPENAI_API_KEY` is configured, with a local rule fallback.
- Answers questions only when the channel permits it and approved knowledge matches.
- Matches issue reports against open known issues and counts affected players.
- Web dashboard with overview, recent AI activity, issues, knowledge, and channel policy controls.
- Discord OAuth staff login with allowlisted Discord user IDs and/or staff role IDs.
- PostgreSQL + pgvector ready for semantic retrieval, plus Redis for queues/caching.
- Optional Cloudflare Tunnel container profile for `ai.saucinrp.com`.
- Backend API bound to Unraid localhost only; it is not exposed to the LAN or Internet.
- Future tables already included for txAdmin/service events and announcements.

## 1. Configure Discord OAuth

In the Discord Developer Portal open your **Saucin AI** application.

Go to **OAuth2 → Redirects** and add exactly:

`https://ai.saucinrp.com/api/auth/callback`

Do not add a trailing slash.

Copy these values into `.env`:

- Application/Client ID → `DISCORD_CLIENT_ID`
- OAuth2 Client Secret → `DISCORD_CLIENT_SECRET`
- Bot Token → `DISCORD_TOKEN`
- Saucin RP Server ID → `DISCORD_GUILD_ID`

The dashboard requests only:

- `identify`
- `guilds.members.read`

This allows the site to identify the logged-in Discord user and verify that person's roles in the configured Saucin RP guild.

## 2. Discord bot permissions

Under **Bot → Privileged Gateway Intents**, enable:

- **Message Content Intent**

Presence Intent and Server Members Intent are not required for this starter.

Recommended bot permissions:

- View Channels
- Send Messages
- Send Messages in Threads
- Read Message History
- Embed Links

Do not grant Administrator.

After you have the Client ID, generate the bot installation URL with:

```bash
./scripts/discord-invite.sh YOUR_DISCORD_CLIENT_ID
```

## 3. Get staff IDs

In Discord enable **User Settings → Advanced → Developer Mode**.

Then copy:

- Server ID → `DISCORD_GUILD_ID`
- Your user ID → `DASHBOARD_ALLOWED_USER_IDS`
- Staff/Admin role ID(s) → `DASHBOARD_ALLOWED_ROLE_IDS`

For the first login, using your own user ID is the safest option. You can add staff roles after verifying access.

## 4. Configure `.env`

Place the project somewhere persistent, for example:

`/mnt/user/appdata/saucin-ai/project`

Copy `.env.example` to `.env` and generate local secrets:

```bash
./scripts/generate-secrets.sh
```

Your production-specific settings should include:

```env
DASHBOARD_PUBLIC_URL=https://ai.saucinrp.com

DISCORD_TOKEN=YOUR_SECRET_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_CLIENT_ID
DISCORD_CLIENT_SECRET=YOUR_SECRET_CLIENT_SECRET
DISCORD_GUILD_ID=YOUR_SERVER_ID

DASHBOARD_ALLOWED_USER_IDS=YOUR_DISCORD_USER_ID
DASHBOARD_ALLOWED_ROLE_IDS=

CLOUDFLARE_TUNNEL_TOKEN=YOUR_SECRET_TUNNEL_TOKEN
```

Never send the bot token, Discord client secret, session secret, database password, dashboard API key, OpenAI key, or Cloudflare tunnel token in chat or Discord.

## 5. Create the Cloudflare Tunnel

This assumes `saucinrp.com` is managed by Cloudflare.

In Cloudflare:

1. Go to **Networking → Tunnels**.
2. Create a tunnel named `saucin-ai`.
3. Copy the generated tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
4. Add a **Published application** route.
5. Hostname: `ai.saucinrp.com`.
6. Service type: `HTTP`.
7. Service URL: `http://dashboard:3000`.

Because the included `cloudflared` container joins the same Docker network as the dashboard, `dashboard` resolves directly to the dashboard container. No router port-forward is required.

Start the stack including the tunnel with:

```bash
docker compose --profile tunnel up -d --build
```

Check status:

```bash
docker compose --profile tunnel ps
```

Follow the tunnel logs:

```bash
docker compose logs -f cloudflared
```

Then browse to:

`https://ai.saucinrp.com`

The site should send you to Discord, then return to:

`https://ai.saucinrp.com/api/auth/callback`

and finally back to the dashboard.

## 6. Internal network layout

Public:

`ai.saucinrp.com → Cloudflare Tunnel → dashboard:3000`

Private Docker services:

- `api:3100`
- `postgres:5432`
- `redis:6379`

The API is also bound to `127.0.0.1:3100` on the Unraid host for local administration/testing only. It is not available from another LAN device.

## 7. Channel behavior

Every newly discovered channel starts with:

`DEFAULT_CHANNEL_MODE=monitor`

Dashboard modes:

- `monitor` — store/classify only; never reply.
- `questions` — answer verified questions from approved knowledge.
- `issues` — detect and respond to matching known issues.
- `suggestions` — detect suggestions silently.
- `full` — questions + issues + suggestions.
- `ignored` — do not store or process the channel.

Recommended rollout:

- `#general` → monitor
- `#support` / `#help` → questions
- `#bug-reports` → issues
- `#suggestions` → suggestions
- private staff areas → ignored unless intentionally monitored

## 8. OpenAI

`OPENAI_API_KEY` is optional for the first boot. Without it, Discord monitoring and local fallback classification still work, but generated answers are disabled.

The starter separates classification and reply models so high-volume monitoring can stay inexpensive.

## Security notes

- Do not expose the Unraid management GUI publicly.
- Do not port-forward dashboard port 3000 or API port 3100 on your router.
- Cloudflare Tunnel uses an outbound connection from Unraid.
- Only the dashboard hostname is published through the tunnel.
- PostgreSQL and Redis have no host-facing ports in this stack.
- The API is localhost-only until we create a dedicated authenticated FiveM bridge route.
- Never commit `.env` to Git.
- The bot intentionally does not receive Discord Administrator permission.

## Next build target

1. Bring v0.3 online at `ai.saucinrp.com` and verify Discord login.
2. Build the dashboard knowledge editor.
3. Add pgvector embedding ingestion + semantic knowledge search.
4. Add semantic known-issue matching and duplicate clustering.
5. Add “I'm having this issue too” button + issue report modal.
6. Add suggestion clustering and staff review.
7. Add `saucin_ai_bridge` for FiveM/txAdmin.
8. Add scheduled and event-driven announcements.
