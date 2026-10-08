import type { BlockResponse } from "@emdash-cms/blocks";

import type { ResolvedLocale } from "./locales.js";
import type { Counts, FieldResult } from "./portable-text.js";
import { RISKY_RULES, RULE_IDS, RULE_LABELS, type RuleId } from "./rules.js";

type Block = BlockResponse["blocks"][number];

const scanButton = (label: string): Block => ({
	type: "actions",
	elements: [{ type: "button", action_id: "scan", label, style: "primary" }],
});

function localeLine(locale: ResolvedLocale): Block {
	const { style } = locale;
	return {
		type: "context",
		text: locale.fellBack
			? `No quote style for “${locale.requested}” yet — using English quotes.`
			: `Quote style: ${style.tag} → ${style.double[0]} ${style.double[1]}`,
	};
}

export const errorResponse = (message: string): BlockResponse => ({
	blocks: [{ type: "banner", variant: "error", title: message }],
});

export function panelIntro(locale: ResolvedLocale): BlockResponse {
	return {
		blocks: [
			{
				type: "context",
				text: "Finds straight quotes, double hyphens, three dots and breaking spaces in your unsaved text. Nothing changes until you preview and apply.",
			},
			localeLine(locale),
			scanButton("Scan draft"),
		],
	};
}

const total = (counts: Counts) => Object.values(counts).reduce((sum, n) => sum + n, 0);

function problemBanners(results: FieldResult[]): Block[] {
	const blocks: Block[] = [];
	for (const result of results) {
		if (result.status === "too-large") {
			blocks.push({
				type: "banner",
				variant: "alert",
				title: `${result.label} is too long to polish in one go (64 KB limit).`,
				description: "Other fields were polished.",
			});
		} else if (result.status === "failed") {
			blocks.push({
				type: "banner",
				variant: "error",
				title: `Couldn't safely polish ${result.label}.`,
				description: "Nothing was changed in it.",
			});
		}
	}
	return blocks;
}

export function scanResult(results: FieldResult[], counts: Counts, enabled: ReadonlySet<RuleId>, locale: ResolvedLocale): BlockResponse {
	const found = RULE_IDS.filter((id) => (counts[id] ?? 0) > 0);
	const problems = problemBanners(results);
	if (found.length === 0) {
		return {
			blocks: [
				...problems,
				...(problems.length === 0 ? [{ type: "banner" as const, title: "Looks clean ✓", description: "No typographic fixes found." }] : []),
				scanButton("Scan again"),
			],
		};
	}
	return {
		blocks: [
			...problems,
			{ type: "header", text: `Found ${total(counts)} fixes` },
			localeLine(locale),
			{
				type: "form",
				block_id: "rules",
				fields: found.map((id) => ({
					type: "toggle" as const,
					action_id: id,
					label: `${RULE_LABELS[id]} (${counts[id]})`,
					...(RISKY_RULES.has(id) ? { description: "Can misfire on dates and codes — check the preview." } : {}),
					initial_value: enabled.has(id),
				})),
				submit: { label: "Polish selected", action_id: "polish" },
			},
			{ type: "context", text: "Counts assume every rule is on. The preview shows the exact changes. Edited while scanning? Scan again." },
		],
	};
}

export function polishResult(results: FieldResult[], counts: Counts): BlockResponse {
	const blocks = problemBanners(results);
	const changed = results.filter((result) => result.status === "changed").map((result) => result.label);
	blocks.push(
		changed.length > 0
			? { type: "section", text: `Proposed ${total(counts)} fixes in ${changed.join(", ")}. Review the preview to apply them.` }
			: { type: "banner", title: "Nothing to change with the selected rules." },
		scanButton("Scan again"),
	);
	return { blocks };
}
