#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${SAUCIN_PROJECT_DIR:-/mnt/user/appdata/saucin-ai/project}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/install-git-update.sh <patch-file> <version> [commit-message]

Example:
  ./scripts/install-git-update.sh \
    /mnt/user/appdata/saucin-ai/updates/saucin-ai-v1.3.6.patch \
    v1.3.6 \
    "Saucin AI v1.3.6"

What it does:
  1. Requires a clean Git working tree.
  2. Verifies the patch can be applied.
  3. Applies the patch.
  4. Detects whether API, dashboard, or both changed.
  5. Builds only the affected Docker service(s).
  6. Recreates the affected service(s).
  7. Commits the update.
  8. Creates an annotated version tag.
  9. Pushes main and the tag to origin.

If a build fails, the script stops before committing or pushing.
EOF
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage
  exit 2
fi

PATCH_FILE="$1"
VERSION="$2"
COMMIT_MESSAGE="${3:-Saucin AI ${VERSION}}"

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "ERROR: Patch file not found:"
  echo "  $PATCH_FILE"
  exit 1
fi

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
  echo "Commit, stash, or remove those changes before installing an update."
  exit 1
fi

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "ERROR: Git tag/version '$VERSION' already exists."
  exit 1
fi

echo "==> Current version"
git log -1 --oneline

echo
echo "==> Checking patch"
git apply --check "$PATCH_FILE"

echo
echo "==> Applying patch"
git apply "$PATCH_FILE"

CHANGED_FILES="$(git diff --name-only)"
if [[ -z "$CHANGED_FILES" ]]; then
  echo "ERROR: Patch applied but produced no changes."
  exit 1
fi

echo
echo "==> Changed files"
printf '%s\n' "$CHANGED_FILES"

BUILD_API=0
BUILD_DASHBOARD=0

while IFS= read -r file; do
  case "$file" in
    apps/api/*)
      BUILD_API=1
      ;;
    apps/dashboard/*)
      BUILD_DASHBOARD=1
      ;;
    docker-compose.yml|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock)
      BUILD_API=1
      BUILD_DASHBOARD=1
      ;;
  esac
done <<< "$CHANGED_FILES"

# If the patch only changes docs/scripts/config that do not require a service
# rebuild, we still commit/push it but skip Docker work.
SERVICES=()
if [[ "$BUILD_API" -eq 1 ]]; then
  SERVICES+=("api")
fi
if [[ "$BUILD_DASHBOARD" -eq 1 ]]; then
  SERVICES+=("dashboard")
fi

if [[ ${#SERVICES[@]} -gt 0 ]]; then
  echo
  echo "==> Building: ${SERVICES[*]}"
  if ! docker compose build "${SERVICES[@]}"; then
    echo
    echo "BUILD FAILED."
    echo "Nothing was committed or pushed."
    echo
    echo "To discard this attempted update and return to the last commit:"
    echo "  cd \"$PROJECT_DIR\""
    echo "  git reset --hard HEAD"
    echo "  git clean -fd"
    exit 1
  fi

  echo
  echo "==> Recreating: ${SERVICES[*]}"
  docker compose up -d --force-recreate "${SERVICES[@]}"

  echo
  echo "==> Container status"
  docker compose ps
else
  echo
  echo "==> No API/dashboard rebuild required for this patch."
fi

echo
echo "==> Committing ${VERSION}"
git add -A
git commit -m "$COMMIT_MESSAGE"

echo
echo "==> Tagging ${VERSION}"
git tag -a "$VERSION" -m "$COMMIT_MESSAGE"

echo
echo "==> Pushing main"
git push origin main

echo
echo "==> Pushing ${VERSION}"
git push origin "$VERSION"

echo
echo "=============================================="
echo " Saucin AI update installed successfully"
echo " Version: $VERSION"
echo "=============================================="
echo
git log -1 --oneline --decorate
