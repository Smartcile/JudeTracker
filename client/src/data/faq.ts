// FAQ content mirroring IRD guidance for self-employed PT vehicle claims.
// Source provided as a JSON brief (IRD / Inland Revenue - NZ), kept here as
// static app content; answers are guidance, not tax advice.

export type ClaimStatus = "YES" | "NO" | "CONDITIONAL" | "PARTIAL" | "INFO";

export interface FaqItem {
  id: string;
  question: string;
  summary: string;
  answer: string; // markdown-lite: **bold**, lines starting with "* " bullets
  status: ClaimStatus;
  tags?: string[];
}

export interface ScenarioRow {
  route: string;
  claimable: ClaimStatus;
  reason: string;
}

export interface FaqCategory {
  title: string;
  description: string;
  items: FaqItem[];
  scenarios?: ScenarioRow[];
}

export const FAQ_META = {
  title: "Vehicle & kilometre FAQ",
  jurisdiction: "Inland Revenue Department (IRD) — New Zealand",
  lastUpdated: "2026-09-09",
};

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    title: "General travel rules",
    description: "What qualifies as claimable business travel under IRD guidelines.",
    items: [
      {
        id: "faq-home-to-client",
        question: "Can I claim travel directly from my home to a client?",
        summary: "Yes, if your home is your operational base. No, if commuting to a fixed single gym.",
        answer:
          "**Yes**, provided your home serves as your **business base of operations** (where you do programming, client bookings, invoicing, or store gear) and you are travelling directly to deliver a session.\n\n**No**, if you are simply driving to a gym where you work your standard daily shift. IRD classifies driving from home to a single, regular workplace as private commuting.",
        status: "CONDITIONAL",
        tags: ["home-office", "commuting", "client-visit"],
      },
      {
        id: "faq-client-to-home",
        question: "Can I claim the trip back home after seeing my last client?",
        summary: "Yes, if returning to your home base at the end of sessions without personal detours.",
        answer:
          "**Yes**, returning to your home base at the end of client sessions is considered the return leg of your business travel loop.\n\n**No**, if you finish work and take a significant detour for personal activities (e.g. shopping or social visits) — only direct work travel applies.",
        status: "YES",
        tags: ["return-trip", "home-base"],
      },
      {
        id: "faq-between-clients",
        question: "What about driving between two clients in the same day?",
        summary: "Yes, always 100% claimable.",
        answer: "**Yes, always.** Client-to-client travel during your workday is 100% deductible business travel.",
        status: "YES",
        tags: ["client-to-client", "itinerant"],
      },
    ],
  },
  {
    title: "Quick reference scenarios",
    description: "Common daily PT travel routes and their eligibility.",
    scenarios: [
      { route: "Home Base → Client House / Park", claimable: "YES", reason: "Travel from operational home base to an itinerant client session." },
      { route: "Client A → Client B", claimable: "YES", reason: "Direct travel between separate client sites during your workday." },
      { route: "Client House → Home Base", claimable: "YES", reason: "Completing the business loop back to your base of operations." },
      { route: "Home → Commercial Gym (Regular Shift)", claimable: "NO", reason: "Standard daily commute to a fixed workplace." },
      { route: "Home → Commercial Gym (Bulky Equipment)", claimable: "YES", reason: "Transporting heavy, essential gear (weights, sled, mats) that cannot be stored on site." },
      { route: "Client → Supermarket → Home", claimable: "PARTIAL", reason: "Claimable for direct business distance; the personal errand detour must be excluded." },
      { route: "Home Base → Fitness Equipment Store", claimable: "YES", reason: "Business supply run to purchase work-related equipment or consumables." },
    ],
    items: [],
  },
  {
    title: "Edge cases & exceptions",
    description: "Nuanced travel situations, including staying away from home and hybrid gym roles.",
    items: [
      {
        id: "faq-staying-elsewhere",
        question: "What if I stay somewhere other than home (e.g. partner's house or a bach)?",
        summary: "Only travel starting from your bona fide business base is safely deductible.",
        answer:
          "Travel must originate or terminate at your **actual business base**. If you travel from a temporary personal accommodation, IRD considers that starting point private.\n\n*Best practice:* Only log kilometres equivalent to the trip starting from your registered home base, or omit the trip if it was purely personal lodging travel.",
        status: "CONDITIONAL",
        tags: ["temporary-residence", "travel-base"],
      },
      {
        id: "faq-hybrid-gym-mobile",
        question: "I contract at a gym but also visit private mobile clients. How does that work?",
        summary: "Home to gym is private; gym to mobile client and mobile client to home/gym is business.",
        answer:
          "* **Home → Gym:** Non-claimable (regular commute).\n* **Gym → Off-site Client:** Claimable (business journey).\n* **Off-site Client → Home Base:** Claimable if wrapping up your business workday.",
        status: "CONDITIONAL",
        tags: ["hybrid", "commercial-gym", "mobile-pt"],
      },
    ],
  },
  {
    title: "IRD rates & logbook compliance",
    description: "Logbook requirements and Inland Revenue standard kilometre rates.",
    items: [
      {
        id: "faq-logbook-requirements",
        question: "What information must be recorded for every trip?",
        summary: "Date, origin, destination, business purpose and distance.",
        answer:
          "To satisfy an IRD audit, every entry must include:\n1. Date of trip\n2. Start and end addresses / locations\n3. Distance travelled (in km)\n4. Specific business reason (e.g. *\"1-on-1 session with Client Mark S.\"*)",
        status: "INFO",
        tags: ["audit", "compliance", "logbook"],
      },
      {
        id: "faq-ird-rates-structure",
        question: "How do the IRD Tier 1 and Tier 2 rates work?",
        summary: "Tier 1 covers running + fixed costs up to 14,000 km; Tier 2 covers running costs only thereafter.",
        answer:
          "IRD allows you to claim a set rate per kilometre instead of saving all vehicle receipts:\n* **Tier 1 (first 14,000 km total travel per year):** covers fuel, insurance, rego, WOF and vehicle depreciation.\n* **Tier 2 (over 14,000 km total travel):** covers running costs only (fuel and tyres).",
        status: "INFO",
        tags: ["ird-rates", "tier1", "tier2"],
      },
    ],
  },
];

export const CLAIM_LABELS: Record<ClaimStatus, { text: string; cls: string }> = {
  YES: { text: "Claimable", cls: "ok" },
  NO: { text: "Not claimable", cls: "warn" },
  CONDITIONAL: { text: "Conditional", cls: "warn" },
  PARTIAL: { text: "Partial", cls: "warn" },
  INFO: { text: "Info", cls: "muted" },
};
