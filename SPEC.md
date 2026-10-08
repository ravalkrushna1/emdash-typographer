# Typographer — design spec

An EmDash sandboxed plugin that finds typographic mistakes in the entry an editor is
writing (straight quotes, double hyphens, three dots, breaking spaces in `10 kg`…) and
proposes fixes the editor previews and applies. Nothing changes without that preview.

Status: approved 2026-10-08. Target: v1.0.0 in the official registry
(plugins.emdashcms.com), free, MIT.

## Goals

- First EmDash plugin: learn the whole lifecycle — manifest, editor panel, draft
  read/patch, settings, tests, bundle, publish, registry approval.
- Polished enough to be a calling card: correct on hard cases, never corrupts content.

## Non-goals (v1)

- Tables, custom blocks, HTML blocks, embeds — untouched.
- Converting a writer's double quotes to single (or back). That is their choice.
- Auto-fix on save or publish-blocking. The editor stays in control.
- Paid tier, telemetry, network access of any kind.

## Platform constraints this design rests on

Verified against `emdash-cms/emdash` source at `00b5cfa` (2026-10-08).

| Constraint | Consequence |
|---|---|
| Sandboxed plugins cannot inject page fragments or custom Portable Text blocks (trusted-only). | The value has to live in the editor, not on the public site. |
| `admin.editor-draft:read` / `:patch` work on any recognised field type, `portableText` included (`packages/core/src/plugins/editor-draft.ts`). | We can fix rich-text bodies, not just titles. |
| Patches are whole-field `set`/`clear`; the host previews them, applying only marks the form dirty, and any edit made meanwhile rejects the result. | Safe by construction; we only have to produce a correct whole-field value. |
| `panel_load` never carries the draft; explicit `block_action` / `form_submit` interactions do. | Panel needs an explicit **Scan** click. |
| Draft access requires an explicit `collections` list (no wildcard), ≤ 64 collections, ≤ 32 field slugs. | We ship a list of common slugs. Sites with unusual collection names don't get the panel — a documented ceiling. |
| Selected field slugs a collection doesn't have are filtered out (`selectedFields` + `patchFieldDefinitions`). | One field list can serve `posts`, `pages`, `projects` together. **Verify in a runtime test before relying on it.** |
| Limits: 64 KB per field, 192 KB per snapshot. | Oversized fields are skipped with an explanation. |
| Bundle ≤ 256 KB decompressed, ≤ 128 KB per file, ≤ 20 files; no Node built-ins. | `zod/mini`, no heavy deps; check `bundle` output every release. |
| Releases are immutable per version. | Patch = fixes, minor = new rules, major = new capabilities (forces re-consent). |

## Manifest

- Slug `typographer`, license MIT, publisher pinned to the author's Atmosphere DID
  `did:plc:2vgwjmqe2e6u72wl5uyumrc2` (handle `krushnaraval.bsky.social`; handle may
  change, the DID never does). Registry name: `@krushnaraval.bsky.social/typographer`.
- Capabilities: `admin.editor-draft:read`, `admin.editor-draft:patch`. Nothing else —
  no content, network, or hook capabilities. Smallest possible consent prompt.
- One editor panel, id `typographer`, route `editor/typographer`.
  - `collections` (28 of 64): template slugs `posts`, `pages`, `projects`, plus
    `articles`, `news`, `blog`, `stories`, `docs`, `guides`, `tutorials`, `events`,
    `products`, `case_studies`, `portfolio`, `services`, `recipes`, `podcasts`,
    `episodes`, `faqs`, `testimonials`, `team`, `jobs`, `courses`, `lessons`,
    `changelog`, `press`, `resources`, `reviews`.
  - `draft.read` and `draft.patch` fields (19 of 32): `title`, `subtitle`, `headline`,
    `excerpt`, `summary`, `description`, `intro`, `lead`, `content`, `body`, `text`,
    `bio`, `abstract`, `caption`, `quote`, `question`, `answer`, `details`, `overview`.
  - Adding slugs later likely widens the trust contract (major bump, admins re-consent),
    so the v1 list is deliberately generous. Confirm how the CLI classifies it before
    the first post-1.0 scope change.
