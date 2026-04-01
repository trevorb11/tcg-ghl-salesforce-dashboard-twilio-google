const pg = require("pg");
const client = new pg.Client({ connectionString: "postgresql://neondb_owner:npg_JxPwVhbg3v0E@ep-green-recipe-a5iqinrz.us-east-2.aws.neon.tech/neondb?sslmode=require" });

async function main() {
  await client.connect();

  await client.query("ALTER TABLE dialer_contacts ADD COLUMN IF NOT EXISTS revenue_numeric INTEGER");

  // Get all records with revenue text
  const rows = await client.query("SELECT id, monthly_revenue FROM dialer_contacts WHERE monthly_revenue IS NOT NULL AND monthly_revenue != '' AND revenue_numeric IS NULL");
  console.log("Records to parse:", rows.rowCount);

  let parsed = 0, failed = 0;

  for (const row of rows.rows) {
    const raw = row.monthly_revenue.trim();
    let num = null;

    try {
      // Remove $ and commas
      let clean = raw.replace(/[$,]/g, "").trim();

      // Handle "35k", "35K", "$35k"
      if (/^\d+\.?\d*[kK]$/i.test(clean)) {
        num = Math.round(parseFloat(clean.replace(/[kK]/, "")) * 1000);
      }
      // Handle "35k+", "$35k+"
      else if (/^\d+\.?\d*[kK]\+?$/i.test(clean.replace("+", ""))) {
        num = Math.round(parseFloat(clean.replace(/[kK+]/g, "")) * 1000);
      }
      // Handle pure numbers: "35000", "35000.50"
      else if (/^\d+\.?\d*$/.test(clean)) {
        num = Math.round(parseFloat(clean));
      }
      // Handle ranges: "10k-30k", "$25,000 - $50,000", "50-55k"
      else if (clean.includes("-")) {
        const parts = clean.split("-").map(p => p.trim().replace(/[$,kK]/g, ""));
        const first = parseFloat(parts[0]);
        if (!isNaN(first)) {
          // If original had 'k', multiply
          if (/k/i.test(raw)) {
            num = Math.round(first * 1000);
          } else {
            num = Math.round(first);
          }
        }
      }
    } catch {}

    if (num && num > 0 && num < 100000000) {
      await client.query("UPDATE dialer_contacts SET revenue_numeric = $1 WHERE id = $2", [num, row.id]);
      parsed++;
    } else {
      failed++;
    }
  }

  console.log(`Parsed: ${parsed}, Failed: ${failed}`);

  await client.query("CREATE INDEX IF NOT EXISTS idx_dc_revenue ON dialer_contacts(revenue_numeric)");

  const stats = await client.query("SELECT COUNT(*) as total, COUNT(revenue_numeric) as with_rev, MIN(revenue_numeric) as min, MAX(revenue_numeric) as max, AVG(revenue_numeric)::int as avg FROM dialer_contacts WHERE revenue_numeric IS NOT NULL");
  console.log("Stats:", stats.rows[0]);

  await client.end();
}

main().catch(e => console.error(e.message));
