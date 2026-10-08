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
