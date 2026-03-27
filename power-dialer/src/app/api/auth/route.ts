// POST /api/auth — Simple rep login
// Phase 1: Rep provides email + their phone number to start a session.
// We look them up in the rep directory. No passwords yet.

import { NextRequest, NextResponse } from "next/server";
import { REP_DIRECTORY } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { email, phone } = await req.json();

  if (!email || !phone) {
    return NextResponse.json(
      { error: "Email and phone number are required" },
      { status: 400 }
    );
  }

  const rep = REP_DIRECTORY.find(
    (r) => r.email.toLowerCase() === email.toLowerCase()
  );

  if (!rep) {
    return NextResponse.json(
      { error: "Rep not found. Contact your admin." },
      { status: 404 }
    );
  }

  // Normalize phone — ensure +1 prefix
  let normalizedPhone = phone.replace(/\D/g, "");
  if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
  if (!normalizedPhone.startsWith("+")) normalizedPhone = "+" + normalizedPhone;

  return NextResponse.json({
    id: rep.id,
    name: rep.name,
    email: rep.email,
    phone: normalizedPhone,
  });
}
