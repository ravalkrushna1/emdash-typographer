import { describe, expect, it, vi } from "vitest";

import { resolveLocale } from "../src/locales.js";
import {
	MAX_FIELD_BYTES,
	keepPattern,
	polishFields,
	polishText,
	polishPortableText,
	sameStructure,
	type Rule,
} from "../src/portable-text.js";
import { RULE_IDS, selectRules } from "../src/rules.js";

const ctx = { locale: resolveLocale(null, "en").style };
const all = selectRules(new Set(RULE_IDS));

const span = (key: string, text: string, marks: string[] = []) => ({ _type: "span", _key: key, text, marks });
const block = (key: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
	_type: "block",
	_key: key,
	style: "normal",
	markDefs: [],
	children,
	...extra,
});
const texts = (value: unknown) =>
	(value as Array<{ children?: Array<{ text?: string }> }>).map((b) => b.children?.map((c) => c.text));

describe("polishPortableText", () => {
	it("gets quote direction right across formatting runs", () => {
		const value = [block("b1", [span("s1", 'He said "'), span("s2", "hello", ["strong"]), span("s3", '" -- twice...')])];
		const result = polishPortableText(value, all, ctx);
		expect(texts(result.value)).toEqual([["He said “", "hello", "” — twice…"]]);
		expect(result.counts).toMatchObject({ quotes: 2, dashes: 1, ellipsis: 1 });
	});

	it("never touches inline code", () => {
		const value = [block("b1", [span("s1", "Use "), span("s2", '"--force"', ["code"]), span("s3", " here...")])];
		expect(texts(polishPortableText(value, all, ctx).value)).toEqual([["Use ", '"--force"', " here…"]]);
	});

	it("treats inline objects as fixed points", () => {
		const value = [block("b1", [span("s1", '"a'), { _type: "break", _key: "k1" }, span("s2", 'b"')])];
		const result = polishPortableText(value, all, ctx);
		expect(texts(result.value)).toEqual([["“a", undefined, "b”"]]);
	});

	it("leaves non-text blocks alone", () => {
		const code = { _type: "code", _key: "c1", code: 'echo "x" -- y...' };
		const image = { _type: "image", _key: "i1", alt: '"alt"' };
		const result = polishPortableText([code, image], all, ctx);
		expect(result.value).toEqual([code, image]);
		expect(result.counts).toEqual({});
	});

	it("keeps keys, marks, markDefs, styles and list data", () => {
		const value = [
			block("b1", [span("s1", '"Hi"', ["em", "link1"])], {
				style: "h2",
				listItem: "bullet",
				level: 2,
				markDefs: [{ _type: "link", _key: "link1", href: "https://x.com/a--b" }],
			}),
		];
		const result = polishPortableText(value, all, ctx);
		expect(sameStructure(value, result.value)).toBe(true);
		expect(result.value).toEqual([
			{ ...value[0], children: [{ ...span("s1", "“Hi”", ["em", "link1"]) }] },
		]);
	});

	it("resets quote context at each paragraph", () => {
		const value = [block("b1", [span("s1", '"one')]), block("b2", [span("s2", '"two"')])];
		expect(texts(polishPortableText(value, all, ctx).value)).toEqual([["“one"], ["“two”"]]);
	});

	it("returns non-arrays unchanged", () => {
		expect(polishPortableText("plain", all, ctx).value).toBe("plain");
	});
});

describe("sameStructure", () => {
	it("ignores span text", () => {
		expect(sameStructure([block("b", [span("s", "a")])], [block("b", [span("s", "b")])])).toBe(true);
	});

	it("catches an added span, a changed key or a dropped mark", () => {
		const base = [block("b", [span("s", "a", ["em"])])];
		expect(sameStructure(base, [block("b", [span("s", "a", ["em"]), span("t", "b")])])).toBe(false);
		expect(sameStructure(base, [block("b", [span("x", "a", ["em"])])])).toBe(false);
		expect(sameStructure(base, [block("b", [span("s", "a")])])).toBe(false);
	});
});

