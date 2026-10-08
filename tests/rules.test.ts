import { describe, expect, it } from "vitest";

import { resolveLocale } from "../src/locales.js";
import { polishText, type Rule } from "../src/portable-text.js";
import { dashes, ellipsis, nbsp, quotes, spacing, symbols } from "../src/rules.js";

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

	it.each(["--force", "npm i --save-dev", "a --- b", "- list item", "well-known", "x-y"])(
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
