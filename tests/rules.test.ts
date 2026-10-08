import { describe, expect, it } from "vitest";

import { resolveLocale } from "../src/locales.js";
import { polishText, type Rule } from "../src/portable-text.js";
import {
	RULE_DEFAULTS, RULE_IDS, dashes, ellipsis, fractions, multiplication, nbsp, primes, quotes, ranges,
	selectRules, spacing, symbols,
} from "../src/rules.js";

const fix = (rule: Rule, text: string, locale = "en") =>
	polishText(text, [["rule", rule]], { locale: resolveLocale(null, locale).style }).text;

describe("spacing", () => {
	it.each([
		["a  b", "a b"],
		["a     b", "a b"],
		["one.  Two", "one. Two"],
	])("changes %j → %j", (input, output) => expect(fix(spacing, input)).toBe(output));

	it.each(["  leading", "trailing  ", "a\u00A0\u00A0b", "single space"])(
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

	it.each(["--force", "npm i --save-dev", "a --- b", "- list item", "well-known", "x-y", 'the "--force" flag', "(--verbose)"])(
		"never touches %j",
		(input) => expect(fix(dashes, input)).toBe(input),
	);
});

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
		["the 1990's", "the 1990’s"],
		['"I am 10"', "“I am 10”"],
		['"hi" 👍', "“hi” 👍"],
		['👍 "hi"', "👍 “hi”"],
		['😀"hi"', "😀“hi”"],
	])("changes %j → %j", (input, output) => expect(fix(quotes, input)).toBe(output));

	it.each(["“already” ‘curly’", "no quotes here", `5'10"`, 'a 12" pizza', "the 12' boat"])("never touches %j", (input) =>
		expect(fix(quotes, input)).toBe(input),
	);

	it.each([
		["fr", '"Bonjour"', "«Bonjour»"],
		["fr", "l'homme", "l’homme"],
		["de", '"Hallo"', "„Hallo“"],
		["de", "'Hallo'", "‚Hallo‘"],
		["ja", '"こんにちは"', "「こんにちは」"],
		["ja", '彼は"はい"と言った', "彼は「はい」と言った"],
		["zh", '他说"你好"', "他说“你好”"],
		["da", '"Hej"', "»Hej«"],
		["ar", '"marhaba"', "“marhaba”"],
	])("in %s changes %j → %j", (locale, input, output) =>
		expect(fix(quotes, input, locale)).toBe(output),
	);
});

describe("nbsp", () => {
	it.each([
		["10 kg", "10\u00A0kg"],
		["5 min", "5\u00A0min"],
		["50 %", "50\u00A0%"],
		["90 km/h", "90\u00A0km/h"],
		["₹ 500", "₹\u00A0500"],
		["5 €", "5\u00A0€"],
	])("changes %j → %j", (input, output) => expect(fix(nbsp, input)).toBe(output));

	it.each(["5 in total", "10 kgs", "Room 5 A", "Hello!", "Note: yes", "12:30"])(
		"in English never touches %j",
		(input) => expect(fix(nbsp, input)).toBe(input),
	);

	it.each([
		["Bonjour !", "Bonjour\u202F!"],
		["Bonjour!", "Bonjour\u202F!"],
		["Vraiment ?", "Vraiment\u202F?"],
		["Quoi ?!", "Quoi\u202F?!"],
		["Note : oui", "Note\u00A0: oui"],
		["Note: oui", "Note\u00A0: oui"],
		["«Bonjour»", "«\u202FBonjour\u202F»"],
		["« Bonjour »", "«\u202FBonjour\u202F»"],
	])("in French changes %j → %j", (input, output) => expect(fix(nbsp, input, "fr")).toBe(output));

	it.each(["12:30", "Super :)", "Clin d'œil ;)", "Bonjour\u202F!"])(
		"in French never touches %j",
		(input) => expect(fix(nbsp, input, "fr")).toBe(input),
	);
});

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
		["10 x 20 x 30", "10 × 20 × 30"],
		["10x20x30", "10×20×30"],
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

	it("closes a quote after a dash", () => {
		expect(run(`"I was going to--" she said`)).toBe("“I was going to—” she said");
	});

	it.each([
		[`"Wait..." -- she said  it's 10 kg (c) 2026`, "en"],
		[`"Bonjour !" l'homme : 1/2 page`, "fr"],
		[`She said 'hi' -- then "bye"... 1920x1080`, "en"],
		[`box 10 x 20 x 30, pages 10-20 and 5'10"`, "en"],
		[`„Schon“ "da" 3 x 4`, "de"],
		['彼は"はい"と言った', "ja"],
		['他说"你好"', "zh"],
		[`"I was going to--" she said`, "en"],
		['😀"hi"', "en"],
	])("is idempotent on %j (%s)", (input, locale) => {
		const once = run(input, locale);
		expect(run(once, locale)).toBe(once);
	});
});
