# GHL Pipeline & Stage Reference

Complete mapping of GoHighLevel pipelines and stages used at TCG.

## Table of Contents
1. [Pipeline 0: Marketing Leads](#pipeline-0-marketing-leads)
2. [Pipeline 1: App Sent — Warm](#pipeline-1-app-sent--warm)
3. [Pipeline 2: App Sent — Cold](#pipeline-2-app-sent--cold)
4. [Pipeline 3: Underwriting](#pipeline-3-underwriting)
5. [Pipeline 4: Active Deals](#pipeline-4-active-deals)
6. [Pipeline 5: Cold](#pipeline-5-cold)
7. [Hold Pipeline](#hold-pipeline)
8. [Graveyard Pipeline](#graveyard-pipeline)
9. [GHL API Quick Reference](#ghl-api-quick-reference)

---

## Pipeline 0: Marketing Leads (`2ZuG0JXXga3RlZ7KvWmZ`)

| Stage | ID | Use |
|---|---|---|
| Intake Form Submitted | `a2d67bc8-9106-4447-ae82-b8f825b54ce3` | Lead filled out initial interest form |
| Application Started | `86b428b0-f782-44e3-a93e-186c5033e1c0` | Merchant started the application |
| Application Submitted | `18208225-029d-4eb6-9a80-0e67dcb3e221` | Full application completed |
| Statements Submitted | `60378850-7811-4b3d-8826-63c74de95c4c` | Bank statements uploaded |

## Pipeline 1: App Sent — Warm (`pjjgB0kC9vAkneufgt9g`)

| Stage | ID | Dialer Key |
|---|---|---|
| New Opportunity | `2a213c3f-01f9-46c6-9193-f38e1c2307da` | `new_opportunity` |
| Waiting for App / Statements | `eb3cc53b-1b7b-47d7-9353-7a69ffff78e5` | `waiting_for_app` |
| 2nd Attempt | `29c565c5-8c05-4b90-869f-540fb24f2f0c` | `second_attempt` |

## Pipeline 2: App Sent — Cold (`bNRbE4dCbSxmpPQ4W0gu`)

These are the "absent" leads — people who went dark or aren't ready yet.

| Stage | ID | Dialer Key |
|---|---|---|
| Missing In Action | `7147307c-260c-42c9-a6b0-ce19341ee225` | `missing_in_action` |
| No Use At The Moment | `ed8bf405-28bf-4e5d-8280-8e930129ff76` | `no_use_at_moment` |
| Unrealistic | `81ed3074-3843-401d-a8c3-26ce829f6993` | — |
| Low Revenue | `f549f6de-9bbd-4513-8647-30b4a30de344` | `low_revenue` |

## Pipeline 3: Underwriting (`AWNQpZ8HuhqxAvoBlRQQ`)

| Stage | ID |
|---|---|
| Submitted to Underwriting | `738d96bb-4b4d-4c33-9b20-3c53a2c35809` |
| Sent to Lenders | `7e7f3b9c-9b59-4715-91af-220eb8cc776e` |
| Requested More Information | `dfb7a5cf-f047-4f9a-bb3c-a9ecb9986cdd` |
| Approved | `3fa7ca03-e0a7-4049-8874-1d563a3b3820` |

## Pipeline 4: Active Deals (`jLsHCKE4gswjkxLu4EsV`)

| Stage | ID | Dialer Key |
|---|---|---|
| Approved - Moving Forward | `3b2c89c9-05b2-4b60-bec2-d52572507acf` | `approved_moving` |
| Contracts Requested / Sent | `395500e0-7496-4c75-94ea-cec2b39200e4` | `contracts_sent` |
| Contracts Signed | `dfee3d1b-603a-46cd-9581-b230454a40f4` | — |
| Additional Stips Needed | `16ea8e0f-445f-4636-a11d-9f74200532cc` | — |
| Final Underwriting / BV | `05c75c10-834f-43f2-b1a5-433446dd4217` | — |
| Funded | `c4d7ea46-8450-4c5b-a5b0-d1cdc55e6665` | — |
| Renewal Prospecting | `93dd89cd-06d8-4ae5-83f3-63ed15f51396` | `renewal` |

## Pipeline 5: Cold (`cn5qN7tb99iFRAilrSnH`)

| Stage | ID |
|---|---|
| Default | `1238d14d-beb0-4e7c-8353-d66d09b133e4` |
| Unrealistic | `02b16dfa-25cd-40cb-90fa-4951e9e93292` |
| Funded Elsewhere | `ec5e14a4-87b6-4cdb-918d-6e51e2f837c2` |
| Killed In Final / Dead Deal | `37e8137c-94c4-4012-a88b-61c670793148` |
| Unqualified | `59f004a6-4c64-4e24-bddc-2a05467c1276` |
| Balances Too High | `97a185b5-980a-4f32-b021-a3d00b909d9a` |
| Declined | `9407450b-7362-4772-abaf-911bea5aa291` |

## Hold Pipeline (`RP9Z9EMA3UHNRGbrQEiU`)

| Stage | Dialer Key |
|---|---|
| Hold | `hold` |
| Follow Up Date Has Hit | `follow_up` |

## Graveyard Pipeline (`76zHAUBmcyJlVdH0g6bQ`)

Dead contacts — **NEVER dial these:**
- Disconnected #
- Wrong Lead
- Do Not Contact
- Closed Business

---

## GHL API Quick Reference

**Base URL:** `https://services.leadconnectorhq.com`
**Auth:** `Authorization: Bearer {GHL_API_KEY}` + `Version: 2021-07-28`
**Location ID:** `n778xwOps9t8Q34eRPfM`

### Search contacts
```
POST /contacts/search
Body: { "locationId": "n778xwOps9t8Q34eRPfM", "query": "search term", "pageLimit": 10 }
```
Note: uses `pageLimit` (camelCase), not `limit`.

### Search opportunities
```
GET /opportunities/search?location_id=n778xwOps9t8Q34eRPfM&q=search+term&limit=10
```
Note: uses `q` param (not `query`).

### Get opportunities by contact
```
GET /opportunities/search?location_id=n778xwOps9t8Q34eRPfM&contact_id=CONTACT_ID
```

### Add note to contact
```
POST /contacts/CONTACT_ID/notes
Body: { "body": "note text", "locationId": "n778xwOps9t8Q34eRPfM" }
```

### Create opportunity
```
POST /opportunities/     ← trailing slash required!
Body: { "pipelineId": "...", "pipelineStageId": "...", "locationId": "...", "contactId": "...", "name": "...", "status": "open" }
```

### Move opportunity
```
PUT /opportunities/OPP_ID
Body: { "pipelineId": "NEW_PIPELINE_ID", "pipelineStageId": "NEW_STAGE_ID" }
```

## Common GHL Gotchas

1. `POST /opportunities/` needs a **trailing slash** — 404 without it
2. Contact search uses `query` param, opportunity search uses `q` — different!
3. Contact search uses `pageLimit` (camelCase), not `limit`
4. Rate limit: 100 requests per 10 seconds
