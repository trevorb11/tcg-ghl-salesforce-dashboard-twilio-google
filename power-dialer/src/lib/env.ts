// ============================================================
// Environment variable validation
// ============================================================
// Logs warnings at startup for missing required vars.
// Doesn't crash — allows partial functionality during dev.

export function validateEnv() {
  const carrier = (process.env.VOICE_CARRIER || "twilio").toLowerCase();

  // Base requirements regardless of carrier
  const required: { key: string; label: string }[] = [
    { key: "GHL_API_KEY", label: "GoHighLevel" },
    { key: "NEXT_PUBLIC_APP_URL", label: "App URL (webhooks)" },
  ];

  // Add carrier-specific requirements
  if (carrier === "signalwire") {
    required.push(
      { key: "SIGNALWIRE_PROJECT_ID", label: "SignalWire" },
      { key: "SIGNALWIRE_API_TOKEN", label: "SignalWire" },
      { key: "SIGNALWIRE_PHONE_NUMBER", label: "SignalWire" },
      { key: "SIGNALWIRE_SPACE", label: "SignalWire" },
    );
  } else {
    required.push(
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio" },
      { key: "TWILIO_AUTH_TOKEN", label: "Twilio" },
      { key: "TWILIO_PHONE_NUMBER", label: "Twilio" },
    );
  }

  const optional = [
    { key: "ANTHROPIC_API_KEY", label: "AI call analysis" },
    { key: "DIALER_API_KEY", label: "API auth (disabled if not set)" },
    { key: "GHL_LOCATION_ID", label: "GHL location (has default)" },
  ];

  // If on SignalWire, Twilio creds are optional (used for transcription fallback)
  if (carrier === "signalwire") {
    optional.push(
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio (for transcription fallback)" },
      { key: "TWILIO_AUTH_TOKEN", label: "Twilio (for transcription fallback)" },
    );
  }

  const missing = required.filter((v) => !process.env[v.key]);
  const missingOptional = optional.filter((v) => !process.env[v.key]);

  console.log(`\n📞 Voice carrier: ${carrier.toUpperCase()}\n`);

  if (missing.length > 0) {
    console.warn(
      `\n⚠️  Missing required env vars:\n${missing.map((v) => `   - ${v.key} (${v.label})`).join("\n")}\n`
    );
  }

  if (missingOptional.length > 0) {
    console.log(
      `ℹ️  Optional env vars not set:\n${missingOptional.map((v) => `   - ${v.key} (${v.label})`).join("\n")}\n`
    );
  }

  if (!process.env.DIALER_API_KEY) {
    console.warn(
      "⚠️  DIALER_API_KEY not set — API endpoints are unprotected. Set it in production!\n"
    );
  }

  if (
    process.env.NEXT_PUBLIC_APP_URL === "http://localhost:3000" ||
    !process.env.NEXT_PUBLIC_APP_URL
  ) {
    console.log(
      "ℹ️  NEXT_PUBLIC_APP_URL is localhost — webhooks won't work. Use ngrok for local dev.\n"
    );
  }
}
