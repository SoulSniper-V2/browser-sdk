---
title: Machine-readable docs
description: Use raw Markdown, LLM indexes, JSONL entities, and a schema map.
---

The documentation site publishes the active surface in formats that do not require scraping rendered HTML.

| Endpoint | Purpose |
| :--- | :--- |
| `/llms.txt` | Site facts and documentation index. |
| `/llms-full.txt` | Complete current docs corpus. |
| `/feeds/docs.jsonl` | One schema.org TechArticle record per page. |
| `/schemamap.xml` | Feed discovery for indexers. |
| `/docs/llms.txt` | Documentation-only index. |
| `/docs/<page>.md` | Raw Markdown for one page. |
| `/skills/browser-sdk/SKILL.md` | Coding-agent instructions. |

```bash
curl https://browser-sdk.dev/llms.txt
curl https://browser-sdk.dev/docs/quickstart.md
curl https://browser-sdk.dev/feeds/docs.jsonl
```

Refresh `/llms.txt` before integrating the package in an agent-maintained codebase.
