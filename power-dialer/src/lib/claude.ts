// ============================================================
// Claude AI Integration — Call analysis, notes, dispositions
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type { Disposition } from "./types";

const anthropic = new Anthropic();
// Uses ANTHROPIC_API_KEY env var automatically

// Analyze a call transcript and generate structured output
export async function analyzeCallTranscript(transcript: string, context: {
  leadName: string;
  businessName: string;
  stageName: string;
  repName: string;
}): Promise<{
  summary: string;
  disposition: Disposition;
  dispositionReason: string;
  keyPoints: string[];
  followUpActions: string[];
  leadSentiment: "positive" | "neutral" | "negative";
  ghlNote: string;
}> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a sales call analyst for Today Capital Group, a merchant cash advance (MCA) company. Analyze this call transcript and provide structured output.

Context:
- Rep: ${context.repName}
- Lead: ${context.leadName}
- Business: ${context.businessName}
- Pipeline Stage: ${context.stageName}

Transcript:
${transcript}

Respond in EXACTLY this JSON format (no markdown, no code fences, just raw JSON):
{
  "summary": "2-3 sentence summary of what happened on the call",
  "disposition": "one of: interested, callback, not_interested, no_answer, voicemail, wrong_number, disconnected",
  "dispositionReason": "brief explanation of why you chose this disposition",
  "keyPoints": ["array of key things discussed or learned"],
  "followUpActions": ["array of next steps the rep should take"],
  "leadSentiment": "positive, neutral, or negative",
  "ghlNote": "A clean, professional CRM note summarizing the call (include date, disposition, key takeaways, and next steps)"
}

Rules for disposition:
- "interested": Lead expressed interest in funding, asked questions about terms, or agreed to next steps
- "callback": Lead asked to be called back at a specific time or said now isn't a good time
- "not_interested": Lead explicitly declined or said they don't need funding
- "voicemail": Call went to voicemail
- "no_answer": Nobody picked up, phone rang out
- "wrong_number": Person who answered is not the lead / wrong business
- "disconnected": Call dropped or number is disconnected`
      }
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      summary: parsed.summary || "Call completed — analysis pending.",
      disposition: parsed.disposition || "no_answer",
      dispositionReason: parsed.dispositionReason || "",
      keyPoints: parsed.keyPoints || [],
      followUpActions: parsed.followUpActions || [],
      leadSentiment: parsed.leadSentiment || "neutral",
      ghlNote: parsed.ghlNote || parsed.summary || "",
    };
  } catch {
    // If Claude's response isn't valid JSON, extract what we can
    return {
      summary: text.slice(0, 500),
      disposition: "no_answer",
      dispositionReason: "Could not parse AI response",
      keyPoints: [],
      followUpActions: [],
      leadSentiment: "neutral",
      ghlNote: text.slice(0, 500),
    };
  }
}

// Generate a daily summary for a rep
export async function generateDailySummary(calls: {
  leadName: string;
  businessName: string;
  disposition: string;
  summary: string;
  keyPoints: string[];
  followUpActions: string[];
  duration?: number;
}[]): Promise<{
  recap: string;
  hotLeads: string[];
  followUpPlan: string[];
  stats: string;
}> {
  if (calls.length === 0) {
    return {
      recap: "No calls made today.",
      hotLeads: [],
      followUpPlan: [],
      stats: "0 calls",
    };
  }

  const callSummaries = calls
    .map((c, i) => `${i + 1}. ${c.leadName} (${c.businessName}) — ${c.disposition}: ${c.summary}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a sales coach for Today Capital Group (MCA company). Generate an end-of-day briefing for a sales rep based on their calls today.

Today's Calls:
${callSummaries}

Respond in EXACTLY this JSON format (no markdown, no code fences, just raw JSON):
{
  "recap": "2-3 paragraph friendly recap of the day — what went well, what to improve, overall tone",
  "hotLeads": ["array of lead names that showed interest and should be prioritized tomorrow"],
  "followUpPlan": ["array of specific follow-up actions for tomorrow, with lead names and what to do"],
  "stats": "one-line stat summary like '12 calls, 3 interested, 2 callbacks, 5 no-answer'"
}`
      }
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    return JSON.parse(text);
  } catch {
    return {
      recap: text.slice(0, 1000),
      hotLeads: [],
      followUpPlan: [],
      stats: `${calls.length} calls made`,
    };
  }
}

// Quick transcript-to-note for when we don't need full analysis
export async function transcriptToNote(transcript: string, leadName: string, businessName: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Write a concise, professional CRM note for this sales call with ${leadName} at ${businessName}. Include key discussion points and any next steps. Keep it under 200 words.

Transcript:
${transcript}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "Call completed.";
}
