# Contributing

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
# or: npm run check
```

Keep provider credentials out of commits and tests. Use injected `fetch` functions and the memory provider for deterministic coverage. If an adapter changes capabilities or request mapping, update its provider docs, README examples, agent skill, MCP surface, and machine-readable docs together.

## Pull requests

Include the behavior change, the focused test, and the verification command. Do not claim live provider verification unless the provider was exercised with a disposable resource and the credentials were supplied outside the repository.
