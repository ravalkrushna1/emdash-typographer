import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import * as z from "zod";

import { resolveLocale } from "./locales.js";
import { polishFields } from "./portable-text.js";
import { RULE_DEFAULTS, RULE_IDS, selectRules, type RuleId } from "./rules.js";
import { errorResponse, panelIntro, polishResult, scanResult } from "./ui.js";

const draftSchema = z.object({
	fields: z.record(z.string(), z.unknown()),
	fieldDefinitions: z.array(z.object({ slug: z.string(), label: z.string(), type: z.string() })),
});

const panelInput = z.discriminatedUnion("type", [
	z.object({ type: z.literal("panel_load") }),
	z.object({ type: z.literal("block_action"), action_id: z.string(), draft: z.optional(draftSchema) }),
	z.object({
		type: z.literal("form_submit"),
		action_id: z.string(),
		values: z.record(z.string(), z.unknown()),
		draft: z.optional(draftSchema),
	}),
]);

export async function readSettings(ctx: PluginContext): Promise<{ rules: Set<RuleId>; locale: string | null }> {
	const stored = new Map((await ctx.settings.list()).map(({ key, value }) => [key, value]));
	const rules = new Set<RuleId>();
	for (const id of RULE_IDS) {
		const value = stored.get(id);
		if (typeof value === "boolean" ? value : RULE_DEFAULTS[id]) rules.add(id);
	}
	const locale = stored.get("locale");
	return { rules, locale: typeof locale === "string" ? locale : null };
}

const plugin: SandboxedPlugin = {
	routes: {
		panel: {
			permission: "content:edit_own",
			handler: async (route, ctx) => {
				if (route.ui?.surface !== "content-editor-panel") return errorResponse("Open Typographer from the editor.");
				const parsed = panelInput.safeParse(route.input);
				if (!parsed.success) return errorResponse("Something went wrong — reopen the panel.");
				const input = parsed.data;
				const settings = await readSettings(ctx);
				const locale = resolveLocale(settings.locale, route.ui.entry.locale ?? null);

				if (input.type === "panel_load") return panelIntro(locale);
				const { draft } = input;
				if (!draft) return errorResponse("Save the entry once, then scan.");

				const log = (message: string, data: Record<string, string>) => ctx.log.error(message, data);
				const run = (rules: ReadonlySet<RuleId>) =>
					polishFields(draft.fields, draft.fieldDefinitions, selectRules(rules), { locale: locale.style }, log);

				if (input.type === "block_action" && input.action_id === "scan") {
					return scanResult(run(new Set(RULE_IDS)).counts, settings.rules, locale);
				}
				if (input.type === "form_submit" && input.action_id === "polish") {
					const chosen = new Set(RULE_IDS.filter((id) => input.values[id] === true));
					const { results, counts } = run(chosen);
					const changed = results.filter((result) => result.status === "changed");
					return {
						...polishResult(results, counts),
						...(changed.length > 0 && {
							patch: {
								type: "editor-draft-patch" as const,
								operations: changed.map((result) => ({ op: "set" as const, field: result.slug, value: result.value })),
							},
						}),
					};
				}
				return errorResponse("Something went wrong — reopen the panel.");
			},
		},
	},
};

export default plugin;