describe("polishFields", () => {
	const definitions = [
		{ slug: "title", label: "Title", type: "string" },
		{ slug: "excerpt", label: "Excerpt", type: "text" },
		{ slug: "content", label: "Content", type: "portableText" },
		{ slug: "featured_image", label: "Featured image", type: "image" },
	];

	it("polishes text and rich-text fields and reports totals", () => {
		const log = vi.fn();
		const { results, counts } = polishFields(
			{
				title: '"Hello"',
				excerpt: "Clean",
				content: [block("b1", [span("s1", "Wait...")])],
				featured_image: { id: "m1" },
			},
			definitions,
			all,
			ctx,
			log,
		);
		expect(results.map((r) => [r.slug, r.status])).toEqual([
			["title", "changed"],
			["excerpt", "clean"],
			["content", "changed"],
			["featured_image", "skipped"],
		]);
		expect(results[0]?.value).toBe("“Hello”");
		expect(texts(results[2]?.value)).toEqual([["Wait…"]]);
		expect(counts).toEqual({ quotes: 2, ellipsis: 1 });
		expect(log).not.toHaveBeenCalled();
	});

	it("ignores definitions with no value in the draft", () => {
		const { results } = polishFields({ title: "x" }, definitions, all, ctx, vi.fn());
		expect(results.map((r) => r.slug)).toEqual(["title"]);
	});

	it("omits a field that would exceed the size limit", () => {
		const big = `"x" ${"a".repeat(MAX_FIELD_BYTES)}`;
		const { results } = polishFields({ excerpt: big }, definitions, all, ctx, vi.fn());
		expect(results[0]).toMatchObject({ slug: "excerpt", status: "too-large" });
		expect(results[0]?.value).toBeUndefined();
	});

	it("contains a failing rule to its field and logs without content", () => {
		const boom: Rule = () => {
			throw new Error("broken");
		};
		const log = vi.fn();
		const { results } = polishFields({ title: "secret words" }, definitions, [["boom", boom]], ctx, log);
		expect(results[0]).toMatchObject({ slug: "title", status: "failed" });
		expect(log).toHaveBeenCalledWith("Typographer could not polish a field", {
			field: "title",
			rule: "boom",
			error: expect.any(String),
		});
		expect(JSON.stringify(log.mock.calls)).not.toContain("secret words");
	});

	it("passes the structure guard for every polished rich-text field", () => {
		const content = [block("b1", [span("s1", '"a"'), span("s2", "b", ["em"])])];
		const { results } = polishFields({ content }, definitions, all, ctx, vi.fn());
		expect(results[0]?.status).toBe("changed");
		expect(sameStructure(content, results[0]?.value)).toBe(true);
	});

	it("treats (c) as a list marker when another block in the field has (a) or (b)", () => {
		const legal = [block("b1", [span("s1", "(a) one")]), block("b2", [span("s2", "(b) two")]), block("b3", [span("s3", "(c) three")])];
		const copyright = [block("b1", [span("s1", "(c) 2026 Acme")])];
		const run = (content: unknown) => polishFields({ content }, definitions, all, ctx, vi.fn()).results[0];
		expect(run(legal)?.status).toBe("clean");
		expect(texts(run(copyright)?.value)).toEqual([["© 2026 Acme"]]);
	});
});

describe("code-like fields", () => {
	it.each(["embed_code", "custom_css", "json_ld", "content_html", "canonical_url", "sku", "hero_svg", "contact_email"])(
		"skips %s, whose name says it holds code or an identifier",
		(slug) => {
			const { results } = polishFields({ [slug]: '"x" -- y' }, [{ slug, label: slug, type: "text" }], all, ctx, vi.fn());
			expect(results[0]).toMatchObject({ slug, status: "skipped" });
			expect(results[0]?.value).toBeUndefined();
		},
	);

	it.each(["description", "transcript", "post_body", "barcode_notes"])("still polishes %s", (slug) => {
		const { results } = polishFields({ [slug]: '"x"' }, [{ slug, label: slug, type: "text" }], all, ctx, vi.fn());
		expect(results[0]?.status).toBe("changed");
	});
});

describe("never-touch words", () => {
	const keep = (list: string) => ({ ...ctx, keep: keepPattern(list) });

	it("leaves a listed phrase alone and still fixes the rest", () => {
		expect(polishText(`I love Rock 'n' Roll -- "really"`, all, keep("Rock 'n' Roll")).text).toBe(
			"I love Rock 'n' Roll — “really”",
		);
	});

	it("ignores case and surrounding blank lines and spaces", () => {
		expect(polishText("rock 'n' roll", all, keep("\n  Rock 'n' Roll  \n\n")).text).toBe("rock 'n' roll");
	});

	it("protects a phrase that runs across formatting", () => {
		const value = [block("b1", [span("s1", "the "), span("s2", "Yahoo", ["strong"]), span("s3", "!... site")])];
		const result = polishPortableText(value, all, keep("Yahoo!..."));
		expect(result.counts).toEqual({});
	});

	it("treats regex characters literally", () => {
		expect(polishText("a (c) b -- (c.)", all, keep("(c.)")).text).toBe("a © b — (c.)");
	});

	it("returns nothing for an empty list", () => {
		expect(keepPattern("")).toBeUndefined();
		expect(keepPattern(" \n \n")).toBeUndefined();
	});

	it("uses at most 100 entries of at most 100 characters", () => {
		const many = Array.from({ length: 150 }, (_, i) => `<${i}>`).join("\n");
		const pattern = keepPattern(`${many}\n${"x".repeat(101)}`);
		expect(pattern && "<99>".match(pattern)).not.toBeNull();
		expect(pattern && "<100>".match(pattern)).toBeNull();
		expect(keepPattern("x".repeat(101))).toBeUndefined();
	});

	it("is idempotent", () => {
		const once = polishText(`"Rock 'n' Roll" isn't dead`, all, keep("Rock 'n' Roll")).text;
		expect(once).toBe("“Rock 'n' Roll” isn’t dead");
		expect(polishText(once, all, keep("Rock 'n' Roll")).text).toBe(once);
	});
});
