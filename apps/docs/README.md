# @lurq/docs

The lurq documentation site, built with [Fumadocs](https://fumadocs.dev) on
Next.js (App Router).

## Develop

```bash
npm run dev -w @lurq/docs
```

Then open http://localhost:3000.

## Structure

| Path | What |
| --- | --- |
| `content/docs/*.mdx` | The documentation pages (MDX). |
| `content/docs/meta.json` | Sidebar order. |
| `source.config.ts` | Fumadocs MDX content config. |
| `src/lib/source.ts` | Content loader (`baseUrl: /docs`). |
| `src/app/docs/` | Docs layout + catch-all page route. |
| `src/app/(home)/` | Landing page. |
| `src/app/api/search/route.ts` | Static search endpoint (Orama). |

To add a page, drop a new `.mdx` file in `content/docs/` with `title` and
`description` frontmatter, then add its slug to `meta.json`.
