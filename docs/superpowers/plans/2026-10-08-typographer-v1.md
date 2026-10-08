# Typographer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Typographer v1.0.0, a sandboxed EmDash plugin that scans the unsaved entry in the editor, counts typographic fixes per rule, and proposes a whole-field patch the editor previews and applies.

**Architecture:** Pure rules (`rules.ts`) return edits against a joined paragraph string; an engine (`portable-text.ts`) maps those edits back into the original Portable Text spans, protects code/URLs/inline objects, and guards structure. `plugin.ts` is a thin router for two private routes (editor panel, settings page); `ui.ts` renders Block Kit; `locales.ts` is pure data.

**Tech Stack:** TypeScript (strict), EmDash 1.2 sandboxed plugin API, `@emdash-cms/plugin-cli` 0.13.3 (exact), `@emdash-cms/plugin-test` (vitest in workerd), Block Kit, `zod/mini`, pnpm.

**Spec:** `SPEC.md` (repo root). Read it before any task.

## Module map

| # | Task | Module | Files | Deliverable |
|---|---|---|---|---|
| 1 | Scaffold + baseline | project | `package.json`, manifest, `tests/plugin.test.ts` | Scaffold builds, validates, sample test green |
| 2 | Locale data | `locales.ts` | `src/locales.ts`, `tests/locales.test.ts` | Quote styles, units, currencies, `resolveLocale` |
| 3 | Edit engine | `portable-text.ts` (core) | `src/portable-text.ts`, `tests/engine.test.ts` | `runRules` / `polishText` with protection + boundary rules |
| 4 | Safe rules | `rules.ts` (1/3) | `src/rules.ts`, `tests/rules.test.ts` | spacing, symbols, ellipsis, dashes |
| 5 | Quotes + NBSP | `rules.ts` (2/3) | same | quotes, nbsp (incl. French) |
| 6 | Risky rules + registry | `rules.ts` (3/3) | same | ranges, multiplication, fractions, primes, `RULES`, `selectRules`, idempotence |
| 7 | Portable Text + fields | `portable-text.ts` (fields) | same + `tests/portable-text.test.ts` | `polishPortableText`, `sameStructure`, `polishFields` |
| 8 | Editor panel | `plugin.ts`, `ui.ts`, manifest | `src/plugin.ts`, `src/ui.ts`, `emdash-plugin.jsonc`, `tests/plugin.test.ts` | Full panel flow passes host validation |
| 9 | Settings | `plugin.ts`, `ui.ts`, manifest | same | Settings page saves validated defaults; panel honours them |
| 10 | Docs + bundle + manual QA | docs | `README.md`, `CLAUDE.md`, `images/` | Bundle under caps; real-site click-through; screenshots |
| 11 | Publish (human) | release | — | `@krushnaraval.bsky.social/typographer@1.0.0` in registry |

## Global Constraints

- Package manager: **pnpm** (exception to the author's bun default; the plugin CLI assumes pnpm).
- `@emdash-cms/plugin-cli` pinned **exactly** to `0.13.3`.
- Manifest `publisher`: `did:plc:2vgwjmqe2e6u72wl5uyumrc2` (handle `krushnaraval.bsky.social`).
- Capabilities: exactly `admin.editor-draft:read`, `admin.editor-draft:patch`. No others. `allowedHosts: []`, `storage: {}`.
- No network, no hooks, no Node built-ins in `src/`.
- Bundle: ≤ 256 KB total decompressed, ≤ 128 KB per file, ≤ 20 files. Listing images live in `images/`, never root `icon.png`.
- Draft limits: field ≤ 64 KB (`MAX_FIELD_BYTES = 64 * 1024`).
- Logs never contain entry content — only field slugs, rule ids, error messages.
- Every edit is previewed by the host; the plugin never saves.
- Rule order is fixed: `spacing, symbols, ellipsis, dashes, ranges, multiplication, fractions, primes, quotes, nbsp`.
- Defaults: risky rules (`ranges, multiplication, fractions, primes`) **off**; all others on.
- Tests in `tests/`, TypeScript imports use `.js` suffixes (bundler resolution).
- If a test written from this plan fails because the plan's implementation code is wrong, fix the implementation, not the test — unless the test contradicts `SPEC.md`, in which case stop and ask.

## Review Focus

1. **Already-polished text** — running Typographer twice must change nothing the second time. Pinned by the idempotence test in Task 6.
2. **Nested and mixed quotes** (`"She said 'hi'"`, a quote right after a bold run) — must open/close correctly across span boundaries. Pinned in Task 5 (nested) and Task 7 (cross-span).
3. **Entry never saved** — the admin cannot capture a draft for an unsaved entry, so `scan` arrives without `draft`; the editor must be told to save once. Pinned in Task 8.
4. **Emoji / astral characters next to fixes** — UTF-16 index arithmetic must not split surrogate pairs. Pinned in Task 3.
5. **Entry language with no quote table** (`ar`, `sw`) — must fall back to English quotes and say so in the panel. Pinned in Task 2 and Task 8.

---

### Task 1: Scaffold and baseline

**Files:**
- Create (by CLI): `emdash-plugin.jsonc`, `src/plugin.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `tests/plugin.test.ts`, `vitest.config.ts`, `AGENTS.md`, `skills/`, `.agents/`, `.claude/`, `pnpm-workspace.yaml`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable plugin package named `typographer` with scripts `validate`, `build`, `typecheck`, `test`, `bundle`, `login`, `publish`.

- [ ] **Step 1: Scaffold into the existing repo**

Run from `~/Projects/emdash-typographer` (contains `SPEC.md`, `docs/`, `.git` — init only conflicts with its own file names):

```bash
pnpm dlx @emdash-cms/plugin-cli@0.13.3 init typographer --dir . \
  --publisher did:plc:2vgwjmqe2e6u72wl5uyumrc2 \
  --license MIT \
  --author-name "Krushna Raval" \
  --security-url https://github.com/ravalkrushna1/emdash-typographer/security/advisories/new \
  --description "Polishes quotes, dashes, ellipses and spacing in the editor — preview before apply." \
  --repo https://github.com/ravalkrushna1/emdash-typographer \
  --package-manager pnpm --yes
```

Expected: files listed above created; `SPEC.md` untouched.

- [ ] **Step 2: Enable private vulnerability reporting** (the manifest's security URL must work)

```bash
gh api -X PUT repos/ravalkrushna1/emdash-typographer/private-vulnerability-reporting
```

Expected: exit 0, no output.

- [ ] **Step 3: Fix dependency ranges**

Edit `package.json`:
- `devDependencies["@emdash-cms/plugin-cli"]` → `"0.13.3"` (exact, no caret).
- `devDependencies.emdash` → `"1.2.0"`; `peerDependencies.emdash` → `">=1.2.0"` (the scaffold template may emit `<1.0.0`; EmDash is 1.2.0 and the draft APIs we use are 1.x).
- Add `"dependencies": { "zod": "4.6.5" }` and `devDependencies["@emdash-cms/blocks"]` → `"1.2.0"`.

Then:

```bash
pnpm install
```

Expected: lockfile created, no peer-dependency errors.

- [ ] **Step 4: Run the scaffold's checks**

```bash
pnpm run validate && pnpm run typecheck && pnpm test && pnpm run build
```

Expected: all pass; `tests/plugin.test.ts` "hello route" PASS; `dist/plugin.mjs`, `dist/manifest.json`, `dist/index.mjs` exist.

If `pnpm test` fails because of the emdash range, read the error, adjust the range in `package.json` to the version the error names, and rerun. Record what you changed in the commit message.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold typographer plugin with plugin-cli 0.13.3"
git push
```

---

### Task 2: Locale data

**Files:**
- Create: `src/locales.ts`
- Test: `tests/locales.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LocaleStyle { tag: string; double: readonly [string, string]; single: readonly [string, string]; frenchSpacing: boolean }`
  - `interface ResolvedLocale { style: LocaleStyle; requested: string | null; fellBack: boolean }`
  - `resolveLocale(override: string | null, entryLocale: string | null): ResolvedLocale`
  - `SUPPORTED_LOCALES: readonly string[]`
  - `APOSTROPHE: "’"`, `ELISIONS: readonly string[]`, `UNITS: readonly string[]`, `CURRENCIES: readonly string[]`, `FRACTIONS: Readonly<Record<string, string>>`

- [ ] **Step 1: Write the failing test**

`tests/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { FRACTIONS, SUPPORTED_LOCALES, resolveLocale } from "../src/locales.js";

describe("resolveLocale", () => {
	it("uses the entry locale when there is no override", () => {
		const resolved = resolveLocale(null, "fr");
		expect(resolved.style.tag).toBe("fr");
		expect(resolved.style.double).toEqual(["«", "»"]);
		expect(resolved.style.frenchSpacing).toBe(true);
		expect(resolved.fellBack).toBe(false);
	});

	it("matches on the language subtag", () => {
		expect(resolveLocale(null, "de-AT").style.double).toEqual(["„", "“"]);
		expect(resolveLocale(null, "pt_BR").style.tag).toBe("pt");
	});

	it("lets a settings override win over the entry locale", () => {
		expect(resolveLocale("de", "fr").style.tag).toBe("de");
	});

	it("treats the 'auto' override as no override", () => {
		expect(resolveLocale("auto", "ja").style.double).toEqual(["「", "」"]);
	});

	it("defaults to English when nothing is known", () => {
		const resolved = resolveLocale(null, null);
		expect(resolved.style.tag).toBe("en");
		expect(resolved.fellBack).toBe(false);
	});

	it("falls back to English and reports it for an unsupported language", () => {
		const resolved = resolveLocale(null, "ar");
		expect(resolved.style.tag).toBe("en");
		expect(resolved.style.double).toEqual(["“", "”"]);
		expect(resolved.requested).toBe("ar");
		expect(resolved.fellBack).toBe(true);
	});
});

describe("locale table", () => {
	it.each(SUPPORTED_LOCALES)("%s has complete, single-character quote pairs", (tag) => {
		const { style } = resolveLocale(tag, null);
		for (const glyph of [...style.double, ...style.single]) {
			expect([...glyph]).toHaveLength(1);
		}
	});

	it("only lists fractions that have a single glyph", () => {
		for (const glyph of Object.values(FRACTIONS)) expect([...glyph]).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/locales.test.ts`
Expected: FAIL — cannot resolve `../src/locales.js`.

- [ ] **Step 3: Write the implementation**

`src/locales.ts`:

```ts
/**
 * Pure typographic data. No behaviour lives here so that languages, units and
 * glyphs can be added without touching the rules.
 */

export interface LocaleStyle {
	/** Resolved language subtag, e.g. "fr". */
	tag: string;
	/** Opening and closing double quotes. */
	double: readonly [string, string];
	/** Opening and closing single quotes. */
	single: readonly [string, string];
	/** French spacing: narrow no-break space before ; ! ? and inside « ». */
	frenchSpacing: boolean;
}

export interface ResolvedLocale {
	style: LocaleStyle;
	/** The locale we were asked for, before falling back. */
	requested: string | null;
	/** True when `requested` had no table and English was used instead. */
	fellBack: boolean;
}

type Style = Omit<LocaleStyle, "tag">;

const ENGLISH: Style = { double: ["“", "”"], single: ["‘", "’"], frenchSpacing: false };
const GUILLEMETS_INNER_CURLY: Style = { double: ["«", "»"], single: ["“", "”"], frenchSpacing: false };

const STYLES: Readonly<Record<string, Style>> = {
	en: ENGLISH,
	nl: ENGLISH,
	hi: ENGLISH,
	gu: ENGLISH,
	zh: ENGLISH,
	fr: { double: ["«", "»"], single: ["‹", "›"], frenchSpacing: true },
	es: GUILLEMETS_INNER_CURLY,
	it: GUILLEMETS_INNER_CURLY,
	pt: GUILLEMETS_INNER_CURLY,
	ru: { double: ["«", "»"], single: ["„", "“"], frenchSpacing: false },
	de: { double: ["„", "“"], single: ["‚", "‘"], frenchSpacing: false },
	pl: { double: ["„", "”"], single: ["«", "»"], frenchSpacing: false },
	ja: { double: ["「", "」"], single: ["『", "』"], frenchSpacing: false },
	da: { double: ["»", "«"], single: ["›", "‹"], frenchSpacing: false },
};

export const SUPPORTED_LOCALES: readonly string[] = Object.keys(STYLES);

/** Apostrophe is U+2019 in every supported language. */
export const APOSTROPHE = "’";

/** Words that begin with an elided letter, so a leading ' is an apostrophe: 'tis, 'n'. */
export const ELISIONS: readonly string[] = ["tis", "twas", "em", "n", "cause", "til", "round"];

/**
 * Units that take a no-break space after a number. "in" and "A" are left out on
 * purpose: they are ordinary words too often ("5 in total").
 */
export const UNITS: readonly string[] = [
	"kg", "g", "mg", "km", "m", "cm", "mm", "µm", "nm", "l", "ml", "L", "mL",
	"h", "min", "s", "ms", "°C", "°F", "%", "px", "rem", "em", "pt",
	"GB", "MB", "KB", "kB", "TB", "Hz", "kHz", "MHz", "GHz",
	"W", "kW", "kWh", "V", "mAh", "ft", "lb", "oz", "mi", "mph", "km/h",
];

export const CURRENCIES: readonly string[] = ["₹", "$", "€", "£", "¥"];

export const FRACTIONS: Readonly<Record<string, string>> = {
	"1/2": "½",
	"1/4": "¼",
	"3/4": "¾",
	"1/3": "⅓",
	"2/3": "⅔",
};

export function resolveLocale(override: string | null, entryLocale: string | null): ResolvedLocale {
	const requested = override && override !== "auto" ? override : entryLocale;
	const tag = requested ? (requested.toLowerCase().split(/[-_]/)[0] ?? "") : "en";
	const known: Style | undefined = STYLES[tag];
	return {
		style: { tag: known ? tag : "en", ...(known ?? ENGLISH) },
		requested: requested ?? null,
		fellBack: requested != null && known === undefined,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/locales.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/locales.ts tests/locales.test.ts
git commit -m "feat: locale quote styles and typographic data"
```

---

### Task 3: Edit engine

**Files:**
- Create: `src/portable-text.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: `LocaleStyle` from `src/locales.ts`.
- Produces (all exported from `src/portable-text.ts`):
  - `interface Edit { start: number; end: number; text: string }` — replace `[start, end)` with `text`; `start === end` is an insertion.
  - `interface RuleContext { locale: LocaleStyle }`
  - `type Rule = (text: string, ctx: RuleContext) => Edit[]`
  - `type NamedRule = readonly [id: string, rule: Rule]`
  - `type Counts = Record<string, number>`
  - `interface Piece { text: string; locked: boolean }`
  - `const OBJECT_PLACEHOLDER = "￼"`
  - `class RuleError extends Error { readonly rule: string }`
  - `runRules(pieces: readonly Piece[], rules: readonly NamedRule[], ctx: RuleContext): { pieces: Piece[]; counts: Counts }`
  - `polishText(text: string, rules: readonly NamedRule[], ctx: RuleContext): { text: string; counts: Counts }`

- [ ] **Step 1: Write the failing test**

`tests/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveLocale } from "../src/locales.js";
import {
	OBJECT_PLACEHOLDER,
	RuleError,
	polishText,
	runRules,
	type Edit,
	type Rule,
} from "../src/portable-text.js";

