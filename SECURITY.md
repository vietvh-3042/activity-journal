# Security Policy

Activity Journal processes sensitive local activity metadata. Security and privacy reports are taken seriously.

## Supported versions

Only the latest published release is supported with security fixes. Older pilot builds should be upgraded before
reporting an issue.

| Version | Supported |
| ------- | --------- |
| 0.4.x   | Yes       |
| < 0.4   | No        |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include real window titles, domains, paths, database
files, DPAPI material, tokens, or personal activity logs in an issue.

Use GitHub's private vulnerability reporting page:

<https://github.com/vietvh-3042/activity-journal/security/advisories/new>

Include a concise description, affected version, reproduction steps, impact, and a sanitized proof of concept. You
should receive an acknowledgement within seven days. Please allow time to investigate and publish a fix before
public disclosure.

## Security boundaries

- The app is local-only and does not provide cloud sync or telemetry.
- SQLCipher protects the database at rest; its key is protected with DPAPI `CurrentUser`.
- Malware already running as the same Windows user is outside the protection boundary.
- Unsigned pilot builds can trigger SmartScreen and should only be downloaded from this repository's Releases page
  with a matching SHA-256 checksum.
