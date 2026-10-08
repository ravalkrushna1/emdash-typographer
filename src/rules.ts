import { APOSTROPHE, CURRENCIES, ELISIONS, FRACTIONS, UNITS } from "./locales.js";
import type { Edit, NamedRule, Rule } from "./portable-text.js";

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

/** "(c)" next to "(a)" or "(b)" is a list marker, not a copyright sign. */
export const hasListMarkers = (text: string) => /\((?:a|b)\)/i.test(text);

export const symbols: Rule = (text, ctx) => {
	const isList = ctx.listMarkers ?? hasListMarkers(text);
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
		const startsWord = before === undefined || /[\s("'“‘«[]/.test(before);
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

const OPEN_BRACKET = /[([{\uFFFC]/u;
const CLOSING_PUNCTUATION = /[.,;:!?)\]}…]/u;
const DASH = /[—–-]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\d/;

type QuoteKind = "double" | "single";
type QuoteDecision = "open" | "close" | "apostrophe" | "straight";

function startsElision(text: string, from: number): boolean {
	const word = /^\p{L}+/u.exec(text.slice(from))?.[0]?.toLowerCase();
	return word !== undefined && ELISIONS.includes(word);
}

/** it's, l'homme, 1990's, and word-initial '90s / 'tis. */
function isApostrophe(text: string, i: number, afterOpening: boolean): boolean {
	const prev = text[i - 1];
	const next = text[i + 1];
	if (next === undefined) return false;
	if (prev !== undefined && LETTER.test(prev) && WORDISH.test(next)) return true;
	if (prev !== undefined && DIGIT.test(prev) && LETTER.test(next)) return true;
	return afterOpening && (DIGIT.test(next) || startsElision(text, i + 1));
}

/**
 * Looks at both neighbours and at which quote kinds are open in this paragraph.
 * Already-curly glyphs count towards what is open, so a second run changes nothing.
 */
export const quotes: Rule = (text, { locale }) => {
	const edits: Edit[] = [];
	const glyphs = { double: locale.double, single: locale.single };
	const openers = new Set([locale.double[0], locale.single[0]]);
	const closers = new Set([locale.double[1], locale.single[1]]);
	const depth = { double: 0, single: 0 };
	const decided = new Map<number, QuoteDecision>();
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? "";
		const kind: QuoteKind | undefined =
			ch === '"' || ch === locale.double[0] || ch === locale.double[1] ? "double"
			: ch === "'" || ch === locale.single[0] || ch === locale.single[1] ? "single"
			: undefined;
		if (!kind) continue;
		const prev = text[i - 1];
		const next = text[i + 1];
		const before = decided.get(i - 1);
		const afterOpening =
			prev === undefined || /\s/u.test(prev) || OPEN_BRACKET.test(prev) || openers.has(prev) || before === "open";

		if (kind === "single" && (ch === "'" || ch === APOSTROPHE) && isApostrophe(text, i, afterOpening)) {
			if (ch === "'") {
				decided.set(i, "apostrophe");
				edits.push({ start: i, end: i + 1, text: APOSTROPHE });
			}
			continue;
		}
		if (ch !== '"' && ch !== "'") {
			depth[kind] = ch === glyphs[kind][0] ? depth[kind] + 1 : Math.max(0, depth[kind] - 1);
			continue;
		}
		const isOpen = depth[kind] > 0;
		// 12" or 12' with nothing open is a measurement; the primes rule owns those.
		if (prev !== undefined && DIGIT.test(prev) && !isOpen) {
			decided.set(i, "straight");
			continue;
		}
		const beforeClosing =
			next === undefined || /\s/u.test(next) || CLOSING_PUNCTUATION.test(next) || closers.has(next);
		const afterClosing =
			prev !== undefined &&
			(WORDISH.test(prev) || CLOSING_PUNCTUATION.test(prev) || closers.has(prev) || before === "close" || before === "apostrophe");
		let opens: boolean;
		if (beforeClosing && (isOpen || afterClosing)) opens = false;
		else if (afterOpening || (prev !== undefined && DASH.test(prev) && next !== undefined && WORDISH.test(next))) opens = true;
		else opens = !isOpen; // no space on either side (CJK, emoji, after code): alternate
		depth[kind] = opens ? depth[kind] + 1 : Math.max(0, depth[kind] - 1);
		decided.set(i, opens ? "open" : "close");
		edits.push({ start: i, end: i + 1, text: glyphs[kind][opens ? 0 : 1] });
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

const NBSP = "\u00A0";
const NARROW_NBSP = "\u202F";
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
	matches(
		text,
		/(?<![\p{L}\p{N}.])\d+(?:\.\d+)?(?:( ?)x\1\d+(?:\.\d+)?)+(?![\p{L}\p{N}])/gu,
		(match, at) => {
			if (/^0x\d/.test(match[0])) return null; // hex: 0x10
			return [...match[0].matchAll(/(?<=\d) ?x(?= ?\d)/g)].map((m) => {
				const start = at + (m.index ?? 0) + m[0].length - 1;
				return { start, end: start + 1, text: "×" };
			});
		},
	);

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
