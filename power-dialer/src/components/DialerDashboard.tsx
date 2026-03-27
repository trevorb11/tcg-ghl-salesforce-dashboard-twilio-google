"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

interface Rep {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "rep" | "admin";
}

interface Lead {
  id: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  stageName: string;
  // Extended DB fields
  _monthlyRevenue?: string;
  _industry?: string;
  _yearsInBusiness?: string;
  _amountRequested?: string;
  _creditScore?: string;
  _lastNote?: string;
  _lastDisposition?: string;
  _approvalLetter?: string;
  _previouslyFunded?: string;
  _currentPositions?: string;
  _salesforceId?: string;
  _salesforceType?: string;
  lastContactedAt?: string;
  tags?: string[];
}

type Status =
  | "idle"
  | "connecting_rep"
  | "dialing"
  | "on_call"
  | "wrap_up"
  | "ended"
  | "monitoring";
type Disposition =
  | "interested"
  | "callback"
  | "not_interested"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "disconnected";

interface CallAnalysis {
  summary: string;
  disposition: Disposition;
  dispositionReason: string;
  keyPoints: string[];
  followUpActions: string[];
  leadSentiment: "positive" | "neutral" | "negative";
  ghlNote: string;
}

interface CallLogEntry {
  id: string;
  leadName: string;
  leadBusinessName: string;
  status: string;
  disposition?: string;
  duration?: number;
  startedAt: string;
  analysis?: CallAnalysis | null;
}

interface DailySummary {
  recap: string;
  hotLeads: string[];
  followUpPlan: string[];
  stats: string;
  sessionStats: {
    totalCalls: number;
    totalLeads: number;
    connected: number;
    interested: number;
    callbacks: number;
    notInterested: number;
    noAnswer: number;
    totalTalkTime: number;
  };
}

const DISPOSITIONS: { value: Disposition; label: string; color: string }[] = [
  { value: "interested", label: "Interested", color: "bg-green-600" },
  { value: "callback", label: "Callback", color: "bg-blue-600" },
  { value: "not_interested", label: "Not Interested", color: "bg-orange-600" },
  { value: "no_answer", label: "No Answer", color: "bg-gray-600" },
  { value: "voicemail", label: "Voicemail", color: "bg-purple-600" },
  { value: "wrong_number", label: "Wrong Number", color: "bg-red-600" },
  { value: "disconnected", label: "Disconnected", color: "bg-red-800" },
];

