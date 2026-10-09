import type { LocaleStyle } from "./locales.js";
import { hasListMarkers } from "./rules.js";

/** Replace `[start, end)` with `text`. `start === end` is an insertion. */
export interface Edit {
	start: number;
	end: number;
	text: string;
}

export interface RuleContext {
	locale: LocaleStyle;
	/** Whether the whole field uses (a)/(b) list markers; rules check their own text when unset. */
	listMarkers?: boolean;
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
export const OBJECT_PLACEHOLDER = "\uFFFC";

export class RuleError extends Error {
	constructor(
		readonly rule: string,
		cause: unknown,
	) {
		super(`Rule "${rule}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = "RuleError";
	}
}

const URL_PATTERN = String.raw`\b(?:https?:\/\/|www\.)[^\s<>"“”«»]+`;
const URL_ONLY = new RegExp(URL_PATTERN, "giu");
const URL_OR_EMAIL = new RegExp(String.raw`${URL_PATTERN}|[\w.+-]{1,64}@[\w-]{1,255}(?:\.[\w-]+)+`, "giu");
const HAS_URL = /https?:\/\/|www\./i;

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

/** Punctuation that closes a sentence or quote rather than belonging to the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"’”»]+$/u;

function protectedRanges(joined: string, pieces: readonly Piece[], bounds: readonly Bounds[]): Bounds[] {
	const ranges = bounds.filter((_, index) => pieces[index]?.locked);
	// Every rule rescans this; skip the costly email alternative (and URLs) when they cannot match.
	const pattern = joined.includes("@") ? URL_OR_EMAIL : HAS_URL.test(joined) ? URL_ONLY : undefined;
	if (!pattern) return ranges;
	for (const match of joined.matchAll(pattern)) {
		const start = match.index ?? 0;
		const text = match[0].replace(TRAILING_PUNCTUATION, "");
		ranges.push({ start, end: start + text.length });
	}
	return ranges;
}

/** The piece an edit belongs to, or -1 when it crosses a boundary. */
function owningPiece(edit: Edit, pieces: readonly Piece[], bounds: readonly Bounds[]): number {
	if (edit.start === edit.end) {
		// An insertion joins the piece holding the character before it, unless
		// that piece is locked and an unlocked one starts right here: then it
		// prepends to the following piece.
		if (edit.start === 0) return bounds.length > 0 ? 0 : -1;
		const before = bounds.findIndex((b) => b.start < edit.start && edit.start <= b.end);
		if (before === -1) return -1;
		const after = before + 1;
		if (pieces[before]?.locked && bounds[after]?.start === edit.start && !pieces[after]?.locked) {
			return after;
		}
		return before;
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
		const piece = owningPiece(edit, pieces, bounds);
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

/** All text in a field: the string itself, or every span, one line per block. */
function fieldText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((node) => (isTextBlock(node) ? node.children.map((child) => (isSpan(child) ? child.text : "")).join("") : ""))
		.join("\n");
}

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
		if (!Object.hasOwn(fields, definition.slug)) continue;
		try {
			const value = fields[definition.slug];
			const result = polishField(definition, value, rules, { ...ctx, listMarkers: hasListMarkers(fieldText(value)) });
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
