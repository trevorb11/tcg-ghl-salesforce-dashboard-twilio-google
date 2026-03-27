// ============================================================
// TCG Power Dialer — MCP Server
// ============================================================
// This exposes the dialer, GHL, and AI features as MCP tools
// so reps can control everything from the Claude app.
//
// Supports two transports:
//   1. SSE — for remote access (Claude on any computer hits the Next.js endpoint)
//   2. Stdio — for local Claude Desktop (launched as a subprocess)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { sessions, REP_DIRECTORY, type DialerSession, type Lead } from "../lib/types";
import { getLeadsByStage, STAGE_MAP, searchContact, addContactNote } from "../lib/ghl";
import { callRepIntoConference, dialLeadIntoConference, endConference } from "../lib/twilio";
import { analyzeCallTranscript, generateDailySummary } from "../lib/claude";

export function createMcpServer() {
  const server = new McpServer({
    name: "tcg-power-dialer",
    version: "1.0.0",
  });

  // ===========================================================
  // TOOL: identify_rep
  // ===========================================================
  server.tool(
    "identify_rep",
    "Identify which sales rep is using this session. Call this first before any dialer operations. Returns rep info if email matches.",
    {
      email: z.string().describe("The rep's TCG email address (e.g. dillon@todaycapitalgroup.com)"),
      phone: z.string().describe("The rep's personal phone number to receive dialer calls"),
    },
    async ({ email, phone }) => {
      const rep = REP_DIRECTORY.find(
        (r) => r.email.toLowerCase() === email.toLowerCase()
      );

      if (!rep) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No rep found with email "${email}". Available reps: ${REP_DIRECTORY.map((r) => r.email).join(", ")}`,
            },
          ],
        };
      }

      let normalizedPhone = phone.replace(/\D/g, "");
      if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
      if (!normalizedPhone.startsWith("+")) normalizedPhone = "+" + normalizedPhone;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              id: rep.id,
              name: rep.name,
              email: rep.email,
              phone: normalizedPhone,
            }),
          },
        ],
      };
    }
  );

  // ===========================================================
  // TOOL: list_stages
  // ===========================================================
  server.tool(
    "list_stages",
    "List all available pipeline stages that can be dialed. Use this to show the rep what lead lists are available.",
    {},
    async () => {
      const stages = Object.entries(STAGE_MAP).map(([key, val]) => ({
        key,
        label: val.label,
        pipelineId: val.pipelineId,
      }));

      const grouped = {
        "Absent / Cold Leads": stages.filter((s) =>
          ["missing_in_action", "no_use_at_moment", "low_revenue"].includes(s.key)
        ),
        "App Sent (Warm)": stages.filter((s) =>
          ["new_opportunity", "waiting_for_app", "second_attempt"].includes(s.key)
        ),
        "Pipeline (Active Deals)": stages.filter((s) =>
          ["approved_moving", "contracts_sent", "renewal"].includes(s.key)
        ),
        "Hold / Follow-Up": stages.filter((s) =>
          ["hold", "follow_up"].includes(s.key)
        ),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(grouped, null, 2),
          },
        ],
      };
    }
  );

  // ===========================================================
  // TOOL: load_leads
  // ===========================================================
  server.tool(
    "load_leads",
    "Load leads from GHL for a specific pipeline stage. Returns contacts with phone numbers ready to dial.",
    {
      stage: z.string().describe("Stage key (e.g. 'missing_in_action', 'new_opportunity', 'approved_moving'). Use list_stages to see all options."),
    },
    async ({ stage }) => {
      if (!STAGE_MAP[stage]) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid stage "${stage}". Valid stages: ${Object.keys(STAGE_MAP).join(", ")}`,
            },
          ],
        };
      }

      try {
        const leads = await getLeadsByStage(stage);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                stage,
                stageLabel: STAGE_MAP[stage].label,
                count: leads.length,
                leads: leads.map((l) => ({
                  id: l.id,
                  name: l.name,
                  businessName: l.businessName,
                  phone: l.phone,
                  email: l.email,
                })),
              }),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: `Error loading leads: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: start_dialer_session
  // ===========================================================
  server.tool(
    "start_dialer_session",
    "Start a power dialer session. This calls the rep's phone and puts them in a conference room, ready to start dialing leads. Returns a session ID needed for all subsequent dialer operations.",
    {
      repId: z.string().describe("Rep's ID from identify_rep"),
      repName: z.string().describe("Rep's name"),
      repPhone: z.string().describe("Rep's phone number (with +1 prefix)"),
      leads: z.string().describe("JSON array of leads from load_leads (pass the leads array as a JSON string)"),
    },
    async ({ repId, repName, repPhone, leads: leadsJson }) => {
      let leads: Lead[];
      try {
        leads = JSON.parse(leadsJson);
      } catch {
        return {
          content: [{ type: "text" as const, text: "Invalid leads JSON. Pass the leads array as a JSON string." }],
          isError: true,
        };
      }

      if (!leads.length) {
        return {
          content: [{ type: "text" as const, text: "No leads provided. Load leads first with load_leads." }],
          isError: true,
        };
      }

      const conferenceName = `tcg-dialer-${repId}-${Date.now()}`;
      const sessionId = `session-${repId}-${Date.now()}`;

      const session: DialerSession = {
        id: sessionId,
        repId,
        repName,
        repPhone,
        conferenceName,
        leads,
        currentLeadIndex: -1,
        callLog: [],
        status: "connecting_rep",
        startedAt: new Date().toISOString(),
      };

      sessions.set(sessionId, session);

      try {
        const repCallSid = await callRepIntoConference(repPhone, conferenceName, sessionId);
        session.conferenceCallSid = repCallSid;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sessionId,
                status: "connecting_rep",
                totalLeads: leads.length,
                message: `Calling ${repName} at ${repPhone}. Answer the phone to join the dialer, then tell me to start dialing.`,
              }),
            },
          ],
        };
      } catch (err: unknown) {
        sessions.delete(sessionId);
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: `Failed to start session: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: dial_next_lead
  // ===========================================================
  server.tool(
    "dial_next_lead",
    "Dial the next lead in the queue. The rep must already be connected in the conference. The lead is called and bridged into the conference seamlessly.",
    {
      sessionId: z.string().describe("Session ID from start_dialer_session"),
    },
    async ({ sessionId }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      session.currentLeadIndex++;

      if (session.currentLeadIndex >= session.leads.length) {
        session.status = "ended";
        session.endedAt = new Date().toISOString();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                done: true,
                message: "All leads have been dialed!",
                totalCalls: session.callLog.length,
              }),
            },
          ],
        };
      }

      const lead = session.leads[session.currentLeadIndex];
      session.status = "dialing";

      try {
        const callSid = await dialLeadIntoConference(
          lead.phone,
          session.conferenceName,
          lead.id,
          session.id
        );

        session.callLog.push({
          id: `call-${Date.now()}`,
          leadId: lead.id,
          leadName: lead.name,
          leadBusinessName: lead.businessName,
          leadPhone: lead.phone,
          repId: session.repId,
          status: "ringing",
          twilioCallSid: callSid,
          startedAt: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                dialing: true,
                lead: {
                  name: lead.name,
                  businessName: lead.businessName,
                  phone: lead.phone,
                  stageName: lead.stageName,
                },
                position: session.currentLeadIndex + 1,
                total: session.leads.length,
                remaining: session.leads.length - session.currentLeadIndex - 1,
                message: `Dialing ${lead.name} at ${lead.businessName} (${lead.phone})... ${session.leads.length - session.currentLeadIndex - 1} leads remaining.`,
              }),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: `Failed to dial: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: set_call_disposition
  // ===========================================================
  server.tool(
    "set_call_disposition",
    "Set the disposition for the most recent call and optionally add notes. Also pushes a note to GHL. Valid dispositions: interested, callback, not_interested, no_answer, voicemail, wrong_number, disconnected.",
    {
      sessionId: z.string().describe("Session ID"),
      disposition: z.enum([
        "interested", "callback", "not_interested", "no_answer",
        "voicemail", "wrong_number", "disconnected",
      ]).describe("Call disposition"),
      notes: z.string().optional().describe("Optional notes about the call"),
    },
    async ({ sessionId, disposition, notes }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      const lastCall = session.callLog[session.callLog.length - 1];
      if (!lastCall) {
        return {
          content: [{ type: "text" as const, text: "No calls in session yet." }],
          isError: true,
        };
      }

      lastCall.disposition = disposition;
      if (notes) lastCall.notes = notes;
      session.status = "wrap_up";

      // Push note to GHL
      try {
        const noteBody = [
          `Power Dialer Call — ${new Date().toLocaleDateString()}`,
          `Disposition: ${disposition}`,
          notes ? `Notes: ${notes}` : null,
          lastCall.duration ? `Duration: ${lastCall.duration}s` : null,
        ]
          .filter(Boolean)
          .join("\n");

        await addContactNote(lastCall.leadId, noteBody);
      } catch (err) {
        console.error("Failed to push note to GHL:", err);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              disposition,
              notes,
              leadName: lastCall.leadName,
              message: `Disposition set to "${disposition}" for ${lastCall.leadName}. Note pushed to GHL. Ready to dial next lead.`,
            }),
          },
        ],
      };
    }
  );

  // ===========================================================
  // TOOL: get_session_status
  // ===========================================================
  server.tool(
    "get_session_status",
    "Get the current status of a dialing session including call log, current lead, and stats.",
    {
      sessionId: z.string().describe("Session ID"),
    },
    async ({ sessionId }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      const currentLead =
        session.currentLeadIndex >= 0 && session.currentLeadIndex < session.leads.length
          ? session.leads[session.currentLeadIndex]
          : null;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sessionId: session.id,
              status: session.status,
              currentLead: currentLead
                ? { name: currentLead.name, businessName: currentLead.businessName, phone: currentLead.phone }
                : null,
              position: session.currentLeadIndex + 1,
              total: session.leads.length,
              callsCompleted: session.callLog.filter((c) => c.endedAt).length,
              callLog: session.callLog.map((c) => ({
                leadName: c.leadName,
                leadBusinessName: c.leadBusinessName,
                disposition: c.disposition || "pending",
                duration: c.duration,
                analysis: c.analysis ? { summary: c.analysis.summary, sentiment: c.analysis.leadSentiment } : null,
              })),
            }, null, 2),
          },
        ],
      };
    }
  );

  // ===========================================================
  // TOOL: end_dialer_session
  // ===========================================================
  server.tool(
    "end_dialer_session",
    "End the current dialing session. Hangs up all calls and closes the conference.",
    {
      sessionId: z.string().describe("Session ID"),
    },
    async ({ sessionId }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      try {
        await endConference(session.conferenceName);
      } catch (err) {
        console.error("Error ending conference:", err);
      }

      session.status = "ended";
      session.endedAt = new Date().toISOString();

      const stats = {
        totalCalls: session.callLog.length,
        interested: session.callLog.filter((c) => c.disposition === "interested").length,
        callbacks: session.callLog.filter((c) => c.disposition === "callback").length,
        notInterested: session.callLog.filter((c) => c.disposition === "not_interested").length,
        noAnswer: session.callLog.filter((c) => c.disposition === "no_answer" || c.disposition === "voicemail").length,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ended: true,
              stats,
              message: `Session ended. ${stats.totalCalls} calls made: ${stats.interested} interested, ${stats.callbacks} callbacks, ${stats.notInterested} not interested, ${stats.noAnswer} no answer.`,
            }),
          },
        ],
      };
    }
  );

  // ===========================================================
  // TOOL: analyze_last_call
  // ===========================================================
  server.tool(
    "analyze_last_call",
    "Run AI analysis on the most recent call's recording/transcript. Returns summary, suggested disposition, key points, follow-up actions, and pushes a note to GHL.",
    {
      sessionId: z.string().describe("Session ID"),
    },
    async ({ sessionId }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      const lastCall = session.callLog[session.callLog.length - 1];
      if (!lastCall) {
        return {
          content: [{ type: "text" as const, text: "No calls to analyze." }],
          isError: true,
        };
      }

      if (lastCall.analysis) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ analysis: lastCall.analysis, cached: true }),
            },
          ],
        };
      }

      const transcript = lastCall.transcription;
      if (!transcript) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No transcript available yet. The recording may still be processing. Try again in a moment, or manually set a disposition.",
            },
          ],
        };
      }

      try {
        const analysis = await analyzeCallTranscript(transcript, {
          leadName: lastCall.leadName,
          businessName: lastCall.leadBusinessName,
          stageName: session.leads[session.currentLeadIndex]?.stageName || "Unknown",
          repName: session.repName,
        });

        lastCall.analysis = analysis;

        // Push AI note to GHL
        try {
          await addContactNote(lastCall.leadId, analysis.ghlNote);
        } catch {
          // Best effort
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                analysis,
                message: `Call analyzed. ${analysis.summary} Suggested disposition: ${analysis.disposition} (${analysis.dispositionReason}). Note pushed to GHL.`,
              }),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        return {
          content: [{ type: "text" as const, text: `Analysis failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: get_daily_briefing
  // ===========================================================
  server.tool(
    "get_daily_briefing",
    "Generate an AI-powered daily briefing for the session. Includes recap, hot leads, follow-up plan, and stats. Best called at the end of a session.",
    {
      sessionId: z.string().describe("Session ID"),
    },
    async ({ sessionId }) => {
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text" as const, text: "Session not found." }],
          isError: true,
        };
      }

      const calls = session.callLog.map((c) => ({
        leadName: c.leadName,
        businessName: c.leadBusinessName,
        disposition: c.disposition || "no_answer",
        summary: c.analysis?.summary || c.notes || "No summary available",
        keyPoints: c.analysis?.keyPoints || [],
        followUpActions: c.analysis?.followUpActions || [],
        duration: c.duration,
      }));

      try {
        const summary = await generateDailySummary(calls);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...summary,
                sessionStats: {
                  totalCalls: session.callLog.length,
                  connected: session.callLog.filter((c) => c.duration && c.duration > 10).length,
                  interested: session.callLog.filter((c) => c.disposition === "interested").length,
                  callbacks: session.callLog.filter((c) => c.disposition === "callback").length,
                  totalTalkTime: session.callLog.reduce((sum, c) => sum + (c.duration || 0), 0),
                },
              }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Summary failed";
        return {
          content: [{ type: "text" as const, text: `Failed to generate briefing: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: search_ghl_contact
  // ===========================================================
  server.tool(
    "search_ghl_contact",
    "Search for a contact in GoHighLevel CRM by name, email, phone, or business name.",
    {
      query: z.string().describe("Search query — name, email, phone, or business name"),
    },
    async ({ query }) => {
      try {
        const results = await searchContact(query);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Search failed";
        return {
          content: [{ type: "text" as const, text: `GHL search failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: add_ghl_note
  // ===========================================================
  server.tool(
    "add_ghl_note",
    "Add a note to a GHL contact. Use this to manually log information about a lead.",
    {
      contactId: z.string().describe("GHL contact ID"),
      note: z.string().describe("The note content to add"),
    },
    async ({ contactId, note }) => {
      try {
        await addContactNote(contactId, note);
        return {
          content: [
            { type: "text" as const, text: `Note added to contact ${contactId}.` },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to add note";
        return {
          content: [{ type: "text" as const, text: `Failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );

  // ===========================================================
  // TOOL: get_dashboard_link
  // ===========================================================
  server.tool(
    "get_dashboard_link",
    "Get the URL to the power dialer web dashboard. Reps can use this alongside Claude for the visual dialer controls.",
    {},
    async () => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return {
        content: [
          {
            type: "text" as const,
            text: `The Power Dialer dashboard is available at: ${appUrl}\n\nReps can use the web dashboard for visual dialer controls (buttons, call log, real-time status) while using Claude for conversational commands and AI insights.`,
          },
        ],
      };
    }
  );

  return server;
}
