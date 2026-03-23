# TCG System Guide — Data Sources, Pipelines & Integration Reference

**Purpose:** This document maps every place data lives in the TCG (Today Capital Group) funding process, how to access it, how to cross-reference between systems, and the rules for keeping everything in sync. Written for future Claude Code instances.

---

## 1. Systems Overview

| System | What It Is | Access Method |
|---|---|---|
| **CapitalLoanConnect Dashboard** | MCA loan application platform — intake forms, underwriting decisions, bank statements, approvals | REST API at `app.todaycapitalgroup.com` with `X-Claude-API-Key` header |
| **Google Sheet ("Approvals 2.0")** | Auto-parsed lender emails — submissions to underwriting, lender responses (approvals/denials), funded deals | Public CSV export from Google Sheets |
| **GoHighLevel (GHL)** | CRM — contacts, opportunities in pipelines, conversation threads | REST API at `services.leadconnectorhq.com` with `Authorization: Bearer` PIT key |
| **SMS Middleware** | Twilio SMS gateway — sends texts, syncs to GHL, enforces opt-outs | REST API via ngrok URL |

---

## 2. Dashboard API (CapitalLoanConnect)

### Authentication
```
Header: X-Claude-API-Key: <CLAUDE_API_KEY env var>
Base URL: https://app.todaycapitalgroup.com
```

### Key Endpoints
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/admin/claude/ping` | Auth test |
| GET | `/api/admin/claude/context` | Full system context, schema, table counts |
| GET | `/api/admin/claude/table/:tableName?limit=50&offset=0` | Read any table |
| POST | `/api/admin/claude/sql` | Read-only SQL: `{ "query": "SELECT ..." }` |
| POST | `/api/admin/claude/mutate` | Write SQL: `{ "sql": "INSERT/UPDATE/DELETE ...", "params": [] }` |
| POST | `/api/admin/claude/upsert/:tableName` | Convenience update: `{ "where": {col: val}, "set": {col: val} }` |

### Key Database Tables

#### `loan_applications` (intake + full applications)
- **Primary ID:** `id` (varchar UUID)
- **Key fields:** `email`, `full_name`, `phone`, `business_name`, `business_type`, `industry`, `monthly_revenue`, `requested_amount`, `credit_score`
- **State tracking:** `current_step` (integer), `is_completed` (boolean), `is_full_application_completed` (boolean)
- **Agent/rep:** `agent_name`, `agent_email`, `agent_ghl_id`
- **GHL link:** `ghl_contact_id`
- **Timestamps:** `created_at`, `updated_at`
- **Note:** `business_name` is sometimes null or formatted differently than Google Sheet names

#### `business_underwriting_decisions` (THE source of truth for deal outcomes)
- **Primary ID:** `id` (varchar UUID)
- **Key fields:** `business_email` (required), `business_name`, `status`, `advance_amount`, `factor_rate`, `total_payback`, `net_after_fees`, `lender`, `term`, `payment_frequency`
- **Status values:** `approved`, `declined`, `funded`, `unqualified`
- **Dates:** `approval_date`, `funded_date`, `created_at`, `updated_at`
- **GHL sync:** `ghl_synced`, `ghl_synced_at`, `ghl_opportunity_id`
- **Rep:** `assigned_rep`, `business_phone`
- **Stacking:** `additional_fundings` (JSONB array), `additional_approvals` (JSONB)
- **Merchant portal:** `merchant_email`, `merchant_password_hash`, `merchant_portal_token`
- **Follow-up:** `follow_up_worthy` (boolean), `follow_up_date`
- **This table is actively updated.** The `lender_approvals` table stopped receiving new entries after Feb 11, 2026.

#### `lender_approvals` (historical individual lender offers — STALE after Feb 11, 2026)
- Individual offer records per lender per deal
- **Status values:** `approved`, `accepted`, `declined`, `denied`, `unknown`
- Has 352 rows but no new entries since 2026-02-11
- Use `business_underwriting_decisions` instead for current data

#### `bank_statement_uploads` (merchant bank statements)
- Linked to loan applications via `loan_application_id` and `email`
- `view_token` = public share link for viewing statements
- `approval_status` = review workflow state

#### `system_settings` (feature flags)
- All 8 trigger flags currently set to `false`:
  - `trigger.app_abandoned`, `trigger.bank_statements_reminder`, `trigger.approval_congratulations`
  - `trigger.approval_stale_reminder`, `trigger.funded_congratulations`
  - `trigger.portal_after_application`, `trigger.portal_after_intake`, `trigger.scheduled_checks`

---

## 3. Google Sheet ("Approvals 2.0")

**Spreadsheet ID:** `1ZzwoAOzk1gpLoAFSZiM0om055kbHF--TZO3O5t_C3sI`

### Tabs

| Tab | GID | Purpose | Key Columns |
|---|---|---|---|
| **Lender Emails** | 0 | Directory of lender submission email addresses | `Lender Emails` |
| **Business Status Summary** | 320044161 | Aggregated per-business view — approval/decline counts per lender | `Business Name`, `Status`, `Approval 1-5`, `Decline 1-3` |
| **Submissions** | 450165067 | Emails sent to/from underwriting — rep submissions + lender submissions | `Date`, `Submitter Name`, `Submitter Email`, `Business Name`, `Subject`, `Sent To` |
| **Links** | 475433845 | Which lenders use offer links vs inline email details | `(lender name)`, `Link (Y/N)` |
| **Funded Deals** | 792873257 | Funded deal details with amounts, rates, commissions | `Business Name`, `Funded Amount`, `Factor Rate`, `Term`, `Commission` |
| **Lender Responses** | 1529633793 | Auto-parsed lender approval/denial emails (1,669+ rows) | `Date`, `Lender Name`, `Business Name`, `Status`, `Funding Amount`, `Factor Rate`, `Email Body` |

### How to Read Tabs
```bash
# CSV export (public, no auth needed)
curl -sL "https://docs.google.com/spreadsheets/d/1ZzwoAOzk1gpLoAFSZiM0om055kbHF--TZO3O5t_C3sI/export?format=csv&gid=<GID>"

