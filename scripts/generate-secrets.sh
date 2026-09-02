#!/usr/bin/env sh
set -eu
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
printf 'DASHBOARD_API_KEY=%s\n' "$(openssl rand -hex 32)"
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)"
