// ============================================================
// Local Presence Matching — pick the best caller ID per lead
// ============================================================
//
// Maps the lead's area code to the closest available outbound
// number based on geographic region. Increases answer rates
// by showing a local-ish number on the lead's caller ID.

// Available outbound numbers — add more as you acquire them
const OUTBOUND_NUMBERS: { number: string; areaCode: string; region: string }[] = [
  { number: "+14245508233", areaCode: "424", region: "west" },
  { number: "+12395203499", areaCode: "239", region: "southeast" },
  { number: "+13323166950", areaCode: "332", region: "northeast" },
];

// Map every US area code to a region
// Regions: west, mountain, central, southeast, northeast, midwest
const AREA_CODE_REGIONS: Record<string, string> = {
  // ── West Coast / Pacific ──
  "202": "northeast", "203": "northeast", "205": "southeast", "206": "west",
  "207": "northeast", "208": "west", "209": "west", "210": "central",
  "212": "northeast", "213": "west", "214": "central", "215": "northeast",
  "216": "midwest", "217": "midwest", "218": "midwest", "219": "midwest",
  "220": "midwest", "223": "northeast", "224": "midwest", "225": "southeast",
  "228": "southeast", "229": "southeast", "231": "midwest", "234": "midwest",
  "239": "southeast", "240": "northeast", "248": "midwest", "251": "southeast",
  "252": "southeast", "253": "west", "254": "central", "256": "southeast",
  "260": "midwest", "262": "midwest", "267": "northeast", "269": "midwest",
  "270": "southeast", "272": "northeast", "276": "southeast", "278": "midwest",
  "281": "central", "283": "midwest", "301": "northeast", "302": "northeast",
  "303": "mountain", "304": "southeast", "305": "southeast", "307": "mountain",
  "308": "central", "309": "midwest", "310": "west", "312": "midwest",
  "313": "midwest", "314": "midwest", "315": "northeast", "316": "central",
  "317": "midwest", "318": "southeast", "319": "midwest", "320": "midwest",
  "321": "southeast", "323": "west", "325": "central", "326": "midwest",
  "330": "midwest", "331": "midwest", "332": "northeast", "334": "southeast",
  "336": "southeast", "337": "southeast", "339": "northeast", "340": "southeast",
  "341": "west", "346": "central", "347": "northeast", "351": "northeast",
  "352": "southeast", "360": "west", "361": "central", "364": "southeast",
  "380": "midwest", "385": "mountain", "386": "southeast", "401": "northeast",
  "402": "central", "404": "southeast", "405": "central", "406": "mountain",
  "407": "southeast", "408": "west", "409": "central", "410": "northeast",
  "412": "northeast", "413": "northeast", "414": "midwest", "415": "west",
  "417": "midwest", "419": "midwest", "423": "southeast", "424": "west",
  "425": "west", "430": "central", "432": "central", "434": "southeast",
  "435": "mountain", "440": "midwest", "442": "west", "443": "northeast",
  "445": "northeast", "447": "midwest", "448": "northeast", "458": "west",
  "463": "midwest", "464": "midwest", "469": "central", "470": "southeast",
  "475": "northeast", "478": "southeast", "479": "central", "480": "mountain",
  "484": "northeast", "501": "central", "502": "southeast", "503": "west",
  "504": "southeast", "505": "mountain", "507": "midwest", "508": "northeast",
  "509": "west", "510": "west", "512": "central", "513": "midwest",
  "515": "midwest", "516": "northeast", "517": "midwest", "518": "northeast",
  "520": "mountain", "530": "west", "531": "central", "534": "midwest",
  "539": "central", "540": "southeast", "541": "west", "551": "northeast",
  "559": "west", "561": "southeast", "562": "west", "563": "midwest",
  "564": "west", "567": "midwest", "570": "northeast", "571": "northeast",
  "573": "midwest", "574": "midwest", "575": "mountain", "580": "central",
  "585": "northeast", "586": "midwest", "601": "southeast", "602": "mountain",
  "603": "northeast", "605": "central", "606": "southeast", "607": "northeast",
  "608": "midwest", "609": "northeast", "610": "northeast", "612": "midwest",
  "614": "midwest", "615": "southeast", "616": "midwest", "617": "northeast",
  "618": "midwest", "619": "west", "620": "central", "623": "mountain",
  "626": "west", "628": "west", "629": "southeast", "630": "midwest",
  "631": "northeast", "636": "midwest", "640": "northeast", "641": "midwest",
  "646": "northeast", "650": "west", "651": "midwest", "657": "west",
  "659": "southeast", "660": "midwest", "661": "west", "662": "southeast",
  "667": "northeast", "669": "west", "670": "west", "678": "southeast",
  "680": "northeast", "681": "southeast", "682": "central", "689": "southeast",
  "701": "central", "702": "west", "703": "northeast", "704": "southeast",
  "706": "southeast", "707": "west", "708": "midwest", "712": "midwest",
  "713": "central", "714": "west", "715": "midwest", "716": "northeast",
  "717": "northeast", "718": "northeast", "719": "mountain", "720": "mountain",
  "724": "northeast", "725": "west", "726": "central", "727": "southeast",
  "731": "southeast", "732": "northeast", "734": "midwest", "737": "central",
  "740": "midwest", "743": "southeast", "747": "west", "754": "southeast",
  "757": "southeast", "760": "west", "762": "southeast", "763": "midwest",
  "765": "midwest", "769": "southeast", "770": "southeast", "772": "southeast",
  "773": "midwest", "774": "northeast", "775": "west", "779": "midwest",
  "781": "northeast", "785": "central", "786": "southeast", "787": "southeast",
  "801": "mountain", "802": "northeast", "803": "southeast", "804": "southeast",
  "805": "west", "806": "central", "808": "west", "810": "midwest",
  "812": "midwest", "813": "southeast", "814": "northeast", "815": "midwest",
  "816": "midwest", "817": "central", "818": "west", "828": "southeast",
  "830": "central", "831": "west", "832": "central", "838": "northeast",
  "843": "southeast", "845": "northeast", "847": "midwest", "848": "northeast",
  "850": "southeast", "854": "southeast", "856": "northeast", "857": "northeast",
  "858": "west", "859": "southeast", "860": "northeast", "862": "northeast",
  "863": "southeast", "864": "southeast", "865": "southeast", "870": "central",
  "872": "midwest", "878": "northeast", "901": "southeast", "903": "central",
  "904": "southeast", "906": "midwest", "907": "west", "908": "northeast",
  "909": "west", "910": "southeast", "912": "southeast", "913": "central",
  "914": "northeast", "915": "central", "916": "west", "917": "northeast",
  "918": "central", "919": "southeast", "920": "midwest", "925": "west",
  "928": "mountain", "929": "northeast", "930": "midwest", "931": "southeast",
  "934": "northeast", "936": "central", "937": "midwest", "938": "southeast",
  "940": "central", "941": "southeast", "943": "southeast", "945": "central",
  "947": "midwest", "949": "west", "951": "west", "952": "midwest",
  "954": "southeast", "956": "central", "959": "northeast", "970": "mountain",
  "971": "west", "972": "central", "973": "northeast", "975": "midwest",
  "978": "northeast", "979": "central", "980": "southeast", "984": "southeast",
  "985": "southeast", "986": "mountain", "989": "midwest",
};

