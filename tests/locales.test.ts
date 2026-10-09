import { describe, expect, it } from "vitest";

import manifestText from "../emdash-plugin.jsonc?raw";
import { FRACTIONS, SUPPORTED_LOCALES, resolveLocale } from "../src/locales.js";
import { RULE_DEFAULTS, RULE_IDS } from "../src/rules.js";

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

	it.each(["constructor", "__proto__", "toString"])("treats the object key %j as an unknown language", (tag) => {
		const resolved = resolveLocale(null, tag);
		expect(resolved.style.tag).toBe("en");
		expect(resolved.fellBack).toBe(true);
	});
});

describe("locale table", () => {
	it.each(SUPPORTED_LOCALES)("%s has complete, single-character quote pairs", (tag) => {
		const { style } = resolveLocale(tag, null);
		expect(style.tag).toBe(tag);
		for (const glyph of [...style.double, ...style.single]) {
			expect([...glyph]).toHaveLength(1);
		}
	});

	it.each([
		["sv", "”", "”", "’", "’"],
		["fi", "”", "”", "’", "’"],
		["nb", "«", "»", "‘", "’"],
		["no", "«", "»", "‘", "’"],
		["nn", "«", "»", "‘", "’"],
		["cs", "„", "“", "‚", "‘"],
		["sk", "„", "“", "‚", "‘"],
		["hu", "„", "”", "»", "«"],
		["tr", "“", "”", "‘", "’"],
		["ko", "“", "”", "‘", "’"],
		["uk", "«", "»", "„", "“"],
		["el", "«", "»", "“", "”"],
		["ro", "„", "”", "«", "»"],
		["bg", "„", "“", "„", "“"],
		["mr", "“", "”", "‘", "’"],
		["ta", "“", "”", "‘", "’"],
		["bn", "“", "”", "‘", "’"],
	])("%s uses %s…%s and %s…%s", (tag, d0, d1, s0, s1) => {
		const { style } = resolveLocale(null, tag);
		expect(style.double).toEqual([d0, d1]);
		expect(style.single).toEqual([s0, s1]);
		expect(style.frenchSpacing).toBe(false);
		expect(resolveLocale(null, tag).fellBack).toBe(false);
	});

	it("only lists fractions that have a single glyph", () => {
		for (const glyph of Object.values(FRACTIONS)) expect([...glyph]).toHaveLength(1);
	});
});

it("offers exactly the supported locales in the settings schema", () => {
	for (const tag of SUPPORTED_LOCALES) expect(manifestText).toContain(`{ "value": "${tag}"`);
});

it("declares one setting per rule plus locale, with the rule defaults", () => {
	const manifest = JSON.parse(manifestText.replace(/^\s*\/\/.*$/gm, ""));
	const schema: Record<string, { default: unknown }> = manifest.admin.settingsSchema;
	expect(Object.keys(schema).sort()).toEqual([...RULE_IDS, "locale"].sort());
	for (const id of RULE_IDS) expect(schema[id]?.default).toBe(RULE_DEFAULTS[id]);
});
