"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useSignalWireWebRTC } from "@/hooks/useSignalWireWebRTC";

// ── Types ────────────────────────────────────────────────
interface Rep { id: string; name: string; email: string; phone: string; role: "rep" | "admin"; }
interface Lead {
  id: string; name: string; businessName: string; phone: string; email: string; stageName: string;
  _monthlyRevenue?: string; _industry?: string; _yearsInBusiness?: string; _amountRequested?: string;
  _creditScore?: string; _lastNote?: string; _lastDisposition?: string; _approvalLetter?: string;
  _previouslyFunded?: string; _currentPositions?: string; _salesforceId?: string; _salesforceType?: string;
  lastContactedAt?: string; tags?: string[];
}
type Status = "idle" | "connecting_rep" | "dialing" | "on_call" | "wrap_up" | "paused" | "ended" | "monitoring";
type Disposition = "interested" | "callback" | "not_interested" | "no_answer" | "voicemail" | "wrong_number" | "disconnected";

interface CallAnalysis {
  summary: string; disposition: Disposition; dispositionReason: string;
  keyPoints: string[]; followUpActions: string[];
  leadSentiment: "positive" | "neutral" | "negative"; ghlNote: string;
}
interface CallLogEntry {
  id: string; leadName: string; leadBusinessName: string; status: string;
  disposition?: string; duration?: number; startedAt: string;
  analysis?: CallAnalysis | null; recordingUrl?: string | null; recordingSid?: string | null;
}
interface DailySummary {
  recap: string; hotLeads: string[]; followUpPlan: string[]; stats: string;
  sessionStats: { totalCalls: number; totalLeads: number; connected: number; interested: number; callbacks: number; notInterested: number; noAnswer: number; totalTalkTime: number; };
}

const DISPOSITIONS: { value: Disposition; label: string; color: string; key: string }[] = [
  { value: "interested", label: "Interested", color: "bg-green-600", key: "1" },
  { value: "callback", label: "Callback", color: "bg-blue-600", key: "2" },
  { value: "not_interested", label: "Not Interested", color: "bg-orange-600", key: "3" },
  { value: "no_answer", label: "No Answer", color: "bg-gray-600", key: "4" },
  { value: "voicemail", label: "Voicemail", color: "bg-purple-600", key: "5" },
  { value: "wrong_number", label: "Wrong Number", color: "bg-red-600", key: "6" },
  { value: "disconnected", label: "Disconnected", color: "bg-red-800", key: "7" },
];

