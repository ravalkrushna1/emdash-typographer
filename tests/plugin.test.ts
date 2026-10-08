import { afterEach, describe, expect, it } from "vitest";

import { scanResult } from "../src/ui.js";
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
});

const ALL_OFF = Object.fromEntries(
	["spacing", "symbols", "ellipsis", "dashes", "ranges", "multiplication", "fractions", "primes", "quotes", "nbsp"].map(
		(id) => [id, false],
	),
);

describe("Typographer settings", () => {
	it("shows the defaults with risky rules off", async () => {
		host = await createPluginRuntimeTestHost();
		const page = await host.admin.loadPage("/settings");
		const blocks = text(page);
		expect(blocks).toContain("Typographer defaults");
		expect(blocks).toMatch(/"action_id":"ranges"[^}]*"initial_value":false/);
		expect(blocks).toMatch(/"action_id":"quotes"[^}]*"initial_value":true/);
	});

	it("saves valid settings and the panel uses them", async () => {
		const { host, entry } = await setup("posts");
		const saved = await host.admin.submit("/settings", "save", { ...ALL_OFF, ranges: true, quotes: true, locale: "de" });
		expect(saved.toast).toEqual({ type: "success", message: "Settings saved" });

		const draft = await host.admin.captureEditorDraft("posts", entry.id, { title: '"Seiten" 10-20' }, { contentLocale: "en" });
		const scan = await host.admin.actEditorPanel("typographer", "posts", entry.id, "scan", { contentLocale: "en", draft });
		expect(text(scan)).toMatch(/"action_id":"ranges"[^}]*"initial_value":true/);
		expect(text(scan)).toContain("\u201e");
	});

	it("rejects an unknown locale without saving", async () => {
		host = await createPluginRuntimeTestHost();
		const bad = await host.admin.submit("/settings", "save", { ...ALL_OFF, locale: "xx" });
		expect(bad.toast?.type).toBe("error");
		const page = await host.admin.loadPage("/settings");
		expect(text(page)).toMatch(/"action_id":"quotes"[^}]*"initial_value":true/);
	});
});
