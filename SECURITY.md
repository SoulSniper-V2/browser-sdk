# Security

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Use GitHub's private vulnerability reporting for this repository when it is enabled, or contact the repository owner privately through GitHub with a reproducible description and the affected version.

## Credentials and browser sessions

Provider API keys, CDP connection URLs, cookies, profiles, and session artifacts are sensitive. Keep them in server-side environment variables or a secrets manager. Do not put them in browser bundles, commit them, or return them from an agent tool. The MCP runtime intentionally returns opaque session ids instead of provider connection URLs.

When reporting a bug, redact keys, cookies, authorization headers, session URLs, and customer data from logs and reproduction cases.