const ctx = { locale: resolveLocale(null, "en").style };

/** Replaces every occurrence of `from` with `to`. */
const replaceAll =
	(from: string, to: string): Rule =>
	(text) => {
		const edits: Edit[] = [];
		for (let at = text.indexOf(from); at !== -1; at = text.indexOf(from, at + from.length)) {
			edits.push({ start: at, end: at + from.length, text: to });
		}
		return edits;
	};

describe("polishText", () => {
	it("applies edits and counts them per rule", () => {
		const result = polishText("a-a-a", [["swap", replaceAll("a", "b")]], ctx);
		expect(result.text).toBe("b-b-b");
		expect(result.counts).toEqual({ swap: 3 });
	});

	it("runs rules in the given order, each on the previous result", () => {
		const result = polishText(
			"ab",
			[
				["first", replaceAll("a", "b")],
				["second", replaceAll("bb", "c")],
			],
			ctx,
		);
		expect(result.text).toBe("c");
		expect(result.counts).toEqual({ first: 1, second: 1 });
	});

	it("protects URLs and email addresses", () => {
		const text = "see https://example.com/a.b and me@site.org.";
		const result = polishText(text, [["dot", replaceAll(".", "!")]], ctx);
		expect(result.text).toBe("see https://example.com/a.b and me@site.org!");
	});

	it("drops overlapping edits after the first", () => {
		const overlapping: Rule = () => [
			{ start: 0, end: 2, text: "X" },
			{ start: 1, end: 3, text: "Y" },
		];
		expect(polishText("abc", [["o", overlapping]], ctx).text).toBe("Xc");
	});

	it("applies an insertion before a replacement at the same position", () => {
		const both: Rule = () => [
			{ start: 1, end: 2, text: "B" },
			{ start: 1, end: 1, text: "+" },
		];
		expect(polishText("abc", [["both", both]], ctx).text).toBe("a+Bc");
	});

	it("leaves surrogate pairs intact around edits", () => {
		const result = polishText("👍a👍", [["swap", replaceAll("a", "b")]], ctx);
		expect(result.text).toBe("👍b👍");
	});

	it("wraps a throwing rule in a RuleError naming the rule", () => {
		const boom: Rule = () => {
			throw new Error("bad regex");
		};
		expect(() => polishText("x", [["boom", boom]], ctx)).toThrowError(RuleError);
		try {
			polishText("x", [["boom", boom]], ctx);
		} catch (error) {
			expect((error as RuleError).rule).toBe("boom");
		}
	});
});

