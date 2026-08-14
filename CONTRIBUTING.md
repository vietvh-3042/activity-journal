# Contributing to Activity Journal

Thank you for helping improve Activity Journal. Please keep changes local-first, privacy-preserving, and narrowly
scoped.

## Development requirements

- Windows 10 22H2 x64 or Windows 11 x64 for collector and integration work.
- Node.js 22.12 or newer.
- .NET 10 SDK.
- Chrome or Edge for native-messaging integration tests.

## Set up the project

```powershell
git clone https://github.com/vietvh-3042/activity-journal.git
cd activity-journal
npm install
npm run build:helper
npm run dev
```

WSL/Linux can be used for renderer-only work, but Windows API, DPAPI, named pipe, native messaging, and packaging
changes must be verified on Windows.

## Quality checks

Run these before opening a pull request:

```powershell
npm run check
npm run test:helper
npm run build
```

When changing Windows integration or packaging, also run:

```powershell
npm run build:helper
npm run dist:win
```

## Privacy requirements

Pull requests must not introduce keylogging, clipboard capture, screenshots, full URL collection, page-content
capture, telemetry, or cloud transfer without an explicit project-level design decision. Exclusion rules must remain
before persistence, and tests must use synthetic metadata rather than real activity history.

Never attach a real Activity Journal database or screenshots containing private titles, domains, or file paths to a
public issue.

## Commits and pull requests

Use Conventional Commits, for example:

```text
feat(timeline): add keyboard navigation
fix(browser): resolve native host registration
chore(deps): update development dependencies
```

Keep pull requests focused, explain user-visible behavior, add tests for logic changes, and complete the pull request
template. By participating, you agree to follow the repository's Code of Conduct.
