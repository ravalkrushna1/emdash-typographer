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
