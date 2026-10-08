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

	it("does not protect trailing punctuation after a URL", () => {
		expect(polishText('see https://x.com/a... ok', [["dot", replaceAll("...", "…")]], ctx).text).toBe(
			"see https://x.com/a… ok",
		);
		expect(polishText("(https://x.com/b), done", [["paren", replaceAll(")", "]")]], ctx).text).toBe(
			"(https://x.com/b], done",
		);
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

	it("keeps an insertion at a boundary after a locked piece by prepending to the next", () => {
		const insertAt1: Rule = () => [{ start: 1, end: 1, text: "!" }];
		const pieces = [
			{ text: "x", locked: true },
			{ text: "?", locked: false },
		];
		const result = runRules(pieces, [["ins", insertAt1]], ctx);
		expect(result.pieces.map((piece) => piece.text)).toEqual(["x", "!?"]);
		expect(result.counts).toEqual({ ins: 1 });
	});

	it("does not mutate the input pieces", () => {
		const pieces = [{ text: "a", locked: false }];
		runRules(pieces, [["swap", replaceAll("a", "b")]], ctx);
		expect(pieces[0]?.text).toBe("a");
	});
});