// Region priority — which outbound number to prefer per region
// First match wins. If no exact region match, falls back to default.
const REGION_TO_NUMBER: Record<string, string[]> = {
  west:      ["+14245508233", "+13323166950", "+12395203499"],
  mountain:  ["+14245508233", "+13323166950", "+12395203499"],
  central:   ["+12395203499", "+13323166950", "+14245508233"],
  southeast: ["+12395203499", "+13323166950", "+14245508233"],
  northeast: ["+13323166950", "+12395203499", "+14245508233"],
  midwest:   ["+13323166950", "+12395203499", "+14245508233"],
};

const DEFAULT_NUMBER = process.env.SIGNALWIRE_PHONE_NUMBER || "+14245508233";

/**
 * Pick the best outbound caller ID for a lead based on their area code.
 * Returns the phone number string to use as the `from` number.
 */
export function getLocalPresenceNumber(leadPhone: string): string {
  // Extract area code from the lead's phone
  const digits = leadPhone.replace(/\D/g, "");
  let areaCode: string;

  if (digits.length === 11 && digits.startsWith("1")) {
    areaCode = digits.substring(1, 4);
  } else if (digits.length === 10) {
    areaCode = digits.substring(0, 3);
  } else {
    return DEFAULT_NUMBER;
  }

  // Exact area code match — best case
  const exactMatch = OUTBOUND_NUMBERS.find((n) => n.areaCode === areaCode);
  if (exactMatch) return exactMatch.number;

  // Region match
  const region = AREA_CODE_REGIONS[areaCode];
  if (region && REGION_TO_NUMBER[region]) {
    return REGION_TO_NUMBER[region][0];
  }

  return DEFAULT_NUMBER;
}

/**
 * Get all available outbound numbers (for UI display or configuration)
 */
export function getOutboundNumbers() {
  return OUTBOUND_NUMBERS;
}
