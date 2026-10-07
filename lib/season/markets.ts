// Markets (countries) read from campaign names. Multi-country advertisers
// name campaigns per market - "PL - 2025 TOP", "DE | PMax | Video",
// "Search 🇮🇹 Generic" - and neither platform syncs a country breakdown, so
// the name is the one place the market lives. Only exact upper-case codes
// and flag emoji count: "it"/"us" inside ordinary words must not match.

const LABELS: Record<string, string> = {
  PL: "Polska",
  DE: "Niemcy",
  IT: "Włochy",
  UK: "Wielka Brytania",
  FR: "Francja",
  ES: "Hiszpania",
  US: "USA",
  BR: "Brazylia",
  CZ: "Czechy",
  SK: "Słowacja",
  AT: "Austria",
  CH: "Szwajcaria",
  NL: "Holandia",
  BE: "Belgia",
  PT: "Portugalia",
  RO: "Rumunia",
  HU: "Węgry",
  SE: "Szwecja",
  NO: "Norwegia",
  DK: "Dania",
  FI: "Finlandia",
  IE: "Irlandia",
  LT: "Litwa",
  LV: "Łotwa",
  EE: "Estonia",
  UA: "Ukraina",
  CA: "Kanada",
  AU: "Australia",
  MX: "Meksyk",
};

// Codes advertisers use that aren't ISO: GB is the UK, ".com" campaigns run
// the international / US store.
const ALIASES: Record<string, string> = { GB: "UK", USA: "US", COM: "US", ENG: "UK" };

const FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u;

function normalize(code: string): string | null {
  const c = ALIASES[code] ?? code;
  return LABELS[c] ? c : null;
}

export function marketOf(campaignName: string): string | null {
  const flag = FLAG.exec(campaignName);
  if (flag) {
    const code = String.fromCharCode(
      flag[1].codePointAt(0)! - 0x1f1e6 + 65,
      flag[2].codePointAt(0)! - 0x1f1e6 + 65
    );
    const hit = normalize(code);
    if (hit) return hit;
  }
  for (const token of campaignName.split(/[^A-Za-z]+/)) {
    if (token.length < 2 || token.length > 3 || token !== token.toUpperCase()) continue;
    const hit = normalize(token);
    if (hit) return hit;
  }
  return null;
}

export function marketLabel(code: string): string {
  return LABELS[code] ?? code;
}
