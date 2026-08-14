# Public Release Checklist

Use this checklist before publishing a release or accepting outside contributions.

## Repository security

- [ ] Review **Security → Secret scanning** and resolve every alert.
- [ ] Enable push protection and private vulnerability reporting.
- [ ] Enable Dependabot alerts and security updates.
- [ ] Add a ruleset for the default branch that blocks deletion and force pushes.
- [ ] Require the `quality` status check before merging pull requests.
- [ ] Keep GitHub Actions token permissions read-only unless a workflow explicitly needs more.

## Privacy and quality

- [ ] Confirm no `.env`, database, DPAPI key, real activity log, certificate, or local path is tracked.
- [ ] Run `npm run check` and `npm run test:helper`.
- [ ] Test foreground, idle, lock/sleep, Chrome/Edge, exclusions, pause/resume, and crash recovery on Windows.
- [ ] Confirm Chrome/Edge receive only sanitized title and hostname data.
- [ ] Review new permissions and document why each permission is needed.

## Release artifacts

- [ ] Build from a clean commit on Windows.
- [ ] Publish ZIP/installer through GitHub Releases instead of committing binaries.
- [ ] Publish `SHA256SUMS.txt` and release notes.
- [ ] State that unsigned builds may trigger SmartScreen.
- [ ] Verify uninstall behavior and whether local data is retained.
- [ ] Update supported versions in `SECURITY.md`.