- Settings page at `/settings` (route `admin`), `settingsSchema` for rule defaults and
  locale override. No secrets.

Why no wildcard workaround: there isn't one. The manifest is fixed at publish time and
the host enforces explicit scope. README states the limit plainly.

## Layout

```
emdash-plugin.jsonc   manifest
src/plugin.ts         routes only: "admin" (settings) and "editor/typographer" (panel)
src/ui.ts             Block Kit: panel states, settings page
src/portable-text.ts  join → fix → split; plain fields pass straight through
src/rules.ts          pure rules: text in → edits out
src/locales.ts        pure data: quote pairs, French spacing, units, elision words
tests/                one file per src file + never-touch corpus
```

`plugin.ts` is a thin controller; all behaviour lives in `rules.ts` and
`portable-text.ts`; `locales.ts` has no logic so languages can be added without touching
behaviour.

## Panel flow

| Step | Editor | Plugin receives | Plugin returns |
|---|---|---|---|
| 1 | Opens panel | `panel_load` (no draft) | Intro, detected locale (e.g. `fr → « »`), **Scan draft** button |
| 2 | Clicks Scan | `block_action` + draft | Form: one toggle per rule with its count, preset from site defaults; zero-count rules hidden. Nothing found → "Looks clean ✓" |
| 3 | Clicks **Polish selected** | `form_submit` + fresh draft + toggles | `editor-draft-patch` with `set` ops only for fields that changed |
| 4 | Previews, applies, saves | — | — |

Step 2 counts every rule as if all were on, so editors can see what the risky rules
would catch before enabling them; the panel says so. Step 3 rescans the fresh draft with
only the selected rules, so the patch reflects exactly what is in the form, and the host
preview shows the precise changes.

## Rules

Run in this fixed order (later rules depend on earlier ones claiming characters):

| # | Rule | Default | Changes | Never touches |
|---|---|---|---|---|
| 1 | Spacing | on | 2+ spaces → 1 | intentional non-breaking spaces |
| 2 | Symbols | on | `(c)` `(r)` `(tm)` → `©` `®` `™` | `(c)` in a paragraph that also has `(a)` or `(b)` |
| 3 | Ellipsis | on | `...` → `…` | `....` and longer |
| 4 | Dashes | on | `--` → `—`; ` - ` between words → ` – ` | `--flag`, `---`, line-start hyphen |
| 5 | Ranges | off | `10-20`, `1990-1995` → en dash | `2026-10-08`, `555-123-4567`, `B-52`, first > second (`3-2`) |
| 6 | Multiplication | off | `1920x1080`, `3 x 4` → `×` | `0x1F`, `X200x300` |
| 7 | Fractions | off | `1/2 1/4 3/4 1/3 2/3` → `½ ¼ ¾ ⅓ ⅔` | `1/2/2026`, `11/2`, `1/20` |
| 8 | Primes | off | `5'10"` → `5′10″`; `6' tall` → `6′ tall` | a closing quote after a number (`"I am 10"`) |
| 9 | Quotes | on | `"x"` → `“x”`, `it's` → `it’s`, `'90s` → `’90s`, `'tis` → `’tis` | already-curly quotes |
| 10 | Non-breaking spaces | on | `10 kg`, `₹ 500`, `5 €`; French: narrow NBSP (U+202F) before `; ! ?` and inside `« »`, NBSP (U+00A0) before `:` | `12:30`, `:)` |

Risky rules (5–8) ship off by default with strict patterns. Each has its own never-touch
corpus.

**Never touched by any rule:** inline `code` spans, code blocks, HTML blocks, URLs,
emails, inline objects, images, embeds, tables, non-text fields.

**Quote direction:** opens after start-of-text, whitespace, an opening bracket or a dash;
closes otherwise. `'` between letters is an apostrophe. English `’` serves as both closing
single quote and apostrophe, so only word-initial `'` is ambiguous: digits (`'90s`) and an
elision list in `locales.ts` (`'tis`, `'em`, `'n'`) resolve it to `’`.

**Locale swaps glyphs only.** Typed double → locale's double pair; typed single → locale's
single pair.

