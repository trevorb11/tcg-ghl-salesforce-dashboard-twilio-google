// POST /api/leads/upload — Accept a custom lead list (JSON array or CSV text)
// Used by: dashboard CSV upload, Claude Code pushing generated lists

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

interface UploadedLead {
  name?: string;
  businessName?: string;
  business_name?: string;
  phone: string;
  email?: string;
}

function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  if (!digits.startsWith("+")) digits = "+" + digits;
  return digits;
}

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const contentType = req.headers.get("content-type") || "";

  let rawLeads: UploadedLead[] = [];

  if (contentType.includes("text/csv")) {
    // Raw CSV body
    const csvText = await req.text();
    rawLeads = parseCsv(csvText);
  } else {
    // JSON body — either { leads: [...] } or { csv: "..." }
    const body = await req.json();

    if (body.csv) {
      rawLeads = parseCsv(body.csv);
    } else if (Array.isArray(body.leads)) {
      rawLeads = body.leads;
    } else if (Array.isArray(body)) {
      rawLeads = body;
    } else {
      return NextResponse.json(
        { error: "Provide { leads: [...] }, { csv: \"...\" }, or a JSON array" },
        { status: 400 }
      );
    }
  }

  // Validate and normalize
  const leads = [];
  const skipped = [];

  for (let i = 0; i < rawLeads.length; i++) {
    const raw = rawLeads[i];
    const phone = raw.phone?.toString().trim();

    if (!phone) {
      skipped.push({ row: i + 1, reason: "Missing phone number" });
      continue;
    }

    const normalized = normalizePhone(phone);
    if (normalized.length < 11) {
      skipped.push({ row: i + 1, reason: `Invalid phone: ${phone}` });
      continue;
    }

    leads.push({
      id: `upload-${Date.now()}-${i}`,
      name: (raw.name || "Unknown").trim(),
      businessName: (raw.businessName || raw.business_name || "").trim(),
      phone: normalized,
      email: (raw.email || "").trim(),
      pipelineId: "uploaded",
      pipelineStageId: "uploaded",
      stageName: "Uploaded List",
    });
  }

  return NextResponse.json({
    leads,
    count: leads.length,
    skipped,
    skippedCount: skipped.length,
    stage: "uploaded",
  });
}

function parseCsv(csvText: string): UploadedLead[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header row — normalize to lowercase, trim
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  // Map common header variations
  const phoneIdx = headers.findIndex((h) =>
    ["phone", "phone number", "phone_number", "phonenumber", "mobile", "cell"].includes(h)
  );
  const nameIdx = headers.findIndex((h) =>
    ["name", "contact name", "contact_name", "full name", "full_name", "fullname"].includes(h)
  );
  const businessIdx = headers.findIndex((h) =>
    ["business", "business name", "business_name", "businessname", "company", "company name", "company_name"].includes(h)
  );
  const emailIdx = headers.findIndex((h) =>
    ["email", "email address", "email_address"].includes(h)
  );

  if (phoneIdx === -1) return [];

  const leads: UploadedLead[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields with commas)
    const cols = parseCsvLine(line);

    leads.push({
      phone: cols[phoneIdx] || "",
      name: nameIdx >= 0 ? cols[nameIdx] || "" : "",
      businessName: businessIdx >= 0 ? cols[businessIdx] || "" : "",
      email: emailIdx >= 0 ? cols[emailIdx] || "" : "",
    });
  }

  return leads;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}
