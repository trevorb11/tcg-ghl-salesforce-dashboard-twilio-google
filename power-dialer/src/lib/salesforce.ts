// ============================================================
// Salesforce Write-Back — sync call data to SF after each call
// ============================================================
// Uses OAuth refresh tokens for persistent auth. If the access
// token expires (401), it auto-refreshes and retries the request.
// Falls back to static SF_ACCESS_TOKEN env var if no OAuth tokens
// are configured (legacy, will eventually expire).

import { DISPOSITION_LABELS } from "./types";
import { getValidToken, handleTokenExpiry } from "./sf-auth";

async function sfApi(path: string, method: string, body?: unknown): Promise<unknown> {
  const token = await getValidToken();
  if (!token) return null;

  async function doRequest(accessToken: string, instanceUrl: string): Promise<Response> {
    return fetch(`${instanceUrl}/services/data/v59.0${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  let res = await doRequest(token.accessToken, token.instanceUrl);

  // Auto-refresh on 401 (expired token) and retry once
  if (res.status === 401) {
    const refreshed = await handleTokenExpiry();
    if (refreshed) {
      res = await doRequest(refreshed.accessToken, refreshed.instanceUrl);
    } else {
      const errText = await res.text();
      throw new Error(`SF API ${method} ${path}: 401 (token expired, refresh failed) ${errText}`);
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SF API ${method} ${path}: ${res.status} ${errText}`);
  }

  if (res.status === 204) return null; // PATCH returns no body
  return res.json();
}

/**
 * Create a Task (call log) in Salesforce
 */
export async function createCallTask(params: {
  contactId?: string;  // SF Contact ID (WhoId)
  leadId?: string;     // SF Lead ID (WhoId — alternative)
  oppId?: string;      // SF Opportunity ID (WhatId)
  disposition: string;
  duration?: number;
  notes?: string;
  repName?: string;
  leadName?: string;
  businessName?: string;
}): Promise<string | null> {
  // Token check handled by sfApi()

  const dispLabel = DISPOSITION_LABELS[params.disposition] || params.disposition;
  const whoId = params.contactId || params.leadId || undefined;
  const subject = `Call — ${params.leadName || "Unknown"}${params.businessName ? ` (${params.businessName})` : ""}`;

  const description = [
    `Disposition: ${dispLabel}`,
    params.notes ? `Notes: ${params.notes}` : null,
    params.duration ? `Duration: ${Math.floor(params.duration / 60)}m ${params.duration % 60}s` : null,
    params.repName ? `Rep: ${params.repName}` : null,
    `Via: TCG Power Dialer`,
  ].filter(Boolean).join("\n");

  try {
    const result = await sfApi("/sobjects/Task/", "POST", {
      Subject: subject,
      Description: description,
      CallType: "Outbound",
      CallDisposition: dispLabel,
      CallDurationInSeconds: params.duration || 0,
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: new Date().toISOString().split("T")[0],
      ...(whoId ? { WhoId: whoId } : {}),
      ...(params.oppId ? { WhatId: params.oppId } : {}),
    }) as { id: string } | null;

    return result?.id || null;
  } catch (err) {
    console.error("[SF] Task creation failed:", err);
    return null;
  }
}

/**
 * Update a Contact's Call_Disposition__c and Last_Contacted__c
 */
export async function updateContactDisposition(
  sfContactId: string,
  disposition: string,
  callbackDate?: string
): Promise<boolean> {
  if (!sfContactId) return false;

  const dispLabel = DISPOSITION_LABELS[disposition] || disposition;

  try {
    // First get current dial attempts to increment
    let currentAttempts = 0;
    try {
      const current = await sfApi(`/sobjects/Contact/${sfContactId}?fields=Dial_Attempts__c`, "GET") as Record<string, unknown> | null;
      currentAttempts = (current?.Dial_Attempts__c as number) || 0;
    } catch { /* field may not exist yet */ }

    const fields: Record<string, unknown> = {
      Call_Disposition__c: dispLabel,
      Last_Contacted__c: new Date().toISOString().split("T")[0],
      Dial_Attempts__c: currentAttempts + 1,
    };
    if (callbackDate) {
      fields.Follow_Up_Date__c = callbackDate;
    }
    await sfApi(`/sobjects/Contact/${sfContactId}`, "PATCH", fields);
    return true;
  } catch (err) {
    console.error("[SF] Contact update failed:", err);
    return false;
  }
}

/**
 * Update a Lead's Last_Contacted__c and status
 */
