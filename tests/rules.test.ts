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

	it.each(["  leading", "trailing  ", "a\u00a0b", "single space"])(
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