export default function DialerDashboard({
  rep,
  leads,
  onEnd,
  sessionId: initialSessionId,
}: {
  rep: Rep;
  leads: Lead[];
  onEnd: () => void;
  sessionId?: string;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [status, setStatus] = useState<Status>(initialSessionId ? "monitoring" : "idle");
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [position, setPosition] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [callTimer, setCallTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // AI state
  const [lastAnalysis, setLastAnalysis] = useState<CallAnalysis | null>(null);
  const [analyzingCall, setAnalyzingCall] = useState(false);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Dial mode config (set before starting session)
  const [dialMode, setDialMode] = useState<"single" | "multi">("single");
  const [linesCount, setLinesCount] = useState(3);
  const [batchInfo, setBatchInfo] = useState<{ linesDialed: number; connected: boolean; settled: boolean } | null>(null);
  const [dialingLeads, setDialingLeads] = useState<{ name: string; businessName: string; phone: string; callSid?: string }[]>([]);

  // Poll session status
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/api/dialer/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setCallLog(data.callLog || []);
      if (data.currentLead) {
        setCurrentLead(data.currentLead);
      }
      // Multi-line state
      if (data.dialMode) setDialMode(data.dialMode);
      if (data.lines) setLinesCount(data.lines);
      if (data.batch) setBatchInfo(data.batch);
      // If AI analysis came back via the backend, pick it up
      if (data.lastCallAnalysis && !lastAnalysis) {
        setLastAnalysis(data.lastCallAnalysis);
      }
    } catch {
      // Polling failure is non-fatal
    }
  }, [sessionId, lastAnalysis]);

  useEffect(() => {
    if (sessionId && status !== "ended" && status !== "idle") {
      pollRef.current = setInterval(pollStatus, 2000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [sessionId, status, pollStatus]);

  // Call timer
  useEffect(() => {
    if (status === "on_call") {
      setCallTimer(0);
      timerRef.current = setInterval(() => setCallTimer((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // Auto-trigger AI analysis when call moves to wrap_up
  useEffect(() => {
    if (status === "wrap_up" && sessionId && callLog.length > 0 && !analyzingCall && !lastAnalysis) {
      const lastCall = callLog[callLog.length - 1];
      if (lastCall && lastCall.id && !lastCall.analysis) {
        requestAnalysis(lastCall.id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, callLog.length]);

  // Request AI analysis for a call
  async function requestAnalysis(callId: string) {
    if (!sessionId) return;
    setAnalyzingCall(true);
    try {
      const res = await apiFetch("/api/dialer/call-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, callId }),
      });
      const data = await res.json();
      if (data.analysis) {
        setLastAnalysis(data.analysis);
      }
    } catch (err) {
      console.error("Analysis request failed:", err);
    } finally {
      setAnalyzingCall(false);
    }
  }

  // Start session
  async function startSession() {
    setError("");
    try {
      const res = await apiFetch("/api/dialer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: rep.id,
          repName: rep.name,
          repPhone: rep.phone,
          leads,
          dialMode,
          lines: dialMode === "multi" ? linesCount : 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.sessionId);
      setStatus("connecting_rep");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      setError(msg);
    }
  }

  // Dial next lead
  async function dialNext() {
    if (!sessionId) return;
    setError("");
    setNotes("");
    setCallTimer(0);
    setLastAnalysis(null);

    try {
      const res = await apiFetch("/api/dialer/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.done) {
        setStatus("ended");
        return;
      }

      // Multi-line: capture all leads being dialed
      if (data.dialMode === "multi" && data.leads) {
        setDialingLeads(data.leads);
        setDialMode("multi");
        setLinesCount(data.lines || data.leads.length);
      } else {
        setDialingLeads([]);
      }

      if (data.lead) setCurrentLead(data.lead);
      setPosition(data.position);
      setStatus("dialing");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to dial";
      setError(msg);
    }
  }

  // Set disposition (can use AI suggestion or manual)
  async function setDisposition(disposition: Disposition) {
    if (!sessionId) return;

    try {
      const res = await apiFetch("/api/dialer/disposition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, disposition, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotes("");
      setLastAnalysis(null);
      setStatus("connecting_rep");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to set disposition";
      setError(msg);
    }
  }

  // Request daily summary
  async function requestDailySummary() {
    if (!sessionId) return;
    setLoadingSummary(true);
    try {
      const res = await apiFetch("/api/dialer/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDailySummary(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate summary";
      setError(msg);
    } finally {
      setLoadingSummary(false);
    }
  }

  // End session
  async function endSession() {
    if (!sessionId) return;
    try {
      await apiFetch("/api/dialer/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      // Best effort
    }
    setStatus("ended");
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function StatusBadge({ s }: { s: Status }) {
    const dialingLabel = dialMode === "multi" && linesCount > 1
      ? `Ringing ${linesCount} Lines...`
      : "Ringing Lead...";
    const config: Record<Status, { label: string; color: string; pulse: boolean }> = {
      idle: { label: "Ready", color: "bg-gray-500", pulse: false },
      connecting_rep: { label: "Connecting You...", color: "bg-yellow-500", pulse: true },
      dialing: { label: dialingLabel, color: "bg-blue-500", pulse: true },
      on_call: { label: "Live Call", color: "bg-green-500", pulse: true },
      wrap_up: { label: "Wrap Up", color: "bg-orange-500", pulse: false },
      ended: { label: "Session Ended", color: "bg-gray-500", pulse: false },
      monitoring: { label: "Claude Driving", color: "bg-purple-500", pulse: true },
    };
    const c = config[s];
    return (
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${c.color} ${c.pulse ? "animate-pulse" : ""}`} />
        <span className="text-sm font-medium">{c.label}</span>
      </div>
    );
  }

  const sentimentColor = {
    positive: "text-green-400",
    neutral: "text-gray-400",
    negative: "text-red-400",
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Power Dialer</h1>
          <p className="text-gray-400">
            {rep.name} &middot; {leads.length} leads loaded
          </p>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge s={status} />
          {status !== "ended" && status !== "idle" && (
            <button
              onClick={endSession}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
            >
              End Session
            </button>
          )}
          {status === "ended" && (
            <button
              onClick={onEnd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
            >
              New Session
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Start Button */}
          {status === "idle" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 sm:p-12">
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold mb-2">Ready to Dial</h2>
                <p className="text-gray-400">
                  We&apos;ll call you at {rep.phone}, then start dialing your leads.
                </p>
              </div>

              {/* Dial Mode Toggle */}
              <div className="max-w-sm mx-auto mb-6">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 text-center">
                  Dial Mode
                </label>
                <div className="flex rounded-lg bg-gray-800 p-1">
                  <button
                    onClick={() => setDialMode("single")}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                      dialMode === "single"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Single Line
                  </button>
                  <button
                    onClick={() => setDialMode("multi")}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                      dialMode === "multi"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Multi-Line
                  </button>
                </div>
                <p className="text-[11px] text-gray-600 text-center mt-1.5">
                  {dialMode === "single"
                    ? "Calls one lead at a time"
                    : "Dials multiple leads at once — first to answer connects"}
                </p>
              </div>

              {/* Line Count (multi-line only) */}
              {dialMode === "multi" && (
                <div className="max-w-sm mx-auto mb-8">
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 text-center">
                    Lines ({linesCount})
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 text-xs">2</span>
                    <input
                      type="range"
                      min={2}
                      max={5}
                      value={linesCount}
                      onChange={(e) => setLinesCount(parseInt(e.target.value))}
                      className="flex-1 accent-blue-600"
                    />
                    <span className="text-gray-500 text-xs">5</span>
                  </div>
                  <p className="text-[11px] text-gray-600 text-center mt-1">
                    {linesCount} leads will ring simultaneously per round
                  </p>
                </div>
              )}

              <div className="text-center">
                <button
                  onClick={startSession}
                  className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white text-lg font-bold rounded-xl transition-colors"
                >
                  Start {dialMode === "multi" ? `Multi-Line (${linesCount}x)` : "Dialing"} Session
                </button>
              </div>
            </div>
          )}

          {/* Connecting Rep */}
          {status === "connecting_rep" && !currentLead && callLog.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
              <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Calling your phone...</h2>
              <p className="text-gray-400">
                Answer the call to join the dialer. Then press &quot;Dial Next&quot; to start.
              </p>
            </div>
          )}

          {/* Active Dialer Panel */}
          {sessionId && status !== "idle" && status !== "ended" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              {/* Current Lead Info */}
              {currentLead && (status === "dialing" || status === "on_call" || status === "wrap_up") ? (
                <div className="mb-6">
                  {/* Lead header + CRM links */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{currentLead.name}</h2>
                      {currentLead.businessName && (
                        <p className="text-gray-400 text-lg">{currentLead.businessName}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-gray-500">{currentLead.phone}</span>
                        {currentLead.email && (
                          <span className="text-gray-600 text-sm">{currentLead.email}</span>
                        )}
                      </div>
                      {/* CRM Links */}
                      <div className="flex items-center gap-2 mt-2">
                        {currentLead.id && !currentLead.id.startsWith("db-") && !currentLead.id.startsWith("upload-") && (
                          <a
                            href={`https://app.gohighlevel.com/v2/location/n778xwOps9t8Q34eRPfM/contacts/detail/${currentLead.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-600/20 text-orange-400 text-xs font-medium rounded-md hover:bg-orange-600/30 transition-colors"
                          >
                            GHL Record &rarr;
                          </a>
                        )}
                        {currentLead._salesforceId && (
                          <a
                            href={`https://customization-data-47--dev.sandbox.lightning.force.com/lightning/r/${currentLead._salesforceType || "Contact"}/${currentLead._salesforceId}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-600/20 text-blue-400 text-xs font-medium rounded-md hover:bg-blue-600/30 transition-colors"
                          >
                            Salesforce &rarr;
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">
                        Lead {position} of {leads.length}
                      </p>
                      {status === "on_call" && (
                        <p className="text-2xl font-mono text-green-400 mt-1">
                          {formatTime(callTimer)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Contact context card */}
                  <LeadContextCard lead={currentLead} />
                </div>
              ) : (
                <div className="text-center mb-6">
                  <p className="text-gray-400 mb-2">
                    {callLog.length === 0
                      ? "You're connected. Press Dial Next to start calling."
                      : "Ready for the next lead."}
                  </p>
                </div>
              )}

              {/* Dial Next Button */}
              {(status === "connecting_rep" || status === "wrap_up") && (
                <button
                  onClick={dialNext}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white text-lg font-bold rounded-xl transition-colors"
                >
                  Dial Next Lead
                </button>
              )}

              {/* Dialing indicator */}
              {status === "dialing" && (
                <div className="py-4">
                  {dialMode === "multi" && dialingLeads.length > 1 ? (
                    /* Multi-line: show all lines ringing */
                    <div>
                      <div className="flex items-center justify-center gap-2 mb-4">
                        <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-blue-400 font-semibold">
                          Ringing {dialingLeads.length} lines — first to answer connects
                        </p>
                      </div>
                      <div className="grid gap-2">
                        {dialingLeads.map((dl, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 px-4 py-2.5 bg-blue-900/15 border border-blue-800/30 rounded-lg"
                          >
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-medium text-gray-200">{dl.name}</span>
                              {dl.businessName && (
                                <span className="text-gray-500 text-sm ml-2">— {dl.businessName}</span>
                              )}
                            </div>
                            <span className="text-gray-600 text-xs font-mono shrink-0">{dl.phone}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Single line */
                    <div className="text-center">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-blue-400 font-medium">
                        Ringing {currentLead?.name}...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* On Call indicator */}
              {status === "on_call" && (
                <div className="text-center py-4">
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse mx-auto mb-2" />
                  <p className="text-green-400 font-medium text-lg">
                    Connected{dialMode === "multi" && currentLead ? ` with ${currentLead.name}` : ""} — You&apos;re live!
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Disposition + AI Analysis Panel */}
          {(status === "wrap_up" || status === "on_call") && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              {/* AI Analysis (if available) */}
              {analyzingCall && (
                <div className="flex items-center gap-3 mb-4 p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-blue-300 text-sm">Claude is analyzing the call...</span>
                </div>
              )}

              {lastAnalysis && (
                <div className="mb-5 p-4 bg-gray-800/50 border border-gray-700 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      AI Call Analysis
                    </h4>
                    <span className={`text-xs font-medium ${sentimentColor[lastAnalysis.leadSentiment]}`}>
                      {lastAnalysis.leadSentiment} sentiment
                    </span>
                  </div>

                  <p className="text-gray-300 text-sm mb-3">{lastAnalysis.summary}</p>

                  {lastAnalysis.keyPoints.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1">Key Points:</p>
                      <ul className="text-sm text-gray-400 space-y-0.5">
                        {lastAnalysis.keyPoints.map((p, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-gray-600">-</span> {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {lastAnalysis.followUpActions.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1">Follow-up:</p>
                      <ul className="text-sm text-gray-400 space-y-0.5">
                        {lastAnalysis.followUpActions.map((a, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-blue-500">*</span> {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* AI suggested disposition */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-700">
                    <span className="text-xs text-gray-500">AI suggests:</span>
                    <button
                      onClick={() => setDisposition(lastAnalysis.disposition)}
                      className="px-3 py-1 bg-blue-600/50 hover:bg-blue-600 text-blue-300 text-xs font-medium rounded-md transition-colors"
                    >
                      {lastAnalysis.disposition.replace("_", " ")} — {lastAnalysis.dispositionReason}
                    </button>
                  </div>
                </div>
              )}

              {/* Manual Disposition Buttons */}
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                {lastAnalysis ? "Or choose manually:" : "Call Disposition"}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {DISPOSITIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDisposition(d.value)}
                    className={`${d.color} hover:opacity-80 text-white text-sm font-medium py-2.5 px-3 rounded-lg transition-opacity`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Quick notes about this call... (AI will also generate notes automatically)"
                rows={2}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          )}

          {/* Session Ended — AI Daily Summary */}
          {status === "ended" && (
            <div className="space-y-4">
              {/* Stats cards */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-semibold mb-4">Session Complete</h2>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold">{callLog.length}</p>
                    <p className="text-gray-400 text-xs">Calls</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-400">
                      {callLog.filter((c) => c.disposition === "interested").length}
                    </p>
                    <p className="text-gray-400 text-xs">Interested</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">
                      {callLog.filter((c) => c.disposition === "callback").length}
                    </p>
                    <p className="text-gray-400 text-xs">Callbacks</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-400">
                      {callLog.filter((c) => c.disposition === "no_answer" || c.disposition === "voicemail").length}
                    </p>
                    <p className="text-gray-400 text-xs">No Answer</p>
                  </div>
                </div>

                {/* Generate Summary Button */}
                {!dailySummary && (
                  <button
                    onClick={requestDailySummary}
                    disabled={loadingSummary}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {loadingSummary ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                        Claude is generating your daily briefing...
                      </>
                    ) : (
                      "Get AI Daily Briefing"
                    )}
                  </button>
                )}
              </div>

              {/* AI Daily Summary */}
              {dailySummary && (
                <div className="bg-gray-900 border border-blue-800/30 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
                    Daily Briefing
                    <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded-full">AI</span>
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">{dailySummary.stats}</p>

                  <div className="mb-4">
                    <p className="text-gray-300 text-sm whitespace-pre-line leading-relaxed">
                      {dailySummary.recap}
                    </p>
                  </div>

                  {dailySummary.hotLeads.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-sm font-medium text-green-400 mb-2">
                        Hot Leads to Prioritize
                      </h4>
                      <ul className="space-y-1">
                        {dailySummary.hotLeads.map((lead, i) => (
                          <li key={i} className="text-sm text-gray-300 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                            {lead}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dailySummary.followUpPlan.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-blue-400 mb-2">
                        Follow-Up Plan
                      </h4>
                      <ul className="space-y-1.5">
                        {dailySummary.followUpPlan.map((item, i) => (
                          <li key={i} className="text-sm text-gray-300 flex gap-2">
                            <span className="text-blue-500 mt-0.5 shrink-0">{i + 1}.</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel — Call Log */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
              Call Log ({callLog.length})
            </h3>
            {callLog.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">
                No calls yet
              </p>
            ) : (
              <div className="space-y-2 max-h-[700px] overflow-y-auto">
                {[...callLog].reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-gray-800/50 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-gray-800/80 transition-colors"
                    onClick={() =>
                      setExpandedCallId(expandedCallId === entry.id ? null : entry.id)
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">
                        {entry.leadName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {entry.analysis && (
                          <span className="text-[10px] bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded">
                            AI
                          </span>
                        )}
                        <DispositionBadge d={entry.disposition} />
                      </div>
                    </div>
                    {entry.leadBusinessName && (
                      <p className="text-gray-500 text-xs truncate">
                        {entry.leadBusinessName}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-0.5">
                      {entry.duration ? (
                        <p className="text-gray-600 text-xs">
                          {formatTime(entry.duration)}
                        </p>
                      ) : (
                        <span />
                      )}
                      {entry.analysis && (
                        <span className={`text-xs ${sentimentColor[entry.analysis.leadSentiment]}`}>
                          {entry.analysis.leadSentiment}
                        </span>
                      )}
                    </div>

                    {/* Expanded AI details */}
                    {expandedCallId === entry.id && entry.analysis && (
                      <div className="mt-2 pt-2 border-t border-gray-700 text-xs">
                        <p className="text-gray-300 mb-1.5">
                          {entry.analysis.summary}
                        </p>
                        {entry.analysis.keyPoints.length > 0 && (
                          <ul className="text-gray-400 space-y-0.5 mb-1.5">
                            {entry.analysis.keyPoints.map((p, i) => (
                              <li key={i}>- {p}</li>
                            ))}
                          </ul>
                        )}
                        {entry.analysis.followUpActions.length > 0 && (
                          <div className="text-blue-400">
                            {entry.analysis.followUpActions.map((a, i) => (
                              <p key={i}>* {a}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lead Context Card ──────────────────────────────────────
// Shows enriched CRM data when a lead is on a call
function LeadContextCard({ lead }: { lead: Lead }) {
  const fields = [
    { label: "Stage", value: lead.stageName },
    { label: "Email", value: lead.email },
    { label: "Monthly Revenue", value: lead._monthlyRevenue },
    { label: "Industry", value: lead._industry },
    { label: "Years in Business", value: lead._yearsInBusiness },
    { label: "Amount Requested", value: lead._amountRequested },
    { label: "Credit Score", value: lead._creditScore },
    { label: "Previously Funded", value: lead._previouslyFunded },
    { label: "Current Positions", value: lead._currentPositions },
    { label: "Last Disposition", value: lead._lastDisposition },
  ].filter((f) => f.value);

  const hasNote = lead._lastNote;
  const hasTags = lead.tags && lead.tags.length > 0;

  if (fields.length === 0 && !hasNote && !hasTags) return null;

  return (
    <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4">
      {/* Tags */}
      {hasTags && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {lead.tags!.map((tag, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-gray-700/60 text-gray-300 text-[11px] rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* CRM fields grid */}
      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-3">
          {fields.map((f, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-gray-500 uppercase tracking-wider shrink-0">
                {f.label}
              </span>
              <span className="text-sm text-gray-300 text-right truncate">
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Last note */}
      {hasNote && (
        <div className="pt-2 border-t border-gray-700/50">
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
            Last Note
          </p>
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">
            {lead._lastNote}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Disposition Badge ──────────────────────────────────────
function DispositionBadge({ d }: { d?: string }) {
  if (!d) return <span className="text-xs text-gray-600">pending</span>;
  const colors: Record<string, string> = {
    interested: "text-green-400",
    callback: "text-blue-400",
    not_interested: "text-orange-400",
    no_answer: "text-gray-400",
    voicemail: "text-purple-400",
    wrong_number: "text-red-400",
    disconnected: "text-red-400",
  };
  return (
    <span className={`text-xs font-medium ${colors[d] || "text-gray-400"}`}>
      {d.replace("_", " ")}
    </span>
  );
}