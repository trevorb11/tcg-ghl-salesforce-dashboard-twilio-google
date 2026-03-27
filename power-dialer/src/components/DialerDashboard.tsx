"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Rep {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface Lead {
  id: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  stageName: string;
}

type Status =
  | "idle"
  | "connecting_rep"
  | "dialing"
  | "on_call"
  | "wrap_up"
  | "ended";
type Disposition =
  | "interested"
  | "callback"
  | "not_interested"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "disconnected";

interface CallLogEntry {
  leadName: string;
  leadBusinessName: string;
  status: string;
  disposition?: string;
  duration?: number;
  startedAt: string;
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
}: {
  rep: Rep;
  leads: Lead[];
  onEnd: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [position, setPosition] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [callTimer, setCallTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll session status
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/dialer/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setCallLog(data.callLog || []);
      if (data.currentLead) {
        setCurrentLead(data.currentLead);
      }
      // If a call just completed and auto-dispositioned, update status
      if (data.status === "wrap_up" && data.lastCallDisposition) {
        // Auto-dispositioned (no_answer, voicemail) — can skip wrap_up
      }
    } catch {
      // Polling failure is non-fatal
    }
  }, [sessionId]);

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

  // Start session — calls the rep
  async function startSession() {
    setError("");
    try {
      const res = await fetch("/api/dialer/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: rep.id,
          repName: rep.name,
          repPhone: rep.phone,
          leads,
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

    try {
      const res = await fetch("/api/dialer/next", {
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

      setCurrentLead(data.lead);
      setPosition(data.position);
      setStatus("dialing");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to dial";
      setError(msg);
    }
  }

  // Set disposition
  async function setDisposition(disposition: Disposition) {
    if (!sessionId) return;

    try {
      const res = await fetch("/api/dialer/disposition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, disposition, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotes("");
      // After disposition, ready for next call
      setStatus("connecting_rep"); // Back to ready state
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to set disposition";
      setError(msg);
    }
  }

  // End session
  async function endSession() {
    if (!sessionId) return;
    try {
      await fetch("/api/dialer/end", {
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

  // Status indicator
  function StatusBadge({ s }: { s: Status }) {
    const config: Record<Status, { label: string; color: string; pulse: boolean }> = {
      idle: { label: "Ready", color: "bg-gray-500", pulse: false },
      connecting_rep: { label: "Connecting You...", color: "bg-yellow-500", pulse: true },
      dialing: { label: "Ringing Lead...", color: "bg-blue-500", pulse: true },
      on_call: { label: "Live Call", color: "bg-green-500", pulse: true },
      wrap_up: { label: "Wrap Up", color: "bg-orange-500", pulse: false },
      ended: { label: "Session Ended", color: "bg-gray-500", pulse: false },
    };
    const c = config[s];
    return (
      <div className="flex items-center gap-2">
        <div className={`w-3 h-3 rounded-full ${c.color} ${c.pulse ? "animate-pulse" : ""}`} />
        <span className="text-sm font-medium">{c.label}</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
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
          {/* Start Button (before session starts) */}
          {status === "idle" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
              <h2 className="text-xl font-semibold mb-2">Ready to Dial</h2>
              <p className="text-gray-400 mb-6">
                We&apos;ll call you at {rep.phone}, then start dialing your leads.
              </p>
              <button
                onClick={startSession}
                className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white text-lg font-bold rounded-xl transition-colors"
              >
                Start Dialing Session
              </button>
            </div>
          )}

          {/* Connecting Rep */}
          {status === "connecting_rep" && !currentLead && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
              <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                Calling your phone...
              </h2>
              <p className="text-gray-400">
                Answer the call to join the dialer. Then press &quot;Dial Next&quot; to start.
              </p>
            </div>
          )}

          {/* Ready to Dial Next (rep is connected, waiting to dial) */}
          {sessionId && status !== "idle" && status !== "ended" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              {/* Current Lead Info */}
              {currentLead && (status === "dialing" || status === "on_call" || status === "wrap_up") ? (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold">{currentLead.name}</h2>
                      {currentLead.businessName && (
                        <p className="text-gray-400 text-lg">
                          {currentLead.businessName}
                        </p>
                      )}
                      <p className="text-gray-500">{currentLead.phone}</p>
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
                <div className="text-center py-4">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-blue-400 font-medium">
                    Ringing {currentLead?.name}...
                  </p>
                </div>
              )}

              {/* On Call indicator */}
              {status === "on_call" && (
                <div className="text-center py-4">
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse mx-auto mb-2" />
                  <p className="text-green-400 font-medium text-lg">
                    Connected — You&apos;re live!
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Disposition Panel */}
          {(status === "wrap_up" || status === "on_call") && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                Call Disposition
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
                placeholder="Quick notes about this call..."
                rows={2}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          )}

          {/* Session Summary */}
          {status === "ended" && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <h2 className="text-xl font-semibold mb-4">Session Complete</h2>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-2xl font-bold">{callLog.length}</p>
                  <p className="text-gray-400 text-sm">Calls Made</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-2xl font-bold text-green-400">
                    {callLog.filter((c) => c.disposition === "interested").length}
                  </p>
                  <p className="text-gray-400 text-sm">Interested</p>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-2xl font-bold text-blue-400">
                    {callLog.filter((c) => c.disposition === "callback").length}
                  </p>
                  <p className="text-gray-400 text-sm">Callbacks</p>
                </div>
              </div>
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
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {[...callLog].reverse().map((entry, i) => (
                  <div
                    key={i}
                    className="bg-gray-800/50 rounded-lg px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate">
                        {entry.leadName}
                      </span>
                      <DispositionBadge d={entry.disposition} />
                    </div>
                    {entry.leadBusinessName && (
                      <p className="text-gray-500 text-xs truncate">
                        {entry.leadBusinessName}
                      </p>
                    )}
                    {entry.duration && (
                      <p className="text-gray-600 text-xs">
                        {formatTime(entry.duration)}
                      </p>
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
