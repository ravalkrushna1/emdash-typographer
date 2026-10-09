/**
 * Pure typographic data. No behaviour lives here so that languages, units and
 * glyphs can be added without touching the rules.
 */

export interface LocaleStyle {
	/** Resolved language subtag, e.g. "fr". */
	tag: string;
	/** Opening and closing double quotes. */
	double: readonly [string, string];
	/** Opening and closing single quotes. */
	single: readonly [string, string];
	/** French spacing: narrow no-break space before ; ! ? and inside « ». */
	frenchSpacing: boolean;
}

export interface ResolvedLocale {
	style: LocaleStyle;
	/** The locale we were asked for, before falling back. */
	requested: string | null;
	/** True when `requested` had no table and English was used instead. */
	fellBack: boolean;
}

type Style = Omit<LocaleStyle, "tag">;

const ENGLISH: Style = { double: ["“", "”"], single: ["‘", "’"], frenchSpacing: false };
const GUILLEMETS_INNER_CURLY: Style = { double: ["«", "»"], single: ["“", "”"], frenchSpacing: false };
const SWEDISH: Style = { double: ["”", "”"], single: ["’", "’"], frenchSpacing: false };
const NORWEGIAN: Style = { double: ["«", "»"], single: ["‘", "’"], frenchSpacing: false };
const CZECH: Style = { double: ["„", "“"], single: ["‚", "‘"], frenchSpacing: false };

const STYLES: Readonly<Record<string, Style>> = {
	en: ENGLISH,
	nl: ENGLISH,
	hi: ENGLISH,
	gu: ENGLISH,
	zh: ENGLISH,
	fr: { double: ["«", "»"], single: ["‹", "›"], frenchSpacing: true },
	es: GUILLEMETS_INNER_CURLY,
	it: GUILLEMETS_INNER_CURLY,
	pt: GUILLEMETS_INNER_CURLY,
	ru: { double: ["«", "»"], single: ["„", "“"], frenchSpacing: false },
	de: { double: ["„", "“"], single: ["‚", "‘"], frenchSpacing: false },
	pl: { double: ["„", "”"], single: ["«", "»"], frenchSpacing: false },
	ja: { double: ["「", "」"], single: ["『", "』"], frenchSpacing: false },
	da: { double: ["»", "«"], single: ["›", "‹"], frenchSpacing: false },
	// 1.1 additions; pairs from CLDR delimiters (quotationStart/End, alternateQuotationStart/End).
	sv: SWEDISH,
	fi: SWEDISH,
	nb: NORWEGIAN,
	no: NORWEGIAN,
	nn: NORWEGIAN,
	cs: CZECH,
	sk: CZECH,
	hu: { double: ["„", "”"], single: ["»", "«"], frenchSpacing: false },
	tr: ENGLISH,
	ko: ENGLISH,
	uk: { double: ["«", "»"], single: ["„", "“"], frenchSpacing: false },
	el: GUILLEMETS_INNER_CURLY,
	ro: { double: ["„", "”"], single: ["«", "»"], frenchSpacing: false },
	bg: { double: ["„", "“"], single: ["„", "“"], frenchSpacing: false },
	mr: ENGLISH,
	ta: ENGLISH,
	bn: ENGLISH,
};

export const SUPPORTED_LOCALES: readonly string[] = Object.keys(STYLES);

/** Apostrophe is U+2019 in every supported language. */
export const APOSTROPHE = "’";

/** Words that begin with an elided letter, so a leading ' is an apostrophe: 'tis, 'n'. */
export const ELISIONS: readonly string[] = ["tis", "twas", "em", "n", "cause", "til", "round"];

/**
 * Units that take a no-break space after a number. "in" and "A" are left out on
 * purpose: they are ordinary words too often ("5 in total").
 */
export const UNITS: readonly string[] = [
	"kg", "g", "mg", "km", "m", "cm", "mm", "µm", "nm", "l", "ml", "L", "mL",
	"h", "min", "s", "ms", "°C", "°F", "%", "px", "rem", "em", "pt",
	"GB", "MB", "KB", "kB", "TB", "Hz", "kHz", "MHz", "GHz",
	"W", "kW", "kWh", "V", "mAh", "ft", "lb", "oz", "mi", "mph", "km/h",
];

export const CURRENCIES: readonly string[] = ["₹", "$", "€", "£", "¥"];

export const FRACTIONS: Readonly<Record<string, string>> = {
	"1/2": "½",
	"1/4": "¼",
	"3/4": "¾",
	"1/3": "⅓",
	"2/3": "⅔",
};

export function resolveLocale(override: string | null, entryLocale: string | null): ResolvedLocale {
	const requested = override && override !== "auto" ? override : entryLocale;
	const tag = requested ? (requested.toLowerCase().split(/[-_]/)[0] ?? "") : "en";
	const known: Style | undefined = Object.hasOwn(STYLES, tag) ? STYLES[tag] : undefined;
	return {
		style: { tag: known ? tag : "en", ...(known ?? ENGLISH) },
		requested: requested ?? null,
		fellBack: requested != null && known === undefined,
	};
}
