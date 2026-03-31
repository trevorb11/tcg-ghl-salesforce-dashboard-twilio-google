// ============================================================
// Natural Language Query Parser for Lead Search
// ============================================================
// Converts rep-speak into structured LeadFilter objects.
// No AI API call — just pattern matching and synonym maps.

import type { LeadFilter } from "./db";

// State name → code mapping
const STATE_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
  // Common abbreviations/nicknames
  cali: "CA", ny: "NY", tx: "TX", fl: "FL", nj: "NJ", pa: "PA",
  "socal": "CA", "norcal": "CA", dc: "DC",
};

// Region → states
const REGIONS: Record<string, string> = {
  "west coast": "CA,WA,OR",
  "east coast": "NY,NJ,CT,MA,PA,MD,VA,DC,FL,GA,NC,SC",
  northeast: "NY,NJ,CT,MA,PA,RI,VT,NH,ME,MD,DE,DC",
  southeast: "FL,GA,AL,MS,LA,SC,NC,TN,KY,AR,VA,WV",
  midwest: "OH,MI,IL,IN,WI,MN,IA,MO,KS,NE,SD,ND",
  southwest: "TX,AZ,NM,OK",
  "pacific northwest": "WA,OR",
  tristate: "NY,NJ,CT",
  "new england": "MA,CT,RI,VT,NH,ME",
  south: "FL,GA,AL,MS,LA,SC,NC,TN,KY,AR,TX,OK,VA,WV",
};

// Industry synonyms
const INDUSTRY_MAP: Record<string, string> = {
  construction: "construction", builder: "construction", contractor: "construction", "general contractor": "construction",
  trucking: "trucking", transport: "trucking", logistics: "trucking", freight: "trucking", hauling: "trucking",
  restaurant: "restaurant", food: "restaurant", cafe: "restaurant", diner: "restaurant", eatery: "restaurant",
  "food service": "restaurant", catering: "restaurant",
  healthcare: "healthcare", medical: "healthcare", dental: "healthcare", clinic: "healthcare", doctor: "healthcare",
  auto: "auto", "auto repair": "auto-repair", mechanic: "auto-repair", "body shop": "auto-repair",
  retail: "retail", store: "retail", shop: "retail", ecommerce: "retail", "e-commerce": "retail",
  landscaping: "landscaping", lawn: "landscaping",
  staffing: "staffing", temp: "staffing", recruiting: "staffing",
  plumbing: "plumbing", plumber: "plumbing",
  hvac: "hvac", "air conditioning": "hvac", heating: "hvac",
  roofing: "roofing", roofer: "roofing",
  electrical: "electrical", electrician: "electrical",
  cleaning: "cleaning", janitorial: "cleaning",
  salon: "salon", barber: "salon", "beauty": "salon",
  manufacturing: "manufacturing",
};

// Disposition synonyms
const DISPOSITION_MAP: Record<string, string> = {
  interested: "Interested", hot: "Interested", warm: "Interested",
  callback: "Callback", "call back": "Callback", "follow up": "Callback",
  "not interested": "Not Interested", cold: "Not Interested", "no interest": "Not Interested",
  "no answer": "No Answer", "didn't answer": "No Answer", "didn't pick up": "No Answer", na: "No Answer",
  voicemail: "Voicemail", vm: "Voicemail",
  "wrong number": "Wrong Number",
  disconnected: "Disconnected", dead: "Disconnected",
};

// Tag synonyms
const TAG_SYNONYMS: Record<string, string> = {
  sba: "sba", "sba interest": "sba", "sba loan": "sba",
  ucc: "ucc", "ucc leads": "ucc", "ucc filed": "ucc",
  "top tier": "top tier prospects", "top prospects": "top tier prospects", "best leads": "top tier prospects",
  "fresh data": "fresh data", "new data": "fresh data", "fresh leads": "fresh data",
  "gov contract": "gov contracts", "government": "gov contracts",
  assigned: "assigned",
};

/**
 * Parse a natural language query into structured LeadFilter
 */
