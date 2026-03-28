"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useSignalWireWebRTC } from "@/hooks/useSignalWireWebRTC";

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
  recordingUrl?: string | null;
  recordingSid?: string | null;
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

const DISPOSITIONS: { value: Disposition; label: string; color: string; icon: string }[] = [
  { value: "interested", label: "Interested", color: "bg-green-600", icon: "🔥" },
  { value: "callback", label: "Callback", color: "bg-blue-600", icon: "📞" },
  { value: "not_interested", label: "Not Interested", color: "bg-orange-600", icon: "👎" },
  { value: "no_answer", label: "No Answer", color: "bg-gray-600", icon: "📵" },
  { value: "voicemail", label: "Voicemail", color: "bg-purple-600", icon: "📧" },
  { value: "wrong_number", label: "Wrong Number", color: "bg-red-600", icon: "❌" },
  { value: "disconnected", label: "Disconnected", color: "bg-red-800", icon: "🔌" },
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
  const [totalLeads, setTotalLeads] = useState(leads.length);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [callTimer, setCallTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Connection mode + WebRTC
  const [connectionMode, setConnectionMode] = useState<"phone" | "webrtc">(
    rep.phone ? "phone" : "webrtc"
  );
  const webrtc = useSignalWireWebRTC();

  // AI state
  const [lastAnalysis, setLastAnalysis] = useState<CallAnalysis | null>(null);
  const [analyzingCall, setAnalyzingCall] = useState(false);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Dial mode config
  const [dialMode, setDialMode] = useState<"single" | "multi">("single");
  const [linesCount, setLinesCount] = useState(3);
  const [batchInfo, setBatchInfo] = useState<{ linesDialed: number; connected: boolean; settled: boolean } | null>(null);
  const [dialingLeads, setDialingLeads] = useState<{ name: string; businessName: string; phone: string; callSid?: string }[]>([]);

  // Voicemail drop state
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);

  // Recording playback state
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ── Poll session status ──────────────────────────────────
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/api/dialer/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setCallLog(data.callLog || []);
      if (data.currentLead) setCurrentLead(data.currentLead);
      if (data.dialMode) setDialMode(data.dialMode);
      if (data.lines) setLinesCount(data.lines);
      if (data.batch) setBatchInfo(data.batch);
      if (data.total) setTotalLeads(data.total);
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

  // WebRTC mode: sync browser call state with dialer status
  useEffect(() => {
    if (connectionMode !== "webrtc") return;

    if (webrtc.callState === "active" && status === "dialing") {
      setStatus("on_call");
    } else if (
      (webrtc.callState === "hangup" || webrtc.callState === "destroy" || webrtc.callState === "idle") &&
      status === "on_call"
    ) {
      setStatus("wrap_up");
    }
  }, [webrtc.callState, status, connectionMode]);

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

  // ── Actions ──────────────────────────────────────────────

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
      if (data.analysis) setLastAnalysis(data.analysis);
    } catch (err) {
      console.error("Analysis request failed:", err);
    } finally {
      setAnalyzingCall(false);
    }
  }

  async function startSession() {
    setError("");
    try {
      const res = await apiFetch("/api/dialer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: rep.id,
          repName: rep.name,
          repPhone: connectionMode === "phone" ? rep.phone : undefined,
          leads,
          dialMode,
          lines: dialMode === "multi" ? linesCount : 1,
          connectionMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.sessionId);
      setStatus("connecting_rep");

      if (connectionMode === "webrtc" && data.webrtc) {
        webrtc.connect({
          ...data.webrtc,
          callerNumber: data.callerNumber || process.env.NEXT_PUBLIC_SIGNALWIRE_PHONE || "",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      setError(msg);
    }
  }

  // Track the current lead index for WebRTC browser-driven dialing
  const webrtcLeadIndexRef = useRef(0);

  async function dialNext() {
    if (!sessionId) return;
    setError("");
    setNotes("");
    setCallTimer(0);
    setLastAnalysis(null);
    setDroppingVoicemail(false);

    // WebRTC mode: browser makes the call directly
    if (connectionMode === "webrtc" && webrtc.isConnected) {
      const idx = webrtcLeadIndexRef.current;
      if (idx >= leads.length) {
        setStatus("ended");
        return;
      }

      const lead = leads[idx];
      webrtcLeadIndexRef.current = idx + 1;
      setCurrentLead(lead);
      setPosition(idx + 1);
      setStatus("dialing");
      setDialingLeads([]);

      // Browser dials the lead directly — audio streams browser ↔ lead
      webrtc.makeCall(lead.phone);

      // Also notify the server so it can track the call in the session
      try {
        await apiFetch("/api/dialer/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, webrtcDial: true, leadIndex: idx }),
        });
      } catch {
        // Server tracking is best-effort — call still goes through
      }
      return;
    }

    // Phone mode: server makes the call
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

  // ── Voicemail Drop ────────────────────────────────────────
  async function dropVoicemail() {
    if (!sessionId || droppingVoicemail) return;
    setDroppingVoicemail(true);

    try {
      const res = await apiFetch("/api/dialer/voicemail-drop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // VM dropped — status will update via polling to wrap_up
      setLastAnalysis(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to drop voicemail";
      setError(msg);
    } finally {
      setDroppingVoicemail(false);
    }
  }

  // ── Recording Playback ────────────────────────────────────
  function toggleRecordingPlayback(entry: CallLogEntry) {
    if (!entry.recordingUrl) return;

    if (playingRecordingId === entry.id) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingRecordingId(null);
    } else {
      // Stop any current playback
      if (audioRef.current) {
        audioRef.current.pause();
      }
      // Start new playback
      const audio = new Audio(entry.recordingUrl);
      audio.onended = () => {
        setPlayingRecordingId(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingRecordingId(null);
        audioRef.current = null;
        setError("Failed to play recording");
      };
      audio.play();
      audioRef.current = audio;
      setPlayingRecordingId(entry.id);
    }
  }

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
    webrtc.disconnect();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingRecordingId(null);
    setStatus("ended");
  }

  // ── Helpers ──────────────────────────────────────────────

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function StatusBadge({ s }: { s: Status }) {
    const dialingLabel =
      dialMode === "multi" && linesCount > 1
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

  function DispositionBadge({ d }: { d?: string }) {
    if (!d) return <span className="text-gray-600 text-xs">pending</span>;
    const found = DISPOSITIONS.find((x) => x.value === d);
    if (!found) return <span className="text-gray-400 text-xs">{d}</span>;
    return (
      <span
        className={`${found.color} text-white text-[10px] font-medium px-2 py-0.5 rounded-full`}
      >
        {found.label}
      </span>
    );
  }

  function LeadContextCard({ lead }: { lead: Lead }) {
    const fields = [
      { label: "Industry", value: lead._industry },
      { label: "Monthly Revenue", value: lead._monthlyRevenue },
      { label: "Years in Business", value: lead._yearsInBusiness },
      { label: "Amount Requested", value: lead._amountRequested },
      { label: "Credit Score", value: lead._creditScore },
      { label: "Previously Funded", value: lead._previouslyFunded },
      { label: "Current Positions", value: lead._currentPositions },
      { label: "Approval Letter", value: lead._approvalLetter },
    ].filter((f) => f.value);

    if (fields.length === 0 && !lead._lastNote && !lead._lastDisposition) return null;

    return (
      <div className="bg-gray-800/40 border border-gray-700/50 rounded-lg p-4 mt-3">
        {fields.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {fields.map((f) => (
              <div key={f.label}>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{f.label}</p>
                <p className="text-sm text-gray-300 font-medium">{f.value}</p>
              </div>
            ))}
          </div>
        )}
        {lead._lastDisposition && (
          <div className="mb-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Last Disposition: </span>
            <span className="text-xs text-gray-400">{lead._lastDisposition}</span>
          </div>
        )}
        {lead._lastNote && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Last Note</p>
            <p className="text-xs text-gray-400 line-clamp-3">{lead._lastNote}</p>
          </div>
        )}
      </div>
    );
  }

  const sentimentColor = {
    positive: "text-green-400",
    neutral: "text-gray-400",
    negative: "text-red-400",
  };

  // ── RENDER ───────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Power Dialer</h1>
          <p className="text-gray-400">
            {rep.name} &middot; {totalLeads} leads loaded
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
          <button onClick={() => setError("")} className="ml-2 text-red-400 hover:text-red-300">
            &times;
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main Panel ────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Start Button */}
          {status === "idle" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 sm:p-12">
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold mb-2">Ready to Dial</h2>
                <p className="text-gray-400">
                  {connectionMode === "webrtc"
                    ? "Calls will connect directly through your browser."
                    : `We'll call you at ${rep.phone}, then start dialing your leads.`}
                </p>
              </div>

              {/* Connection Mode Toggle */}
              <div className="max-w-sm mx-auto mb-6">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 text-center">
                  Call Via
                </label>
                <div className="flex rounded-lg bg-gray-800 p-1">
                  <button
                    onClick={() => setConnectionMode("webrtc")}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                      connectionMode === "webrtc"
                        ? "bg-green-600 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Browser
                  </button>
                  <button
                    onClick={() => setConnectionMode("phone")}
                    disabled={!rep.phone}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
                      connectionMode === "phone"
                        ? "bg-green-600 text-white shadow-sm"
                        : "text-gray-400 hover:text-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed"
                    }`}
                  >
                    Phone
                  </button>
                </div>
                <p className="text-[11px] text-gray-600 text-center mt-1.5">
                  {connectionMode === "webrtc"
                    ? "Uses your browser microphone — no phone needed"
                    : `Calls ${rep.phone} first, then dials leads`}
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
              {connectionMode === "webrtc" ? (
                <>
                  <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <h2 className="text-xl font-semibold mb-2">
                    {webrtc.isConnected ? "Browser connected!" : "Connecting browser..."}
                  </h2>
                  <p className="text-gray-400">
                    {webrtc.isConnected
                      ? "You're live. Press \"Dial Next\" to start calling."
                      : "Requesting microphone access..."}
                  </p>
                  {webrtc.error && (
                    <p className="text-red-400 text-sm mt-3">{webrtc.error}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <h2 className="text-xl font-semibold mb-2">Calling your phone...</h2>
                  <p className="text-gray-400">
                    Answer the call to join the dialer. Then press &quot;Dial Next&quot; to start.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Active Dialer Panel */}
          {sessionId && status !== "idle" && status !== "ended" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              {/* Current Lead Info */}
              {currentLead && (status === "dialing" || status === "on_call" || status === "wrap_up") ? (
                <div className="mb-6">
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
                        Lead {position} of {totalLeads}
                      </p>
                      {status === "on_call" && (
                        <p className="text-2xl font-mono text-green-400 mt-1">
                          {formatTime(callTimer)}
                        </p>
                      )}
                    </div>
                  </div>

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
                    <div className="text-center">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-blue-400 font-medium">
                        Ringing {currentLead?.name}...
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* On Call indicator + Voicemail Drop + Mute */}
              {status === "on_call" && (
                <div className="text-center py-4">
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse mx-auto mb-2" />
                  <p className="text-green-400 font-medium text-lg">
                    Connected{dialMode === "multi" && currentLead ? ` with ${currentLead.name}` : ""} — You&apos;re live!
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-4">
                    {/* Mute button (WebRTC mode) */}
                    {connectionMode === "webrtc" && (
                      <button
                        onClick={webrtc.toggleMute}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                          webrtc.isMuted
                            ? "bg-red-600 hover:bg-red-700 text-white"
                            : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        }`}
                      >
                        {webrtc.isMuted ? "Unmute" : "Mute"}
                      </button>
                    )}
                    {/* VOICEMAIL DROP BUTTON */}
                    <button
                      onClick={dropVoicemail}
                      disabled={droppingVoicemail}
                      className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                    >
                      {droppingVoicemail ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                          Dropping VM...
                        </>
                      ) : (
                        <>
                          <span className="text-base leading-none">📧</span>
                          Drop Voicemail
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Voicemail Drop button also available during dialing (for when it hits VM before connecting) */}
              {status === "dialing" && (
                <div className="mt-3 text-center">
                  <button
                    onClick={dropVoicemail}
                    disabled={droppingVoicemail}
                    className="px-4 py-2 bg-purple-600/70 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-1.5"
                  >
                    {droppingVoicemail ? "Dropping VM..." : "Drop VM & Move On"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Disposition + AI Analysis Panel ─────────────── */}
          {(status === "wrap_up" || status === "on_call") && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              {/* AI Analysis loading */}
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

              {/* ── Quick Disposition Buttons ─────────────────── */}
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                {lastAnalysis ? "Or choose manually:" : "Call Disposition"}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {DISPOSITIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDisposition(d.value)}
                    className={`${d.color} hover:opacity-80 text-white text-sm font-medium py-3 px-3 rounded-lg transition-opacity flex items-center justify-center gap-1.5`}
                  >
                    <span className="text-base leading-none">{d.icon}</span>
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Notes */}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Quick notes about this call... (AI will also generate notes automatically)"
                rows={2}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          )}

          {/* ── Session Ended — AI Daily Summary ────────────── */}
          {status === "ended" && (
            <div className="space-y-4">
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

        {/* ── Right Panel — Call Log with Recording Playback ── */}
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
                        {entry.recordingUrl && (
                          <span className="text-[10px] bg-gray-600/30 text-gray-400 px-1.5 py-0.5 rounded">
                            REC
                          </span>
                        )}
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

                    {/* ── Expanded Call Details ────────────────── */}
                    {expandedCallId === entry.id && (
                      <div className="mt-2 pt-2 border-t border-gray-700 text-xs">
                        {/* Recording Playback */}
                        {entry.recordingUrl && (
                          <div className="mb-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRecordingPlayback(entry);
                              }}
                              className={`w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors ${
                                playingRecordingId === entry.id
                                  ? "bg-red-600/30 text-red-300 hover:bg-red-600/40 border border-red-700/50"
                                  : "bg-green-600/20 text-green-300 hover:bg-green-600/30 border border-green-700/50"
                              }`}
                            >
                              {playingRecordingId === entry.id ? (
                                <>
                                  <span className="w-2.5 h-2.5 bg-red-400 rounded-sm" />
                                  Stop Recording
                                </>
                              ) : (
                                <>
                                  <span className="text-sm leading-none">&#9654;</span>
                                  Play Recording
                                </>
                              )}
                            </button>
                          </div>
                        )}

                        {/* AI Analysis details */}
                        {entry.analysis && (
                          <>
                            <p className="text-gray-300 mb-1.5">
                              {entry.analysis.summary}
                            </p>
                            {entry.analysis.keyPoints.length > 0 && (
                              <ul className="text-gray-400 space-y-0.5 mb-1.5">
                                {entry.analysis.keyPoints.map((p, i) => (
                                  <li key={i} className="flex gap-1.5">
                                    <span className="text-gray-600 shrink-0">-</span>
                                    <span>{p}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {entry.analysis.followUpActions.length > 0 && (
                              <ul className="text-gray-400 space-y-0.5">
                                {entry.analysis.followUpActions.map((a, i) => (
                                  <li key={i} className="flex gap-1.5">
                                    <span className="text-blue-500 shrink-0">*</span>
                                    <span>{a}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}

                        {/* No analysis and no recording */}
                        {!entry.analysis && !entry.recordingUrl && (
                          <p className="text-gray-600 text-center py-2">
                            No analysis or recording available
                          </p>
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
