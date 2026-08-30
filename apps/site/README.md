# Browser SDK site

The site is a Next.js and Fumadocs app.

- `/` is the product homepage.
- `/docs` is the generated Fumadocs documentation tree sourced from the root `docs/` directory.
- `/llms.txt`, `/llms-full.txt`, `/feeds/docs.jsonl`, `/schemamap.xml`, and `/skills/browser-sdk/SKILL.md` are first-class machine-readable routes.
- `scripts/sync-site-docs.mjs` mirrors canonical Markdown into the public raw-document paths.

```bash
npm run dev --workspace=browser-sdk-site -- --hostname 0.0.0.0
```

Build and typecheck from the repository root:

```bash
npm run typecheck
npm run build
```