# Alternative (handles multiline better for smaller datasets)
curl -sL "https://docs.google.com/spreadsheets/d/1ZzwoAOzk1gpLoAFSZiM0om055kbHF--TZO3O5t_C3sI/gviz/tq?tqx=out:csv&gid=<GID>"
```

**Warning:** The CSV export can mangle multiline email bodies. URLs embedded in email bodies may not parse correctly. For rows with offer links, search the raw CSV content with regex rather than relying on CSV field parsing.

### Submissions Tab — Understanding "Sent To"
- `Sent To = "Internal Review"` → Rep forwarding statements/docs to internal underwriting
- `Sent To = "Lender Submission"` → Underwriting sending deal to lenders
- `Sent To = <specific lender email>` → Underwriting sending to a specific lender
- `Submitter Name = "Underwriting Department"` → Outbound to lenders
- `Submitter Name = <rep name>` → Rep submission (Dillon LeBlanc, Ryan Wilcox, Julius Speck, Kenny Nwobi, Gregory Dergevorkian, etc.)

### Lender Responses Tab — Status Values
- `Approved` — Lender approved the deal (472 as of March 2026)
- `Denied` — Lender declined (690)
- `Unknown` — Parser couldn't determine status (507) — often submission confirmations, newsletters, or ambiguous emails

### Lender Responses — Known Data Quality Issues
1. **Missing amounts/rates on ~18% of approvals** — Lenders that send offers as links (not inline) won't have amounts parsed
2. **Status misclassification is rare** (only 2 of 1,669 found incorrect) — but `Unknown` contains many classifiable entries
3. **Business names often differ from dashboard** — see Section 6 on name matching
4. **The Google Sheet is faster than the dashboard** — it auto-populates from emails, while the dashboard requires human input

---

## 4. GHL (GoHighLevel) CRM

### Authentication
```
Header: Authorization: Bearer <GHL_API_KEY>
Header: Version: 2021-07-28
Header: Content-Type: application/json
Base URL: https://services.leadconnectorhq.com
Location ID: n778xwOps9t8Q34eRPfM
```

### Pipelines and Stages

#### 0. Marketing Leads (`2ZuG0JXXga3RlZ7KvWmZ`)
| Stage | ID | Use |
|---|---|---|
| Intake Form Submitted | `a2d67bc8-9106-4447-ae82-b8f825b54ce3` | Lead filled out initial interest form |
| Application Started | `86b428b0-f782-44e3-a93e-186c5033e1c0` | Merchant started the application |
| Application Submitted | `18208225-029d-4eb6-9a80-0e67dcb3e221` | Full application completed |
| Statements Submitted | `60378850-7811-4b3d-8826-63c74de95c4c` | Bank statements uploaded |

#### 1. App Sent (`pjjgB0kC9vAkneufgt9g`)
| Stage | ID | Use |
|---|---|---|
| New Opportunity | `2a213c3f-01f9-46c6-9193-f38e1c2307da` | New deal, not yet worked |
| Waiting for App / Statements | `eb3cc53b-1b7b-47d7-9353-7a69ffff78e5` | **New application from dashboard → create opp HERE** |
| 2nd Attempt | `29c565c5-8c05-4b90-869f-540fb24f2f0c` | Follow-up attempt |

#### 2. App Sent (Cold) (`bNRbE4dCbSxmpPQ4W0gu`)
| Stage | ID | Use |
|---|---|---|
| Missing In Action | `7147307c-260c-42c9-a6b0-ce19341ee225` | Contact went dark |
| No Use At The Moment | `ed8bf405-28bf-4e5d-8280-8e930129ff76` | Not interested right now |
| Unrealistic | `81ed3074-3843-401d-a8c3-26ce829f6993` | **Dashboard: unqualified → move HERE** |
| Low Revenue | `f549f6de-9bbd-4513-8647-30b4a30de344` | Revenue too low |

#### 3. Underwriting (`AWNQpZ8HuhqxAvoBlRQQ`)
| Stage | ID | Use |
|---|---|---|
| Submitted to Underwriting | `738d96bb-4b4d-4c33-9b20-3c53a2c35809` | **Google Sheet Submissions tab → move HERE** |
| Sent to Lenders | `7e7f3b9c-9b59-4715-91af-220eb8cc776e` | Underwriting sent to lenders |
| Requested More Information | `dfb7a5cf-f047-4f9a-bb3c-a9ecb9986cdd` | Lender needs more info |
| Approved | `3fa7ca03-e0a7-4049-8874-1d563a3b3820` | **Dashboard: approved → move HERE** |

#### 4. Pipeline (`jLsHCKE4gswjkxLu4EsV`)
| Stage | ID | Use |
|---|---|---|
| Approved - Moving Forward | `3b2c89c9-05b2-4b60-bec2-d52572507acf` | Merchant accepted approval |
| Contracts Requested / Sent | `395500e0-7496-4c75-94ea-cec2b39200e4` | Contract stage |
| Contracts Signed | `dfee3d1b-603a-46cd-9581-b230454a40f4` | Contracts signed |
| Additional Stips Needed | `16ea8e0f-445f-4636-a11d-9f74200532cc` | More documents needed |
| Final Underwriting / BV | `05c75c10-834f-43f2-b1a5-433446dd4217` | Final review |
| Funded | `c4d7ea46-8450-4c5b-a5b0-d1cdc55e6665` | **Dashboard: funded → move HERE** |
| Renewal Prospecting | `93dd89cd-06d8-4ae5-83f3-63ed15f51396` | Post-funding renewal outreach |

#### 5. Pipeline (Cold) (`cn5qN7tb99iFRAilrSnH`)
| Stage | ID | Use |
|---|---|---|
| Default | `1238d14d-beb0-4e7c-8353-d66d09b133e4` | General cold |
| Unrealistic | `02b16dfa-25cd-40cb-90fa-4951e9e93292` | Unrealistic expectations |
| Funded Elsewhere | `ec5e14a4-87b6-4cdb-918d-6e51e2f837c2` | Got funding elsewhere |
| Killed In Final / Dead Deal | `37e8137c-94c4-4012-a88b-61c670793148` | Deal died in final stages |
| Unqualified | `59f004a6-4c64-4e24-bddc-2a05467c1276` | Doesn't qualify |
| Balances Too High | `97a185b5-980a-4f32-b021-a3d00b909d9a` | Existing balance too high |
| Declined | `9407450b-7362-4772-abaf-911bea5aa291` | **Dashboard: declined → move HERE** |

#### SBA - 7a Pipeline (`TevIlkMAZ9lraqVarYgm`)
Separate pipeline for SBA loans — stages: Referral In → Prequalified → Underwriting → Credit Committee → Closing Documents → Funded

#### Graveyard (`76zHAUBmcyJlVdH0g6bQ`)
Dead contacts: Disconnected #, Wrong Lead, Do Not Contact, Closed Business

#### Hold (`RP9Z9EMA3UHNRGbrQEiU`)
Temporary hold: Hold, Follow Up Date Has Hit

### GHL API — Searching for Contacts
```bash
curl -s -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" -H "Content-Type: application/json" \
  "https://services.leadconnectorhq.com/contacts/search" \
  -d '{"locationId": "n778xwOps9t8Q34eRPfM", "query": "business name or contact name", "pageLimit": 10}'