describe("runRules across pieces", () => {
	it("lets a rule see across piece boundaries but edits each piece in place", () => {
		const pieces = [
			{ text: "a", locked: false },
			{ text: "a", locked: false },
		];
		const result = runRules(pieces, [["swap", replaceAll("a", "b")]], ctx);
		expect(result.pieces.map((piece) => piece.text)).toEqual(["b", "b"]);
	});

	it("drops an edit that crosses a piece boundary", () => {
		const pieces = [
			{ text: "a-", locked: false },
			{ text: "-b", locked: false },
		];
		const result = runRules(pieces, [["dash", replaceAll("--", "—")]], ctx);
		expect(result.pieces.map((piece) => piece.text)).toEqual(["a-", "-b"]);
		expect(result.counts).toEqual({});
	});

	it("never edits a locked piece", () => {
		const pieces = [
			{ text: "a", locked: false },
			{ text: "a", locked: true },
			{ text: OBJECT_PLACEHOLDER, locked: true },
		];
		const result = runRules(pieces, [["swap", replaceAll("a", "b")]], ctx);
		expect(result.pieces.map((piece) => piece.text)).toEqual(["b", "a", OBJECT_PLACEHOLDER]);
		expect(result.counts).toEqual({ swap: 1 });
	});

	it("puts an insertion at a boundary into the piece before it", () => {
		const insertAt2: Rule = () => [{ start: 2, end: 2, text: "!" }];
		const pieces = [
			{ text: "ab", locked: false },
			{ text: "cd", locked: false },
		];
		const result = runRules(pieces, [["ins", insertAt2]], ctx);
		expect(result.pieces.map((piece) => piece.text)).toEqual(["ab!", "cd"]);
	});

	it("does not mutate the input pieces", () => {
		const pieces = [{ text: "a", locked: false }];
		runRules(pieces, [["swap", replaceAll("a", "b")]], ctx);
		expect(pieces[0]?.text).toBe("a");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/engine.test.ts`
Expected: FAIL — cannot resolve `../src/portable-text.js`.

- [ ] **Step 3: Write the implementation**

`src/portable-text.ts`:

```ts
import type { LocaleStyle } from "./locales.js";

/** Replace `[start, end)` with `text`. `start === end` is an insertion. */
export interface Edit {
	start: number;
	end: number;
	text: string;
}

export interface RuleContext {
	locale: LocaleStyle;
}

export type Rule = (text: string, ctx: RuleContext) => Edit[];
export type NamedRule = readonly [id: string, rule: Rule];
export type Counts = Record<string, number>;

/** One run of text. Locked pieces (code spans, inline objects) are never edited. */
export interface Piece {
	text: string;
	locked: boolean;
}

/** Stands in for an inline object (line break, embed) inside a paragraph. */
export const OBJECT_PLACEHOLDER = "￼";

export class RuleError extends Error {
	constructor(
		readonly rule: string,
		cause: unknown,
	) {
		super(`Rule "${rule}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = "RuleError";
	}
}

const URL_OR_EMAIL = /\b(?:https?:\/\/|www\.)[^\s<>"“”«»]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;

interface Bounds {
	start: number;
	end: number;
}

interface PlacedEdit extends Edit {
	piece: number;
}

export function runRules(
	pieces: readonly Piece[],
	rules: readonly NamedRule[],
	ctx: RuleContext,
): { pieces: Piece[]; counts: Counts } {
	let current = pieces.map((piece) => ({ ...piece }));
	const counts: Counts = {};
	for (const [id, rule] of rules) {
		const joined = current.map((piece) => piece.text).join("");
		const bounds = pieceBounds(current);
		let proposed: Edit[];
		try {
			proposed = rule(joined, ctx);
		} catch (error) {
			throw new RuleError(id, error);
		}
		const accepted = acceptEdits(proposed, current, bounds, protectedRanges(joined, current, bounds));
		if (accepted.length === 0) continue;
		current = applyEdits(current, bounds, accepted);
		counts[id] = (counts[id] ?? 0) + accepted.length;
	}
	return { pieces: current, counts };
}

export function polishText(
	text: string,
	rules: readonly NamedRule[],
	ctx: RuleContext,
): { text: string; counts: Counts } {
	const result = runRules([{ text, locked: false }], rules, ctx);
	return { text: result.pieces[0]?.text ?? text, counts: result.counts };
}

function pieceBounds(pieces: readonly Piece[]): Bounds[] {
	let offset = 0;
	return pieces.map((piece) => {
		const bounds = { start: offset, end: offset + piece.text.length };
		offset = bounds.end;
		return bounds;
	});
}

function protectedRanges(joined: string, pieces: readonly Piece[], bounds: readonly Bounds[]): Bounds[] {
	const ranges = bounds.filter((_, index) => pieces[index]?.locked);
	for (const match of joined.matchAll(URL_OR_EMAIL)) {
		const start = match.index ?? 0;
		ranges.push({ start, end: start + match[0].length });
	}
	return ranges;
}

/** The piece an edit belongs to, or -1 when it crosses a boundary. */
function owningPiece(edit: Edit, bounds: readonly Bounds[]): number {
	if (edit.start === edit.end) {
		// An insertion joins the piece holding the character before it.
		if (edit.start === 0) return bounds.length > 0 ? 0 : -1;
		return bounds.findIndex((b) => b.start < edit.start && edit.start <= b.end);
	}
	return bounds.findIndex((b) => b.start <= edit.start && edit.end <= b.end);
}

function touchesProtected(edit: Edit, ranges: readonly Bounds[]): boolean {
	return ranges.some((range) =>
		edit.start === edit.end
			? range.start < edit.start && edit.start < range.end
			: edit.start < range.end && edit.end > range.start,
	);
}

function acceptEdits(
	edits: readonly Edit[],
	pieces: readonly Piece[],
	bounds: readonly Bounds[],
	ranges: readonly Bounds[],
): PlacedEdit[] {
	const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
	const accepted: PlacedEdit[] = [];
	let lastEnd = 0;
	let lastInsertion = -1;
	for (const edit of sorted) {
		if (edit.start < lastEnd) continue;
		const isInsertion = edit.start === edit.end;
		if (isInsertion && edit.start === lastInsertion) continue;
		const piece = owningPiece(edit, bounds);
		if (piece === -1 || pieces[piece]?.locked || touchesProtected(edit, ranges)) continue;
		accepted.push({ ...edit, piece });
		lastEnd = edit.end;
		if (isInsertion) lastInsertion = edit.start;
	}
	return accepted;
}

function applyEdits(pieces: readonly Piece[], bounds: readonly Bounds[], edits: readonly PlacedEdit[]): Piece[] {
	const next = pieces.map((piece) => ({ ...piece }));
	// Right to left so earlier offsets stay valid; at equal starts the
	// replacement (larger end) goes first so an insertion lands before it.
	const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
	for (const edit of ordered) {
		const piece = next[edit.piece];
		const base = bounds[edit.piece]?.start ?? 0;
		if (!piece) continue;
		piece.text = piece.text.slice(0, edit.start - base) + edit.text + piece.text.slice(edit.end - base);
	}
	return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add src/portable-text.ts tests/engine.test.ts
git commit -m "feat: edit engine with piece mapping and protected ranges"
```

---

### Task 4: Safe rules — spacing, symbols, ellipsis, dashes

**Files:**
- Create: `src/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `Edit`, `Rule`, `polishText` from `src/portable-text.ts`; `resolveLocale` from `src/locales.ts`.
- Produces: exported `Rule` constants `spacing`, `symbols`, `ellipsis`, `dashes` from `src/rules.ts`; internal helper `matches(text, re, toEdit)` reused by Tasks 5–6.

- [ ] **Step 1: Write the failing test**

`tests/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveLocale } from "../src/locales.js";
import { polishText, type Rule } from "../src/portable-text.js";
import { dashes, ellipsis, spacing, symbols } from "../src/rules.js";

const fix = (rule: Rule, text: string, locale = "en") =>
	polishText(text, [["rule", rule]], { locale: resolveLocale(null, locale).style }).text;

describe("spacing", () => {
	it.each([
		["a  b", "a b"],
		["a     b", "a b"],
		["one.  Two", "one. Two"],
	])("changes %j → %j", (input, output) => expect(fix(spacing, input)).toBe(output));

	it.each(["  leading", "trailing  ", "a  b", "single space"])(
		"never touches %j",
		(input) => expect(fix(spacing, input)).toBe(input),
	);
});

describe("symbols", () => {
	it.each([
		["(c) 2026 Acme", "© 2026 Acme"],
		["Brand(R)", "Brand®"],
		["Name(tm)", "Name™"],
		["Name (TM)", "Name ™"],
	])("changes %j → %j", (input, output) => expect(fix(symbols, input)).toBe(output));

	it.each(["(a) one (b) two (c) three", "(cc)", "(rr)"])("never touches %j", (input) =>
		expect(fix(symbols, input)).toBe(input),
	);
});

describe("ellipsis", () => {
	it.each([
		["Wait...", "Wait…"],
		["...and then", "…and then"],
		["so... yes", "so… yes"],
	])("changes %j → %j", (input, output) => expect(fix(ellipsis, input)).toBe(output));

	it.each(["Wait....", "1.2.3", "a.b"])("never touches %j", (input) =>
		expect(fix(ellipsis, input)).toBe(input),
	);
});

describe("dashes", () => {
	it.each([
		["wait--what", "wait—what"],
		["wait -- what", "wait — what"],
		["and then--", "and then—"],
		["London - Paris", "London – Paris"],
		["2 - 3", "2 – 3"],
	])("changes %j → %j", (input, output) => expect(fix(dashes, input)).toBe(output));

	it.each(["--force", "npm i --save-dev", "a --- b", "- list item", "well-known", "x-y"])(
		"never touches %j",
		(input) => expect(fix(dashes, input)).toBe(input),
	);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: FAIL — cannot resolve `../src/rules.js`.

- [ ] **Step 3: Write the implementation**

`src/rules.ts`:

```ts
import type { Edit, Rule } from "./portable-text.js";

/** A letter or a digit in any script. */
const WORDISH = /[\p{L}\p{N}]/u;

/** Collect edits from every match of a global regex. */
function matches(
	text: string,
	re: RegExp,
	toEdit: (match: RegExpMatchArray, at: number) => Edit | Edit[] | null,
): Edit[] {
	const edits: Edit[] = [];
	for (const match of text.matchAll(re)) {
		const result = toEdit(match, match.index ?? 0);
		if (result) edits.push(...(Array.isArray(result) ? result : [result]));
	}
	return edits;
}

export const spacing: Rule = (text) =>
	matches(text, /(?<=\S) {2,}(?=\S)/g, (match, at) => ({ start: at, end: at + match[0].length, text: " " }));

const SYMBOLS: Readonly<Record<string, string>> = { c: "©", r: "®", tm: "™" };

export const symbols: Rule = (text) => {
	// "(c)" after "(a)" or "(b)" is a list marker, not a copyright sign.
	const isList = /\((?:a|b)\)/i.test(text);
	return matches(text, /\((c|r|tm)\)/gi, (match, at) => {
		const key = (match[1] ?? "").toLowerCase();
		if (key === "c" && isList) return null;
		const glyph = SYMBOLS[key];
		return glyph ? { start: at, end: at + match[0].length, text: glyph } : null;
	});
};

export const ellipsis: Rule = (text) =>
	matches(text, /(?<!\.)\.\.\.(?!\.)/g, (_, at) => ({ start: at, end: at + 3, text: "…" }));

export const dashes: Rule = (text) => [
	...matches(text, /(?<!-)--(?!-)/g, (_, at) => {
		const before = text[at - 1];
		const after = text[at + 2];
		const startsWord = before === undefined || /\s/.test(before);
		// "--force": a command-line flag, not a dash.
		if (startsWord && after !== undefined && WORDISH.test(after)) return null;
		return { start: at, end: at + 2, text: "—" };
	}),
	...matches(text, /(?<=[\p{L}\p{N},.!?;:)"”’]) - (?=[\p{L}\p{N}("“‘])/gu, (_, at) => ({
		start: at + 1,
		end: at + 2,
		text: "–",
	})),
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: spacing, symbols, ellipsis and dash rules"
```

---

### Task 5: Quotes and no-break spaces

**Files:**
- Modify: `src/rules.ts`
- Test: `tests/rules.test.ts` (append)

**Interfaces:**
- Consumes: `matches`, `WORDISH` (Task 4); `APOSTROPHE`, `ELISIONS`, `UNITS`, `CURRENCIES` from `src/locales.ts`; `RuleContext.locale`.
- Produces: exported `quotes: Rule`, `nbsp: Rule`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules.test.ts` (and add `nbsp, quotes` to the existing `../src/rules.js` import):

```ts
describe("quotes", () => {
	it.each([
		['"Hello"', "“Hello”"],
		["it's", "it’s"],
		["'90s", "’90s"],
		["rock 'n' roll", "rock ’n’ roll"],
		["'tis the season", "’tis the season"],
		["She said 'hi'", "She said ‘hi’"],
		[`"She said 'hi'"`, "“She said ‘hi’”"],
		['("quoted")', "(“quoted”)"],
		["students' books", "students’ books"],
		['"I am 10"', "“I am 10”"],
		['"hi" 👍', "“hi” 👍"],
		['👍 "hi"', "👍 “hi”"],
	])("changes %j → %j", (input, output) => expect(fix(quotes, input)).toBe(output));

	it.each(["“already” ‘curly’", "no quotes here"])("never touches %j", (input) =>
		expect(fix(quotes, input)).toBe(input),
	);

	it.each([
		["fr", '"Bonjour"', "«Bonjour»"],
		["fr", "l'homme", "l’homme"],
		["de", '"Hallo"', "„Hallo“"],
		["de", "'Hallo'", "‚Hallo‘"],
		["ja", '"こんにちは"', "「こんにちは」"],
		["da", '"Hej"', "»Hej«"],
		["ar", '"marhaba"', "“marhaba”"],
	])("in %s changes %j → %j", (locale, input, output) =>
		expect(fix(quotes, input, locale)).toBe(output),
	);
});

describe("nbsp", () => {
	it.each([
		["10 kg", "10 kg"],
		["5 min", "5 min"],
		["50 %", "50 %"],
		["90 km/h", "90 km/h"],
		["₹ 500", "₹ 500"],
		["5 €", "5 €"],
	])("changes %j → %j", (input, output) => expect(fix(nbsp, input)).toBe(output));

	it.each(["5 in total", "10 kgs", "Room 5 A", "Hello!", "Note: yes", "12:30"])(
		"in English never touches %j",
		(input) => expect(fix(nbsp, input)).toBe(input),
	);

	it.each([
		["Bonjour !", "Bonjour !"],
		["Bonjour!", "Bonjour !"],
		["Vraiment ?", "Vraiment ?"],
		["Quoi ?!", "Quoi ?!"],
		["Note : oui", "Note : oui"],
		["Note: oui", "Note : oui"],
		["«Bonjour»", "« Bonjour »"],
		["« Bonjour »", "« Bonjour »"],
	])("in French changes %j → %j", (input, output) => expect(fix(nbsp, input, "fr")).toBe(output));

	it.each(["12:30", "Super :)", "Clin d'œil ;)", "Bonjour !"])(
		"in French never touches %j",
		(input) => expect(fix(nbsp, input, "fr")).toBe(input),
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: FAIL — `quotes` / `nbsp` are not exported.

- [ ] **Step 3: Write the implementation**

Add to the top of `src/rules.ts`:

```ts
import { APOSTROPHE, CURRENCIES, ELISIONS, UNITS } from "./locales.js";
```

Append to `src/rules.ts`:

```ts
/** A quote opens after these (or at the start of the text). */
const OPENS_AFTER = /[\s([{—–\-/  ￼]/u;

function startsElision(text: string, from: number): boolean {
	const word = /^\p{L}+/u.exec(text.slice(from))?.[0]?.toLowerCase();
	return word !== undefined && ELISIONS.includes(word);
}

export const quotes: Rule = (text, { locale }) => {
	const edits: Edit[] = [];
	const openingGlyphs = new Set([locale.double[0], locale.single[0]]);
	// Whether the straight quote at an index was turned into an opening glyph.
	const opened = new Map<number, boolean>();
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== '"' && ch !== "'") continue;
		const prev = text[i - 1];
		const next = text[i + 1];
		const prevIsStraightQuote = prev === '"' || prev === "'";
		const opens = prevIsStraightQuote
			? opened.get(i - 1) === true
			: prev === undefined || OPENS_AFTER.test(prev) || openingGlyphs.has(prev);

		let glyph: string;
		if (ch === '"') {
			glyph = opens ? locale.double[0] : locale.double[1];
		} else if (prev !== undefined && WORDISH.test(prev) && next !== undefined && WORDISH.test(next)) {
			glyph = APOSTROPHE; // it's, l'homme
		} else if (opens && next !== undefined && (/\d/.test(next) || startsElision(text, i + 1))) {
			glyph = APOSTROPHE; // '90s, 'tis
		} else {
			glyph = opens ? locale.single[0] : locale.single[1];
		}
		opened.set(i, glyph === locale.double[0] || glyph === locale.single[0]);
		edits.push({ start: i, end: i + 1, text: glyph });
	}
	return edits;
};

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const UNIT_SPACE = new RegExp(
	`(?<=\\d) (?=(?:${UNITS.map(escapeRe).join("|")})(?![\\p{L}\\p{N}]))`,
	"gu",
);
const CURRENCY_CLASS = CURRENCIES.map(escapeRe).join("");
const SPACE_AFTER_CURRENCY = new RegExp(`(?<=[${CURRENCY_CLASS}]) (?=\\d)`, "gu");
const SPACE_BEFORE_CURRENCY = new RegExp(`(?<=\\d) (?=[${CURRENCY_CLASS}](?![\\p{L}\\p{N}]))`, "gu");

const NBSP = " ";
const NARROW_NBSP = " ";
const HIGH_PUNCTUATION = ";!?:";

function frenchSpacing(text: string): Edit[] {
	const edits: Edit[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? "";
		const prev = text[i - 1];
		const next = text[i + 1];
		if (HIGH_PUNCTUATION.includes(ch)) {
			if (prev !== undefined && HIGH_PUNCTUATION.includes(prev)) continue; // only before the first of "?!"
			if (next !== undefined && /[()/]/.test(next)) continue; // :) ;( http:/
			if (ch === ":" && prev !== undefined && /\d/.test(prev) && next !== undefined && /\d/.test(next)) continue; // 12:30
			const space = ch === ":" ? NBSP : NARROW_NBSP;
			if (prev === " ") edits.push({ start: i - 1, end: i, text: space });
			else if (prev !== undefined && /[\p{L}\p{N}»)\]’”]/u.test(prev)) edits.push({ start: i, end: i, text: space });
		} else if (ch === "«") {
			if (next === " ") edits.push({ start: i + 1, end: i + 2, text: NARROW_NBSP });
			else if (next !== undefined && WORDISH.test(next)) edits.push({ start: i + 1, end: i + 1, text: NARROW_NBSP });
		} else if (ch === "»") {
			if (prev === " ") edits.push({ start: i - 1, end: i, text: NARROW_NBSP });
			else if (prev !== undefined && /[\p{L}\p{N}.!?…]/u.test(prev)) edits.push({ start: i, end: i, text: NARROW_NBSP });
		}
	}
	return edits;
}

export const nbsp: Rule = (text, { locale }) => {
	const toNbsp = (_: RegExpMatchArray, at: number): Edit => ({ start: at, end: at + 1, text: NBSP });
	return [
		...matches(text, UNIT_SPACE, toNbsp),
		...matches(text, SPACE_AFTER_CURRENCY, toNbsp),
		...matches(text, SPACE_BEFORE_CURRENCY, toNbsp),
		...(locale.frenchSpacing ? frenchSpacing(text) : []),
	];
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: PASS (Task 4 cases still pass).

- [ ] **Step 5: Commit**

```bash
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: locale-aware quotes and no-break space rules"
```

---

### Task 6: Risky rules, rule registry, idempotence

**Files:**
- Modify: `src/rules.ts`
- Test: `tests/rules.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 4–5; `FRACTIONS` from `src/locales.ts`; `NamedRule` from `src/portable-text.ts`.
- Produces:
  - exported `ranges`, `multiplication`, `fractions`, `primes: Rule`
  - `RULE_IDS` (readonly tuple, spec order), `type RuleId`
  - `RULES: Record<RuleId, Rule>`, `RULE_LABELS: Record<RuleId, string>`, `RULE_DEFAULTS: Record<RuleId, boolean>`, `RISKY_RULES: ReadonlySet<RuleId>`
  - `selectRules(enabled: ReadonlySet<RuleId>): NamedRule[]` (spec order)

- [ ] **Step 1: Write the failing tests**

Append to `tests/rules.test.ts` (extend the `../src/rules.js` import with `RULE_DEFAULTS, RULE_IDS, fractions, multiplication, primes, ranges, selectRules`):

```ts
describe("ranges", () => {
	it.each([
		["pages 10-20", "pages 10–20"],
		["1990-1995", "1990–1995"],
		["read 10-20.", "read 10–20."],
	])("changes %j → %j", (input, output) => expect(fix(ranges, input)).toBe(output));

	it.each(["2026-10-08", "555-123-4567", "B-52", "won 3-2", "1.5-3", "10:00-11:00", "12345-6789"])(
		"never touches %j",
		(input) => expect(fix(ranges, input)).toBe(input),
	);
});

describe("multiplication", () => {
	it.each([
		["1920x1080", "1920×1080"],
		["3 x 4", "3 × 4"],
		["2.5x3", "2.5×3"],
	])("changes %j → %j", (input, output) => expect(fix(multiplication, input)).toBe(output));

	it.each(["0x1F", "0x10", "X200x300", "3x", "3 x4", "box"])("never touches %j", (input) =>
		expect(fix(multiplication, input)).toBe(input),
	);
});

describe("fractions", () => {
	it.each([
		["1/2 cup", "½ cup"],
		["add 3/4", "add ¾"],
		["2/3 done", "⅔ done"],
	])("changes %j → %j", (input, output) => expect(fix(fractions, input)).toBe(output));

	it.each(["1/2/2026", "11/2", "1/20", "21/2", "5/8"])("never touches %j", (input) =>
		expect(fix(fractions, input)).toBe(input),
	);
});

describe("primes", () => {
	it.each([
		[`5'10"`, "5′10″"],
		[`5' 11"`, "5′ 11″"],
		["6' tall", "6′ tall"],
	])("changes %j → %j", (input, output) => expect(fix(primes, input)).toBe(output));

	it.each([`"I am 10"`, "'I scored 10' she said", "the '90s", "rock'n'roll"])(
		"never touches %j",
		(input) => expect(fix(primes, input)).toBe(input),
	);
});

describe("rule registry", () => {
	it("keeps the spec's order", () => {
		expect(RULE_IDS).toEqual([
			"spacing", "symbols", "ellipsis", "dashes", "ranges",
			"multiplication", "fractions", "primes", "quotes", "nbsp",
		]);
	});

	it("turns risky rules off by default", () => {
		expect(RULE_IDS.filter((id) => !RULE_DEFAULTS[id])).toEqual([
			"ranges", "multiplication", "fractions", "primes",
		]);
	});

	it("selects enabled rules in spec order regardless of set order", () => {
		const ids = selectRules(new Set(["quotes", "spacing"] as const)).map(([id]) => id);
		expect(ids).toEqual(["spacing", "quotes"]);
	});
});

describe("all rules together", () => {
	const all = selectRules(new Set(RULE_IDS));
	const run = (text: string, locale = "en") =>
		polishText(text, all, { locale: resolveLocale(null, locale).style }).text;

	it("lets primes claim measurements before quotes see them", () => {
		expect(run(`He is 5'10" and said "hi"`)).toBe("He is 5′10″ and said “hi”");
	});

	it.each([
		[`"Wait..." -- she said  it's 10 kg (c) 2026`, "en"],
		[`"Bonjour !" l'homme : 1/2 page`, "fr"],
		[`She said 'hi' -- then "bye"... 1920x1080`, "en"],
		[`„Schon“ "da" 3 x 4`, "de"],
	])("is idempotent on %j (%s)", (input, locale) => {
		const once = run(input, locale);
		expect(run(once, locale)).toBe(once);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: FAIL — `ranges`, `RULE_IDS` etc. are not exported.

- [ ] **Step 3: Write the implementation**

Change the `./locales.js` import in `src/rules.ts` to:

```ts
import { APOSTROPHE, CURRENCIES, ELISIONS, FRACTIONS, UNITS } from "./locales.js";
```

and the `./portable-text.js` import to:

```ts
import type { Edit, NamedRule, Rule } from "./portable-text.js";
```

Append to `src/rules.ts`:

```ts
export const ranges: Rule = (text) =>
	matches(
		text,
		/(?<![\p{L}\p{N}\-/:]|\d\.)(\d{1,4})-(\d{1,4})(?![\p{L}\p{N}\-/:]|\.\d)/gu,
		(match, at) => {
			const from = match[1] ?? "";
			const to = match[2] ?? "";
			if (Number(from) >= Number(to)) return null; // scores like 3-2
			return { start: at + from.length, end: at + from.length + 1, text: "–" };
		},
	);

export const multiplication: Rule = (text) =>
	matches(text, /(?<![\p{L}\p{N}.])(\d+(?:\.\d+)?)( ?)x\2(\d+(?:\.\d+)?)(?![\p{L}\p{N}])/gu, (match, at) => {
		const left = match[1] ?? "";
		const space = match[2] ?? "";
		if (left === "0" && space === "") return null; // hex: 0x10
		const x = at + left.length + space.length;
		return { start: x, end: x + 1, text: "×" };
	});

export const fractions: Rule = (text) =>
	matches(text, /(?<![\p{N}/])(\d\/\d)(?![\p{N}/])/gu, (match, at) => {
		const glyph = FRACTIONS[match[1] ?? ""];
		return glyph ? { start: at, end: at + 3, text: glyph } : null;
	});

/** An opening single quote earlier in the text means a later ' after a digit is probably its close. */
const hasOpenSingleQuote = (before: string) => /(?:^|[\s([{])['‘]/.test(before);

export const primes: Rule = (text) => {
	const edits: Edit[] = [];
	const claimed = new Set<number>();
	for (const match of text.matchAll(/(?<![\p{L}\p{N}])(\d+)'(\s?)(\d+(?:\.\d+)?)"/gu)) {
		const at = match.index ?? 0;
		const feet = at + (match[1] ?? "").length;
		const inches = at + match[0].length - 1;
		edits.push({ start: feet, end: feet + 1, text: "′" }, { start: inches, end: inches + 1, text: "″" });
		claimed.add(feet);
	}
	for (const match of text.matchAll(/(?<![\p{L}\p{N}])(\d+)'(?=[\s,.;:!?)]|$)/gu)) {
		const at = match.index ?? 0;
		const feet = at + (match[1] ?? "").length;
		if (claimed.has(feet) || hasOpenSingleQuote(text.slice(0, at))) continue;
		edits.push({ start: feet, end: feet + 1, text: "′" });
	}
	return edits;
};

export const RULE_IDS = [
	"spacing", "symbols", "ellipsis", "dashes", "ranges",
	"multiplication", "fractions", "primes", "quotes", "nbsp",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export const RULES: Record<RuleId, Rule> = {
	spacing, symbols, ellipsis, dashes, ranges, multiplication, fractions, primes, quotes, nbsp,
};

export const RULE_LABELS: Record<RuleId, string> = {
	spacing: "Double spaces",
	symbols: "Symbols © ® ™",
	ellipsis: "Ellipsis …",
	dashes: "Dashes — –",
	ranges: "Number ranges 10–20",
	multiplication: "Multiplication ×",
	fractions: "Fractions ½",
	primes: "Feet and inches 5′10″",
	quotes: "Curly quotes",
	nbsp: "No-break spaces",
};

export const RISKY_RULES: ReadonlySet<RuleId> = new Set(["ranges", "multiplication", "fractions", "primes"]);

export const RULE_DEFAULTS: Record<RuleId, boolean> = Object.fromEntries(
	RULE_IDS.map((id) => [id, !RISKY_RULES.has(id)]),
) as Record<RuleId, boolean>;

export function selectRules(enabled: ReadonlySet<RuleId>): NamedRule[] {
	return RULE_IDS.filter((id) => enabled.has(id)).map((id) => [id, RULES[id]] as const);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/rules.test.ts`
Expected: PASS. If an idempotence case fails, the second run's diff names the rule that re-fires — fix that rule's guard (it is treating its own output as input), not the test.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add src/rules.ts tests/rules.test.ts
git commit -m "feat: opt-in ranges, multiplication, fractions and primes; rule registry"
```

---

### Task 7: Portable Text and field orchestration

**Files:**
- Modify: `src/portable-text.ts`
- Test: `tests/portable-text.test.ts`

**Interfaces:**
- Consumes: `runRules`, `polishText`, `RuleError`, `OBJECT_PLACEHOLDER`, `Counts`, `NamedRule`, `RuleContext` (Task 3); `selectRules`, `RULE_IDS` (Task 6, tests only).
- Produces:
  - `polishPortableText(value: unknown, rules: readonly NamedRule[], ctx: RuleContext): { value: unknown; counts: Counts }`
  - `sameStructure(before: unknown, after: unknown): boolean`
  - `const MAX_FIELD_BYTES = 64 * 1024`
  - `interface FieldDefinition { slug: string; label: string; type: string }`
  - `type FieldStatus = "changed" | "clean" | "too-large" | "failed" | "skipped"`
  - `interface FieldResult { slug: string; label: string; status: FieldStatus; value?: unknown; counts: Counts }`
  - `type FieldLog = (message: string, data: Record<string, string>) => void`
  - `polishFields(fields: Record<string, unknown>, definitions: readonly FieldDefinition[], rules: readonly NamedRule[], ctx: RuleContext, log: FieldLog): { results: FieldResult[]; counts: Counts }`

- [ ] **Step 1: Write the failing test**

`tests/portable-text.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveLocale } from "../src/locales.js";
import {
	MAX_FIELD_BYTES,
	polishFields,
	polishPortableText,
	sameStructure,
	type Rule,
} from "../src/portable-text.js";
import { RULE_IDS, selectRules } from "../src/rules.js";

const ctx = { locale: resolveLocale(null, "en").style };
const all = selectRules(new Set(RULE_IDS));

const span = (key: string, text: string, marks: string[] = []) => ({ _type: "span", _key: key, text, marks });
const block = (key: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs: [],
	children,
	...extra,
});
const texts = (value: unknown) =>
	(value as Array<{ children?: Array<{ text?: string }> }>).map((b) => b.children?.map((c) => c.text));

describe("polishPortableText", () => {
	it("gets quote direction right across formatting runs", () => {
		const value = [block("b1", [span("s1", 'He said "'), span("s2", "hello", ["strong"]), span("s3", '" -- twice...')])];
		const result = polishPortableText(value, all, ctx);
		expect(texts(result.value)).toEqual([["He said “", "hello", "” — twice…"]]);
		expect(result.counts).toMatchObject({ quotes: 2, dashes: 1, ellipsis: 1 });
	});

	it("never touches inline code", () => {
		const value = [block("b1", [span("s1", "Use "), span("s2", '"--force"', ["code"]), span("s3", " here...")])];
		expect(texts(polishPortableText(value, all, ctx).value)).toEqual([["Use ", '"--force"', " here…"]]);
	});

	it("treats inline objects as fixed points", () => {
		const value = [block("b1", [span("s1", '"a'), { _type: "break", _key: "k1" }, span("s2", 'b"')])];
		const result = polishPortableText(value, all, ctx);
		expect(texts(result.value)).toEqual([["“a", undefined, "b”"]]);
	});

	it("leaves non-text blocks alone", () => {
		const code = { _type: "code", _key: "c1", code: 'echo "x" -- y...' };
		const image = { _type: "image", _key: "i1", alt: '"alt"' };
		const result = polishPortableText([code, image], all, ctx);
		expect(result.value).toEqual([code, image]);
		expect(result.counts).toEqual({});
	});

	it("keeps keys, marks, markDefs, styles and list data", () => {
		const value = [
			block("b1", [span("s1", '"Hi"', ["em", "link1"])], {
				style: "h2",
				listItem: "bullet",
				level: 2,
				markDefs: [{ _type: "link", _key: "link1", href: "https://x.com/a--b" }],
			}),
		];
		const result = polishPortableText(value, all, ctx);
		expect(sameStructure(value, result.value)).toBe(true);
		expect(result.value).toEqual([
			{ ...value[0], children: [{ ...span("s1", "“Hi”", ["em", "link1"]) }] },
		]);
	});

	it("resets quote context at each paragraph", () => {
		const value = [block("b1", [span("s1", '"one')]), block("b2", [span("s2", '"two"')])];
		expect(texts(polishPortableText(value, all, ctx).value)).toEqual([["“one"], ["“two”"]]);
	});

	it("returns non-arrays unchanged", () => {
		expect(polishPortableText("plain", all, ctx).value).toBe("plain");
	});
});

describe("sameStructure", () => {
	it("ignores span text", () => {
		expect(sameStructure([block("b", [span("s", "a")])], [block("b", [span("s", "b")])])).toBe(true);
	});

	it("catches an added span, a changed key or a dropped mark", () => {
		const base = [block("b", [span("s", "a", ["em"])])];
		expect(sameStructure(base, [block("b", [span("s", "a", ["em"]), span("t", "b")])])).toBe(false);
		expect(sameStructure(base, [block("b", [span("x", "a", ["em"])])])).toBe(false);
		expect(sameStructure(base, [block("b", [span("s", "a")])])).toBe(false);
	});
});

describe("polishFields", () => {
	const definitions = [
		{ slug: "title", label: "Title", type: "string" },
		{ slug: "excerpt", label: "Excerpt", type: "text" },
		{ slug: "content", label: "Content", type: "portableText" },
		{ slug: "featured_image", label: "Featured image", type: "image" },
	];

	it("polishes text and rich-text fields and reports totals", () => {
		const log = vi.fn();
		const { results, counts } = polishFields(
			{
				title: '"Hello"',
				excerpt: "Clean",
				content: [block("b1", [span("s1", "Wait...")])],
				featured_image: { id: "m1" },
			},
			definitions,
			all,
			ctx,
			log,
		);
		expect(results.map((r) => [r.slug, r.status])).toEqual([
			["title", "changed"],
			["excerpt", "clean"],
			["content", "changed"],
			["featured_image", "skipped"],
		]);
		expect(results[0]?.value).toBe("“Hello”");
		expect(texts(results[2]?.value)).toEqual([["Wait…"]]);
		expect(counts).toEqual({ quotes: 2, ellipsis: 1 });
		expect(log).not.toHaveBeenCalled();
	});

	it("ignores definitions with no value in the draft", () => {
		const { results } = polishFields({ title: "x" }, definitions, all, ctx, vi.fn());
		expect(results.map((r) => r.slug)).toEqual(["title"]);
	});

	it("omits a field that would exceed the size limit", () => {
		const big = `"x" ${"a".repeat(MAX_FIELD_BYTES)}`;
		const { results } = polishFields({ excerpt: big }, definitions, all, ctx, vi.fn());
		expect(results[0]).toMatchObject({ slug: "excerpt", status: "too-large" });
		expect(results[0]?.value).toBeUndefined();
	});

	it("contains a failing rule to its field and logs without content", () => {
		const boom: Rule = () => {
			throw new Error("broken");
		};
		const log = vi.fn();
		const { results } = polishFields({ title: "secret words" }, definitions, [["boom", boom]], ctx, log);
		expect(results[0]).toMatchObject({ slug: "title", status: "failed" });
		expect(log).toHaveBeenCalledWith("Typographer could not polish a field", {
			field: "title",
			rule: "boom",
			error: expect.any(String),
		});
		expect(JSON.stringify(log.mock.calls)).not.toContain("secret words");
	});

	it("passes the structure guard for every polished rich-text field", () => {
		const content = [block("b1", [span("s1", '"a"'), span("s2", "b", ["em"])])];
		const { results } = polishFields({ content }, definitions, all, ctx, vi.fn());
		expect(results[0]?.status).toBe("changed");
		expect(sameStructure(content, results[0]?.value)).toBe(true);
	});
});
```

The guard's negative path (an added span, a changed key, a dropped mark) is pinned by the `sameStructure` tests above; the engine itself cannot change structure, so there is no honest way to make `polishFields` trip it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/portable-text.test.ts`
Expected: FAIL — `polishPortableText` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/portable-text.ts`:

```ts
interface SpanNode {
	_type: "span";
	text: string;
	marks?: unknown;
}

interface TextBlockNode {
	_type: "block";
	children: unknown[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isSpan = (value: unknown): value is SpanNode =>
	isRecord(value) && value._type === "span" && typeof value.text === "string";

const isTextBlock = (value: unknown): value is TextBlockNode =>
	isRecord(value) && value._type === "block" && Array.isArray(value.children);

const hasCodeMark = (span: SpanNode) => Array.isArray(span.marks) && span.marks.includes("code");

function addCounts(into: Counts, from: Counts): void {
	for (const [id, count] of Object.entries(from)) into[id] = (into[id] ?? 0) + count;
}

export function polishPortableText(
	value: unknown,
	rules: readonly NamedRule[],
	ctx: RuleContext,
): { value: unknown; counts: Counts } {
	if (!Array.isArray(value)) return { value, counts: {} };
	const counts: Counts = {};
	const polished = value.map((node) => {
		if (!isTextBlock(node)) return node;
		const pieces: Piece[] = node.children.map((child) =>
			isSpan(child) ? { text: child.text, locked: hasCodeMark(child) } : { text: OBJECT_PLACEHOLDER, locked: true },
		);
		const result = runRules(pieces, rules, ctx);
		if (Object.keys(result.counts).length === 0) return node;
		addCounts(counts, result.counts);
		return {
			...node,
			children: node.children.map((child, index) =>
				isSpan(child) ? { ...child, text: result.pieces[index]?.text ?? child.text } : child,
			),
		};
	});
	return { value: polished, counts };
}

function blankSpanText(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(blankSpanText);
	if (!isRecord(value)) return value;
	const isSpanNode = value._type === "span";
	return Object.fromEntries(
		Object.entries(value).map(([key, inner]) => [key, isSpanNode && key === "text" ? "" : blankSpanText(inner)]),
	);
}

/** True when two values differ in nothing but span text. */
export function sameStructure(before: unknown, after: unknown): boolean {
	return JSON.stringify(blankSpanText(before)) === JSON.stringify(blankSpanText(after));
}

export const MAX_FIELD_BYTES = 64 * 1024;

export interface FieldDefinition {
	slug: string;
	label: string;
	type: string;
}

export type FieldStatus = "changed" | "clean" | "too-large" | "failed" | "skipped";

export interface FieldResult {
	slug: string;
	label: string;
	status: FieldStatus;
	value?: unknown;
	counts: Counts;
}

export type FieldLog = (message: string, data: Record<string, string>) => void;

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function polishField(
	definition: FieldDefinition,
	value: unknown,
	rules: readonly NamedRule[],
	ctx: RuleContext,
): FieldResult {
	const base = { slug: definition.slug, label: definition.label };
	let polished: { value: unknown; counts: Counts };
	if ((definition.type === "string" || definition.type === "text") && typeof value === "string") {
		const result = polishText(value, rules, ctx);
		polished = { value: result.text, counts: result.counts };
	} else if (definition.type === "portableText") {
		polished = polishPortableText(value, rules, ctx);
		if (!sameStructure(value, polished.value)) throw new RuleError("structure-guard", "structure changed");
	} else {
		return { ...base, status: "skipped", counts: {} };
	}
	if (Object.keys(polished.counts).length === 0) return { ...base, status: "clean", counts: {} };
	if (byteLength(polished.value) > MAX_FIELD_BYTES) return { ...base, status: "too-large", counts: polished.counts };
	return { ...base, status: "changed", value: polished.value, counts: polished.counts };
}

export function polishFields(
	fields: Record<string, unknown>,
	definitions: readonly FieldDefinition[],
	rules: readonly NamedRule[],
	ctx: RuleContext,
	log: FieldLog,
): { results: FieldResult[]; counts: Counts } {
	const results: FieldResult[] = [];
	const counts: Counts = {};
	for (const definition of definitions) {
		if (!(definition.slug in fields)) continue;
		try {
			const result = polishField(definition, fields[definition.slug], rules, ctx);
			results.push(result);
			if (result.status === "changed") addCounts(counts, result.counts);
		} catch (error) {
			log("Typographer could not polish a field", {
				field: definition.slug,
				rule: error instanceof RuleError ? error.rule : "unknown",
				error: error instanceof Error ? error.name : "Error",
			});
			results.push({ slug: definition.slug, label: definition.label, status: "failed", counts: {} });
		}
	}
	return { results, counts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/portable-text.test.ts`
Expected: PASS. Note the `counts` assertion in "polishes text and rich-text fields": the error-log test checks `error` is the error *name* only (never the message, which could echo content).

- [ ] **Step 5: Run the whole suite, typecheck, commit**

```bash
pnpm test && pnpm run typecheck
git add src/portable-text.ts tests/portable-text.test.ts
git commit -m "feat: portable text polishing with structure guard and per-field results"
```

---

### Task 8: Editor panel

**Files:**
- Modify: `emdash-plugin.jsonc`, `src/plugin.ts`, `tests/plugin.test.ts` (replace scaffold test), `SPEC.md` (one clarification)
- Create: `src/ui.ts`

**Interfaces:**
- Consumes: `resolveLocale`, `ResolvedLocale` (Task 2); `polishFields`, `FieldResult`, `Counts` (Task 7); `RULE_IDS`, `RuleId`, `RULE_LABELS`, `RULE_DEFAULTS`, `RISKY_RULES`, `selectRules` (Task 6).
- Produces:
  - Manifest panel id `typographer`, route `panel`.
  - `src/ui.ts`: `panelIntro(locale: ResolvedLocale): BlockResponse`, `scanResult(counts: Counts, enabled: ReadonlySet<RuleId>, locale: ResolvedLocale): BlockResponse`, `polishResult(results: FieldResult[], counts: Counts): BlockResponse`, `errorResponse(message: string): BlockResponse`
  - `src/plugin.ts`: `readSettings(ctx): Promise<{ rules: Set<RuleId>; locale: string | null }>` (Task 9 adds the settings page that writes them).

- [ ] **Step 1: Declare the panel in the manifest**

Edit `emdash-plugin.jsonc`: set `"capabilities": ["admin.editor-draft:read", "admin.editor-draft:patch"]` and add, before the closing brace (keep `allowedHosts: []`, `storage: {}`):

```jsonc
	"admin": {
		"editorPanels": [
			{
				"id": "typographer",
				"title": "Typographer",
				"route": "panel",
				"collections": [
					"posts", "pages", "projects", "articles", "news", "blog", "stories",
					"docs", "guides", "tutorials", "events", "products", "case_studies",
					"portfolio", "services", "recipes", "podcasts", "episodes", "faqs",
					"testimonials", "team", "jobs", "courses", "lessons", "changelog",
					"press", "resources", "reviews"
				],
				"draft": {
					"read": { "fields": [
						"title", "subtitle", "headline", "excerpt", "summary", "description",
						"intro", "lead", "content", "body", "text", "bio", "abstract",
						"caption", "quote", "question", "answer", "details", "overview"
					] },
					"patch": { "fields": [
						"title", "subtitle", "headline", "excerpt", "summary", "description",
						"intro", "lead", "content", "body", "text", "bio", "abstract",
						"caption", "quote", "question", "answer", "details", "overview"
					] }
				}
			}
		]
	}
```

Run: `pnpm run validate`
Expected: PASS. (If validation complains that route `panel` doesn't exist yet, continue — Step 4 adds it.)

- [ ] **Step 2: Write the failing test**

Replace `tests/plugin.test.ts` entirely:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost } from "@emdash-cms/plugin-test";

type Host = Awaited<ReturnType<typeof createPluginRuntimeTestHost>>;
let host: Host | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const POST_FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "featured_image", label: "Featured image", type: "image" },
	{ slug: "content", label: "Content", type: "portableText" },
	{ slug: "excerpt", label: "Excerpt", type: "text" },
] as const;

const PAGE_FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "content", label: "Content", type: "portableText" },
] as const;

const paragraph = (text: string) => [
	{
		_type: "block",
		_key: "b1",
		style: "normal",
		markDefs: [],
		children: [{ _type: "span", _key: "s1", text, marks: [] }],
	},
];

async function setup(collection: "posts" | "pages", locale = "en") {
	host = await createPluginRuntimeTestHost({ i18n: { defaultLocale: "en", locales: ["en", "fr", "ar"] } });
	await host.fixtures.collection({
		slug: collection,
		label: collection,
		fields: [...(collection === "posts" ? POST_FIELDS : PAGE_FIELDS)],
	});
	const entry = await host.fixtures.content(collection, {
		data: { title: "Saved", content: paragraph("Saved") },
		locale,
	});
	return { host, entry };
}

const text = (response: { blocks: unknown[] }) => JSON.stringify(response.blocks);
const editorState = (draft: { entryId: string; locale: string | null; generation: number; invocationId: string }) => ({
	entryId: draft.entryId,
	locale: draft.locale,
	generation: draft.generation,
	invocationId: draft.invocationId,
});

describe("Typographer panel", () => {
	it("opens with the locale and a scan button, without reading the draft", async () => {
		const { host, entry } = await setup("posts", "fr");
		const intro = await host.admin.loadEditorPanel("typographer", "posts", entry.id, { contentLocale: "fr" });
		expect(text(intro)).toContain("Scan draft");
		expect(text(intro)).toContain("«");
	});

	it("scans, polishes, and proposes a patch the host accepts", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft(
			"posts",
			entry.id,
			{ title: '"Hello" -- world...', excerpt: "it's", content: paragraph("Wait...") },
			{ contentLocale: "en" },
		);

		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", {
			contentLocale: "en",
			draft,
		});
		expect(text(scan)).toContain("Polish selected");
		expect(text(scan)).toContain("Curly quotes (3)");
		expect(text(scan)).not.toContain("Number ranges");

		const proposal = await host.admin.submitEditorPanel(
			"typographer",
			"posts",
			entry.id,
			"polish",
			{ quotes: true, dashes: true, ellipsis: true },
			{ contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch(
			"panel",
			"typographer",
			draft,
			proposal,
			editorState(draft),
			draft.fields,
		);
		expect(patched.title).toBe("“Hello” — world…");
		expect(patched.excerpt).toBe("it’s");
		expect(JSON.stringify(patched.content)).toContain("Wait…");
		await expect(host.inspect.content.get("posts", entry.id)).resolves.toMatchObject({
			data: { title: "Saved" },
		});
	});

	it("only applies the rules left switched on", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Hi" -- there' }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true, dashes: false }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("“Hi” -- there");
	});

	it("works on a collection that lacks some declared fields", async () => {
		const { host, entry } = await setup("pages");
		const draft = await host.admin.captureEditorDraft("pages", entry.id, { title: "It's" }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "pages", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("It’s");
	});

	it("says the draft is clean and proposes nothing", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: "Already “fine”" }, { contentLocale: "en" });
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en", draft });
		expect(text(scan)).toContain("Looks clean");
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		expect(proposal.patch).toBeUndefined();
	});

	it("asks the editor to save first when there is no draft", async () => {
		const { host, entry } = await setup("posts");
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en" });
		expect(text(scan)).toContain("Save the entry once");
	});

	it("falls back to English quotes for a language without a table and says so", async () => {
		const { host, entry } = await setup("posts", "ar");
		const intro = await host.admin.loadEditorPanel("typographer", "posts", entry.id, { contentLocale: "ar" });
		expect(text(intro)).toContain("No quote style for “ar” yet");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"marhaba"' }, { contentLocale: "ar" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "ar", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("“marhaba”");
	});

	it("uses French quotes and spacing for a French entry", async () => {
		const { host, entry } = await setup("posts", "fr");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Bonjour" !' }, { contentLocale: "fr" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true, nbsp: true }, { contentLocale: "fr", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("« Bonjour » !");
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — panel route `panel` not found / blocks missing "Scan draft".

- [ ] **Step 4: Write `src/ui.ts`**

```ts
import type { BlockResponse } from "@emdash-cms/blocks";

import type { ResolvedLocale } from "./locales.js";
import type { Counts, FieldResult } from "./portable-text.js";
import { RISKY_RULES, RULE_IDS, RULE_LABELS, type RuleId } from "./rules.js";

type Block = BlockResponse["blocks"][number];

const scanButton = (label: string): Block => ({
	type: "actions",
	elements: [{ type: "button", action_id: "scan", label, style: "primary" }],
});

function localeLine(locale: ResolvedLocale): Block {
	const { style } = locale;
	return {
		type: "context",
		text: locale.fellBack
			? `No quote style for “${locale.requested}” yet — using English quotes.`
			: `Quote style: ${style.tag} → ${style.double[0]} ${style.double[1]}`,
	};
}

export const errorResponse = (message: string): BlockResponse => ({
	blocks: [{ type: "banner", variant: "error", title: message }],
});

export function panelIntro(locale: ResolvedLocale): BlockResponse {
	return {
		blocks: [
			{
				type: "context",
				text: "Finds straight quotes, double hyphens, three dots and breaking spaces in your unsaved text. Nothing changes until you preview and apply.",
			},
			localeLine(locale),
			scanButton("Scan draft"),
		],
	};
}

const total = (counts: Counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

export function scanResult(counts: Counts, enabled: ReadonlySet<RuleId>, locale: ResolvedLocale): BlockResponse {
	const found = RULE_IDS.filter((id) => (counts[id] ?? 0) > 0);
	if (found.length === 0) {
		return {
			blocks: [
				{ type: "banner", title: "Looks clean ✓", description: "No typographic fixes found." },
				scanButton("Scan again"),
			],
		};
	}
	return {
		blocks: [
			{ type: "header", text: `Found ${total(counts)} fixes` },
			localeLine(locale),
			{
				type: "form",
				block_id: "rules",
				fields: found.map((id) => ({
					type: "toggle" as const,
					action_id: id,
					label: `${RULE_LABELS[id]} (${counts[id]})`,
					...(RISKY_RULES.has(id) ? { description: "Can misfire on dates and codes — check the preview." } : {}),
					initial_value: enabled.has(id),
				})),
				submit: { label: "Polish selected", action_id: "polish" },
			},
			{ type: "context", text: "Counts assume every rule is on. The preview shows the exact changes. Edited while scanning? Scan again." },
		],
	};
}

export function polishResult(results: FieldResult[], counts: Counts): BlockResponse {
	const blocks: Block[] = [];
	for (const result of results) {
		if (result.status === "too-large") {
			blocks.push({
				type: "banner",
				variant: "alert",
				title: `${result.label} is too long to polish in one go (64 KB limit).`,
				description: "Other fields were polished.",
			});
		} else if (result.status === "failed") {
			blocks.push({
				type: "banner",
				variant: "error",
				title: `Couldn't safely polish ${result.label}.`,
				description: "Nothing was changed in it.",
			});
		}
	}
	const changed = results.filter((result) => result.status === "changed").map((result) => result.label);
	blocks.push(
		changed.length > 0
			? { type: "section", text: `Proposed ${total(counts)} fixes in ${changed.join(", ")}. Review the preview to apply them.` }
			: { type: "banner", title: "Nothing to change with the selected rules." },
		scanButton("Scan again"),
	);
	return { blocks };
}
```

- [ ] **Step 5: Write `src/plugin.ts`**

Replace the scaffold's file entirely:

```ts
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import * as z from "zod/mini";

import { resolveLocale } from "./locales.js";
import { polishFields } from "./portable-text.js";
import { RULE_DEFAULTS, RULE_IDS, selectRules, type RuleId } from "./rules.js";
import { errorResponse, panelIntro, polishResult, scanResult } from "./ui.js";

const draftSchema = z.object({
	fields: z.record(z.string(), z.unknown()),
	fieldDefinitions: z.array(z.object({ slug: z.string(), label: z.string(), type: z.string() })),
});

const panelInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("panel_load") }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), draft: z.optional(draftSchema) }),
	z.object({
		type: z.literal("form_submit"),
		action_id: z.string(),
		values: z.record(z.string(), z.unknown()),
		draft: z.optional(draftSchema),
	}),
]);

export async function readSettings(ctx: PluginContext): Promise<{ rules: Set<RuleId>; locale: string | null }> {
	const stored = new Map((await ctx.settings.list()).map(({ key, value }) => [key, value]));
	const rules = new Set<RuleId>();
	for (const id of RULE_IDS) {
		const value = stored.get(id);
		if (typeof value === "boolean" ? value : RULE_DEFAULTS[id]) rules.add(id);
	}
	const locale = stored.get("locale");
	return { rules, locale: typeof locale === "string" ? locale : null };
}

const plugin: SandboxedPlugin = {
	routes: {
		panel: {
			permission: "content:edit_own",
			handler: async (route, ctx) => {
				if (route.ui?.surface !== "content-editor-panel") return errorResponse("Open Typographer from the editor.");
				const parsed = panelInput.safeParse(route.input);
				if (!parsed.success) return errorResponse("Something went wrong — reopen the panel.");
				const input = parsed.data;
				const settings = await readSettings(ctx);
				const locale = resolveLocale(settings.locale, route.ui.entry.locale ?? null);

				if (input.type === "panel_load") return panelIntro(locale);
				const { draft } = input;
				if (!draft) return errorResponse("Save the entry once, then scan.");

				const log = (message: string, data: Record<string, string>) => ctx.log.error(message, data);
				const run = (rules: ReadonlySet<RuleId>) =>
					polishFields(draft.fields, draft.fieldDefinitions, selectRules(rules), { locale: locale.style }, log);

				if (input.type === "block_action" && input.action_id === "scan") {
					return scanResult(run(new Set(RULE_IDS)).counts, settings.rules, locale);
				}
				if (input.type === "form_submit" && input.action_id === "polish") {
					const chosen = new Set(RULE_IDS.filter((id) => input.values[id] === true));
					const { results, counts } = run(chosen);
					const changed = results.filter((result) => result.status === "changed");
					return {
						...polishResult(results, counts),
						...(changed.length > 0 && {
							patch: {
								type: "editor-draft-patch" as const,
								operations: changed.map((result) => ({ op: "set" as const, field: result.slug, value: result.value })),
							},
						}),
					};
				}
				return errorResponse("Something went wrong — reopen the panel.");
			},
		},
	},
};

export default plugin;
```

The draft shape (`fields` + `fieldDefinitions`) comes from the host's validated snapshot (`packages/core/src/plugins/editor-draft.ts`, `validateEditorDraftRequest` → `snapshot`). If the panel tests fail with "Something went wrong" on scan, log `Object.keys(route.input.draft)` once to confirm the field-definition key name in the installed EmDash version, match `draftSchema` to it, and record the finding in `CLAUDE.md`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test`
Expected: all suites PASS, including the 8 panel tests.

If `actEditorPanel` without `draft` throws instead of reaching the plugin, change that test to assert the host's error and note it in `CLAUDE.md` (Task 10) as host behaviour; keep the plugin's "Save the entry once" branch (a real browser can still send a draftless action for a never-saved entry).

- [ ] **Step 7: Record the scan-count refinement in the spec**

In `SPEC.md`, under **Panel flow**, replace the sentence starting "Step 3 rescans the fresh draft" with:

```markdown
Step 2 counts every rule as if all were on, so editors can see what the risky rules
would catch before enabling them; the panel says so. Step 3 rescans the fresh draft with
only the selected rules, so the patch reflects exactly what is in the form, and the host
preview shows the precise changes.
```

- [ ] **Step 8: Typecheck, build, commit**

```bash
pnpm run typecheck && pnpm run build
git add -A
git commit -m "feat: Typographer editor panel with scan, rule toggles and draft patch"
git push
```

---

### Task 9: Settings page

**Files:**
- Modify: `emdash-plugin.jsonc`, `src/plugin.ts`, `src/ui.ts`, `tests/plugin.test.ts` (append)

**Interfaces:**
- Consumes: `readSettings` (Task 8); `RULE_IDS`, `RULE_LABELS`, `RISKY_RULES`, `RuleId` (Task 6); `SUPPORTED_LOCALES` (Task 2).
- Produces: admin page `/settings`, route `admin`, `settingsPage(settings: { rules: ReadonlySet<RuleId>; locale: string | null }): BlockResponse` in `src/ui.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plugin.test.ts`:

```ts
const ALL_OFF = Object.fromEntries(
	["spacing", "symbols", "ellipsis", "dashes", "ranges", "multiplication", "fractions", "primes", "quotes", "nbsp"].map(
		(id) => [id, false],
	),
);

describe("Typographer settings", () => {
	it("shows the defaults with risky rules off", async () => {
		host = await createPluginRuntimeTestHost();
		const page = await host.admin.loadPage("/settings");
		const blocks = text(page);
		expect(blocks).toContain("Typographer defaults");
		expect(blocks).toMatch(/"action_id":"ranges"[^}]*"initial_value":false/);
		expect(blocks).toMatch(/"action_id":"quotes"[^}]*"initial_value":true/);
	});

	it("saves valid settings and the panel uses them", async () => {
		const { host, entry } = await setup("posts");
		const saved = await host.admin.submit("/settings", "save", { ...ALL_OFF, ranges: true, quotes: true, locale: "de" });
		expect(saved.toast).toEqual({ type: "success", message: "Settings saved" });

		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Seiten" 10-20' }, { contentLocale: "en" });
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en", draft });
		expect(text(scan)).toMatch(/"action_id":"ranges"[^}]*"initial_value":true/);
		expect(text(scan)).toContain("„");
	});

	it("rejects an unknown locale without saving", async () => {
		host = await createPluginRuntimeTestHost();
		const bad = await host.admin.submit("/settings", "save", { ...ALL_OFF, locale: "xx" });
		expect(bad.toast?.type).toBe("error");
		const page = await host.admin.loadPage("/settings");
		expect(text(page)).toMatch(/"action_id":"quotes"[^}]*"initial_value":true/);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — "Plugin admin page is not declared".

- [ ] **Step 3: Declare the page and schema**

In `emdash-plugin.jsonc`, inside `"admin"`, before `"editorPanels"`:

```jsonc
		"pages": [{ "path": "/settings", "label": "Typographer", "icon": "settings" }],
		"settingsSchema": {
			"locale": {
				"type": "select",
				"label": "Quote style",
				"default": "auto",
				"options": [
					{ "value": "auto", "label": "Automatic (entry language)" },
					{ "value": "en", "label": "en" }, { "value": "nl", "label": "nl" },
					{ "value": "hi", "label": "hi" }, { "value": "gu", "label": "gu" },
					{ "value": "zh", "label": "zh" }, { "value": "fr", "label": "fr" },
					{ "value": "es", "label": "es" }, { "value": "it", "label": "it" },
					{ "value": "pt", "label": "pt" }, { "value": "ru", "label": "ru" },
					{ "value": "de", "label": "de" }, { "value": "pl", "label": "pl" },
					{ "value": "ja", "label": "ja" }, { "value": "da", "label": "da" }
				]
			},
			"spacing": { "type": "boolean", "label": "Double spaces", "default": true },
			"symbols": { "type": "boolean", "label": "Symbols", "default": true },
			"ellipsis": { "type": "boolean", "label": "Ellipsis", "default": true },
			"dashes": { "type": "boolean", "label": "Dashes", "default": true },
			"ranges": { "type": "boolean", "label": "Number ranges", "default": false },
			"multiplication": { "type": "boolean", "label": "Multiplication", "default": false },
			"fractions": { "type": "boolean", "label": "Fractions", "default": false },
			"primes": { "type": "boolean", "label": "Feet and inches", "default": false },
			"quotes": { "type": "boolean", "label": "Curly quotes", "default": true },
			"nbsp": { "type": "boolean", "label": "No-break spaces", "default": true }
		},
```

Add a `locales.test.ts` case so the manifest list cannot drift from the data:

```ts
import manifestText from "../emdash-plugin.jsonc?raw";

it("offers exactly the supported locales in the settings schema", () => {
	for (const tag of SUPPORTED_LOCALES) expect(manifestText).toContain(`{ "value": "${tag}"`);
});
```

(If the `?raw` import is not supported by the test config, read the file with `import.meta.glob("../emdash-plugin.jsonc", { query: "?raw", eager: true, import: "default" })` instead.)

- [ ] **Step 4: Add `settingsPage` to `src/ui.ts`**

Add to the imports: `import { SUPPORTED_LOCALES } from "./locales.js";`. Append:

```ts
export function settingsPage(settings: { rules: ReadonlySet<RuleId>; locale: string | null }): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "Typographer defaults" },
			{ type: "context", text: "Which rules start switched on in the editor panel. Editors can still change them per scan." },
			{
				type: "form",
				block_id: "settings",
				fields: [
					{
						type: "select",
						action_id: "locale",
						label: "Quote style",
						options: [
							{ label: "Automatic (entry language)", value: "auto" },
							...SUPPORTED_LOCALES.map((tag) => ({ label: tag, value: tag })),
						],
						initial_value: settings.locale ?? "auto",
					},
					...RULE_IDS.map((id) => ({
						type: "toggle" as const,
						action_id: id,
						label: RULE_LABELS[id],
						...(RISKY_RULES.has(id) ? { description: "Off by default — can misfire on dates and codes." } : {}),
						initial_value: settings.rules.has(id),
					})),
				],
				submit: { label: "Save", action_id: "save" },
			},
		],
	};
}
```

- [ ] **Step 5: Add the `admin` route to `src/plugin.ts`**

Add imports: `import { SUPPORTED_LOCALES } from "./locales.js";` and `settingsPage` from `./ui.js`. Add above `const plugin`:

```ts
const adminInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({ type: z.literal("form_submit"), action_id: z.string(), values: z.record(z.string(), z.unknown()) }),
	z.object({ type: z.literal("block_action"), action_id: z.string() }),
]);

const settingsValues = z.object({
	locale: z.enum(["auto", ...SUPPORTED_LOCALES] as [string, ...string[]]),
	...(Object.fromEntries(RULE_IDS.map((id) => [id, z.boolean()])) as Record<RuleId, z.ZodMiniBoolean>),
});
```

Add inside `routes`, next to `panel`:

```ts
		admin: {
			handler: async (route, ctx) => {
				const parsed = adminInput.safeParse(route.input);
				if (!parsed.success) return { blocks: [] };
				const input = parsed.data;
				if (input.type === "form_submit" && input.action_id === "save") {
					const values = settingsValues.safeParse(input.values);
					if (!values.success) {
						return { ...settingsPage(await readSettings(ctx)), toast: { type: "error", message: "Settings not saved — check the values." } };
					}
					for (const id of RULE_IDS) await ctx.settings.set(id, values.data[id]);
					await ctx.settings.set("locale", values.data.locale);
					return { ...settingsPage(await readSettings(ctx)), toast: { type: "success", message: "Settings saved" } };
				}
				return settingsPage(await readSettings(ctx));
			},
		},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 7: Typecheck, build, commit**

```bash
pnpm run typecheck && pnpm run build
git add -A
git commit -m "feat: settings page for default rules and quote style"
git push
```

---

### Task 10: Docs, bundle check, real-site QA

**Files:**
- Modify: `README.md`, `package.json` (version), `emdash-plugin.jsonc` (release artifacts)
- Create: `CLAUDE.md`, `images/editor-panel.png`, `images/preview.png`, `images/settings.png`, `images/icon.png`

**Interfaces:**
- Consumes: the finished plugin.
- Produces: a releasable `1.0.0` bundle and docs.

- [ ] **Step 1: Bundle and check the caps**

```bash
pnpm run bundle
tar tzf dist/*.tar.gz
tar xzf dist/*.tar.gz -O | wc -c
```

Expected: tarball lists `manifest.json`, `backend.js`, `README.md`; total decompressed bytes < 262144 and `backend.js` < 131072. If `backend.js` is over, check that only `zod/mini` (not `zod`) is imported anywhere: `grep -rn 'from "zod"' src` must print nothing.

- [ ] **Step 2: Create a disposable local site** (sibling folder, never inside the repo)

```bash
cd ~/Projects
pnpm create emdash@latest typographer-playground
```

Choose the **blog** template and Node (not Cloudflare). Then:

```bash
cd typographer-playground
pnpm add file:../emdash-typographer @emdash-cms/sandbox-workerd
```

Edit its `astro.config.mjs`: `import typographer from "typographer";` and inside the `emdash({ ... })` options add `sandboxed: [typographer], sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox"`.

Run the plugin in watch mode in one terminal (`cd ~/Projects/emdash-typographer && pnpm run dev`) and the site in another (`cd ~/Projects/typographer-playground && pnpm dev`).

- [ ] **Step 3: Click-through checklist (human, in the browser)**

| # | Do | Expect |
|---|---|---|
| 1 | Admin → Plugins → approve Typographer | Consent dialog lists only "read" and "suggest changes to" the open entry |
| 2 | Create a post, paste the QA text below into title and body, **save** | Saved |
| 3 | Open the Typographer panel | Intro + "Quote style: en → “ ”" + Scan draft |
| 4 | Scan draft | Toggle list with counts; risky rules off |
| 5 | Polish selected | Host preview shows a diff; nothing saved yet |
| 6 | Apply, then Save | Text is polished; inline code and the URL untouched |
| 7 | Scan again | "Looks clean ✓" (idempotent) |
| 8 | Plugins → Typographer → Settings: set Quote style `fr`, save; rescan | « » and narrow spaces |
| 9 | Narrow the window to 360 px | Panel readable, no horizontal scroll |

QA text (bold the word **hello**, make `--force` inline code, add a link on "docs"):

```
"Quick test" -- he said... it's 10 kg, 5 min, (c) 2026. Run --force; see https://example.com/a--b and the docs. 'Hello' -- "hello" -- 1990-1995, 1920x1080, 1/2 cup, 5'10".
```

Take screenshots of steps 4, 5 and 8 → `images/editor-panel.png`, `images/preview.png`, `images/settings.png` (≤ 1920×1080, ≤ 1 MiB each). Make a 256×256 `images/icon.png`.

Record anything that surprised you (host behaviour, wording) — it goes into `CLAUDE.md`.

- [ ] **Step 4: Write `README.md`** (replace the scaffold's)

Sections, in this order:
1. One-line pitch + `images/editor-panel.png`.
2. **What it fixes** — the 10-row rules table from `SPEC.md` (Rule, Default, Changes, Never touches).
3. **How to use** — open panel → Scan draft → toggle → Polish selected → review preview → Apply → Save.
4. **Settings** — defaults and quote style.
5. **Permissions** — exactly two: read and suggest changes to the entry you're editing. No network, no content access outside the editor.
6. **Limits** — the panel appears only on these collections (list the 28) and fields (list the 19); unsaved new entries need one save first; fields over 64 KB are skipped; tables and custom blocks are not touched in v1.
7. **Languages** — the quote table.
8. **Reporting a security issue** — GitHub private advisory link.
9. **License** — MIT.

- [ ] **Step 5: Write `CLAUDE.md`** (project root)

Must cover, briefly: build/test/bundle commands (`pnpm test` runs validate + vitest in workerd; `pnpm vitest run tests/<file>` for one file); the architecture in three sentences (rules return edits on a joined string → engine maps them into spans → plugin routes are thin); the traps: manifest collections/fields cannot be wildcards and widening them is a trust-contract change; versions are immutable; `zod/mini` only (bundle cap); never log content; the playground lives at `~/Projects/typographer-playground`; plus anything recorded in Step 3.

- [ ] **Step 6: Declare listing images and bump the version**

`emdash-plugin.jsonc`, top level:

```jsonc
	"release": {
		"artifacts": {
			"icon": { "file": "./images/icon.png" },
			"screenshots": [
				{ "file": "./images/editor-panel.png" },
				{ "file": "./images/preview.png" },
				{ "file": "./images/settings.png" }
			]
		}
	},
```

`package.json`: `"version": "1.0.0"`.

- [ ] **Step 7: Final verification and commit**

```bash
pnpm run validate && pnpm run typecheck && pnpm test && pnpm run bundle && tar tzf dist/*.tar.gz
git add -A
git commit -m "docs: README, CLAUDE.md and listing images for 1.0.0"
git push
```

Expected: everything green; tarball still under caps (images are not in the tarball — they live in `images/`).

---

### Task 11: Publish (human-run)

**Files:** none.

**Interfaces:** consumes the 1.0.0 commit from Task 10.

- [ ] **Step 1: Log in** — `pnpm run login -- krushnaraval.bsky.social`. A browser opens on Bluesky's sign-in; approve. `pnpm exec emdash-plugin whoami` shows `did:plc:2vgwjmqe2e6u72wl5uyumrc2`.
- [ ] **Step 2: Publish** — `pnpm run publish`. Expected: prints `@krushnaraval.bsky.social/typographer`, the release record, and an `emdash-plugin info … --watch` command. Errors: `MANIFEST_PUBLISHER_MISMATCH` → wrong account active (`emdash-plugin switch did:plc:2vgwjmqe2e6u72wl5uyumrc2`); `MISSING_BLOB_SCOPE` → `emdash-plugin logout` then log in again.
- [ ] **Step 3: Watch approval** — run the printed `info … --watch` command until the labeler approves; then confirm the listing at https://plugins.emdashcms.com/.
- [ ] **Step 4: Tag** — `git tag v1.0.0 && git push --tags`.
- [ ] **Step 5: Install from the registry** into `typographer-playground` (remove the `file:` dependency first) and repeat checklist rows 1–7 against the published build.
