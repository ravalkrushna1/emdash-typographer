# Typographer — EmDash sandboxed plugin

Design and decisions: `SPEC.md`. Read `skills/creating-plugins/SKILL.md` before editing the plugin.

## Commands

- `pnpm test` — `emdash-plugin validate` + vitest (runs in workerd). One file: `pnpm vitest run tests/<file>.test.ts`.
- `pnpm run typecheck`, `pnpm run build`.
- `pnpm run bundle` — produces `dist/*.tar.gz`; check with `tar tzf` and `tar xzf ... -O | wc -c`. Caps: 256 KB decompressed, 128 KB per file, 20 files.

## Architecture

Rules (`src/rules.ts`) return edits against one joined paragraph string; the engine (`src/portable-text.ts`) maps those edits back into spans, protecting code, URLs and inline objects. `src/plugin.ts` routes stay thin, and `src/ui.ts` renders Block Kit. Pure data (quote pairs, units) lives in `src/locales.ts`.

## Traps

- Manifest `collections` and draft `fields` cannot be wildcards; widening them is a trust-contract change (version bump, admins re-consent).
- Release versions are immutable.
- No zod. plugin-cli 0.13.3 only bundles the exact `"zod"` specifier and full zod nearly hit the 128 KB per-file cap, so input is validated by hand-written guards.
- Write invisible characters (U+00A0, U+202F, U+FFFC) as backslash escapes. Literal ones get lost in copy/paste and silently break tests.
- The email regex is length-bounded on purpose; an unbounded one was quadratic on 64 KB text.
- Never log entry content — only field slugs, rule names, error messages.
- Routes without `permission` default to admin-only `plugins:manage`; the panel route uses `content:edit_own`.
- Manual QA playground: `~/Projects/typographer-playground` (to be created).
