// POST /api/auth — Rep login with email + phone + password
// On success, returns rep info + the DIALER_API_KEY so the frontend
// can authenticate subsequent API calls without the rep knowing the key.

import { NextRequest, NextResponse } from "next/server";
import { REP_DIRECTORY } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { email, phone, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
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

  if (password !== rep.password) {
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 }
    );
  }

  // Normalize phone — ensure +1 prefix (phone is optional for WebRTC mode)
  let normalizedPhone = "";
  if (phone) {
    normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
    if (!normalizedPhone.startsWith("+")) normalizedPhone = "+" + normalizedPhone;
  }

  return NextResponse.json({
    id: rep.id,
    name: rep.name,
    email: rep.email,
    phone: normalizedPhone,
    role: rep.role,
    dialerKey: process.env.DIALER_API_KEY || "",
  });
}