export function parseLeadQuery(query: string, repName?: string): LeadFilter {
  const q = query.toLowerCase().trim();
  const filters: LeadFilter = {};

  // Always scope to rep if provided
  if (repName) filters.assignedTo = repName;

  // Check for regions first (multi-word)
  for (const [region, states] of Object.entries(REGIONS)) {
    if (q.includes(region)) {
      filters.state = states;
      break;
    }
  }

  // Check for state names
  if (!filters.state) {
    for (const [name, code] of Object.entries(STATE_MAP)) {
      if (q.includes(name) || q.split(/\s+/).includes(name)) {
        filters.state = (filters.state ? filters.state + "," : "") + code;
      }
    }
  }

  // Check for industries
  for (const [keyword, industry] of Object.entries(INDUSTRY_MAP)) {
    if (q.includes(keyword)) {
      filters.industry = industry;
      break;
    }
  }

  // Check for dispositions
  for (const [keyword, disposition] of Object.entries(DISPOSITION_MAP)) {
    if (q.includes(keyword)) {
      filters.lastDisposition = disposition;
      break;
    }
  }

  // Check for tags
  const matchedTags: string[] = [];
  for (const [keyword, tag] of Object.entries(TAG_SYNONYMS)) {
    if (q.includes(keyword)) {
      matchedTags.push(tag);
    }
  }
  if (matchedTags.length > 0) filters.tags = matchedTags;

  // Revenue indicators
  if (q.includes("revenue") || q.includes("with rev") || q.includes("has revenue") || q.includes("high revenue")) {
    filters.monthlyRevenueMin = "notempty";
  }

  // Never contacted
  if (q.includes("never called") || q.includes("never contacted") || q.includes("fresh") || q.includes("untouched") || q.includes("virgin")) {
    filters.neverContacted = true;
  }

  // Has approval
  if (q.includes("approval") || q.includes("approved") || q.includes("has approval")) {
    filters.hasApproval = true;
  }

  // Previously funded
  if (q.includes("previously funded") || q.includes("renewal") || q.includes("already funded") || q.includes("past client")) {
    filters.previouslyFunded = "Yes";
  }
  if (q.includes("never funded") || q.includes("first time") || q.includes("new client")) {
    filters.previouslyFunded = "No";
  }

  // SF records
  if (q.includes("salesforce") || q.includes("sf record") || q.includes("in salesforce") || q.includes("has sf")) {
    filters.hasSfRecord = true;
  }

  // SF opp stage
  if (q.includes("underwriting")) filters.sfOppStage = "Underwriting";
  if (q.includes("application") || q.includes("app sent")) filters.sfOppStage = "Application";
  if (q.includes("contracts out") || q.includes("contract")) filters.sfOppStage = "Contracts";

  // Area codes — look for 3-digit numbers
  const areaCodeMatches = q.match(/\b(\d{3})\s*area\s*code|\barea\s*code\s*(\d{3})|\b(\d{3})\s*numbers?\b/);
  if (areaCodeMatches) {
    const ac = areaCodeMatches[1] || areaCodeMatches[2] || areaCodeMatches[3];
    if (ac) filters.areaCodes = [ac];
  }

  // Limit
  const limitMatch = q.match(/(?:top|first|limit)\s*(\d+)/);
  if (limitMatch) {
    filters.limit = Math.min(parseInt(limitMatch[1]), 2000);
  }
  if (!filters.limit) filters.limit = 200;

  return filters;
}

/**
 * Describe what a filter will return (for confirmation to the rep)
 */
export function describeFilter(filters: LeadFilter): string {
  const parts: string[] = [];
  if (filters.assignedTo) parts.push(`assigned to ${filters.assignedTo}`);
  if (filters.industry) parts.push(`in ${filters.industry}`);
  if (filters.state) parts.push(`in ${filters.state}`);
  if (filters.tags?.length) parts.push(`tagged ${filters.tags.join(", ")}`);
  if (filters.lastDisposition) parts.push(`last disposition: ${filters.lastDisposition}`);
  if (filters.neverContacted) parts.push("never contacted");
  if (filters.monthlyRevenueMin) parts.push("with revenue data");
  if (filters.hasApproval) parts.push("with approval on file");
  if (filters.previouslyFunded === "Yes") parts.push("previously funded");
  if (filters.previouslyFunded === "No") parts.push("never funded");
  if (filters.hasSfRecord) parts.push("with Salesforce record");
  if (filters.sfOppStage) parts.push(`SF stage: ${filters.sfOppStage}`);
  if (filters.areaCodes?.length) parts.push(`area code ${filters.areaCodes.join(", ")}`);
  if (parts.length === 0) return "all leads";
  return parts.join(", ");
}
