# Saucin AI Git Update Workflow

Saucin AI updates can be delivered as standard Git patch files.

## Normal update

Put the downloaded patch somewhere outside the repository, for example:

```text
/mnt/user/appdata/saucin-ai/updates/
```

Then run:

```bash
cd /mnt/user/appdata/saucin-ai/project

./scripts/install-git-update.sh \
  /mnt/user/appdata/saucin-ai/updates/saucin-ai-v1.3.6.patch \
  v1.3.6
```

The installer:

1. Checks that the repository is clean.
2. Validates the patch before changing files.
3. Applies it.
4. Detects API/dashboard changes.
5. Builds only affected Docker services.
6. Recreates affected containers.
7. Commits the update.
8. Creates a version tag.
9. Pushes `main` and the version tag to GitHub.

If the Docker build fails, the update is **not committed or pushed**.

## Before an update

You can always verify the repository is clean:

```bash
git status
```

Expected:

```text
nothing to commit, working tree clean
```

## View installed versions

```bash
git log --oneline --decorate -10
git tag --list --sort=-version:refname
```

## Restore the last committed version after a failed, uncommitted patch

Only use this when the installer explicitly reports that the build failed and
you want to discard the attempted patch:

```bash
git reset --hard HEAD
git clean -fd
```

## GitHub is the canonical copy

After a successful installer run, the update is committed and pushed to the
private GitHub repository automatically.
