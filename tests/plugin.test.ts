import { afterEach, describe, expect, it } from "vitest";

import { polishResult, scanResult } from "../src/ui.js";
import { resolveLocale } from "../src/locales.js";
import { createPluginRuntimeTestHost } from "@emdash-cms/plugin-test";

type Host = Awaited<ReturnType<typeof createPluginRuntimeTestHost>>;
let host: Host | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const POST_FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "featured_image", label: "Featured image", type: "image" },
	{ slug: "content", label: "Content", type: "portableText" },
	{ slug: "excerpt", label: "Excerpt", type: "text" },
] as const;

const PAGE_FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "content", label: "Content", type: "portableText" },
] as const;

const paragraph = (text: string) => [
	{
		_type: "block",
		_key: "b1",
		style: "normal",
		markDefs: [],
		children: [{ _type: "span", _key: "s1", text, marks: [] }],
	},
];

async function setup(collection: "posts" | "pages", locale = "en") {
	host = await createPluginRuntimeTestHost({ i18n: { defaultLocale: "en", locales: ["en", "fr", "ar"] } });
	await host.fixtures.collection({
		slug: collection,
		label: collection,
		fields: [...(collection === "posts" ? POST_FIELDS : PAGE_FIELDS)],
	});
	const entry = await host.fixtures.content(collection, {
		data: { title: "Saved", content: paragraph("Saved") },
		locale,
	});
	return { host, entry };
}

const text = (response: { blocks: unknown[] }) => JSON.stringify(response.blocks);
const editorState = (draft: { entryId: string; locale: string | null; generation: number; invocationId: string }) => ({
	entryId: draft.entryId,
	locale: draft.locale,
	generation: draft.generation,
	invocationId: draft.invocationId,
});

describe("Typographer panel", () => {
	it("opens with the locale and a scan button, without reading the draft", async () => {
		const { host, entry } = await setup("posts", "fr");
		const intro = await host.admin.loadEditorPanel("typographer", "posts", entry.id, { contentLocale: "fr" });
		expect(text(intro)).toContain("Scan draft");
		expect(text(intro)).toContain("«");
	});

	it("scans, polishes, and proposes a patch the host accepts", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft(
			"posts",
			entry.id,
			{ title: '"Hello" -- world...', excerpt: "it's", content: paragraph("Wait...") },
			{ contentLocale: "en" },
		);

		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", {
			contentLocale: "en",
			draft,
		});
		expect(text(scan)).toContain("Polish selected");
		expect(text(scan)).toContain("Curly quotes (3)");
		expect(text(scan)).not.toContain("Number ranges");

		const proposal = await host.admin.submitEditorPanel(
			"typographer",
			"posts",
			entry.id,
			"polish",
			{ quotes: true, dashes: true, ellipsis: true },
			{ contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch(
			"panel",
			"typographer",
			draft,
			proposal,
			editorState(draft),
			draft.fields,
		);
		expect(patched.title).toBe("“Hello” — world…");
		expect(patched.excerpt).toBe("it’s");
		expect(JSON.stringify(patched.content)).toContain("Wait…");
		await expect(host.inspect.content.get("posts", entry.id)).resolves.toMatchObject({
			data: { title: "Saved" },
		});
	});

	it("only applies the rules left switched on", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Hi" -- there' }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true, dashes: false }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("“Hi” -- there");
	});

	it("works on a collection that lacks some declared fields", async () => {
		const { host, entry } = await setup("pages");
		const draft = await host.admin.captureEditorDraft("pages", entry.id, { title: "It's" }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "pages", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("It’s");
		expect(text(proposal)).toContain("Proposed 1 fix in Title.");
	});

	it("says the draft is clean and proposes nothing", async () => {
		const { host, entry } = await setup("posts");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: "Already “fine”" }, { contentLocale: "en" });
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en", draft });
		expect(text(scan)).toContain("Looks clean");
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		expect(proposal.patch).toBeUndefined();
	});

	it("asks the editor to save first when there is no draft", async () => {
		const { host, entry } = await setup("posts");
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en" });
		expect(text(scan)).toContain("Save the entry once");
	});

	it("falls back to English quotes for a language without a table and says so", async () => {
		const { host, entry } = await setup("posts", "ar");
		const intro = await host.admin.loadEditorPanel("typographer", "posts", entry.id, { contentLocale: "ar" });
		expect(text(intro)).toContain("No quote style for “ar” yet");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"marhaba"' }, { contentLocale: "ar" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "ar", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("“marhaba”");
	});

	it("uses French quotes and spacing for a French entry", async () => {
		const { host, entry } = await setup("posts", "fr");
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Bonjour" !' }, { contentLocale: "fr" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true, nbsp: true }, { contentLocale: "fr", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("«\u202FBonjour\u202F»\u202F!");
	});

	it("the host rejects a malformed draft before the plugin sees it", async () => {
		const { host, entry } = await setup("posts");
		await expect(
			host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", {
				contentLocale: "en",
				draft: { fields: "nope" } as never,
			}),
		).rejects.toThrow(/Invalid editor draft/);
	});
});

