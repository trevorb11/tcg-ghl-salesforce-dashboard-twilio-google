// POST /api/salesforce/log-call — Log a call as a Salesforce Task
// Fallback for when Open CTI's saveLog isn't available
// Uses SF REST API with OAuth credentials

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const SF_INSTANCE_URL = process.env.SF_INSTANCE_URL || "https://customization-data-47--dev.sandbox.my.salesforce.com";
const SF_ACCESS_TOKEN = process.env.SF_ACCESS_TOKEN || "";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { phone, contactId, contactType, disposition, duration, notes } = await req.json();

  if (!SF_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Salesforce not configured (missing SF_ACCESS_TOKEN)" }, { status: 500 });
  }

  const dispMap: Record<string, string> = {
    interested: "Interested",
    callback: "Callback Requested",
    not_interested: "Not Interested",
    no_answer: "No Answer",
    voicemail: "Left Voicemail",
    wrong_number: "Wrong Number",
    disconnected: "Disconnected",
  };
  const dispLabel = dispMap[disposition] || disposition;

  const task = {
    Subject: `Outbound Call${contactId ? "" : ` - ${phone}`}`,
    Description: notes || `${dispLabel} via TCG Power Dialer`,
    CallType: "Outbound",
    CallDisposition: dispLabel,
    CallDurationInSeconds: duration || 0,
    Status: "Completed",
    Priority: "Normal",
    ActivityDate: new Date().toISOString().split("T")[0],
    ...(contactId && { WhoId: contactId }),
  };

  try {
    const res = await fetch(`${SF_INSTANCE_URL}/services/data/v59.0/sobjects/Task/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SF_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(task),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[SF] Task creation failed:", errBody);
      return NextResponse.json({ error: `Salesforce error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, taskId: data.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
