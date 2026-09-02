# Saucin AI Git Update Workflow

GitHub is the canonical source for Saucin AI. ChatGPT can update the connected private repository directly, and the Unraid server pulls those changes.

## Normal update

From Unraid:

```bash
cd /mnt/user/appdata/saucin-ai/project
./scripts/update.sh
```

The updater automatically:

1. Refuses to continue if the local Git working tree has uncommitted changes.
2. Fetches `origin/main` and Git tags.
3. Shows the commits and files that changed.
4. Determines whether the API, dashboard, both, or neither require a Docker rebuild.
5. Fast-forwards the local checkout.
6. Builds only the affected application service(s).
7. Recreates only the affected application service(s).
8. Waits briefly and verifies the affected containers remain running.
9. Shows the final Docker status.

PostgreSQL and Redis are not force-recreated simply because `docker-compose.yml` changed. Infrastructure changes should be handled deliberately.

## Preview an update

To fetch GitHub and see what would change without installing anything:

```bash
./scripts/update.sh --check
```

## Force a clean Docker build

Normally Docker's build cache is used so updates are faster. If a clean rebuild is needed:

```bash
./scripts/update.sh --no-cache
```

## Failed build/start rollback

Before updating, the script records the current commit. If the new API/dashboard build fails, `docker compose up` fails, or an affected container does not remain running after startup, the updater:

1. Resets the Unraid source checkout to the previous commit.
2. Rebuilds the previous affected service(s).
3. Recreates those previous service(s).
4. Displays Docker status/logs if rollback also has a problem.

The updater never force-pushes or rewrites GitHub. Rollback is local to the Unraid deployment.

Database migrations used by Saucin AI should remain backward-compatible/additive so application rollback remains safe.

## Local changes

The updater intentionally stops when this command is not clean:

```bash
git status
```

This prevents an update from overwriting work performed directly on the server.

## View versions/history

```bash
git log --oneline --decorate -10
git tag --list --sort=-version:refname
```

## Legacy patch installer

`scripts/install-git-update.sh` remains in the repository for older patch-based updates, but normal connected-GitHub development should use `scripts/update.sh` instead.

## Environment overrides

Optional variables:

```text
SAUCIN_PROJECT_DIR
SAUCIN_GIT_REMOTE
SAUCIN_GIT_BRANCH
SAUCIN_UPDATE_WAIT_SECONDS
```

The production defaults are already set for the current Unraid Saucin AI installation.
