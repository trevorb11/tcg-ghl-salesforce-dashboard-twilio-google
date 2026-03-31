// Bulk sync: Salesforce → dialer_contacts
// Matches SF Contacts/Leads/Opps to dialer_contacts by GHL ID and phone number
// Populates sf_* columns for SF links and context

const { Client } = require("pg");
const { execSync } = require("child_process");

const DB_URL = "postgresql://neondb_owner:npg_JxPwVhbg3v0E@ep-green-recipe-a5iqinrz.us-east-2.aws.neon.tech/neondb?sslmode=require";
const SF_ORG = "tcg-sandbox";

function sfQuery(soql) {
  // Collapse to single line — sf CLI doesn't handle multiline well
  const cleaned = soql.replace(/\s+/g, " ").trim();
  const result = execSync(
    `sf data query --query "${cleaned.replace(/"/g, '\\"')}" --target-org ${SF_ORG} --json`,
    { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
  );
  const data = JSON.parse(result.toString());
  return (data.result?.records || []).map(r => {
    const clean = {};
    for (const [k, v] of Object.entries(r)) {
      if (k !== "attributes" && v !== null && v !== undefined) {
        if (typeof v === "object" && v.attributes) {
          // Nested relationship — extract Name
          clean[k] = v.Name || v.Id || "";
        } else {
          clean[k] = v;
        }
      }
    }
    return clean;
  });
}

function normalizePhone(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits.length >= 10 ? "+" + digits : "";
}

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log("Connected to DB");

  // ── Step 1: Pull SF Contacts with GHL IDs and phone numbers ──
  console.log("\n=== Syncing SF Contacts ===");
  const contacts = sfQuery(`
    SELECT Id, FirstName, LastName, Phone, MobilePhone, Email, AccountId,
           GHL_Id__c, OwnerId, Last_Contacted__c, Follow_up_Date__c,
           Call_Disposition__c, Engagement_Score__c, Industry__c,
           Funding_Type_Interest__c
    FROM Contact
    WHERE Phone != null OR GHL_Id__c != null
  `);
  console.log(`Fetched ${contacts.length} SF Contacts`);

  let contactMatches = 0;
  for (const c of contacts) {
    const phone = normalizePhone(c.Phone || c.MobilePhone);
    const ghlId = c.GHL_Id__c || "";

    // Match by GHL ID first, then phone
    let matchField, matchValue;
    if (ghlId) {
      matchField = "ghl_contact_id";
      matchValue = ghlId;
    } else if (phone) {
      matchField = "phone";
      matchValue = phone;
    } else continue;

    const result = await client.query(
      `UPDATE dialer_contacts SET
        sf_contact_id = $1,
        sf_account_id = $2,
        sf_owner_name = 'Development TCG',
        sf_last_activity_date = $3,
        sf_follow_up_date = $4,
        sf_engagement_score = $5,
        sf_synced_at = NOW()
      WHERE ${matchField} = $6 AND sf_contact_id IS NULL
      `,
      [c.Id, c.AccountId || null, c.Last_Contacted__c || null,
       c.Follow_up_Date__c || null, c.Engagement_Score__c || null, matchValue]
    );
    if (result.rowCount > 0) contactMatches++;
  }
  console.log(`Matched ${contactMatches} contacts to dialer_contacts`);

  // ── Step 2: Pull SF Leads ──
  console.log("\n=== Syncing SF Leads ===");
  const leads = sfQuery(`
    SELECT Id, FirstName, LastName, Phone, Email, Company, Status,
           Lead_Score__c, Engagement_Score__c, Last_Contacted__c,
           Follow_Up_Date__c, Funding_Type_Interest__c, Amount_Requested__c,
           Monthly_Revenue__c
    FROM Lead
    WHERE Phone != null AND IsConverted = false
  `);
  console.log(`Fetched ${leads.length} SF Leads`);

  let leadMatches = 0;
  for (const l of leads) {
    const phone = normalizePhone(l.Phone);
    if (!phone) continue;

    const result = await client.query(
      `UPDATE dialer_contacts SET
        sf_lead_id = $1,
        sf_lead_status = $2,
        sf_lead_score = $3,
        sf_engagement_score = COALESCE(sf_engagement_score, $4),
        sf_last_activity_date = COALESCE(sf_last_activity_date, $5),
        sf_follow_up_date = COALESCE(sf_follow_up_date, $6),
        sf_funding_type_interest = $7,
        sf_amount_requested = $8,
        sf_synced_at = NOW()
      WHERE phone LIKE $9 AND sf_lead_id IS NULL
      `,
      [l.Id, l.Status || null, l.Lead_Score__c || null,
       l.Engagement_Score__c || null, l.Last_Contacted__c || null,
       l.Follow_Up_Date__c || null, l.Funding_Type_Interest__c || null,
       l.Amount_Requested__c || null, `%${phone.slice(-10)}`]
    );
    if (result.rowCount > 0) leadMatches++;
  }
  console.log(`Matched ${leadMatches} leads to dialer_contacts`);

  // ── Step 3: Pull SF Opportunities and link to contacts ──
  console.log("\n=== Syncing SF Opportunities ===");
  const opps = sfQuery(`
    SELECT Id, Name, StageName, Amount, AccountId, ContactId,
           Contact_Phone__c, Amount_Requested__c, Follow_Up_Date__c,
           OwnerId
    FROM Opportunity
    WHERE StageName != 'Closed Lost'
  `);
  console.log(`Fetched ${opps.length} SF Opportunities`);

  let oppMatches = 0;
  for (const o of opps) {
    // Match by ContactId → sf_contact_id, or by phone
    let updated = false;

    if (o.ContactId) {
      const result = await client.query(
        `UPDATE dialer_contacts SET
          sf_opportunity_id = $1,
          sf_opp_stage = $2,
          sf_opp_amount = $3,
          sf_account_id = COALESCE(sf_account_id, $4),
          sf_follow_up_date = COALESCE(sf_follow_up_date, $5),
          sf_synced_at = NOW()
        WHERE sf_contact_id = $6 AND sf_opportunity_id IS NULL
        `,
        [o.Id, o.StageName || null, o.Amount || null,
         o.AccountId || null, o.Follow_Up_Date__c || null, o.ContactId]
      );
      if (result.rowCount > 0) { oppMatches++; updated = true; }
    }

    // Try phone match if ContactId didn't work
    if (!updated && o.Contact_Phone__c) {
      const phone = normalizePhone(o.Contact_Phone__c);
      if (phone) {
        const result = await client.query(
          `UPDATE dialer_contacts SET
            sf_opportunity_id = $1,
            sf_opp_stage = $2,
            sf_opp_amount = $3,
            sf_account_id = COALESCE(sf_account_id, $4),
            sf_synced_at = NOW()
          WHERE phone LIKE $5 AND sf_opportunity_id IS NULL
          `,
          [o.Id, o.StageName || null, o.Amount || null,
           o.AccountId || null, `%${phone.slice(-10)}`]
        );
        if (result.rowCount > 0) oppMatches++;
      }
    }
  }
  console.log(`Matched ${oppMatches} opportunities to dialer_contacts`);

  // ── Step 4: Pull SF Accounts (non-lender) and link ──
  console.log("\n=== Syncing SF Accounts ===");
  const accounts = sfQuery(`
    SELECT Id, Name, Phone FROM Account
    WHERE (Type != 'Lender' OR Type = null) AND Phone != null
  `);
  console.log(`Fetched ${accounts.length} SF Accounts with phone`);

  let acctMatches = 0;
  for (const a of accounts) {
    const phone = normalizePhone(a.Phone);
    if (!phone) continue;

    const result = await client.query(
      `UPDATE dialer_contacts SET
        sf_account_id = $1,
        sf_synced_at = NOW()
      WHERE phone LIKE $2 AND sf_account_id IS NULL
      `,
      [a.Id, `%${phone.slice(-10)}`]
    );
    if (result.rowCount > 0) acctMatches++;
  }
  console.log(`Matched ${acctMatches} accounts to dialer_contacts`);

  // ── Summary ──
  const stats = await client.query(`
    SELECT
      COUNT(*) as total,
      COUNT(sf_contact_id) as with_sf_contact,
      COUNT(sf_lead_id) as with_sf_lead,
      COUNT(sf_opportunity_id) as with_sf_opp,
      COUNT(sf_account_id) as with_sf_account,
      COUNT(CASE WHEN sf_contact_id IS NOT NULL OR sf_lead_id IS NOT NULL OR sf_opportunity_id IS NOT NULL THEN 1 END) as any_sf_link
    FROM dialer_contacts
  `);
  const s = stats.rows[0];
  console.log(`\n=== SYNC COMPLETE ===`);
  console.log(`Total contacts in DB: ${s.total}`);
  console.log(`With SF Contact ID: ${s.with_sf_contact}`);
  console.log(`With SF Lead ID: ${s.with_sf_lead}`);
  console.log(`With SF Opportunity ID: ${s.with_sf_opp}`);
  console.log(`With SF Account ID: ${s.with_sf_account}`);
  console.log(`Any SF link: ${s.any_sf_link}`);

  await client.end();
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
