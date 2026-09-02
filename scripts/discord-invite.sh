#!/usr/bin/env sh
set -eu
CLIENT_ID="${1:-${DISCORD_CLIENT_ID:-}}"
if [ -z "$CLIENT_ID" ]; then
  echo "Usage: ./scripts/discord-invite.sh YOUR_DISCORD_CLIENT_ID" >&2
  exit 1
fi
# View Channels + Send Messages + Manage Messages + Embed Links + Read Message History
# + Create Public Threads + Send Messages in Threads + Moderate Members.
# Administrator is intentionally not requested.
PERMISSIONS=1408749366272
printf 'https://discord.com/oauth2/authorize?client_id=%s&permissions=%s&integration_type=0&scope=bot%%20applications.commands\n' "$CLIENT_ID" "$PERMISSIONS"
