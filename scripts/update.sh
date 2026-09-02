#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${SAUCIN_PROJECT_DIR:-/mnt/user/appdata/saucin-ai/project}"
REMOTE="${SAUCIN_GIT_REMOTE:-origin}"
BRANCH="${SAUCIN_GIT_BRANCH:-main}"
WAIT_SECONDS="${SAUCIN_UPDATE_WAIT_SECONDS:-8}"
NO_CACHE=0
CHECK_ONLY=0

usage() {
  cat <<'EOF'
Saucin AI one-command updater

Usage:
  ./scripts/update.sh
  ./scripts/update.sh --check
  ./scripts/update.sh --no-cache

Options:
  --check      Fetch GitHub and show what would change without installing it.
  --no-cache   Build affected Docker services without Docker build cache.
  -h, --help   Show this help.

Environment overrides:
  SAUCIN_PROJECT_DIR          Project path (default: /mnt/user/appdata/saucin-ai/project)
  SAUCIN_GIT_REMOTE           Git remote (default: origin)
  SAUCIN_GIT_BRANCH           Git branch (default: main)
  SAUCIN_UPDATE_WAIT_SECONDS  Seconds to wait before container verification (default: 8)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --no-cache) NO_CACHE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown option: $1"; usage; exit 2 ;;
  esac
  shift
done

cd "$PROJECT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: $PROJECT_DIR is not a Git repository."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is not clean."
  echo
  git status --short
  echo
  echo "Commit, stash, or remove local changes before updating."
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "ERROR: Git remote '$REMOTE' does not exist."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker was not found."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available."
  exit 1
fi

echo "=============================================="
echo " Saucin AI Updater"
echo "=============================================="
echo

echo "==> Fetching $REMOTE/$BRANCH"
git fetch "$REMOTE" "$BRANCH" --tags

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  echo
  echo "Saucin AI is already up to date."
  git log -1 --oneline --decorate
  exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL_SHA" "$REMOTE_SHA"; then
  echo
  echo "ERROR: Local branch and $REMOTE/$BRANCH have diverged."
  echo "The updater will not overwrite local Git history automatically."
  echo
  echo "Local : $LOCAL_SHA"
  echo "Remote: $REMOTE_SHA"
  exit 1
fi

CHANGED_FILES="$(git diff --name-only "$LOCAL_SHA" "$REMOTE_SHA")"

if [[ -z "$CHANGED_FILES" ]]; then
  echo "ERROR: Remote commit differs but no changed files were detected."
  exit 1
fi

echo
echo "==> Update available"
echo "Current: $(git log -1 --format='%h %s' "$LOCAL_SHA")"
echo "Latest : $(git log -1 --format='%h %s' "$REMOTE_SHA")"
echo
echo "Changed files:"
printf '  %s\n' $CHANGED_FILES

BUILD_API=0
BUILD_DASHBOARD=0
COMPOSE_CHANGED=0

while IFS= read -r file; do
  case "$file" in
    apps/api/*)
      BUILD_API=1
      ;;
    apps/dashboard/*)
      BUILD_DASHBOARD=1
      ;;
    docker-compose.yml)
      BUILD_API=1
      BUILD_DASHBOARD=1
      COMPOSE_CHANGED=1
      ;;
    package.json|package-lock.json|pnpm-lock.yaml|yarn.lock)
      BUILD_API=1
      BUILD_DASHBOARD=1
      ;;
  esac
done <<< "$CHANGED_FILES"

SERVICES=()
[[ "$BUILD_API" -eq 1 ]] && SERVICES+=("api")
[[ "$BUILD_DASHBOARD" -eq 1 ]] && SERVICES+=("dashboard")

echo
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  echo "Docker rebuild: not required"
else
  echo "Docker rebuild: ${SERVICES[*]}"
fi

if [[ "$COMPOSE_CHANGED" -eq 1 ]]; then
  echo "Note: docker-compose.yml changed. API/dashboard will be refreshed; database and Redis are not force-recreated automatically."
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo
  echo "Check complete. No files or containers were changed."
  exit 0
fi

rollback() {
  local reason="$1"
  echo
  echo "=============================================="
  echo " UPDATE FAILED — ROLLING BACK"
  echo " Reason: $reason"
  echo "=============================================="
  echo
  echo "==> Restoring source to $(git rev-parse --short "$LOCAL_SHA")"
  git reset --hard "$LOCAL_SHA"

  if [[ ${#SERVICES[@]} -gt 0 ]]; then
    echo
    echo "==> Rebuilding previous version: ${SERVICES[*]}"
    if docker compose build "${SERVICES[@]}" && docker compose up -d --force-recreate "${SERVICES[@]}"; then
      echo
      echo "Previous version restored."
      docker compose ps
    else
      echo
      echo "WARNING: Automatic container rollback also failed."
      echo "Source is restored to $LOCAL_SHA, but inspect Docker logs before continuing."
      docker compose ps || true
      docker compose logs --tail=100 "${SERVICES[@]}" || true
    fi
  fi

  echo
  echo "GitHub was NOT changed by this updater; only the local Unraid checkout was rolled back."
  exit 1
}

echo
echo "==> Fast-forwarding local source"
if ! git merge --ff-only "$REMOTE_SHA"; then
  rollback "Git fast-forward failed"
fi

if [[ ${#SERVICES[@]} -gt 0 ]]; then
  BUILD_ARGS=()
  [[ "$NO_CACHE" -eq 1 ]] && BUILD_ARGS+=("--no-cache")

  echo
  echo "==> Building: ${SERVICES[*]}"
  if ! docker compose build "${BUILD_ARGS[@]}" "${SERVICES[@]}"; then
    rollback "Docker build failed"
  fi

  echo
  echo "==> Recreating: ${SERVICES[*]}"
  if ! docker compose up -d --force-recreate "${SERVICES[@]}"; then
    rollback "Docker compose up failed"
  fi

  echo
  echo "==> Waiting ${WAIT_SECONDS}s for container startup"
  sleep "$WAIT_SECONDS"

  FAILED_CONTAINER=""
  for service in "${SERVICES[@]}"; do
    case "$service" in
      api) container="saucin-ai-api" ;;
      dashboard) container="saucin-ai-dashboard" ;;
      *) continue ;;
    esac

    state="$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
    if [[ "$state" != "running" ]]; then
      FAILED_CONTAINER="$container ($state)"
      break
    fi
  done

  if [[ -n "$FAILED_CONTAINER" ]]; then
    docker compose logs --tail=100 "${SERVICES[@]}" || true
    rollback "Container did not remain running: $FAILED_CONTAINER"
  fi
fi

echo
echo "==> Current container status"
docker compose ps

echo
echo "=============================================="
echo " Saucin AI update complete"
echo "=============================================="
echo
git log -1 --oneline --decorate

echo
if [[ ${#SERVICES[@]} -gt 0 ]]; then
  echo "Updated services: ${SERVICES[*]}"
else
  echo "Source-only update; no Docker services required a rebuild."
fi