| Language | Double | Single |
|---|---|---|
| en, nl, hi, gu, zh | “ ” | ‘ ’ |
| fr | « » | ‹ › |
| es, it, pt | « » | “ ” |
| ru | « » | „ “ |
| de | „ “ | ‚ ‘ |
| pl | „ ” | « » |
| ja | 「 」 | 『 』 |
| da | » « | › ‹ |

Resolution: settings override → entry locale (`routeCtx.ui.entry.locale`, matched on
language subtag) → `en`. Unknown locale falls back to `en` and the panel says so.

**Counts** are the number of applied edits per rule, from the same code path that builds
the patch. What the panel promises is what the patch does.

## Rich-text engine

Field type from the draft's field definitions: `string`/`text` → treated as one segment;
`portableText` → the engine; anything else → skipped.

Per Portable Text block (`_type: "block"`, so headings, list items and quotes too):

1. **Join** span texts into one string with an offset map `[start, end) → child index`.
2. **Protect** whole `code`-marked spans, inline objects (one placeholder char each),
   and URL/email matches on the joined string.
3. Each rule returns **edits** `(start, end, replacement)` against the joined string, so
   context crosses span boundaries (`"` before a bold word knows it opens).
4. **Apply** edits within each span's own text. An edit that crosses a span boundary or
   overlaps a protected range is dropped, not guessed, and not counted.
5. **Rebuild** joined string and map; next rule.

Output keeps every `_key`, mark, `markDefs` entry and order; only span `text` changes.

**Structure guard:** before a field enters the patch, assert the new value equals the old
in everything except span `text`. Failure means a bug: drop the field, log it.

Quote context resets per block (multi-paragraph quotations open each paragraph).

## Errors

Every field gets the whole correct fix or is left alone, and the editor is told why.

| Case | Editor sees | Behaviour |
|---|---|---|
| Nothing to fix | "Looks clean ✓" | No patch |
| Field > 64 KB after fixing | "*Body* is too long to polish in one go (64 KB limit). Other fields were polished." | Field omitted |
| Structure guard fails / rule throws | "Couldn't safely polish *Body*. Nothing was changed in it." | Field omitted; `ctx.log.error` with field + rule |
| Unsupported locale | "No quote style for *sw* yet — using English quotes" | Fallback `en` |
| Malformed interaction | "Something went wrong — reopen the panel" | zod-validated; never throws |
| Edited while working | Host's stale message | Help text: "Edited while scanning? Scan again." |
| Invalid settings | Inline error, nothing saved | zod before `ctx.settings.set` |

Logs never contain entry content — only field slugs, rule names, error messages.

## Testing

Test-first. Every bug becomes a regression row.

| File | Proves |
|---|---|
| `rules.test.ts` | Table-driven change / never-touch cases per rule (~150) |
| `locales.test.ts` | Complete pairs per language; unknown → `en` |
| `portable-text.test.ts` | Cross-span quotes, code untouched, keys/marks preserved, cross-span edits dropped, guard catches tampering |
| `plugin.test.ts` | `createPluginRuntimeTestHost`: load → act → submit → `applyEditorDraftPatch` passes host validation; oversized field; clean draft; settings save + validation; missing-field tolerance across collections |
| Manual, per release | Real local EmDash blog site, long real article; source of README screenshots |

## Release

1. Atmosphere account (Bluesky) → `emdash-plugin login <handle>`; DID pinned as `publisher`.
2. `validate` → `typecheck` → `test` → `bundle`; inspect with `tar tzf`.
3. `emdash-plugin publish` → registry checks → `emdash-plugin info … --watch` → listed.
4. Later: GitHub Actions automated releases with provenance on version tags.

Tooling: pnpm (the plugin CLI and docs assume it), `@emdash-cms/plugin-cli` pinned
exactly (0.13.3 at time of writing; registry is experimental). Listing images in
`images/`, never root `icon.png` (counts against the bundle cap).

## Roadmap

- 1.1: tables; per-locale dash style (closed em dash vs spaced en dash); more locales.
- Later: House Style plugin reusing this engine with a team glossary.
