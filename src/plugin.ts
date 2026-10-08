import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { resolveLocale } from "./locales.js";
import { polishFields } from "./portable-text.js";
import { RULE_DEFAULTS, RULE_IDS, selectRules, type RuleId } from "./rules.js";
import { errorResponse, panelIntro, polishResult, scanResult } from "./ui.js";

type FieldDefinition = { slug: string; label: string; type: string };
type Draft = { fields: Record<string, unknown>; fieldDefinitions: FieldDefinition[] };
type PanelInput =
	| { type: "panel_load" }
	| { type: "block_action"; action_id: string; draft?: Draft }
	| { type: "form_submit"; action_id: string; values: Record<string, unknown>; draft?: Draft };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFieldDefinition = (value: unknown): value is FieldDefinition =>
	isRecord(value) && typeof value.slug === "string" && typeof value.label === "string" && typeof value.type === "string";

function parseDraft(value: unknown): Draft | undefined {
	if (!isRecord(value) || !isRecord(value.fields)) return undefined;
	const defs = value.fieldDefinitions;
	if (!Array.isArray(defs) || !defs.every(isFieldDefinition)) return undefined;
	return { fields: value.fields, fieldDefinitions: defs };
}

/** Returns undefined for anything malformed, including a present-but-invalid draft. */
function parsePanelInput(value: unknown): PanelInput | undefined {
	if (!isRecord(value)) return undefined;
	if (value.type === "panel_load") return { type: "panel_load" };
	if ((value.type !== "block_action" && value.type !== "form_submit") || typeof value.action_id !== "string") return undefined;
	const draft = value.draft === undefined ? undefined : parseDraft(value.draft);
	if (value.draft !== undefined && !draft) return undefined;
	if (value.type === "block_action") return { type: "block_action", action_id: value.action_id, draft };
	if (!isRecord(value.values)) return undefined;
	return { type: "form_submit", action_id: value.action_id, values: value.values, draft };
}

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
				const input = parsePanelInput(route.input);
				if (!input) return errorResponse("Something went wrong — reopen the panel.");
				const settings = await readSettings(ctx);
				const locale = resolveLocale(settings.locale, route.ui.entry.locale ?? null);

				if (input.type === "panel_load") return panelIntro(locale);
				const { draft } = input;
				if (!draft) return errorResponse("Save the entry once, then scan.");

				const log = (message: string, data: Record<string, string>) => ctx.log.error(message, data);
				const run = (rules: ReadonlySet<RuleId>) =>
					polishFields(draft.fields, draft.fieldDefinitions, selectRules(rules), { locale: locale.style }, log);

				if (input.type === "block_action" && input.action_id === "scan") {
					const scanned = run(new Set(RULE_IDS));
					return scanResult(scanned.results, scanned.counts, settings.rules, locale);
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
