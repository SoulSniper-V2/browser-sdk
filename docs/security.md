---
title: Security
description: Credential, retry, and side-effect boundaries.
---

Browser SDK is designed for server-side use.

- Keep provider keys in server environment variables.
- Never return `connectUrl` values from an untrusted public API without an access decision. Browserbase and Steel connection URLs can contain credentials.
- Use application-level authorization before creating or returning a session for a user.
- Use bounded timeouts and explicit cleanup so a browser is not left running.
- Treat `metadata`, screenshots, PDFs, cookies, and session recordings as sensitive data.
- Do not automatically replay side-effecting browser callbacks after a failover.
- Error messages redact bearer tokens, keys, passwords, and cookies.
- `crawlPurposes` and robots directives are provider-specific policy inputs. Do not use a crawl result as permission to ignore a site's restrictions.
- The MCP runtime returns opaque session ids instead of CDP URLs. Use `BROWSER_SDK_ALLOWED_DOMAINS` and `BROWSER_SDK_MAX_SESSIONS` when agents should operate inside a constrained budget.
- Treat `browser_session_action` as a real side-effect boundary. Require user or application authorization before allowing clicks, typing, submissions, or account changes.

The SDK can route browser work. It does not decide whether a user is allowed to access a site or submit a form.
