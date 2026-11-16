import type { CampaignType } from "@/lib/demo/profile/anonymize";

// The public demo's fictional shop: "Mediaspec", an online home-appliance and
// electronics shop (AGD i RTV: TVs, audio, laptops, phones, washing machines,
// fridges, coffee machines...) whose year peaks with Black Friday and
// Christmas gifts, with a TV season around big sports events. It sells in
// Poland and a few neighbouring countries. Every name the demo shows comes
// from here; the numbers come from lib/demo/source.ts (a real client's
// anonymized profile, or the synthetic year behind it). No real brand,
// chain or model number appears anywhere.

export const DEMO_BRAND = "Mediaspec";

type Pair = readonly [pl: string, en: string];

// ---- campaigns ---------------------------------------------------------------

/** How a type reads inside a campaign name, per platform. */
const TYPE_LABEL: Record<"meta_ads" | "google_ads", Partial<Record<CampaignType, Pair>>> = {
  google_ads: {
    PMAX: ["PMAX", "PMAX"],
    SEARCH: ["Search", "Search"],
    SHOPPING: ["Shopping", "Shopping"],
    VIDEO: ["YouTube", "YouTube"],
    DISPLAY: ["Display", "Display"],
    DEMAND_GEN: ["Demand Gen", "Demand Gen"],
    OTHER: ["DSA", "DSA"],
  },
  meta_ads: {
    PROSPECTING: ["Prospecting", "Prospecting"],
    RETARGETING: ["Remarketing", "Remarketing"],
    CATALOG: ["Katalog", "Catalogue"],
    OTHER: ["Zasięg", "Reach"],
  },
};

/** Themes by type, in the order the campaigns of one market get them (biggest first). */
const THEMES: Record<"meta_ads" | "google_ads", Partial<Record<CampaignType, Pair[]>>> = {
  google_ads: {
    PMAX: [["Telewizory", "TVs"], ["Duże AGD", "Large appliances"], ["Black Friday", "Black Friday"], ["Laptopy i smartfony", "Laptops & phones"], ["Małe AGD", "Small appliances"]],
    SEARCH: [["Marka", "Brand"], ["Telewizory 4K", "4K TVs"], ["Pralki i lodówki", "Washers & fridges"], ["Raty 0%", "0% instalments"]],
    SHOPPING: [["Cały katalog", "Full catalogue"], ["Słuchawki i audio", "Headphones & audio"]],
    VIDEO: [["Black Friday", "Black Friday"], ["Telewizory na mecze", "TVs for the big match"]],
    DISPLAY: [["Odwiedzający sklep", "Shop visitors"]],
    DEMAND_GEN: [["Prezenty RTV", "Electronics gifts"]],
    OTHER: [["Kategorie", "Categories"], ["Outlet", "Outlet"]],
  },
  meta_ads: {
    PROSPECTING: [["Promocje sezonu", "Season deals"], ["Black Friday", "Black Friday"], ["Prezenty świąteczne", "Christmas gifts"], ["Telewizory", "TVs"], ["Kuchnia", "Kitchen"]],
    RETARGETING: [["Koszyk 14 dni", "Cart 14 days"], ["Odwiedzający 30 dni", "Visitors 30 days"]],
    CATALOG: [["Wszystkie produkty", "All products"], ["Bestsellery", "Bestsellers"]],
    OTHER: [["Raty 0%", "0% instalments"], ["Konkurs", "Giveaway"]],
  },
};

/**
 * A campaign's name in the agency's convention: "PL | PMAX | Telewizory".
 * `rank` counts the campaigns of the same platform, type and market (0 = the
 * biggest). The market code is the one lib/season/markets.ts reads back.
 */
export function campaignNames(
  provider: "meta_ads" | "google_ads",
  type: CampaignType,
  market: string | null,
  rank: number
): Pair {
  const label = TYPE_LABEL[provider][type] ?? TYPE_LABEL[provider].OTHER!;
  const themes = THEMES[provider][type] ?? THEMES[provider].OTHER!;
  const theme = themes[rank % themes.length];
  const round = Math.floor(rank / themes.length);
  const suffix = round > 0 ? ` ${round + 1}` : "";
  const prefix = market ? `${market} | ` : "";
  return [`${prefix}${label[0]} | ${theme[0]}${suffix}`, `${prefix}${label[1]} | ${theme[1]}${suffix}`];
}

// ---- shop ----------------------------------------------------------------------

