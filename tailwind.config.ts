import type { Config } from "tailwindcss";

// Merged config: shadcn/ui design tokens (HSL CSS vars) + Tremor dashboard
// tokens (used by @tremor/react charts and cards). Both need their content
// globs and colour scales present for the utility classes to be generated.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    // Tremor components live in node_modules and emit utility classes.
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx,mjs}",
  ],
  theme: {
    transparent: "transparent",
    current: "currentColor",
    extend: {
      colors: {
        // shadcn/ui tokens
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // The client's own accent (clients.brand_color, migration 0031), set
        // as --client-accent on the dashboard wrapper. Unset = our primary.
        "client-accent": "var(--client-accent, hsl(var(--primary)))",
        // Card edge hairline and the selected segment of segmented controls.
        hairline: "hsl(var(--hairline))",
        segment: "hsl(var(--segment))",
        chrome: "hsl(var(--chrome))",
        // v2 skin (app/globals.css). `anchor` = the near-black selected /
        // primary pill (inverts to off-white in dark); `lime` = signature
        // accent for fills, `olive` its quiet sibling; `chart-*` = earthy
        // categorical palette; positive/negative/warning = meaning; `ai` =
        // the AI insight banner.
        anchor: {
          DEFAULT: "hsl(var(--anchor) / <alpha-value>)",
          foreground: "hsl(var(--anchor-foreground) / <alpha-value>)",
          dot: "hsl(var(--anchor-dot) / <alpha-value>)",
        },
        lime: {
          DEFAULT: "hsl(var(--lime) / <alpha-value>)",
          soft: "hsl(var(--lime-soft) / <alpha-value>)",
          foreground: "hsl(var(--lime-foreground) / <alpha-value>)",
        },
        olive: {
          DEFAULT: "hsl(var(--olive) / <alpha-value>)",
          soft: "hsl(var(--olive-soft) / <alpha-value>)",
        },
        chart: {
          1: "hsl(var(--chart-1) / <alpha-value>)",
          2: "hsl(var(--chart-2) / <alpha-value>)",
          3: "hsl(var(--chart-3) / <alpha-value>)",
          4: "hsl(var(--chart-4) / <alpha-value>)",
          5: "hsl(var(--chart-5) / <alpha-value>)",
          6: "hsl(var(--chart-6) / <alpha-value>)",
          muted: "hsl(var(--chart-muted) / <alpha-value>)",
        },
        tooltip: {
          DEFAULT: "hsl(var(--tooltip) / <alpha-value>)",
          foreground: "hsl(var(--tooltip-foreground) / <alpha-value>)",
        },
        positive: {
          DEFAULT: "hsl(var(--positive) / <alpha-value>)",
          soft: "hsl(var(--positive-soft) / <alpha-value>)",
        },
        negative: {
          DEFAULT: "hsl(var(--negative) / <alpha-value>)",
          soft: "hsl(var(--negative-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          soft: "hsl(var(--warning-soft) / <alpha-value>)",
          fill: "hsl(var(--warning-fill) / <alpha-value>)",
        },
        ai: {
          DEFAULT: "hsl(var(--ai) / <alpha-value>)",
          soft: "hsl(var(--ai-soft) / <alpha-value>)",
        },
        // 2026 pastel system (Przeglad-pastel). Fills/decoration; text on
        // them uses the *-ink / foreground tokens. `chip` is a translucent
        // ink wash (rgba), so it takes no alpha modifier.
        mint: "hsl(var(--mint) / <alpha-value>)",
        violet: "hsl(var(--violet) / <alpha-value>)",
        coral: {
          DEFAULT: "hsl(var(--coral) / <alpha-value>)",
          foreground: "hsl(var(--coral-foreground) / <alpha-value>)",
        },
        amber: "hsl(var(--amber) / <alpha-value>)",
        chip: "var(--chip)",
        line: "var(--line)",
        prev: "var(--prev)",
        // Text tones of the pastel system: ink-2 (secondary), ink-3 (meta,
        // kickers). AA on glass in both themes (see globals.css).
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        // Tremor tokens. Pointed at the same CSS variables as shadcn, so a
        // Tremor <Card> and a hand-built card are the same surface in both
        // themes (the variables switch under .dark; `dark-tremor` repeats
        // them because Tremor emits dark: classes for its own palette).
        tremor: {
          brand: {
            faint: "hsl(var(--accent))",
            muted: "hsl(var(--primary) / 0.25)",
            subtle: "hsl(var(--primary) / 0.6)",
            DEFAULT: "hsl(var(--primary))",
            emphasis: "hsl(var(--accent-foreground))",
            inverted: "hsl(var(--primary-foreground))",
          },
          background: {
            muted: "hsl(var(--muted))",
            subtle: "hsl(var(--secondary))",
            DEFAULT: "hsl(var(--card))",
            emphasis: "hsl(var(--foreground))",
          },
          border: { DEFAULT: "hsl(var(--border))" },
          ring: { DEFAULT: "hsl(var(--hairline))" },
          content: {
            subtle: "hsl(var(--muted-foreground))",
            DEFAULT: "hsl(var(--muted-foreground))",
            emphasis: "hsl(var(--foreground) / 0.85)",
            strong: "hsl(var(--foreground))",
            inverted: "hsl(var(--background))",
          },
        },
        "dark-tremor": {
          brand: {
            faint: "hsl(var(--accent))",
            muted: "hsl(var(--primary) / 0.3)",
            subtle: "hsl(var(--primary) / 0.6)",
            DEFAULT: "hsl(var(--primary))",
            emphasis: "hsl(var(--accent-foreground))",
            inverted: "hsl(var(--primary-foreground))",
          },
          background: {
            muted: "hsl(var(--muted))",
            subtle: "hsl(var(--secondary))",
            DEFAULT: "hsl(var(--card))",
            emphasis: "hsl(var(--foreground))",
          },
          border: { DEFAULT: "hsl(var(--border))" },
          ring: { DEFAULT: "hsl(var(--hairline))" },
          content: {
            subtle: "hsl(var(--muted-foreground))",
            DEFAULT: "hsl(var(--muted-foreground))",
            emphasis: "hsl(var(--foreground) / 0.85)",
            strong: "hsl(var(--foreground))",
            inverted: "hsl(var(--background))",
          },
        },
      },
      fontFamily: {
        // Geist (self-hosted, app/layout.tsx): latin subset first, latin-ext
        // second (Polish diacritics), then the system UI font.
        sans: [
          "var(--font-geist)",
          "var(--font-geist-ext)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "var(--font-geist-mono-ext)",
          "ui-monospace",
          '"SF Mono"',
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        // Top-level surfaces (cards, sections).
        card: "var(--radius-card)",
        // KPI tiles / inner glass (30px) and the big glass sections (32px).
        tile: "1.875rem",
        glass: "2rem",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Tremor radii: Tremor's Card uses tremor-default, so it matches
        // <Card> and the bridged hand-built cards.
        "tremor-small": "0.625rem",
        "tremor-default": "var(--radius-card)",
        "tremor-full": "9999px",
      },
      fontSize: {
        // Type scale (see the design spec in the phase-1 notes):
        // page title > section title > body > label; numbers have their own.
        "page-title": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.022em", fontWeight: "600" }],
        // v2: section titles ~18px semibold; numbers large, medium weight,
        // tight tracking (benchmarks) - confident without shouting.
        "section-title": ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.012em", fontWeight: "600" }],
        "metric-lg": ["2.75rem", { lineHeight: "1", letterSpacing: "-0.035em", fontWeight: "500" }],
        metric: ["2rem", { lineHeight: "1.1", letterSpacing: "-0.03em", fontWeight: "500" }],
        "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
      boxShadow: {
        // Softer defaults: existing shadow-sm/shadow-md usages calm down too.
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        md: "0 2px 4px -1px rgb(0 0 0 / 0.06), 0 6px 16px -4px rgb(0 0 0 / 0.08)",
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        glass: "var(--shadow-glass)",
        // Selected KPI tile: lime hairline ring + soft lime glow.
        "lime-ring": "0 0 0 1.5px hsl(var(--lime)), 0 22px 50px -24px var(--lime-glow)",
        "lime-glow": "0 10px 30px -10px var(--lime-glow)",
        "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.04)",
        "tremor-card": "var(--shadow-card)",
        "tremor-dropdown": "var(--shadow-raised)",
        "dark-tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.3)",
        "dark-tremor-card": "var(--shadow-card)",
        "dark-tremor-dropdown": "var(--shadow-raised)",
      },
      keyframes: {
        // 2026 motion set. All are entrance-only (fill-mode backwards), so
        // the resting state is the element's own style: SSR, print and
        // reduced motion (animations off) show final values.
        rise: {
          from: { opacity: "0", transform: "translateY(18px)", filter: "blur(6px)" },
        },
        draw: { from: { strokeDashoffset: "1" } },
        "ring-fill": { from: { strokeDashoffset: "100" } },
        grow: { from: { transform: "scaleX(0)" } },
        fade: { from: { opacity: "0" } },
        ping: { "75%, 100%": { transform: "scale(3.2)", opacity: "0" } },
        drift: {
          "0%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(90px,40px,0) scale(1.12)" },
          "100%": { transform: "translate3d(-40px,100px,0) scale(.94)" },
        },
        spin: { to: { transform: "rotate(360deg)" } },
        blink: { "50%": { opacity: "0" } },
        bob: { "50%": { transform: "translateY(-5px)", opacity: ".4" } },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        rise: "rise 1.1s cubic-bezier(.16,1,.3,1) var(--d,0s) backwards",
        draw: "draw 2.2s cubic-bezier(.65,0,.35,1) var(--d,.4s) backwards",
        "ring-fill": "ring-fill 2.4s cubic-bezier(.65,0,.35,1) var(--d,.6s) backwards",
        grow: "grow 1.6s cubic-bezier(.16,1,.3,1) var(--d,.8s) backwards",
        fade: "fade 1.4s ease var(--d,1s) backwards",
        "ping-soft": "ping 1.8s cubic-bezier(0,0,.2,1) infinite",
        blink: "blink 1s steps(1) infinite",
        bob: "bob 1s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],
  plugins: [require("@tailwindcss/forms"), require("tailwindcss-animate")],
};

export default config;
