// The card's style: a theme, an accent and a title font, all set through @brewlang/render's --brew-* variables.
// 'auto' sets nothing, so the card follows the playground's own light or dark theme

export type ThemeName = "auto" | "paper" | "night" | "roaster";
export type FontName = "serif" | "sans" | "mono";

export interface CardStyle {
  theme: ThemeName;
  accent?: string; // A swatch name or a '#rrggbb' color; absent: the theme's
  font: FontName;
}

export const DEFAULT_STYLE: CardStyle = { theme: "auto", font: "serif" };

/// Every color of a card, as brew.css names them without the '--brew-' prefix
type Palette = Record<"bg" | "ink" | "muted" | "faint" | "rule" | "rule-soft" | "soft" | "accent" | "qual" | "qual-line", string>;

export const THEMES: Record<Exclude<ThemeName, "auto">, { label: string; palette: Palette }> = {
  paper: {
    label: "Paper",
    palette: {
      bg: "oklch(0.995 0.003 85)",
      ink: "oklch(0.23 0.012 60)",
      muted: "oklch(0.47 0.012 60)",
      faint: "oklch(0.68 0.012 70)",
      rule: "oklch(0.87 0.012 80)",
      "rule-soft": "oklch(0.92 0.01 80)",
      soft: "oklch(0.955 0.01 85)",
      accent: "oklch(0.56 0.15 38)",
      qual: "oklch(0.42 0.1 155)",
      "qual-line": "oklch(0.8 0.04 155)",
    },
  },
  night: {
    label: "Night",
    palette: {
      bg: "oklch(0.225 0 0)",
      ink: "oklch(0.94 0 0)",
      muted: "oklch(0.7 0 0)",
      faint: "oklch(0.5 0 0)",
      rule: "oklch(0.31 0 0)",
      "rule-soft": "oklch(0.27 0 0)",
      soft: "oklch(0.26 0 0)",
      accent: "oklch(0.76 0.13 45)",
      qual: "oklch(0.8 0.1 155)",
      "qual-line": "oklch(0.45 0.06 155)",
    },
  },
  roaster: {
    label: "Roaster",
    palette: {
      bg: "oklch(0.91 0.035 78)",
      ink: "oklch(0.24 0.03 50)",
      muted: "oklch(0.44 0.035 55)",
      faint: "oklch(0.62 0.035 60)",
      rule: "oklch(0.79 0.04 70)",
      "rule-soft": "oklch(0.85 0.035 72)",
      soft: "oklch(0.87 0.04 76)",
      accent: "oklch(0.46 0.13 28)",
      qual: "oklch(0.38 0.08 150)",
      "qual-line": "oklch(0.7 0.05 140)",
    },
  },
};

export const ACCENTS: Record<string, { label: string; color: string }> = {
  copper: { label: "Copper", color: "oklch(0.6 0.15 40)" },
  berry: { label: "Berry", color: "oklch(0.55 0.17 0)" },
  cobalt: { label: "Cobalt", color: "oklch(0.52 0.15 260)" },
  leaf: { label: "Leaf", color: "oklch(0.55 0.13 150)" },
  gold: { label: "Gold", color: "oklch(0.7 0.13 85)" },
};

export const FONTS: Record<FontName, { label: string; family: string }> = {
  serif: { label: "Serif", family: '"Newsreader", Georgia, serif' },
  sans: { label: "Sans", family: '"Instrument Sans", system-ui, sans-serif' },
  mono: { label: "Mono", family: '"IBM Plex Mono", ui-monospace, monospace' },
};

const HEX = /^#[0-9a-f]{6}$/i;

/// The accent as a CSS color, or undefined for the theme's
const accentColor = (accent: string | undefined) =>
  accent === undefined ? undefined : HEX.test(accent) ? accent : ACCENTS[accent]?.color;

/** The --brew-* variables a style sets; empty for the default, so the card follows the playground. */
export function variables(style: CardStyle): Record<string, string> {
  const vars: Record<string, string> = {};
  if (style.theme !== "auto") {
    for (const [name, value] of Object.entries(THEMES[style.theme].palette)) vars[`--brew-${name}`] = value;
  }
  const accent = accentColor(style.accent);
  if (accent) vars["--brew-accent"] = accent;
  if (style.font !== "serif") vars["--brew-font-display"] = FONTS[style.font].family;
  return vars;
}

/** Applies a style to a rendered card, over the playground's theme. */
export function applyStyle(card: Element | null, style: CardStyle) {
  if (!(card instanceof HTMLElement)) return;
  for (const [name, value] of Object.entries(variables(style))) card.style.setProperty(name, value);
}

/** The CSS a developer pastes next to brew.css to get the same card. */
export function css(style: CardStyle): string {
  const vars = variables(style);
  if (Object.keys(vars).length === 0) return "/* The default card: brew.css alone */\n";
  return `.brew-card {\n${Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n")}\n}\n`;
}

/** The style as URL parameters, only what differs from the default: 't=roaster&a=berry&f=sans'. */
export function toParams(style: CardStyle): URLSearchParams {
  const params = new URLSearchParams();
  if (style.theme !== DEFAULT_STYLE.theme) params.set("t", style.theme);
  if (style.accent) params.set("a", style.accent.replace(/^#/, ""));
  if (style.font !== DEFAULT_STYLE.font) params.set("f", style.font);
  return params;
}

/** Reads a style from URL parameters or saved text; anything unknown falls back to the default. */
export function fromParams(params: URLSearchParams): CardStyle {
  const style: CardStyle = { ...DEFAULT_STYLE };
  const theme = params.get("t");
  if (theme && (theme === "auto" || theme in THEMES)) style.theme = theme as ThemeName;
  const accent = params.get("a");
  if (accent && accent in ACCENTS) style.accent = accent;
  else if (accent && HEX.test(`#${accent}`)) style.accent = `#${accent.toLowerCase()}`;
  const font = params.get("f");
  if (font && font in FONTS) style.font = font as FontName;
  return style;
}
