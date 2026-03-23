# GoHighLevel API v2 — Complete Reference for Claude Code / Cowork

> **Last updated:** March 2026
> **Base URL:** `https://services.leadconnectorhq.com`
> **API Version Header:** `Version: 2021-07-28`
> **Auth Header:** `Authorization: Bearer <PIT_TOKEN>`
> **Official Docs:** https://marketplace.gohighlevel.com/docs/

---

## Table of Contents

1. [Authentication & Setup](#1-authentication--setup)
2. [Rate Limits](#2-rate-limits)
3. [MCP Server Configuration](#3-mcp-server-configuration)
4. [Complete API Endpoint Reference by Category](#4-complete-api-endpoint-reference-by-category)
5. [Webhook Events](#5-webhook-events)
6. [What Claude Can Do With This API](#6-what-claude-can-do-with-this-api)
7. [Practical Use Cases for TCG](#7-practical-use-cases-for-tcg)
8. [API Gotchas & Tips](#8-api-gotchas--tips)
9. [Quick-Reference cURL Templates](#9-quick-reference-curl-templates)

---

## 1. Authentication & Setup

### Private Integration Token (PIT)

A PIT is a static OAuth2 access token that does not expire (unlike regular OAuth tokens which expire in 24 hours). It's created inside GHL under **Settings → Private Integrations** at either the Agency or Sub-Account level.

**Key facts:**
- PITs function identically to OAuth2 access tokens in the `Authorization` header
- No token refresh needed — PITs are persistent
- Scopes are selected at creation time and can be edited later without regenerating the token
- Token rotation is recommended every 90 days (7-day overlap window for old/new tokens)
- Once generated, the token cannot be viewed again — copy it immediately
- Available at both Agency level and Sub-Account level
- Agency-level PITs can access agency endpoints AND sub-account data
- Sub-Account PITs are scoped to a single location

### Request Format

All API requests follow this pattern:

```bash
curl -X GET "https://services.leadconnectorhq.com/{endpoint}" \
  -H "Authorization: Bearer pit-XXXXXXXXXXXXX" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json"
```

Required headers on every request:
- `Authorization: Bearer <PIT_TOKEN>`
- `Version: 2021-07-28`
- `Content-Type: application/json` (for POST/PUT requests)

---

## 2. Rate Limits

| Limit Type | Threshold |
|-----------|-----------|
| Burst limit | 100 requests per 10 seconds per app per resource (location or company) |
| Daily limit | 200,000 requests per day per app per resource |

Rate limit tracking headers returned in every response:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

**Best practices:** Implement exponential backoff on 429 responses. Batch related operations where possible. Cache frequently requested data.

---

## 3. MCP Server Configuration

GHL has an **official MCP server** that allows Claude Desktop, Claude Code, Cursor, and other MCP-compatible clients to interact with GHL directly via natural language.

### Claude Desktop Configuration

For Claude Desktop (which requires `npx mcp-remote` bridge since it only supports local/stdio MCP):

```json
{
  "mcpServers": {
    "ghl-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://services.leadconnectorhq.com/mcp/",
        "--header",
        "Authorization: Bearer YOUR_PIT_TOKEN",
        "--header",
        "locationId: YOUR_LOCATION_ID"
      ]
    }
  }
}
```

### Claude Code Configuration

Add to `~/.claude/settings.json` or `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "gohighlevel": {
      "type": "url",
      "url": "https://services.leadconnectorhq.com/mcp/",
      "headers": {
        "Authorization": "Bearer YOUR_PIT_TOKEN",
        "x-location-id": "YOUR_LOCATION_ID"
      }
    }
  }
}
```

### Cursor / Windsurf / Other HTTP MCP Clients

```json
{
  "mcpServers": {
    "ghl-mcp": {
      "url": "https://services.leadconnectorhq.com/mcp/",
      "headers": {
        "Authorization": "Bearer YOUR_PIT_TOKEN",
        "locationId": "YOUR_LOCATION_ID"
      }
    }
  }
}
```

> **Note:** The MCP server is GHL's first-party, hosted solution. No self-hosting needed. Transport protocol is HTTP Streamable. The MCP exposes a growing subset of API tools — currently covering contacts, conversations, calendars, opportunities, payments, and more, with a roadmap to 250+ tools.

---

## 4. Complete API Endpoint Reference by Category

Below is every publicly documented API category, its scopes, and available operations. All endpoints use the base URL `https://services.leadconnectorhq.com`.

---

### 4.1 Contacts

**Scopes:** `contacts.readonly`, `contacts.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/contacts/` | List/search contacts (with query params for filtering) |
| GET | `/contacts/:contactId` | Get single contact |
| GET | `/contacts/business/:businessId` | Get contacts by business |
| POST | `/contacts/` | Create contact |
| PUT | `/contacts/:contactId` | Update contact |
| DELETE | `/contacts/:contactId` | Delete contact |
| POST | `/contacts/:contactId/tags` | Add tags to contact |
| DELETE | `/contacts/:contactId/tags` | Remove tags from contact |
| POST | `/contacts/:contactId/notes` | Create note on contact |
| GET | `/contacts/:contactId/notes` | List notes |
| GET | `/contacts/:contactId/notes/:id` | Get single note |
| PUT | `/contacts/:contactId/notes/:id` | Update note |
| DELETE | `/contacts/:contactId/notes/:id` | Delete note |
| POST | `/contacts/:contactId/tasks` | Create task for contact |
| GET | `/contacts/:contactId/tasks` | List tasks |
| GET | `/contacts/:contactId/tasks/:taskId` | Get single task |
| PUT | `/contacts/:contactId/tasks/:taskId` | Update task |
| PUT | `/contacts/:contactId/tasks/:taskId/completed` | Mark task completed |
| DELETE | `/contacts/:contactId/tasks/:taskId` | Delete task |
| GET | `/contacts/:contactId/appointments` | List contact appointments |
| POST | `/contacts/:contactId/campaigns/:campaignId` | Add contact to campaign |
| DELETE | `/contacts/:contactId/campaigns/:campaignId` | Remove from campaign |
| DELETE | `/contacts/:contactId/campaigns/removeAll` | Remove from all campaigns |
| POST | `/contacts/:contactId/workflow/:workflowId` | Add contact to workflow |
| DELETE | `/contacts/:contactId/workflow/:workflowId` | Remove from workflow |

---

### 4.2 Conversations & Messaging

**Scopes:** `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations/:conversationsId` | Get conversation |
| GET | `/conversations/search` | Search conversations |
| POST | `/conversations/` | Create conversation |
| PUT | `/conversations/:conversationsId` | Update conversation |
| DELETE | `/conversations/:conversationsId` | Delete conversation |
| POST | `/conversations/messages` | **Send message (SMS, email, etc.)** |
| POST | `/conversations/messages/inbound` | Record inbound message |
| POST | `/conversations/messages/upload` | Upload attachment |
| PUT | `/conversations/messages/:messageId/status` | Update message status |
| DELETE | `/conversations/messages/:messageId/schedule` | Cancel scheduled message |
| DELETE | `/conversations/messages/email/:emailMessageId/schedule` | Cancel scheduled email |
| GET | `/conversations/messages/:messageId/locations/:locationId/recording` | Get call recording |
| GET | `/conversations/locations/:locationId/messages/:messageId/transcription` | Get call transcription |
| GET | `/conversations/locations/:locationId/messages/:messageId/transcription/download` | Download transcription |

---

### 4.3 Calendars & Appointments

**Scopes:** `calendars.readonly`, `calendars.write`, `calendars/events.readonly`, `calendars/events.write`, `calendars/groups.readonly`, `calendars/groups.write`, `calendars/resources.readonly`, `calendars/resources.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/calendars/` | List calendars |
| GET | `/calendars/:calendarId` | Get calendar |
| GET | `/calendars/:calendarId/free-slots` | Get available slots |
| POST | `/calendars/` | Create calendar |
| PUT | `/calendars/:calendarId` | Update calendar |
| DELETE | `/calendars/:calendarId` | Delete calendar |
| GET | `/calendars/events` | List events |
| GET | `/calendars/events/appointments/:eventId` | Get appointment |
| POST | `/calendars/events/appointments` | **Create appointment** |
| PUT | `/calendars/events/appointments/:eventId` | Update appointment |
| DELETE | `/calendars/events/:eventId` | Delete event |
| GET | `/calendars/blocked-slots` | List blocked slots |
| POST | `/calendars/events/block-slots` | Block time slots |
| PUT | `/calendars/events/block-slots/:eventId` | Update blocked slot |
| GET | `/calendars/groups` | List calendar groups |
| POST | `/calendars/groups` | Create group |
| PUT | `/calendars/groups/:groupId` | Update group |
| DELETE | `/calendars/groups/:groupId` | Delete group |
| PUT | `/calendars/groups/:groupId/status` | Toggle group status |
| POST | `/calendars/groups/validate-slug` | Validate group slug |
| GET | `/calendars/resources/:resourceType` | List resources (rooms, equipment) |
| GET | `/calendars/resources/:resourceType/:id` | Get resource |
| POST | `/calendars/resources` | Create resource |
| PUT | `/calendars/resources/:resourceType/:id` | Update resource |
| DELETE | `/calendars/resources/:resourceType/:id` | Delete resource |

---

### 4.4 Opportunities (Pipeline/Deals)

**Scopes:** `opportunities.readonly`, `opportunities.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/opportunities/search` | Search opportunities |
| GET | `/opportunities/:id` | Get opportunity |
| GET | `/opportunities/pipelines` | List pipelines and stages |
| POST | `/opportunities` | **Create opportunity** |
| PUT | `/opportunities/:id` | Update opportunity |
| PUT | `/opportunities/:id/status` | Update opportunity status (open/won/lost/abandoned) |
| DELETE | `/opportunities/:id` | Delete opportunity |

---

### 4.5 Campaigns

**Scope:** `campaigns.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/campaigns/` | List campaigns |

> **Note:** Campaign management is read-only via API. Contacts can be added to/removed from campaigns via the Contacts endpoints.

---

### 4.6 Workflows

**Scope:** `workflows.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workflows/` | List workflows |

> **Note:** Workflows are read-only via API. You can add/remove contacts from workflows via the Contacts endpoints. Workflow creation/editing/status toggling is not yet available in the public API (this is a community-requested feature).

---

### 4.7 Sub-Account (Location) Management

**Scopes:** `locations.readonly`, `locations.write`

| Method | Endpoint | Description | Access Level |
|--------|----------|-------------|--------------|
| GET | `/locations/:locationId` | Get location details | Sub-Account or Agency |
| GET | `/locations/search` | Search locations | Agency |
| GET | `/locations/timeZones` | List timezones | Sub-Account |
| POST | `/locations/` | Create sub-account | Agency only |
| PUT | `/locations/:locationId` | Update sub-account | Agency only |
| DELETE | `/locations/:locationId` | Delete sub-account | Agency only |

**Custom Values** (`locations/customValues.readonly`, `locations/customValues.write`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations/:locationId/customValues` | List custom values |
| GET | `/locations/:locationId/customValues/:id` | Get custom value |
| POST | `/locations/:locationId/customValues` | Create custom value |
| PUT | `/locations/:locationId/customValues/:id` | Update custom value |
| DELETE | `/locations/:locationId/customValues/:id` | Delete custom value |

**Custom Fields** (`locations/customFields.readonly`, `locations/customFields.write`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations/:locationId/customFields` | List custom fields |
| GET | `/locations/:locationId/customFields/:id` | Get custom field |
| POST | `/locations/:locationId/customFields` | Create custom field |
| PUT | `/locations/:locationId/customFields/:id` | Update custom field |
| DELETE | `/locations/:locationId/customFields/:id` | Delete custom field |

**Tags** (`locations/tags.readonly`, `locations/tags.write`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations/:locationId/tags` | List tags |
| GET | `/locations/:locationId/tags/:tagId` | Get tag |
| POST | `/locations/:locationId/tags/` | Create tag |
| PUT | `/locations/:locationId/tags/:tagId` | Update tag |
| DELETE | `/locations/:locationId/tags/:tagId` | Delete tag |

**Templates** (`locations/templates.readonly`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations/:locationId/templates` | List templates (SMS/email) |

**Tasks** (`locations/tasks.readonly`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/locations/:locationId/tasks/search` | Search tasks |

---

### 4.8 Custom Fields V2

**Scopes:** `locations/customFields.readonly`, `locations/customFields.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/custom-fields/:id` | Get custom field by ID |
| GET | `/custom-field/object-key/:key` | Get custom fields by object key |

---

### 4.9 Custom Objects

**Scopes:** `objects/schema.readonly`, `objects/schema.write`, `objects/record.readonly`, `objects/record.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/objects/` | List all custom object schemas |
| GET | `/objects/:key` | Get schema by key |
| GET | `/objects/:schemaKey/records/:id` | Get record |
| POST | `/objects/:schemaKey/records` | Create record |
| PUT | `/objects/:schemaKey/records/:id` | Update record |
| DELETE | `/objects/:schemaKey/records/:id` | Delete record |

---

### 4.10 Associations

**Scopes:** `associations.readonly`, `associations.write`, `associations/relation.readonly`, `associations/relation.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/associations/` | List all associations |
| GET | `/associations/:associationId` | Get association |
| GET | `/associations/key/:key_name` | Get by key name |
| GET | `/associations/objectKey/:objectKey` | Get by object key |
| POST | `/associations/` | Create association |
| PUT | `/associations/:associationId` | Update association |
| DELETE | `/associations/:associationId` | Delete association |
| GET | `/associations/relations/:recordId` | Get relations for record |
| POST | `/associations/relations` | Create relation |

---

### 4.11 Businesses

**Scopes:** `businesses.readonly`, `businesses.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/businesses` | List businesses |
| GET | `/businesses/:businessId` | Get business |
| POST | `/businesses` | Create business |
| PUT | `/businesses/:businessId` | Update business |
| DELETE | `/businesses/:businessId` | Delete business |

---

### 4.12 Payments & Transactions

**Scopes:** `payments/orders.readonly`, `payments/orders.write`, `payments/transactions.readonly`, `payments/subscriptions.readonly`, `payments/coupons.readonly`, `payments/coupons.write`, `payments/integration.readonly`, `payments/integration.write`, `payments/custom-provider.readonly`, `payments/custom-provider.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/payments/orders/` | List orders |
| GET | `/payments/orders/:orderId` | Get order |
| GET | `/payments/orders/:orderId/fulfillments` | Get fulfillments |
| POST | `/payments/orders/:orderId/fulfillments` | Create fulfillment |
| GET | `/payments/transactions/` | List transactions |
| GET | `/payments/transactions/:transactionId` | Get transaction |
| GET | `/payments/subscriptions/` | List subscriptions |
| GET | `/payments/subscriptions/:subscriptionId` | Get subscription |
| GET | `/payments/coupon/list` | List coupons |
| GET | `/payments/coupon` | Get coupon |
| POST | `/payments/coupon` | Create coupon |
| PUT | `/payments/coupon` | Update coupon |
| DELETE | `/payments/coupon` | Delete coupon |
| GET | `/payments/integrations/provider/whitelabel` | Get payment integration |
| POST | `/payments/integrations/provider/whitelabel` | Create payment integration |
| GET | `/payments/custom-provider/connect` | Get custom provider status |
| POST | `/payments/custom-provider/provider` | Create custom provider |
| POST | `/payments/custom-provider/connect` | Connect custom provider |
| POST | `/payments/custom-provider/disconnect` | Disconnect |
| PUT | `/payments/custom-provider/capabilities` | Update capabilities |
| DELETE | `/payments/custom-provider/provider` | Delete custom provider |

---

### 4.13 Invoices

**Scopes:** `invoices.readonly`, `invoices.write`, `invoices/schedule.readonly`, `invoices/schedule.write`, `invoices/template.readonly`, `invoices/template.write`, `invoices/estimate.readonly`, `invoices/estimate.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices/` | List invoices |
| GET | `/invoices/:invoiceId` | Get invoice |
| GET | `/invoices/generate-invoice-number` | Generate invoice number |
| POST | `/invoices` | Create invoice |
| PUT | `/invoices/:invoiceId` | Update invoice |
| DELETE | `/invoices/:invoiceId` | Delete invoice |
| POST | `/invoices/:invoiceId/send` | Send invoice |
| POST | `/invoices/:invoiceId/void` | Void invoice |
| POST | `/invoices/:invoiceId/record-payment` | Record payment |
| POST | `/invoices/text2pay` | Send text-to-pay link |
| GET | `/invoices/schedule/` | List schedules |
| GET | `/invoices/schedule/:scheduleId` | Get schedule |
| POST | `/invoices/schedule` | Create schedule |
| PUT | `/invoices/schedule/:scheduleId` | Update schedule |
| DELETE | `/invoices/schedule/:scheduleId` | Delete schedule |
| POST | `/invoices/schedule/:scheduleId/schedule` | Activate schedule |
| POST | `/invoices/schedule/:scheduleId/auto-payment` | Set auto-payment |
| POST | `/invoices/schedule/:scheduleId/cancel` | Cancel schedule |
| GET | `/invoices/template/` | List templates |
| GET | `/invoices/template/:templateId` | Get template |
| POST | `/invoices/template/` | Create template |
| PUT | `/invoices/template/:templateId` | Update template |
| DELETE | `/invoices/template/:templateId` | Delete template |
| GET | `/invoices/estimate/list` | List estimates |
| POST | `/invoices/estimate` | Create estimate |
| PUT | `/invoices/estimate/:estimateId` | Update estimate |
| DELETE | `/invoices/estimate/:estimateId` | Delete estimate |
| POST | `/invoices/estimate/:estimateId/send` | Send estimate |
| POST | `/invoices/estimate/:estimateId/invoice` | Convert estimate to invoice |

---

### 4.14 Products & Prices

**Scopes:** `products.readonly`, `products.write`, `products/prices.readonly`, `products/prices.write`, `products/collection.readonly`, `products/collection.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products/` | List products |
| GET | `/products/:productId` | Get product |
| POST | `/products/` | Create product |
| PUT | `/products/:productId` | Update product |
| DELETE | `/products/:productId` | Delete product |
| POST | `/products/bulk-update` | Bulk update products |
| GET | `/products/:productId/price/` | List prices |
| GET | `/products/:productId/price/:priceId` | Get price |
| POST | `/products/:productId/price/` | Create price |
| PUT | `/products/:productId/price/:priceId` | Update price |
| DELETE | `/products/:productId/price/:priceId` | Delete price |
| GET | `/products/collections` | List collections |
| GET | `/products/collections/:collectionId` | Get collection |
| POST | `/products/collections` | Create collection |
| PUT | `/products/collections/:collectionId` | Update collection |
| DELETE | `/products/collections/:collectionId` | Delete collection |
| GET | `/products/reviews` | List reviews |
| GET | `/products/reviews/count` | Count reviews |
| POST | `/products/reviews/bulk-update` | Bulk update reviews |
| PUT | `/products/reviews/:reviewId` | Update review |
| DELETE | `/products/reviews/:reviewId` | Delete review |
| GET | `/products/store/:storeId/stats` | Get store stats |
| POST | `/products/store/:storeId` | Create product in store |

---

### 4.15 Opportunities Pipelines

Accessed via the opportunities endpoints above. `GET /opportunities/pipelines` returns all pipelines with their stages, which is essential for mapping stage IDs when creating or moving opportunities.

---

### 4.16 Forms & Surveys

**Scopes:** `forms.readonly`, `forms.write`, `surveys.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/forms/` | List forms |
| GET | `/forms/submissions` | Get form submissions |
| POST | `/forms/upload-custom-files` | Upload custom form files |
| GET | `/surveys/` | List surveys |
| GET | `/surveys/submissions` | Get survey submissions |

---

### 4.17 Trigger Links

**Scopes:** `links.readonly`, `links.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/links/` | List trigger links |
| POST | `/links/` | Create trigger link |
| PUT | `/links/:linkId` | Update trigger link |
| DELETE | `/links/:linkId` | Delete trigger link |

---

### 4.18 Media Storage

**Scopes:** `medias.readonly`, `medias.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/medias/files` | List media files |
| POST | `/medias/upload-file` | Upload file |
| DELETE | `/medias/:fileId` | Delete file |

---

### 4.19 Funnels & Websites

**Scopes:** `funnels/redirect.readonly`, `funnels/redirect.write`, `funnels/page.readonly`, `funnels/funnel.readonly`, `funnels/pagecount.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/funnels/funnel/list` | List funnels |
| GET | `/funnels/page` | Get pages |
| GET | `/funnels/page/count` | Get page count |
| GET | `/funnels/lookup/redirect/list` | List redirects |
| POST | `/funnels/lookup/redirect` | Create redirect |
| PATCH | `/funnels/lookup/redirect/:id` | Update redirect |
| DELETE | `/funnels/lookup/redirect/:id` | Delete redirect |

---

### 4.20 Social Media Planner

**Scopes:** `socialplanner/post.readonly`, `socialplanner/post.write`, `socialplanner/account.readonly`, `socialplanner/account.write`, `socialplanner/csv.readonly`, `socialplanner/csv.write`, `socialplanner/category.readonly`, `socialplanner/tag.readonly`, `socialplanner/statistics.readonly`, `socialplanner/oauth.readonly`, `socialplanner/oauth.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/social-media-posting/:locationId/posts/list` | List posts |
| GET | `/social-media-posting/:locationId/posts/:id` | Get post |
| POST | `/social-media-posting/:locationId/posts` | **Create social post** |
| PUT | `/social-media-posting/:locationId/posts/:id` | Update post |
| DELETE | `/social-media-posting/:locationId/posts/:id` | Delete post |
| PATCH | `/social-media-posting/:locationId/posts/:id` | Partial update |
| GET | `/social-media-posting/:locationId/accounts` | List connected accounts |
| DELETE | `/social-media-posting/:locationId/accounts/:id` | Remove account |
| GET | `/social-media-posting/:locationId/categories` | List categories |
| GET | `/social-media-posting/:locationId/tags` | List tags |
| POST | `/social-media-posting/statistics` | Get posting statistics |
| GET/POST | `/social-media-posting/:locationId/csv` | CSV bulk import |
| OAuth endpoints | Various per platform | Connect Facebook, Google, Instagram, LinkedIn, TikTok, Twitter |

---

### 4.21 Email Builder & Scheduling

**Scopes:** `emails/builder.readonly`, `emails/builder.write`, `emails/schedule.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/emails/builder` | Get email templates |
| POST | `/emails/builder` | Create email template |
| POST | `/emails/builder/data` | Create email with data |
| DELETE | `/emails/builder/:locationId/:templateId` | Delete template |
| GET | `/emails/schedule` | Get scheduled emails |

---

### 4.22 Blogs

**Scopes:** `blogs/post.write`, `blogs/post-update.write`, `blogs/check-slug.readonly`, `blogs/category.readonly`, `blogs/author.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/blogs/posts` | Create blog post |
| PUT | `/blogs/posts/:postId` | Update blog post |
| GET | `/blogs/posts/url-slug-exists` | Check slug availability |
| GET | `/blogs/categories` | List categories |
| GET | `/blogs/authors` | List authors |

---

### 4.23 Users

**Scopes:** `users.readonly`, `users.write`

| Method | Endpoint | Description | Access Level |
|--------|----------|-------------|--------------|
| GET | `/users/` | List users | Sub-Account or Agency |
| GET | `/users/:userId` | Get user | Sub-Account or Agency |
| POST | `/users/` | Create user | Sub-Account or Agency |
| PUT | `/users/:userId` | Update user | Sub-Account or Agency |
| DELETE | `/users/:userId` | Delete user | Sub-Account or Agency |

---

### 4.24 Snapshots (Agency Level)

**Scopes:** `snapshots.readonly`, `snapshots.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/snapshots` | List snapshots |
| GET | `/snapshots/snapshot-status/:snapshotId` | Get snapshot status |
| GET | `/snapshots/snapshot-status/:snapshotId/location/:locationId` | Get status per location |
| POST | `/snapshots/share/link` | Generate share link |

---

### 4.25 Companies (Agency Level)

**Scope:** `companies.readonly`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/companies/:companyId` | Get company details |

---

### 4.26 SaaS (Agency Level)

**Scopes:** `saas/location.write`, `saas/location.read`, `saas/company.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations` | List all locations (SaaS) |
| PUT | `/update-saas-subscription/:locationId` | Update SaaS subscription |
| POST | `/enable-saas/:locationId` | Enable SaaS for location |
| POST | `/bulk-disable-saas/:companyId` | Bulk disable SaaS |

---

### 4.27 Courses / Memberships

**Scope:** `courses.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/courses/courses-exporter/public/import` | Import course |

> **Note:** Course API is currently limited. Full CRUD for courses, lessons, categories, and enrollments is a top community request.

---

### 4.28 Documents & Contracts (Proposals)

**Scopes:** `documents_contracts/list.readonly`, `documents_contracts/sendlink.write`, `documents_contracts_templates/list.readonly`, `documents_contracts_templates/sendlink.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/proposals/document` | List documents |
| POST | `/proposals/document/send` | Send document |
| GET | `/proposals/templates` | List templates |
| POST | `/proposals/templates/send` | Send from template |

---

### 4.29 Voice AI

**Scopes:** `voice-ai-dashboard.readonly`, `voice-ai-agents.readonly`, `voice-ai-agents.write`, `voice-ai-agent-goals.readonly`, `voice-ai-agent-goals.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/voice-ai/dashboard/call-logs` | List call logs (with filters) |
| GET | `/voice-ai/dashboard/call-logs/:callId` | Get call details + transcript |
| GET | `/voice-ai/agents` | List agents |
| GET | `/voice-ai/agents/:agentId` | Get agent |
| POST | `/voice-ai/agents` | Create agent |
| PATCH | `/voice-ai/agents/:agentId` | Update agent |
| DELETE | `/voice-ai/agents/:agentId` | Delete agent |
| GET | `/voice-ai/actions/:actionId` | Get agent action/goal |
| POST | `/voice-ai/actions` | Create action |
| PUT | `/voice-ai/actions/:actionId` | Update action |
| DELETE | `/voice-ai/actions/:actionId/agent/:agentId` | Delete action |

---

### 4.30 Conversation AI

**Scopes:** Conversation AI-specific scopes (check docs for latest)

Endpoints for managing AI chatbot agents, their actions, and retrieving generation logs for compliance/analytics. Mirrors the Conversation AI UI programmatically.

---

### 4.31 AI Agent Studio

API access to run agents programmatically, manage agent configurations, and integrate with external workflows.

---

### 4.32 Phone System

**Scopes:** `phonenumbers.read`, `numberpools.read`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/phone-system/numbers/location/:locationId` | List phone numbers |
| GET | `/phone-system/number-pools` | List number pools |

---

### 4.33 Custom Menus (Agency Level)

**Scopes:** `custom-menu-link.readonly`, `custom-menu-link.write`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/custom-menus/` | List custom menus |
| GET | `/custom-menus/:customMenuId` | Get custom menu |
| POST | `/custom-menus/` | Create custom menu |
| PUT | `/custom-menus/:customMenuId` | Update custom menu |
| DELETE | `/custom-menus/:customMenuId` | Delete custom menu |

---

### 4.34 Brand Boards

Endpoints for managing brand assets (colors, fonts, logos) per location.

---

### 4.35 Store (E-commerce)

API for managing store settings, inventory, shipping, and order fulfillment beyond the Payments endpoints.

---

### 4.36 LC Email (Email ISV)

Endpoints for email verification and deliverability management at the ISV (independent software vendor) level.

---

### 4.37 Knowledge Base

API for managing knowledge base content that powers Conversation AI and Voice AI agents.

---

## 5. Webhook Events

GHL supports 50+ webhook events. Below are the major categories and events. Webhooks fire in real-time to your configured endpoint URL.

### Contact Events
- `ContactCreate` — New contact created
- `ContactDelete` — Contact deleted
- `ContactDndUpdate` — DND status changed
- `ContactTagUpdate` — Tags added/removed

### Note Events
- `NoteCreate` — Note added to contact
- `NoteDelete` — Note deleted

### Task Events
- `TaskCreate` — Task created
- `TaskDelete` — Task deleted

### Opportunity Events
- `OpportunityCreate` — New opportunity
- `OpportunityDelete` — Opportunity deleted
- `OpportunityStageUpdate` — Stage changed (pipeline movement)
- `OpportunityStatusUpdate` — Status changed (open/won/lost/abandoned)
- `OpportunityMonetaryValueUpdate` — Deal value changed

### Conversation Events
- `InboundMessage` — Contact sends a message (SMS, email, etc.)
- `OutboundMessage` — Message sent to contact
- `ConversationUnreadWebhook` — Unread conversation
- `ConversationProviderOutboundMessage` — Custom provider outbound

### Calendar Events
- Appointment scheduling and update events

### Campaign Events
- `CampaignStatusUpdate` — Campaign status changed

### Invoice Events
- Invoice lifecycle events (created, sent, paid, voided)

### Location Events
- `LocationCreate` — New sub-account created
- `LocationUpdate` — Sub-account updated

### Voice AI Events
- `VoiceAiCallEnd` — Voice AI call completed (includes transcript)

### Association Events
- `AssociationCreate`, `AssociationUpdate`, `AssociationDelete`
- `RelationCreate`, `RelationDelete`

---

## 6. What Claude Can Do With This API

With a full-scope PIT key configured in Claude Code, Claude Desktop, or Cowork, here's what becomes possible:

### Direct API Calls (Claude Code / Scripts)

Claude can write and execute scripts that call the GHL API directly using `curl`, Python `requests`, Node.js `fetch`, etc. This is the most flexible approach.

**Contact Management:**
- Bulk create/update/delete contacts from CSV/Excel files
- Deduplicate contacts using fuzzy matching then merge via API
- Mass tag/untag contacts based on criteria
- Import leads from UCC filing data with proper field mapping
- Search contacts and export results
- Add contacts to workflows or campaigns programmatically

**Messaging & Outreach:**
- Send individual or batch SMS messages
- Send emails with templates
- Schedule messages for later delivery
- Pull conversation history for a contact
- Get call recordings and transcriptions

**Pipeline & Sales:**
- Create opportunities from lead lists
- Move deals between pipeline stages
- Update deal values and statuses
- Search opportunities by stage, assignee, or date
- Generate pipeline reports and analytics

**Calendar & Scheduling:**
- Check available slots
- Book appointments
- Block time ranges
- List and manage upcoming events

**Data & Reporting:**
- Pull transaction and payment data
- Generate invoice summaries
- Export form/survey submissions
- Get social media posting statistics
- Retrieve Voice AI call logs and transcripts

**CRM Configuration:**
- Create/update custom fields and custom values
- Manage tags
- Create and manage custom objects and associations
- Upload media files

### Via MCP Server (Natural Language)

When the GHL MCP server is connected, Claude can perform many of the above operations through conversational commands without writing code. Examples:

- "Show me all contacts tagged 'MCA-Lead' who haven't been contacted in 30 days"
- "Create an opportunity for John Smith in the New Leads pipeline"
- "Send an SMS to contact ID xyz saying their application is approved"
- "What appointments are scheduled for this week?"
- "List all open opportunities over $50k"
- "Get the last 10 transactions"

### What's NOT Available via API (Current Limitations)

- **Workflow builder** — Cannot create, edit, or toggle workflow status (read-only listing only)
- **Funnel/website builder** — Cannot create or edit pages (can list and manage redirects)
- **Reputation management** — No public API
- **Reporting dashboard** — No direct API (must aggregate from individual endpoints)
- **Trigger links** — Can CRUD but limited compared to UI
- **Conversation AI training** — Limited to agent config, not knowledge base content editing (evolving)
- **Full course CRUD** — Only import; no lesson/enrollment management
- **Phone number provisioning** — Read-only; cannot purchase numbers via API

---

## 7. Practical Use Cases for TCG

Here are specific workflows Claude can automate for the Today Capital Group MCA brokerage operation:

### Lead Pipeline Automation
1. **UCC Lead Import** — Parse scraped UCC filing CSVs, clean data, create contacts with tags (`UCC-Lead`, `State-CA`, date tags), and add to the MCA pipeline
2. **Skip-Trace Enrichment** — After enriching leads via BatchSkipTracing/BatchData, bulk update contact records with phone numbers, emails, and verified data
3. **Auto-Opportunity Creation** — When new contacts are imported, automatically create pipeline opportunities at the correct stage

### Outreach Operations
4. **SMS Campaign Builder** — Generate compliant sub-160-char SMS messages, upload contacts, and send via the conversations/messages endpoint
5. **Follow-Up Sequencing** — Query contacts by last-contacted date, identify stale leads, and trigger follow-up messages or workflow enrollments
6. **Campaign Performance** — Pull conversation data to calculate response rates, delivery rates, and opt-out rates

### Pipeline Analytics
7. **Daily Pipeline Report** — Query all opportunities, group by stage, calculate conversion rates and average deal sizes
8. **Lead Attribution** — Track which marketing-touched leads converted by cross-referencing contact tags with opportunity status changes
9. **Stale Lead Identification** — Find contacts in early pipeline stages with no activity in X days

### CRM Maintenance
10. **Duplicate Detection** — Pull all contacts, run fuzzy matching, flag or merge duplicates
11. **Tag Cleanup** — Audit and standardize tag naming conventions across all contacts
12. **Custom Field Sync** — Keep GHL custom fields in sync with external data sources

---

## 8. API Gotchas & Tips

### Authentication
- PITs are prefixed with `pit-` — if your token doesn't start with this, it may be a legacy API key
- Always include the `Version: 2021-07-28` header — requests without it may fail silently or return unexpected formats
- Agency PITs can access sub-account data by passing `locationId` in the request body or query params
- Sub-Account PITs are automatically scoped to their location

### Pagination
- Most list endpoints support `limit` and `offset` (or `startAfter`/`startAfterId`) parameters
- Default page sizes vary by endpoint (typically 20-100)
- Always check for `meta.total` or `meta.nextPageUrl` in responses

### Common Errors
- `401 Unauthorized` — Token invalid, expired, or missing scope
- `422 Unprocessable Entity` — Required field missing or invalid format (check request body)
- `429 Too Many Requests` — Rate limited; back off and retry
- `400 Bad Request` — Often means the `Version` header is missing

### Contact Search Tips
- The `/contacts/` GET endpoint supports query params: `query`, `email`, `phone`, `locationId`, `startAfterDate`, `limit`
- For complex searches, combine multiple filters
- Phone numbers should include country code (e.g., `+15551234567`)

### Messaging Gotchas
- SMS messages via API still go through your 10DLC registered number
- The `conversations/messages` POST endpoint requires `type` (SMS, Email, etc.), `contactId`, and `message`
- Scheduled messages use ISO 8601 datetime format
- Email sending requires an active email service connected in the sub-account

### Opportunity Pipeline Tips
- Always fetch pipelines first (`GET /opportunities/pipelines`) to get correct `pipelineId` and `pipelineStageId` values
- Moving a deal: `PUT /opportunities/:id` with new `pipelineStageId`
- Status values: `open`, `won`, `lost`, `abandoned`

---

## 9. Quick-Reference cURL Templates

### Get Location Info
```bash
curl -s "https://services.leadconnectorhq.com/locations/YOUR_LOCATION_ID" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" | jq .
```

### Search Contacts
```bash
curl -s "https://services.leadconnectorhq.com/contacts/?locationId=YOUR_LOCATION_ID&query=John&limit=20" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" | jq .
```

### Create Contact
```bash
curl -X POST "https://services.leadconnectorhq.com/contacts/" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "phone": "+15551234567",
    "locationId": "YOUR_LOCATION_ID",
    "tags": ["UCC-Lead", "CA"]
  }'
```

### Send SMS
```bash
curl -X POST "https://services.leadconnectorhq.com/conversations/messages" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SMS",
    "contactId": "CONTACT_ID",
    "message": "Hi Jane, just following up on your funding inquiry. Reply YES for more info."
  }'
```

### Create Opportunity
```bash
curl -X POST "https://services.leadconnectorhq.com/opportunities" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{
    "pipelineId": "PIPELINE_ID",
    "pipelineStageId": "STAGE_ID",
    "contactId": "CONTACT_ID",
    "locationId": "YOUR_LOCATION_ID",
    "name": "Jane Doe - MCA Lead",
    "status": "open",
    "monetaryValue": 50000
  }'
```

### List Pipelines
```bash
curl -s "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=YOUR_LOCATION_ID" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" | jq .
```

### Get Calendar Free Slots
```bash
curl -s "https://services.leadconnectorhq.com/calendars/CALENDAR_ID/free-slots?startDate=2026-03-21&endDate=2026-03-28" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" | jq .
```

### List Workflows
```bash
curl -s "https://services.leadconnectorhq.com/workflows/?locationId=YOUR_LOCATION_ID" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" | jq .
```

### Add Contact to Workflow
```bash
curl -X POST "https://services.leadconnectorhq.com/contacts/CONTACT_ID/workflow/WORKFLOW_ID" \
  -H "Authorization: Bearer YOUR_PIT" \
  -H "Version: 2021-07-28" \
  -H "Content-Type: application/json" \
  -d '{"eventStartTime": "2026-03-22T10:00:00Z"}'
```

---

## Appendix: All Scopes at a Glance

For a PIT with full access, select ALL of the following scopes:

**Core CRM:** `contacts.readonly`, `contacts.write`, `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write`, `opportunities.readonly`, `opportunities.write`

**Calendar:** `calendars.readonly`, `calendars.write`, `calendars/events.readonly`, `calendars/events.write`, `calendars/groups.readonly`, `calendars/groups.write`, `calendars/resources.readonly`, `calendars/resources.write`

**Location/Sub-Account:** `locations.readonly`, `locations.write`, `locations/customValues.readonly`, `locations/customValues.write`, `locations/customFields.readonly`, `locations/customFields.write`, `locations/tags.readonly`, `locations/tags.write`, `locations/templates.readonly`, `locations/tasks.readonly`

**Objects & Associations:** `objects/schema.readonly`, `objects/schema.write`, `objects/record.readonly`, `objects/record.write`, `associations.readonly`, `associations.write`, `associations/relation.readonly`, `associations/relation.write`

**Sales & Payments:** `payments/orders.readonly`, `payments/orders.write`, `payments/transactions.readonly`, `payments/subscriptions.readonly`, `payments/coupons.readonly`, `payments/coupons.write`, `payments/integration.readonly`, `payments/integration.write`, `payments/custom-provider.readonly`, `payments/custom-provider.write`

**Invoices:** `invoices.readonly`, `invoices.write`, `invoices/schedule.readonly`, `invoices/schedule.write`, `invoices/template.readonly`, `invoices/template.write`, `invoices/estimate.readonly`, `invoices/estimate.write`

**Products:** `products.readonly`, `products.write`, `products/prices.readonly`, `products/prices.write`, `products/collection.readonly`, `products/collection.write`

**Marketing & Content:** `campaigns.readonly`, `forms.readonly`, `forms.write`, `surveys.readonly`, `links.readonly`, `links.write`, `medias.readonly`, `medias.write`, `funnels/redirect.readonly`, `funnels/redirect.write`, `funnels/page.readonly`, `funnels/funnel.readonly`, `funnels/pagecount.readonly`

**Social Media:** `socialplanner/post.readonly`, `socialplanner/post.write`, `socialplanner/account.readonly`, `socialplanner/account.write`, `socialplanner/csv.readonly`, `socialplanner/csv.write`, `socialplanner/category.readonly`, `socialplanner/tag.readonly`, `socialplanner/statistics.readonly`, `socialplanner/oauth.readonly`, `socialplanner/oauth.write`

**Email:** `emails/builder.readonly`, `emails/builder.write`, `emails/schedule.readonly`

**Blogs:** `blogs/post.write`, `blogs/post-update.write`, `blogs/check-slug.readonly`, `blogs/category.readonly`, `blogs/author.readonly`

**Users & Admin:** `users.readonly`, `users.write`, `businesses.readonly`, `businesses.write`, `workflows.readonly`

**Agency Level:** `companies.readonly`, `snapshots.readonly`, `snapshots.write`, `oauth.readonly`, `oauth.write`, `saas/location.read`, `saas/location.write`, `saas/company.write`, `custom-menu-link.readonly`, `custom-menu-link.write`

**AI & Voice:** `voice-ai-dashboard.readonly`, `voice-ai-agents.readonly`, `voice-ai-agents.write`, `voice-ai-agent-goals.readonly`, `voice-ai-agent-goals.write`

**Documents:** `documents_contracts/list.readonly`, `documents_contracts/sendlink.write`, `documents_contracts_templates/list.readonly`, `documents_contracts_templates/sendlink.write`

**Marketplace:** `marketplace-installer-details.readonly`, `charges.readonly`, `charges.write`

**Phone:** `phonenumbers.read`, `numberpools.read`

**Courses:** `courses.write`

---

> **Sources:** GoHighLevel Official API Docs (marketplace.gohighlevel.com/docs), GHL MCP Server docs, GHL Support Portal, GHL Developer Community. This document reflects the API as of March 2026. GHL actively adds new endpoints — always check the official docs for the latest.