/** Best sellers by rank (the profile only says how they rank). Prices in grosze. */
export const DEMO_PRODUCTS: Array<{ id: string; name: string; price: number }> = [
  { id: "MS-TV55-QLED", name: 'Telewizor 55" 4K QLED', price: 2_799_00 },
  { id: "MS-PR8-A3", name: "Pralka 8 kg A+++", price: 1_899_00 },
  { id: "MS-EKS-AUTO", name: "Ekspres ciśnieniowy automatyczny", price: 1_499_00 },
  { id: "MS-SL-ANC", name: "Słuchawki bezprzewodowe z ANC", price: 449_00 },
  { id: "MS-LAP-156", name: 'Laptop 15,6" 16 GB RAM, 512 GB SSD', price: 3_299_00 },
  { id: "MS-SB-31", name: "Soundbar 3.1 z subwooferem", price: 899_00 },
  { id: "MS-ODK-PION", name: "Odkurzacz pionowy bezprzewodowy", price: 1_199_00 },
  { id: "MS-LOD-NF185", name: "Lodówka No Frost 185 cm", price: 2_499_00 },
  { id: "MS-SMF-256", name: 'Smartfon 6,5" 256 GB', price: 1_799_00 },
  { id: "MS-ZMY-60", name: "Zmywarka do zabudowy 60 cm", price: 1_999_00 },
];

/** Most viewed pages by rank. */
export const DEMO_PAGES = [
  "/",
  "/promocje/black-friday",
  "/kategoria/rtv/telewizory",
  "/kategoria/agd/pralki",
  "/raty-0-procent",
];

// ---- ads -----------------------------------------------------------------------

/**
 * The shop's Meta ads as Kreacje lists them: [pl, en, relative spend, CTR %,
 * relative cost per click]. The same ads run in the creative tests
 * (lib/demo/ab.ts), so a strong ad here is a strong ad there.
 */
export const DEMO_CREATIVES: Array<[string, string, number, number, number]> = [
  ["Black Friday na telewizory - wideo 15 s", "Black Friday on TVs - 15s video", 184050, 2.1, 34],
  ["Raty 0% na AGD - karuzela", "0% instalments on appliances - carousel", 152300, 2.0, 36],
  ["Ekspres do kawy - grafika marki", "Coffee machine - brand image", 141200, 0.8, 49],
  ["Opinie klientów - grafika", "Customer reviews - image", 118900, 2.6, 39],
  ["Rozpakowanie telewizora - film klienta", "TV unboxing - customer video", 104500, 1.9, 32],
  ["Darmowa dostawa i wniesienie - grafika", "Free delivery and carry-in - image", 96700, 1.1, 46],
  ["Soundbar w salonie - wideo 10 s", "Soundbar in the living room - 10s video", 81200, 1.0, 44],
  ["Prezent pod choinkę: słuchawki - grafika", "Christmas gift: headphones - image", 72400, 2.0, 34],
  ["Pralka z montażem - karuzela", "Washing machine with installation - carousel", 61300, 1.7, 41],
  ["Mecz na 65 calach - wideo 20 s", "The match on 65 inches - 20s video", 54900, 2.3, 30],
];

/**
 * What customers type into Google, for the Search report: [phrase, relative
 * clicks, CTR, relative cost per click]. The demo spreads its Search
 * campaigns' clicks and cost over these (lib/demo/data.ts).
 */
export const DEMO_SEARCH_TERMS: Array<[string, number, number, number]> = [
  ["telewizor 55 cali", 612, 0.058, 1.1],
  ["pralka 8 kg", 418, 0.061, 1.0],
  ["mediaspec", 287, 0.24, 0.3],
  ["ekspres do kawy automatyczny", 254, 0.052, 1.15],
  ["black friday telewizory", 241, 0.047, 1.3],
  ["słuchawki bezprzewodowe", 196, 0.041, 0.9],
  ["lodówka no frost", 171, 0.066, 1.05],
  ["laptop do 3000 zł", 158, 0.049, 1.2],
  ["soundbar", 142, 0.038, 0.95],
  ["zmywarka do zabudowy 60", 131, 0.063, 1.0],
  ["odkurzacz pionowy", 119, 0.044, 0.9],
  ["telewizor 65 cali 4k", 104, 0.055, 1.25],
  ["raty 0% rtv agd", 88, 0.072, 0.8],
  ["smartfon 256 gb", 81, 0.036, 1.1],
  ["pralka z montażem", 76, 0.069, 0.85],
  ["prezent dla taty elektronika", 63, 0.042, 0.95],
  ["telewizor qled promocja", 57, 0.051, 1.3],
  ["suszarka do prania", 52, 0.057, 1.0],
  ["robot kuchenny", 49, 0.039, 0.9],
  ["sklep rtv agd z dostawą", 41, 0.048, 1.05],
];

