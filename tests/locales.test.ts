import { describe, expect, it } from "vitest";

import manifestText from "../emdash-plugin.jsonc?raw";
import { FRACTIONS, SUPPORTED_LOCALES, resolveLocale } from "../src/locales.js";

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
});

describe("locale table", () => {
	it.each(SUPPORTED_LOCALES)("%s has complete, single-character quote pairs", (tag) => {
		const { style } = resolveLocale(tag, null);
		for (const glyph of [...style.double, ...style.single]) {
			expect([...glyph]).toHaveLength(1);
		}
	});

	it("only lists fractions that have a single glyph", () => {
		for (const glyph of Object.values(FRACTIONS)) expect([...glyph]).toHaveLength(1);
	});
});

it("offers exactly the supported locales in the settings schema", () => {
	for (const tag of SUPPORTED_LOCALES) expect(manifestText).toContain(`{ "value": "${tag}"`);
});