```

### GHL API — Searching for Opportunities
```bash
# Search by query text
curl -s -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/opportunities/search?location_id=n778xwOps9t8Q34eRPfM&q=business+name&limit=10"

# Search by contact ID
curl -s -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/opportunities/search?location_id=n778xwOps9t8Q34eRPfM&contact_id=<CONTACT_ID>"
```

### GHL API — Creating an Opportunity
```bash
curl -s -X POST -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" -H "Content-Type: application/json" \
  "https://services.leadconnectorhq.com/opportunities/" \
  -d '{
    "pipelineId": "<PIPELINE_ID>",
    "pipelineStageId": "<STAGE_ID>",
    "locationId": "n778xwOps9t8Q34eRPfM",
    "contactId": "<CONTACT_ID>",
    "name": "Business Name",
    "status": "open",
    "monetaryValue": 50000
  }'
```
**Note:** `POST /opportunities/` requires a trailing slash (404 without it).

### GHL API — Moving an Opportunity Between Stages
```bash
curl -s -X PUT -H "Authorization: Bearer <GHL_API_KEY>" \
  -H "Version: 2021-07-28" -H "Content-Type: application/json" \
  "https://services.leadconnectorhq.com/opportunities/<OPP_ID>" \
  -d '{
    "pipelineId": "<NEW_PIPELINE_ID>",
    "pipelineStageId": "<NEW_STAGE_ID>"
  }'