/** Meta audience: age shares and the women / men split. */
export const DEMO_AGE_SHARES: Array<[string, number]> = [
  ["18-24", 0.1], ["25-34", 0.27], ["35-44", 0.29], ["45-54", 0.19], ["55-64", 0.1], ["65+", 0.05],
];
export const DEMO_FEMALE_SHARE = 0.41;

/** Polish regions visits come from (GA4 names), as shares of the Polish traffic. */
export const DEMO_REGION_SHARES: Array<[string, number]> = [
  ["Masovian Voivodeship", 0.23],
  ["Silesian Voivodeship", 0.14],
  ["Greater Poland Voivodeship", 0.11],
  ["Lesser Poland Voivodeship", 0.1],
  ["Lower Silesian Voivodeship", 0.09],
  ["Pomeranian Voivodeship", 0.07],
];

// ---- news ------------------------------------------------------------------------

export interface DemoNewsDef {
  category: "meta" | "google" | "tiktok" | "ai";
  /** Days before today. */
  ago: number;
  pl: [title: string, summary: string];
  en: [title: string, summary: string];
  sourceName: string;
  sourceUrl: string;
}

/** Industry news for the Newsy page - the season's themes for an electronics shop. */
export const DEMO_NEWS: DemoNewsDef[] = [
  {
    category: "meta",
    ago: 1,
    pl: ["Meta: nowe formaty reklam katalogowych na Black Friday", "Reklamy z katalogu produktów mogą łączyć wideo marki z produktami, które ktoś oglądał, i pokazywać cenę promocyjną. Warto przetestować w remarketingu przed tygodniem promocji."],
    en: ["Meta: new catalogue ad formats for Black Friday", "Catalogue ads can mix brand video with the products someone viewed and show the sale price. Worth testing in remarketing before the sale week."],
    sourceName: "Meta for Business",
    sourceUrl: "https://www.facebook.com/business/news",
  },
  {
    category: "google",
    ago: 1,
    pl: ["Google Ads: Performance Max pokazuje więcej o wyszukiwanych hasłach", "Raporty PMax dostają podział na kanały i grupy haseł. Łatwiej sprawdzić, ile budżetu idzie na markę, a ile na klientów szukających konkretnego sprzętu."],
    en: ["Google Ads: Performance Max shows more about search terms", "PMax reports get channel and search-term-group breakdowns - easier to see how much budget goes to brand searches and how much to people looking for a specific device."],
    sourceName: "Google Ads Blog",
    sourceUrl: "https://blog.google/products/ads-commerce/",
  },
  {
    category: "google",
    ago: 2,
    pl: ["Dostawa, wniesienie i montaż w reklamach produktowych", "Merchant Center pozwala pokazać w reklamie usługi dodatkowe i termin dostawy przed Świętami. Przy dużym AGD to często przesądza o kliknięciu."],
    en: ["Delivery, carry-in and installation in shopping ads", "Merchant Center lets shops show extra services and the delivery date before Christmas in the ad. For large appliances that often decides the click."],
    sourceName: "Search Engine Land",
    sourceUrl: "https://searchengineland.com",
  },
  {
    category: "tiktok",
    ago: 2,
    pl: ["TikTok testuje dłuższe reklamy in-feed", "Nowy format do 60 s ma sprzyjać pokazywaniu produktów w działaniu. Pierwsi testujący raportują dłuższy czas oglądania."],
    en: ["TikTok tests longer in-feed ads", "A new format up to 60s favours showing products in action. Early testers report longer watch time."],
    sourceName: "TikTok Newsroom",
    sourceUrl: "https://newsroom.tiktok.com",
  },
  {
    category: "ai",
    ago: 3,
    pl: ["AI przyspiesza produkcję kreacji na Black Friday", "Kolejna generacja modeli obniża koszt przygotowania wariantów reklam. Dla sklepów to szybsze testy przed szczytem sezonu."],
    en: ["AI speeds up Black Friday creative production", "The next generation of models lowers the cost of ad variants - faster tests for shops before the season peaks."],
    sourceName: "The Verge",
    sourceUrl: "https://www.theverge.com/ai-artificial-intelligence",
  },
  {
    category: "google",
    ago: 4,
    pl: ["Black Friday: kliknięcia w RTV i AGD drożeją już od połowy listopada", "Sklepy wcześniej zaczynają promocje, więc konkurencja o te same wyszukiwania rośnie przed samym piątkiem. Warto zawczasu zebrać listy remarketingowe."],
    en: ["Black Friday: electronics clicks get pricier from mid-November", "Shops start their deals earlier, so competition for the same searches grows before the Friday itself. Build remarketing lists in advance."],
    sourceName: "Think with Google",
    sourceUrl: "https://www.thinkwithgoogle.com",
  },
];
