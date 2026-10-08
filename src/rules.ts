import { APOSTROPHE, CURRENCIES, ELISIONS, UNITS } from "./locales.js";
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

/** A quote opens after these (or at the start of the text). */
const OPENS_AFTER = /[\s([{—–\-/\u00A0\u202F\uFFFC]/u;

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