export async function updateLeadDisposition(
  sfLeadId: string,
  disposition: string,
  callbackDate?: string
): Promise<boolean> {
  if (!sfLeadId) return false;

  const dispLabel = DISPOSITION_LABELS[disposition] || disposition;

  try {
    // Get current dial attempts to increment
    let currentAttempts = 0;
    try {
      const current = await sfApi(`/sobjects/Lead/${sfLeadId}?fields=Dial_Attempts__c`, "GET") as Record<string, unknown> | null;
      currentAttempts = (current?.Dial_Attempts__c as number) || 0;
    } catch { /* field may not exist yet */ }

    const fields: Record<string, unknown> = {
      Call_Disposition__c: dispLabel,
      Last_Contacted__c: new Date().toISOString().split("T")[0],
      Dial_Attempts__c: currentAttempts + 1,
      Last_Called_Date__c: new Date().toISOString(),
    };
    if (callbackDate) {
      fields.Follow_Up_Date__c = callbackDate;
    }
    await sfApi(`/sobjects/Lead/${sfLeadId}`, "PATCH", fields);
    return true;
  } catch (err) {
    console.error("[SF] Lead update failed:", err);
    return false;
  }
}

/**
 * Full post-call sync to Salesforce
 * Creates a Task and updates the Contact/Lead disposition
 */
/**
 * Update an Opportunity's dial attempts and last called date
 */
export async function updateOppDialAttempts(
  sfOppId: string,
  disposition?: string,
  callbackDate?: string
): Promise<boolean> {
  if (!sfOppId) return false;

  const dispLabel = disposition ? (DISPOSITION_LABELS[disposition] || disposition) : undefined;

  try {
    let currentAttempts = 0;
    try {
      const current = await sfApi(`/sobjects/Opportunity/${sfOppId}?fields=Activity_Counter__c,ContactId`, "GET") as Record<string, unknown> | null;
      currentAttempts = (current?.Activity_Counter__c as number) || 0;

      // First call on this Opp: seed from the Contact's Dial_Attempts__c
      // so the count carries over from the Lead → Contact → Opportunity chain.
      if (!currentAttempts && current?.ContactId) {
        try {
          const contact = await sfApi(`/sobjects/Contact/${current.ContactId}?fields=Dial_Attempts__c`, "GET") as Record<string, unknown> | null;
          currentAttempts = (contact?.Dial_Attempts__c as number) || 0;
        } catch { /* Contact may not have Dial_Attempts__c yet */ }
      }
    } catch { /* field may not exist */ }

    const fields: Record<string, unknown> = {
      Activity_Counter__c: currentAttempts + 1,
      Last_Called_Date__c: new Date().toISOString(),
      Last_Contacted__c: new Date().toISOString().split("T")[0],
    };
    if (dispLabel) {
      fields.Call_Disposition__c = dispLabel;
    }
    if (callbackDate) {
      fields.Follow_Up_Date__c = callbackDate;
    }

    await sfApi(`/sobjects/Opportunity/${sfOppId}`, "PATCH", fields);
    return true;
  } catch (err) {
    console.error("[SF] Opportunity dial update failed:", err);
    return false;
  }
}

export async function syncCallToSalesforce(params: {
  sfContactId?: string;
  sfLeadId?: string;
  sfOpportunityId?: string;
  disposition: string;
  duration?: number;
  notes?: string;
  repName?: string;
  leadName?: string;
  businessName?: string;
  callbackDate?: string;
}): Promise<{ taskId: string | null; contactUpdated: boolean; leadUpdated: boolean; oppUpdated: boolean }> {
  const [taskId, contactUpdated, leadUpdated, oppUpdated] = await Promise.all([
    createCallTask({
      contactId: params.sfContactId,
      leadId: params.sfLeadId,
      oppId: params.sfOpportunityId,
      disposition: params.disposition,
      duration: params.duration,
      notes: params.notes,
      repName: params.repName,
      leadName: params.leadName,
      businessName: params.businessName,
    }),
    params.sfContactId
      ? updateContactDisposition(params.sfContactId, params.disposition, params.callbackDate)
      : Promise.resolve(false),
    params.sfLeadId
      ? updateLeadDisposition(params.sfLeadId, params.disposition, params.callbackDate)
      : Promise.resolve(false),
    params.sfOpportunityId
      ? updateOppDialAttempts(params.sfOpportunityId, params.disposition, params.callbackDate)
      : Promise.resolve(false),
  ]);

  return { taskId, contactUpdated, leadUpdated, oppUpdated };
}

export async function isSalesforceConfigured(): Promise<boolean> {
  const token = await getValidToken();
  return !!token;
}