```

---

## 5. The Funding Flow — Where Data Lives at Each Stage

```
Stage                          Dashboard Table                    Google Sheet Tab           GHL Pipeline → Stage
─────                          ───────────────                    ────────────────           ─────────────────────
1. Intake form submitted       loan_applications (new row)        —                          0. Marketing → Intake Form Submitted
2. Application completed       loan_applications.is_completed     —                          1. App Sent → Waiting for App/Statements
3. Bank statements uploaded    bank_statement_uploads (new row)   —                          (same)
4. Rep submits to UW           —                                  Submissions (Sent To=Internal) 3. Underwriting → Submitted to Underwriting
5. UW sends to lenders         —                                  Submissions (Sent To=lender)   3. Underwriting → Sent to Lenders
6. Lender responds             —                                  Lender Responses (auto)        (no move yet)
7a. Approved                   underwriting_decisions (approved)   Lender Responses (Approved)    3. Underwriting → Approved
7b. Declined                   underwriting_decisions (declined)   Lender Responses (Denied)      5. Pipeline Cold → Declined
7c. Unqualified                underwriting_decisions (unqualified) —                             2. App Sent Cold → Unrealistic
8. Contracts / stips           —                                  —                              4. Pipeline → Contracts stages
9. Funded                      underwriting_decisions (funded)     Funded Deals tab               4. Pipeline → Funded
```

### Data Source Priority (source of truth)
1. **Dashboard (`business_underwriting_decisions`)** — most accurate for approvals, declines, funded status. Human-verified.
2. **Google Sheet** — fastest for detecting new lender responses (auto-populated from email). Use for timing, not accuracy.
3. **GHL** — CRM state, contact details, pipeline position. Should reflect dashboard, not the other way around.

---

## 6. Business Name Matching — CRITICAL

Business names are formatted differently across systems. You MUST normalize before comparing.

### Known Formatting Differences
| Google Sheet | Dashboard | Issue |
|---|---|---|
| `V.V.D LLC` | `VVD LLC` | Periods stripped |
| `CUT N CURL OF WHITTIER INC` | `Cutncurlof Whittier inc` | Spaces collapsed, casing |
| `W & W HOLDINGS INC` | `W&W Holdings Inc` | Ampersand spacing |
| `CASSREN HOLDINGS LLC dba STEVE'S AUTOMOTIVE` | (might be under DBA name) | DBA vs legal name |