describe("scanResult", () => {
	const locale = resolveLocale(null, "en");
	it.each([
		["too-large", "too long to polish"],
		["failed", "Couldn't safely polish"],
	] as const)("never says clean when a field is %s", (status, message) => {
		const out = JSON.stringify(
			scanResult([{ slug: "content", label: "Content", status, counts: { quotes: 3 } }], {}, new Set(), locale).blocks,
		);
		expect(out).toContain(message);
		expect(out).not.toContain("Looks clean");
	});

	it.each([
		[{ quotes: 1 }, "Found 1 fix"],
		[{ quotes: 1, dashes: 1 }, "Found 2 fixes"],
	])("counts %j as %s", (counts, header) => {
		const results = [{ slug: "title", label: "Title", status: "changed" as const, counts }];
		expect(JSON.stringify(scanResult(results, counts, new Set(), locale).blocks)).toContain(`"${header}"`);
	});

	it("says other fields can still be polished when one is too large at scan time", () => {
		const results = [
			{ slug: "content", label: "Content", status: "too-large" as const, counts: { quotes: 3 } },
			{ slug: "title", label: "Title", status: "changed" as const, counts: { quotes: 2 } },
		];
		expect(JSON.stringify(scanResult(results, { quotes: 2 }, new Set(), locale).blocks)).toContain("Other fields can still be polished.");
	});
});

describe("polishResult", () => {
	const tooLarge = { slug: "content", label: "Content", status: "too-large" as const, counts: { quotes: 3 } };

	it("says other fields were polished only when one was", () => {
		const changed = { slug: "title", label: "Title", status: "changed" as const, counts: { quotes: 1 } };
		const withOther = JSON.stringify(polishResult([tooLarge, changed], { quotes: 1 }).blocks);
		expect(withOther).toContain("Other fields were polished.");
		expect(withOther).toContain("Proposed 1 fix in Title.");
		const alone = JSON.stringify(polishResult([tooLarge], {}).blocks);
		expect(alone).toContain("too long to polish");
		expect(alone).not.toContain("Other fields");
	});
});

describe("Typographer settings", () => {
	it("the panel honours values saved through the host's settings form", async () => {
		const { host, entry } = await setup("posts");
		const saved = await host.actions.plugin.updateSettings({ ranges: true, locale: "de" });
		expect(saved.success).toBe(true);
		const rejected = await host.actions.plugin.updateSettings({ locale: "xx" });
		expect(rejected.success).toBe(false);

		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Seiten" 10-20' }, { contentLocale: "en" });
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en", draft });
		expect(text(scan)).toMatch(/"action_id":"ranges"[^}]*"initial_value":true/);
		expect(text(scan)).toContain("\u201e");
	});

	it("leaves the words listed under 'Leave these words alone'", async () => {
		const { host, entry } = await setup("posts");
		expect((await host.actions.plugin.updateSettings({ keep: "Rock 'n' Roll" })).success).toBe(true);
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: `"Rock 'n' Roll" isn't dead` }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("“Rock 'n' Roll” isn’t dead");
	});
});

describe("Typographer coverage", () => {
	it("polishes custom field names on a singular collection, but not code fields", async () => {
		host = await createPluginRuntimeTestHost({ i18n: { defaultLocale: "en", locales: ["en"] } });
		await host.fixtures.collection({
			slug: "article",
			label: "Articles",
			fields: [
				{ slug: "title", label: "Title", type: "string" },
				{ slug: "post_body", label: "Body", type: "portableText" },
				{ slug: "embed_code", label: "Embed", type: "text" },
			],
		});
		const entry = await host.fixtures.content("article", { data: { title: "Saved" }, locale: "en" });
		const embed = '<div class="x">--</div>';
		const draft = await host.admin.captureEditorDraft(
			"article", entry.id, { title: "It's", post_body: paragraph("Wait..."), embed_code: embed }, { contentLocale: "en" },
		);
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "article", entry.id, "polish", { quotes: true, ellipsis: true, dashes: true }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("It’s");
		expect(JSON.stringify(patched.post_body)).toContain("Wait…");
		expect(patched.embed_code).toBe(embed);
	});

	it("still scans a collection with many non-text fields", async () => {
		host = await createPluginRuntimeTestHost({ i18n: { defaultLocale: "en", locales: ["en"] } });
		const images = Array.from({ length: 20 }, (_, i) => ({ slug: `photo_${i}`, label: `Photo ${i}`, type: "image" as const }));
		await host.fixtures.collection({
			slug: "posts",
			label: "Posts",
			fields: [{ slug: "title", label: "Title", type: "string" }, ...images],
		});
		const entry = await host.fixtures.content("posts", { data: { title: "Saved" }, locale: "en" });
		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: "It's" }, { contentLocale: "en" });
		const proposal = await host.admin.submitEditorPanel(
			"typographer", "posts", entry.id, "polish", { quotes: true }, { contentLocale: "en", draft },
		);
		const patched = await host.admin.applyEditorDraftPatch("panel", "typographer", draft, proposal, editorState(draft), draft.fields);
		expect(patched.title).toBe("It’s");
	});
});