// ── Component ────────────────────────────────────────────
export default function DialerDashboard({ rep, leads, onEnd, sessionId: initialSessionId }: {
  rep: Rep; leads: Lead[]; onEnd: () => void; sessionId?: string;
}) {
  // Core state
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null);
  const [status, setStatus] = useState<Status>(initialSessionId ? "monitoring" : "idle");
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [position, setPosition] = useState(0);
  const [totalLeads, setTotalLeads] = useState(leads.length);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  // Timer — persists through wrap_up
  const [callTimer, setCallTimer] = useState(0);
  const [lastCallDuration, setLastCallDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Connection + dial mode
  const [connectionMode, setConnectionMode] = useState<"phone" | "webrtc">(rep.phone ? "phone" : "webrtc");
  const webrtc = useSignalWireWebRTC();
  const [dialMode, setDialMode] = useState<"single" | "multi">("single");
  const [linesCount, setLinesCount] = useState(3);
  const [batchInfo, setBatchInfo] = useState<{ linesDialed: number; connected: boolean; settled: boolean } | null>(null);
  const [dialingLeads, setDialingLeads] = useState<{ name: string; businessName: string; phone: string }[]>([]);

  // Feature toggles
  const [autoAdvance, setAutoAdvance] = useState(true);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Callback date picker
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackDate, setCallbackDate] = useState("");

  // AI + summary
  const [lastAnalysis, setLastAnalysis] = useState<CallAnalysis | null>(null);
  const [analyzingCall, setAnalyzingCall] = useState(false);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Voicemail + recording
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // WebRTC lead tracking
  const webrtcLeadIndexRef = useRef(0);

  // ── Live session stats ─────────────────────────────────
  const stats = {
    calls: callLog.length,
    connected: callLog.filter(c => ["interested","callback","not_interested"].includes(c.disposition || "")).length,
    interested: callLog.filter(c => c.disposition === "interested").length,
    noAnswer: callLog.filter(c => c.disposition === "no_answer" || c.disposition === "voicemail").length,
  };

  // ── Next lead preview ──────────────────────────────────
  const nextLeadIndex = connectionMode === "webrtc" ? webrtcLeadIndexRef.current : position;
  const nextLead = nextLeadIndex < leads.length ? leads[nextLeadIndex] : null;

  // ── Polling ────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/api/dialer/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (status !== "paused") setStatus(data.status);
      setCallLog(data.callLog || []);
      if (data.currentLead) setCurrentLead(data.currentLead);
      if (data.dialMode) setDialMode(data.dialMode);
      if (data.lines) setLinesCount(data.lines);
      if (data.batch) setBatchInfo(data.batch);
      if (data.total) setTotalLeads(data.total);
      if (data.lastCallAnalysis && !lastAnalysis) setLastAnalysis(data.lastCallAnalysis);
    } catch { /* non-fatal */ }
  }, [sessionId, lastAnalysis, status]);

  useEffect(() => {
    if (sessionId && status !== "ended" && status !== "idle" && status !== "paused") {
      pollRef.current = setInterval(pollStatus, 2000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [sessionId, status, pollStatus]);

  // ── Call timer (persists into wrap_up) ─────────────────
  useEffect(() => {
    if (status === "on_call") {
      setCallTimer(0);
      timerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
    } else if (status === "wrap_up") {
      // Stop counting but preserve the value
      if (timerRef.current) clearInterval(timerRef.current);
      setLastCallDuration(callTimer);
    } else if (status === "dialing" || status === "connecting_rep") {
      if (timerRef.current) clearInterval(timerRef.current);
      setCallTimer(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ── WebRTC call state sync ─────────────────────────────
  useEffect(() => {
    if (connectionMode !== "webrtc") return;
    if (webrtc.callState === "active" && status === "dialing") setStatus("on_call");
    else if ((webrtc.callState === "hangup" || webrtc.callState === "destroy" || webrtc.callState === "idle") && status === "on_call") setStatus("wrap_up");
  }, [webrtc.callState, status, connectionMode]);

  // ── Auto AI analysis on wrap_up ────────────────────────
  useEffect(() => {
    if (status === "wrap_up" && sessionId && callLog.length > 0 && !analyzingCall && !lastAnalysis) {
      const last = callLog[callLog.length - 1];
      if (last?.id && !last.analysis) requestAnalysis(last.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, callLog.length]);

  // ── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire if typing in an input
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

      // 1-7: Dispositions (during wrap_up or on_call)
      if ((status === "wrap_up" || status === "on_call") && e.key >= "1" && e.key <= "7") {
        const d = DISPOSITIONS[parseInt(e.key) - 1];
        if (d) { e.preventDefault(); handleDisposition(d.value); }
      }
      // Space: Dial next (during connecting_rep or wrap_up)
      if (e.code === "Space" && (status === "connecting_rep" || status === "wrap_up") && !autoAdvance) {
        e.preventDefault(); dialNext();
      }
      // S: Skip lead (during dialing)
      if (e.key === "s" && status === "dialing") { e.preventDefault(); skipLead(); }
      // P: Pause/Resume
      if (e.key === "p" && sessionId && status !== "idle" && status !== "ended") {
        e.preventDefault();
        status === "paused" ? resumeSession() : pauseSession();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionId, autoAdvance]);

  // ── Actions ────────────────────────────────────────────
  async function requestAnalysis(callId: string) {
    if (!sessionId) return;
    setAnalyzingCall(true);
    try {
      const res = await apiFetch("/api/dialer/call-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, callId }) });
      const data = await res.json();
      if (data.analysis) setLastAnalysis(data.analysis);
    } catch { /* non-fatal */ }
    finally { setAnalyzingCall(false); }
  }

  async function startSession() {
    setError("");
    try {
      const res = await apiFetch("/api/dialer/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repId: rep.id, repName: rep.name, repPhone: connectionMode === "phone" ? rep.phone : undefined, leads, dialMode, lines: dialMode === "multi" ? linesCount : 1, connectionMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.sessionId);
      setStatus("connecting_rep");
      if (connectionMode === "webrtc" && data.webrtc) {
        webrtc.connect({ ...data.webrtc, callerNumber: data.callerNumber || "" });
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to start"); }
  }

  async function dialNext() {
    if (!sessionId) return;
    setError(""); setNotes(""); setCallTimer(0); setLastAnalysis(null); setDroppingVoicemail(false);
    if (autoAdvanceTimerRef.current) { clearTimeout(autoAdvanceTimerRef.current); autoAdvanceTimerRef.current = null; }

    // WebRTC: browser dials directly
    if (connectionMode === "webrtc" && webrtc.isConnected) {
      const idx = webrtcLeadIndexRef.current;
      if (idx >= leads.length) { setStatus("ended"); return; }
      const lead = leads[idx];
      webrtcLeadIndexRef.current = idx + 1;
      setCurrentLead(lead); setPosition(idx + 1); setStatus("dialing"); setDialingLeads([]);
      webrtc.makeCall(lead.phone);
      apiFetch("/api/dialer/next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, webrtcDial: true, leadIndex: idx }) }).catch(() => {});
      return;
    }

    // Phone: server dials
    try {
      const res = await apiFetch("/api/dialer/next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.done) { setStatus("ended"); return; }
      if (data.dialMode === "multi" && data.leads) { setDialingLeads(data.leads); setDialMode("multi"); setLinesCount(data.lines || data.leads.length); } else { setDialingLeads([]); }
      if (data.lead) setCurrentLead(data.lead);
      setPosition(data.position); setStatus("dialing");
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to dial"); }
  }

  async function handleDisposition(disposition: Disposition) {
    if (!sessionId) return;

    // Callback: show date picker first
    if (disposition === "callback" && !callbackDate) {
      setShowCallbackPicker(true);
      return;
    }

    try {
      const body: Record<string, unknown> = { sessionId, disposition, notes };
      if (disposition === "callback" && callbackDate) {
        body.callbackDate = callbackDate;
      }

      const res = await apiFetch("/api/dialer/disposition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotes(""); setLastAnalysis(null); setShowCallbackPicker(false); setCallbackDate("");

      // Auto-advance: dial next after a short pause
      if (autoAdvance) {
        setStatus("connecting_rep");
        autoAdvanceTimerRef.current = setTimeout(() => dialNext(), 800);
      } else {
        setStatus("connecting_rep");
      }
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to set disposition"); }
  }

  function skipLead() {
    // In WebRTC mode, hang up current call and advance
    if (connectionMode === "webrtc") {
      webrtc.hangupCall();
    }
    handleDisposition("no_answer");
  }

  function pauseSession() { setStatus("paused"); }
  function resumeSession() { setStatus("connecting_rep"); }

  async function dropVoicemail() {
    if (!sessionId || droppingVoicemail) return;
    setDroppingVoicemail(true);
    try {
      const res = await apiFetch("/api/dialer/voicemail-drop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLastAnalysis(null);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to drop voicemail"); }
    finally { setDroppingVoicemail(false); }
  }

  function toggleRecording(entry: CallLogEntry) {
    if (!entry.recordingUrl) return;
    if (playingRecordingId === entry.id) {
      audioRef.current?.pause(); audioRef.current = null; setPlayingRecordingId(null);
    } else {
      audioRef.current?.pause();
      const audio = new Audio(entry.recordingUrl);
      audio.onended = () => { setPlayingRecordingId(null); audioRef.current = null; };
      audio.play(); audioRef.current = audio; setPlayingRecordingId(entry.id);
    }
  }

  async function requestDailySummary() {
    if (!sessionId) return;
    setLoadingSummary(true);
    try {
      const res = await apiFetch("/api/dialer/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDailySummary(data);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to generate summary"); }
    finally { setLoadingSummary(false); }
  }

  async function endSession() {
    if (!sessionId) return;
    try { await apiFetch("/api/dialer/end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) }); } catch { /* best effort */ }
    webrtc.disconnect(); audioRef.current?.pause(); audioRef.current = null; setPlayingRecordingId(null); setStatus("ended");
  }

  function fmt(s: number) { return `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`; }

  const sentimentColor: Record<string, string> = { positive: "text-green-400", neutral: "text-gray-400", negative: "text-red-400" };

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      {/* ── Header with live stats ──────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Power Dialer</h1>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">{rep.name}</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500">{stats.calls} calls</span>
            <span className="text-green-500">{stats.connected} connects</span>
            <span className="text-green-400">{stats.interested} interested</span>
            <span className="text-gray-600">{position}/{totalLeads}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${
              status === "on_call" ? "bg-green-500 animate-pulse" :
              status === "dialing" ? "bg-blue-500 animate-pulse" :
              status === "connecting_rep" ? "bg-yellow-500 animate-pulse" :
              status === "wrap_up" ? "bg-orange-500" :
              status === "paused" ? "bg-yellow-500" :
              status === "monitoring" ? "bg-purple-500 animate-pulse" :
              "bg-gray-500"
            }`} />
            <span className="text-sm font-medium">
              {status === "on_call" ? "Live Call" :
               status === "dialing" ? (dialMode === "multi" ? `Ringing ${linesCount} Lines` : "Ringing") :
               status === "connecting_rep" ? "Ready" :
               status === "wrap_up" ? "Wrap Up" :
               status === "paused" ? "Paused" :
               status === "monitoring" ? "Claude Driving" :
               status === "ended" ? "Ended" : "Ready"}
            </span>
          </div>

          {/* Auto-advance toggle */}
          {status !== "idle" && status !== "ended" && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)} className="accent-green-600 w-3.5 h-3.5" />
              <span className="text-xs text-gray-500">Auto</span>
            </label>
          )}

          {/* Pause/Resume */}
          {sessionId && status !== "idle" && status !== "ended" && (
            <button
              onClick={status === "paused" ? resumeSession : pauseSession}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                status === "paused" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-300"
              }`}
            >
              {status === "paused" ? "Resume (P)" : "Pause (P)"}
            </button>
          )}

          {/* End session */}
          {status !== "ended" && status !== "idle" && (
            <button onClick={endSession} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg">End</button>
          )}
          {status === "ended" && (
            <button onClick={onEnd} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg">New Session</button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-2.5 bg-red-900/40 border border-red-800/50 rounded-lg text-red-400 text-sm mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-red-500 hover:text-red-400 ml-2">&times;</button>
        </div>
      )}

      {/* Paused overlay */}
      {status === "paused" && (
        <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-8 text-center mb-4">
          <h2 className="text-xl font-semibold text-yellow-400 mb-2">Session Paused</h2>
          <p className="text-gray-400 mb-4">Your place is saved at lead {position} of {totalLeads}.</p>
          <button onClick={resumeSession} className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl">Resume Dialing</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Main Panel ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* ── IDLE: Start screen ──────────────────── */}
          {status === "idle" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-1">Ready to Dial</h2>
                <p className="text-gray-500 text-sm">{totalLeads} leads loaded</p>
              </div>

              {/* Connection + Dial mode toggles */}
              <div className="max-w-md mx-auto space-y-4 mb-6">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">Call Via</label>
                    <div className="flex rounded-lg bg-gray-800 p-1">
                      <button onClick={() => setConnectionMode("webrtc")} className={`flex-1 py-2 text-sm rounded-md ${connectionMode === "webrtc" ? "bg-green-600 text-white" : "text-gray-400"}`}>Browser</button>
                      <button onClick={() => setConnectionMode("phone")} disabled={!rep.phone} className={`flex-1 py-2 text-sm rounded-md ${connectionMode === "phone" ? "bg-green-600 text-white" : "text-gray-400 disabled:text-gray-600"}`}>Phone</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 text-center">Dial Mode</label>
                    <div className="flex rounded-lg bg-gray-800 p-1">
                      <button onClick={() => setDialMode("single")} className={`flex-1 py-2 text-sm rounded-md ${dialMode === "single" ? "bg-blue-600 text-white" : "text-gray-400"}`}>Single</button>
                      <button onClick={() => setDialMode("multi")} className={`flex-1 py-2 text-sm rounded-md ${dialMode === "multi" ? "bg-blue-600 text-white" : "text-gray-400"}`}>Multi</button>
                    </div>
                  </div>
                </div>
                {dialMode === "multi" && (
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-xs">2</span>
                      <input type="range" min={2} max={5} value={linesCount} onChange={e => setLinesCount(parseInt(e.target.value))} className="flex-1 accent-blue-600" />
                      <span className="text-gray-500 text-xs">5</span>
                      <span className="text-gray-400 text-sm font-mono w-4">{linesCount}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-center">
                <button onClick={startSession} className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white text-lg font-bold rounded-xl">
                  Start {dialMode === "multi" ? `Multi-Line (${linesCount}x)` : "Dialing"}
                </button>
              </div>
            </div>
          )}

          {/* ── CONNECTING ──────────────────────────── */}
          {status === "connecting_rep" && !currentLead && callLog.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
              {connectionMode === "webrtc" ? (
                <>
                  <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <h2 className="text-lg font-semibold mb-1">{webrtc.isConnected ? "Browser connected!" : "Connecting..."}</h2>
                  <p className="text-gray-500 text-sm">{webrtc.isConnected ? "Press Dial Next or Space to start." : "Requesting microphone..."}</p>
                  {webrtc.error && <p className="text-red-400 text-sm mt-2">{webrtc.error}</p>}
                </>
              ) : (
                <>
                  <div className="w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <h2 className="text-lg font-semibold mb-1">Calling your phone...</h2>
                  <p className="text-gray-500 text-sm">Answer to join, then press Dial Next.</p>
                </>
              )}
            </div>
          )}

          {/* ── ACTIVE DIALER PANEL ─────────────────── */}
          {sessionId && !["idle","ended","paused"].includes(status) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">

              {/* Current lead header */}
              {currentLead && ["dialing","on_call","wrap_up"].includes(status) ? (
                <div className="mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{currentLead.name}</h2>
                      {currentLead.businessName && <p className="text-gray-400">{currentLead.businessName}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-gray-500 text-sm">{currentLead.phone}</span>
                        {currentLead.id && !currentLead.id.startsWith("db-") && !currentLead.id.startsWith("upload-") && (
                          <a href={`https://app.gohighlevel.com/v2/location/n778xwOps9t8Q34eRPfM/contacts/detail/${currentLead.id}`} target="_blank" rel="noopener noreferrer" className="text-orange-400 text-xs hover:underline">GHL &rarr;</a>
                        )}
                        {currentLead._salesforceId && (
                          <a href={`https://customization-data-47--dev.sandbox.lightning.force.com/lightning/r/${currentLead._salesforceType || "Contact"}/${currentLead._salesforceId}/view`} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-xs hover:underline">SF &rarr;</a>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{position}/{totalLeads}</p>
                      {(status === "on_call" || status === "wrap_up") && (
                        <p className={`text-2xl font-mono mt-1 ${status === "on_call" ? "text-green-400" : "text-gray-500"}`}>
                          {fmt(status === "on_call" ? callTimer : lastCallDuration)}
                        </p>
                      )}
                    </div>
                  </div>
                  <LeadContextCard lead={currentLead} />
                </div>
              ) : (
                <div className="text-center mb-4">
                  <p className="text-gray-500">{callLog.length === 0 ? "Ready. Press Dial Next or Space." : "Ready for the next lead."}</p>
                </div>
              )}

              {/* Dial Next / Skip buttons */}
              {(status === "connecting_rep" || (status === "wrap_up" && !autoAdvance)) && (
                <div className="flex gap-2">
                  <button onClick={dialNext} className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white text-lg font-bold rounded-xl">
                    Dial Next {!autoAdvance && <span className="text-green-300 text-sm ml-1">(Space)</span>}
                  </button>
                  {nextLead && (
                    <button onClick={skipLead} className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm font-medium">
                      Skip (S)
                    </button>
                  )}
                </div>
              )}

              {/* Auto-advancing indicator */}
              {status === "wrap_up" && autoAdvance && (
                <div className="text-center py-2">
                  <p className="text-gray-500 text-sm">Auto-dialing next lead after disposition...</p>
                </div>
              )}

              {/* Dialing indicator */}
              {status === "dialing" && (
                <div className="py-3">
                  {dialMode === "multi" && dialingLeads.length > 1 ? (
                    <div>
                      <p className="text-blue-400 font-semibold text-center mb-3">Ringing {dialingLeads.length} lines — first to answer connects</p>
                      <div className="grid gap-1.5">
                        {dialingLeads.map((dl, i) => (
                          <div key={i} className="flex items-center gap-3 px-3 py-2 bg-blue-900/15 border border-blue-800/30 rounded-lg">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                            <span className="text-sm text-gray-200">{dl.name}</span>
                            {dl.businessName && <span className="text-gray-500 text-sm">— {dl.businessName}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-blue-400">Ringing {currentLead?.name}...</p>
                    </div>
                  )}
                  <div className="mt-3 flex justify-center gap-2">
                    <button onClick={skipLead} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg">Skip (S)</button>
                    <button onClick={dropVoicemail} disabled={droppingVoicemail} className="px-3 py-1.5 bg-purple-600/70 hover:bg-purple-600 text-white text-xs rounded-lg">{droppingVoicemail ? "Dropping..." : "Drop VM"}</button>
                  </div>
                </div>
              )}

              {/* On Call */}
              {status === "on_call" && (
                <div className="flex items-center justify-center gap-3 py-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-green-400 font-medium">Live{dialMode === "multi" && currentLead ? ` with ${currentLead.name}` : ""}</span>
                  {connectionMode === "webrtc" && (
                    <button onClick={webrtc.toggleMute} className={`px-3 py-1.5 text-xs rounded-lg ${webrtc.isMuted ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300"}`}>{webrtc.isMuted ? "Unmute" : "Mute"}</button>
                  )}
                  <button onClick={dropVoicemail} disabled={droppingVoicemail} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-lg">{droppingVoicemail ? "Dropping..." : "Drop VM"}</button>
                </div>
              )}
            </div>
          )}

          {/* ── Disposition + Notes Panel ────────────── */}
          {(status === "wrap_up" || status === "on_call") && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              {/* AI analysis */}
              {analyzingCall && (
                <div className="flex items-center gap-2 mb-3 p-2.5 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-blue-300 text-sm">Analyzing call...</span>
                </div>
              )}

              {lastAnalysis && (
                <div className="mb-4 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase">AI Analysis</span>
                    <span className={`text-xs ${sentimentColor[lastAnalysis.leadSentiment]}`}>{lastAnalysis.leadSentiment}</span>
                  </div>
                  <p className="text-sm text-gray-300 mb-2">{lastAnalysis.summary}</p>
                  {lastAnalysis.keyPoints.length > 0 && (
                    <ul className="text-xs text-gray-400 space-y-0.5 mb-2">
                      {lastAnalysis.keyPoints.map((p, i) => <li key={i}>- {p}</li>)}
                    </ul>
                  )}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
                    <span className="text-[10px] text-gray-500">AI suggests:</span>
                    <button onClick={() => handleDisposition(lastAnalysis.disposition)} className="px-2.5 py-1 bg-blue-600/40 hover:bg-blue-600 text-blue-300 text-xs rounded-md">
                      {lastAnalysis.disposition.replace("_"," ")}
                    </button>
                  </div>
                </div>
              )}

              {/* Disposition buttons with keyboard hints */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mb-3">
                {DISPOSITIONS.map(d => (
                  <button key={d.value} onClick={() => handleDisposition(d.value)} className={`${d.color} hover:opacity-90 text-white text-xs font-medium py-2.5 px-2 rounded-lg transition-opacity text-center`}>
                    <span className="block">{d.label}</span>
                    <span className="block text-[10px] opacity-60 mt-0.5">{d.key}</span>
                  </button>
                ))}
              </div>

              {/* Callback date picker */}
              {showCallbackPicker && (
                <div className="mb-3 p-3 bg-blue-900/20 border border-blue-800/40 rounded-lg">
                  <p className="text-xs text-blue-300 mb-2 font-medium">When should we call back?</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={callbackDate}
                      onChange={e => setCallbackDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => { if (callbackDate) handleDisposition("callback"); }}
                      disabled={!callbackDate}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm font-medium rounded-lg"
                    >
                      Set Callback
                    </button>
                    <button
                      onClick={() => { setShowCallbackPicker(false); setCallbackDate(""); }}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {["Tomorrow", "2 days", "3 days", "1 week"].map(label => {
                      const days = label === "Tomorrow" ? 1 : label === "2 days" ? 2 : label === "3 days" ? 3 : 7;
                      const d = new Date(); d.setDate(d.getDate() + days);
                      const val = d.toISOString().split("T")[0];
                      return (
                        <button key={label} onClick={() => setCallbackDate(val)}
                          className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${callbackDate === val ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-300"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notes — visible during on_call AND wrap_up */}
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes... (visible to AI for analysis)"
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />

              {/* Next lead preview */}
              {status === "wrap_up" && nextLead && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Up Next</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-300">{nextLead.name}</span>
                      {nextLead.businessName && <span className="text-gray-500 text-sm ml-2">— {nextLead.businessName}</span>}
                    </div>
                    <span className="text-gray-600 text-xs">{nextLead.phone}</span>
                  </div>
                  {(nextLead._lastNote || nextLead._industry) && (
                    <p className="text-xs text-gray-600 mt-0.5 truncate">
                      {nextLead._industry && <span>{nextLead._industry}</span>}
                      {nextLead._industry && nextLead._lastNote && <span> · </span>}
                      {nextLead._lastNote && <span>{nextLead._lastNote}</span>}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── SESSION ENDED ────────────────────────── */}
          {status === "ended" && (
            <div className="space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-lg font-semibold mb-3">Session Complete</h2>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { label: "Calls", value: stats.calls, color: "text-white" },
                    { label: "Interested", value: stats.interested, color: "text-green-400" },
                    { label: "Callbacks", value: callLog.filter(c => c.disposition === "callback").length, color: "text-blue-400" },
                    { label: "No Answer", value: stats.noAnswer, color: "text-gray-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-800 rounded-lg p-3 text-center">
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-gray-500 text-xs">{s.label}</p>
                    </div>
                  ))}
                </div>
                {!dailySummary && (
                  <button onClick={requestDailySummary} disabled={loadingSummary} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2">
                    {loadingSummary ? <><div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />Generating briefing...</> : "Get AI Briefing"}
                  </button>
                )}
              </div>
              {dailySummary && (
                <div className="bg-gray-900 border border-blue-800/30 rounded-xl p-5">
                  <h3 className="text-base font-semibold mb-3">Daily Briefing</h3>
                  <p className="text-sm text-gray-300 mb-3 whitespace-pre-line">{dailySummary.recap}</p>
                  {dailySummary.hotLeads.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-green-400 font-medium mb-1">Hot Leads</p>
                      {dailySummary.hotLeads.map((l, i) => <p key={i} className="text-sm text-gray-300">· {l}</p>)}
                    </div>
                  )}
                  {dailySummary.followUpPlan.length > 0 && (
                    <div>
                      <p className="text-xs text-blue-400 font-medium mb-1">Follow-Up Plan</p>
                      {dailySummary.followUpPlan.map((f, i) => <p key={i} className="text-sm text-gray-300">{i+1}. {f}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Call Log ──────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Call Log ({callLog.length})</h3>
            {callLog.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-6">No calls yet</p>
            ) : (
              <div className="space-y-1.5 max-h-[700px] overflow-y-auto">
                {[...callLog].reverse().map(entry => (
                  <div key={entry.id} className="bg-gray-800/40 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-800/70" onClick={() => setExpandedCallId(expandedCallId === entry.id ? null : entry.id)}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">{entry.leadName}</span>
                      <DispositionBadge d={entry.disposition} />
                    </div>
                    {entry.leadBusinessName && <p className="text-gray-500 text-xs truncate">{entry.leadBusinessName}</p>}
                    <div className="flex items-center justify-between mt-0.5">
                      {entry.duration ? <span className="text-gray-600 text-xs">{fmt(entry.duration)}</span> : <span />}
                      <div className="flex gap-1">
                        {entry.recordingUrl && <span className="text-[9px] bg-gray-600/30 text-gray-500 px-1 rounded">REC</span>}
                        {entry.analysis && <span className="text-[9px] bg-blue-600/20 text-blue-400 px-1 rounded">AI</span>}
                      </div>
                    </div>
                    {expandedCallId === entry.id && (
                      <div className="mt-2 pt-2 border-t border-gray-700 text-xs space-y-2">
                        {entry.recordingUrl && (
                          <button onClick={e => { e.stopPropagation(); toggleRecording(entry); }} className={`w-full py-1.5 rounded text-xs font-medium ${playingRecordingId === entry.id ? "bg-red-600/30 text-red-300" : "bg-green-600/20 text-green-300"}`}>
                            {playingRecordingId === entry.id ? "Stop" : "Play Recording"}
                          </button>
                        )}
                        {entry.analysis && (
                          <div>
                            <p className="text-gray-300 mb-1">{entry.analysis.summary}</p>
                            {entry.analysis.keyPoints.map((p, i) => <p key={i} className="text-gray-400">- {p}</p>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Keyboard shortcuts hint */}
          {sessionId && status !== "idle" && status !== "ended" && (
            <div className="mt-3 px-3 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Shortcuts</p>
              <div className="grid grid-cols-2 gap-x-3 text-[10px] text-gray-500">
                <span><kbd className="bg-gray-800 px-1 rounded">1-7</kbd> Disposition</span>
                <span><kbd className="bg-gray-800 px-1 rounded">Space</kbd> Dial Next</span>
                <span><kbd className="bg-gray-800 px-1 rounded">S</kbd> Skip Lead</span>
                <span><kbd className="bg-gray-800 px-1 rounded">P</kbd> Pause</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────
function DispositionBadge({ d }: { d?: string }) {
  if (!d) return <span className="text-gray-600 text-xs">pending</span>;
  const found = DISPOSITIONS.find(x => x.value === d);
  return found
    ? <span className={`${found.color} text-white text-[10px] font-medium px-2 py-0.5 rounded-full`}>{found.label}</span>
    : <span className="text-gray-400 text-xs">{d}</span>;
}

function LeadContextCard({ lead }: { lead: Lead }) {
  const fields = [
    { label: "Industry", value: lead._industry },
    { label: "Revenue", value: lead._monthlyRevenue },
    { label: "Yrs in Biz", value: lead._yearsInBusiness },
    { label: "Requested", value: lead._amountRequested },
    { label: "Credit", value: lead._creditScore },
    { label: "Prev Funded", value: lead._previouslyFunded },
  ].filter(f => f.value);

  if (fields.length === 0 && !lead._lastNote && !lead._lastDisposition) return null;

  return (
    <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg p-3 mt-2">
      {fields.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-2">
          {fields.map(f => (
            <div key={f.label}>
              <p className="text-[9px] text-gray-500 uppercase">{f.label}</p>
              <p className="text-xs text-gray-300">{f.value}</p>
            </div>
          ))}
        </div>
      )}
      {lead._approvalLetter && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-green-900/20 border border-green-800/30 rounded mb-2">
          <span className="text-green-400 text-xs font-semibold">Approval on file</span>
          <a href={lead._approvalLetter} target="_blank" rel="noopener noreferrer" className="text-green-400 text-xs underline ml-auto">View</a>
        </div>
      )}
      {lead._lastDisposition && <p className="text-xs text-gray-500 mb-1">Last: {lead._lastDisposition}{lead.lastContactedAt ? ` (${lead.lastContactedAt})` : ""}</p>}
      {lead._lastNote && <p className="text-xs text-gray-500 line-clamp-2">{lead._lastNote}</p>}
      {lead.tags && lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {lead.tags.slice(0, 5).map((t, i) => <span key={i} className="px-1.5 py-0.5 bg-gray-700/40 text-gray-500 text-[9px] rounded-full">{t}</span>)}
          {lead.tags.length > 5 && <span className="text-[9px] text-gray-600">+{lead.tags.length - 5}</span>}
        </div>
      )}
    </div>
  );
}