### Normalization Algorithm
```python
import re

def normalize_business_name(name):
    if not name:
        return ""
    name = name.lower().strip()
    name = re.sub(r'[.\-\'",]', '', name)           # Remove punctuation
    name = name.replace('&', ' and ')                 # Normalize ampersand
    name = re.sub(r'\b(llc|inc|corp|ltd|co|dba|the|of)\b', '', name)  # Remove suffixes
    name = re.sub(r'\s+', ' ', name).strip()          # Collapse whitespace
    return name
```

### Matching Strategy
1. **Exact match** on normalized names
2. **Containment check** — if one normalized name contains the other
3. **Word overlap** — if 2+ significant words match between names
4. **DBA check** — split on "dba" and check both parts
5. **Email domain match** — as fallback, compare `business_email` domains

### Checking if an Approval Exists on Dashboard
```sql
-- Always search multiple ways
SELECT * FROM business_underwriting_decisions
WHERE LOWER(business_name) LIKE '%keyword%'
   OR LOWER(business_email) LIKE '%keyword%';

-- Also check loan_applications for the email
SELECT * FROM loan_applications
WHERE LOWER(business_name) LIKE '%keyword%'
   OR LOWER(email) LIKE '%keyword%'
   OR LOWER(full_name) LIKE '%keyword%';
```

---

## 7. Lender Offer Links — Scraping with Playwright

Some lenders send approval details as links to their portal rather than inline in the email. The Google Sheet `Links` tab (gid=475433845) tracks which lenders use links.

### Lenders with Scrapable Offer Portals

| Lender | Portal Domain | Link Expiry | Auth Required | How to Access |
|---|---|---|---|---|
| **VitalCap Fund** | `vitalcapfund.lendtech.io` | 14 days | No | Direct link from email, wait 5s for JS render |
| **Vox Funding** | `synq.voxfunding.com` | Never (shows "Expired" label but data persists) | No | Direct link, wait 5s |
| **Revenued** | `offers.revenued.com` | Unknown | No | Direct link, multiple offer options per page |
| **Super Fast Cap** | `dashboard.superfastcap.com` | Unknown | No (link includes auth token) | Follow redirect from email tracking link → `/select-offer` page |

### How to Find Offer Links in Google Sheet Data
The CSV export mangles multiline email bodies. Search the raw file content:
```python
import re
with open("lender_responses.csv", "r", encoding="utf-8", errors="replace") as f:
    content = f.read()
urls = re.findall(r'https?://[^\s<>"\')\],]+', content)
# Filter for offer-portal domains
offer_urls = [u for u in urls if any(d in u.lower() for d in [
    "lendtech", "lendsaas", "offers.revenued", "synq.voxfunding", "superfastcap"
])]
```

### Scraping Offer Details with Playwright
```python
# Navigate and wait for JS to render
browser_navigate(url)
browser_wait_for(time=5)
browser_snapshot()  # Read the accessibility tree for structured data
```

### Data Fields Available from Offer Portals

**VitalCap (lendtech.io):**
Merchant, Max Advance, Term, APR, Total Payback, Weekly/Daily Payment, Buy Rate, Sell Rate, Upfront Fees, Net Advance, Referral Fee, Position, Outstanding Stips

**Vox Funding (synq.voxfunding.com):**
Term (weeks), Frequency, Commission %, Origination %, Amount (slider), Disbursement, Buy Rate, Factor Rate, Payback, # Payments, Payment amount

**Revenued (offers.revenued.com):**
Multiple options with: Available Spending Limit, Estimated Payback Period, Estimated Weekly Payment, Specified Percentage

**Super Fast Cap (dashboard.superfastcap.com):**
Product type, Advance amount, Buy Rate, Sell Rate, Total Fees, Fees %, Commission, Net Funded, Total Payback, # Payments, Frequency, Payment amount, Required Stips

---

## 8. SMS Middleware

### Access
```
Base URL: https://specificatively-hygrophytic-jermaine.ngrok-free.dev
All endpoints prefixed with /sms/ through nginx
```

