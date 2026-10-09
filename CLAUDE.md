# Typographer — EmDash sandboxed plugin

Design and decisions: `SPEC.md`. Read `skills/creating-plugins/SKILL.md` before editing the plugin.

## Commands

- `pnpm test` — `emdash-plugin validate` + vitest (runs in workerd). One file: `pnpm vitest run tests/<file>.test.ts`.
- `pnpm run typecheck`, `pnpm run build`.
- `pnpm run bundle` — produces `dist/*.tar.gz`; check with `tar tzf` and `tar xzf ... -O | wc -c`. Caps: 256 KB decompressed, 128 KB per file, 20 files.

## Architecture

Rules (`src/rules.ts`) return edits against one joined paragraph string; the engine (`src/portable-text.ts`) maps those edits back into spans, protecting code, URLs and inline objects. `src/plugin.ts` routes stay thin, and `src/ui.ts` renders Block Kit. Pure data (quote pairs, units) lives in `src/locales.ts`.

## Traps

- Manifest `collections` cannot be wildcards (max 64). Draft access uses named `fields` plus `"translatable": true`, which EmDash (admin and server) resolves to every supported translatable field, capped at 32. Widening either is a trust-contract change (version bump, admins re-consent).
- Because `translatable` brings in fields we never named, `CODE_FIELD_WORDS` in `src/portable-text.ts` skips code-like slugs (`embed_code`, `custom_css`). Keep it whole-word, or `description` matches `script`.
- Quote pairs come from CLDR (`cldr-json/cldr-misc-full/main/<tag>/delimiters.json`). Swedish/Finnish open and close with the same glyph; the quotes rule toggles depth for those.
- Release versions are immutable.
- No zod. plugin-cli 0.13.3 only bundles the exact `"zod"` specifier and full zod nearly hit the 128 KB per-file cap, so input is validated by hand-written guards.
- Write invisible characters (U+00A0, U+202F, U+FFFC) as backslash escapes. Literal ones get lost in copy/paste and silently break tests.
- The email regex is length-bounded on purpose; an unbounded one was quadratic on 64 KB text.
- Never log entry content — only field slugs, rule names, error messages.
- Routes without `permission` default to admin-only `plugins:manage`; the panel route uses `content:edit_own`.
- Manual QA playground: `~/Projects/typographer-playground` (EmDash blog site on Node, plugin installed via `file:../emdash-typographer`, `sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox"`). Rebuild the plugin (`pnpm run build`) before restarting it; `npx astro dev stop|status|logs` there.
- EmDash 1.2's rich-text editor doesn't redraw after an applied draft patch until the page is reloaded (data is correct). Not our bug.
- macOS screenshot filenames contain U+202F before "AM/PM" — use globs, not typed paths.

## Release

- Bump `version` in `package.json`, then `pnpm run validate && pnpm test && pnpm run bundle`.
- `pnpm run login -- krushnaraval.bsky.social` (once), then `pnpm run publish`; watch approval with the `emdash-plugin info … --watch` command it prints. Versions are immutable.
- Listing images live in `images/` (declared under `release.artifacts`); the icon source is `images/icon.svg`.