### Sending SMS
```bash
# Single send
curl -X POST "<BASE_URL>/sms/webhooks/ghl/workflow-trigger" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1XXXXXXXXXX", "message": "Your message", "first_name": "Name", "business_name": "Biz"}'

# Bulk (queued, rate-limited at 55/min)
curl -X POST "<BASE_URL>/sms/webhooks/ghl/workflow-trigger-bulk" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1XXXXXXXXXX", "message": "Your message"}'
```

### Checking SMS History
```bash
curl "<BASE_URL>/sms/dashboard/messages?limit=50"
curl "<BASE_URL>/sms/dashboard/stats"
```

---

## 9. Pipeline Sync — Mapping Rules

### When to Create/Move GHL Opportunities

| Trigger | Source | GHL Action | Pipeline | Stage |
|---|---|---|---|---|
| New application | Dashboard: `loan_applications` new row | Create opportunity | 1. App Sent | Waiting for App/Statements |
| Rep submits to UW | Sheet: Submissions, `Sent To = Internal Review` | Move opp | 3. Underwriting | Submitted to Underwriting |
| Sent to lenders | Sheet: Submissions, `Sent To = <lender email>` | Move opp | 3. Underwriting | Sent to Lenders |
| Decision: approved | Dashboard: `underwriting_decisions` status=approved | Move opp | 3. Underwriting | Approved |
| Decision: declined | Dashboard: `underwriting_decisions` status=declined | Move opp | 5. Pipeline (Cold) | Declined |
| Decision: unqualified | Dashboard: `underwriting_decisions` status=unqualified | Move opp | 2. App Sent (Cold) | Unrealistic |
| Decision: funded | Dashboard: `underwriting_decisions` status=funded | Move opp | 4. Pipeline | Funded |

### Rules
1. **Always check if opportunity exists before creating** — search by business name AND contact email/phone
2. **Use normalized business names for matching** (see Section 6)
3. **Dashboard is source of truth** for approvals/declines/funded — Google Sheet is faster but less accurate
4. **When adding approvals from Google Sheet to dashboard, use the Google Sheet date as `approval_date`**
5. **Never move an opportunity backwards** in the pipeline (e.g., don't move from "Approved" back to "Submitted to Underwriting")
6. **Google Sheet Lender Responses status accuracy:** Status classification is ~99.9% accurate (2 misclassifications out of 1,669). However, `Unknown` entries may contain classifiable approvals/denials.
7. **Google Sheet Lender Responses amount accuracy:** ~18% of approved rows are missing funding amounts because lenders sent offer links instead of inline details.

---

## 10. Environment Variables & API Keys

| Variable | Purpose | Where Used |
|---|---|---|
| `CLAUDE_API_KEY` | Dashboard admin API auth | Dashboard REST endpoints |
| `MCP_API_KEY` | MCP server auth | MCP SSE connection |
| `ANTHROPIC_API_KEY` | Claude API for reviewer script | `claude_reviewer.py` |
| `GHL_API_KEY` | GoHighLevel PIT key | GHL REST API |
| `GHL_LOCATION_ID` | GHL location | `n778xwOps9t8Q34eRPfM` |
| `TWILIO_ACCOUNT_SID` | Twilio account | SMS Middleware |
| `TWILIO_AUTH_TOKEN` | Twilio auth | SMS Middleware |
| `TWILIO_PHONE_NUMBER` | Twilio SMS number | SMS Middleware |

---

## 11. Common Gotchas

1. **GHL `POST /opportunities/` needs trailing slash** — 404 without it
2. **GHL contact search uses `query` param, opp search uses `q` param** — different endpoints, different param names
3. **GHL contact search requires `pageLimit` (camelCase)** not `limit`
4. **Dashboard `business_underwriting_decisions.business_email` is required** (NOT NULL) — always find the email before inserting
5. **Google Sheet CSV export truncates/mangles multiline email bodies** — search raw file content for URLs
6. **VitalCap offer links expire after 14 days** — scrape them promptly
7. **Vox offer links show "Expired" but data is still readable** — safe to scrape anytime
8. **SFC links include auth tokens that redirect through tracking URLs** — follow the full redirect chain
9. **The `lender_approvals` table is stale (last entry Feb 11, 2026)** — use `business_underwriting_decisions` for current data
10. **Business names on loan_applications can be null** even when the deal is real — check email domain as fallback
