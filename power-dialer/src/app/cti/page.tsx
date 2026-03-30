"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ────────────────────────────────────────────────
interface SFContact {
  id: string;
  name: string;
  phone: string;
  type: "Contact" | "Lead";
}

type CallState = "idle" | "connecting" | "ringing" | "on_call" | "wrap_up";
type Disposition = "interested" | "callback" | "not_interested" | "no_answer" | "voicemail" | "wrong_number" | "disconnected";

const DISPOSITIONS: { value: Disposition; label: string; color: string; key: string }[] = [
  { value: "interested", label: "Interested", color: "bg-green-600", key: "1" },
  { value: "callback", label: "Callback", color: "bg-blue-600", key: "2" },
  { value: "not_interested", label: "Not Int.", color: "bg-orange-600", key: "3" },
  { value: "no_answer", label: "No Answer", color: "bg-gray-600", key: "4" },
  { value: "voicemail", label: "Voicemail", color: "bg-purple-600", key: "5" },
  { value: "wrong_number", label: "Wrong #", color: "bg-red-600", key: "6" },
  { value: "disconnected", label: "Disconn.", color: "bg-red-800", key: "7" },
];

const DIALER_API_KEY = "9808aca70802f6107fe904345b5adc32de4c342a07d33b20ab8b17158c625dfd";
const DASHBOARD_URL = typeof window !== "undefined" ? window.location.origin : "";

// ── Salesforce Open CTI API ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { sforce?: any; } }

function getSFCTI() {
  return typeof window !== "undefined" && window.sforce?.opencti ? window.sforce.opencti : null;
}

// ── Component ────────────────────────────────────────────
export default function CTIAdapter() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [currentNumber, setCurrentNumber] = useState("");
  const [currentContact, setCurrentContact] = useState<SFContact | null>(null);
  const [callTimer, setCallTimer] = useState(0);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [manualNumber, setManualNumber] = useState("");
  const [ctiReady, setCtiReady] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webrtcClientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentCallRef = useRef<any>(null);
  const callStartRef = useRef<Date | null>(null);

  // ── Initialize Open CTI ────────────────────────────────
  useEffect(() => {
    // Load the Open CTI JS library
    const script = document.createElement("script");
    script.src = "/lightning/opencti_min.js";
    script.onload = () => {
      const cti = getSFCTI();
      if (cti) {
        // Register click-to-dial listener
        cti.onClickToDial({
          listener: (payload: { number: string; objectType: string; recordId: string; recordName: string }) => {
            console.log("[CTI] Click-to-dial:", payload);
            handleClickToDial(payload.number, payload.recordId, payload.recordName, payload.objectType as "Contact" | "Lead");
          },
        });

        // Enable click-to-dial
        cti.enableClickToDial({ callback: () => console.log("[CTI] Click-to-dial enabled") });

        // Set softphone visibility
        cti.setSoftphoneItemVisible({ visible: true });

        setCtiReady(true);
        console.log("[CTI] Open CTI initialized");
      } else {
        // Not in Salesforce — standalone mode
        console.log("[CTI] Not in Salesforce, running standalone");
        setCtiReady(true);
      }
    };
    script.onerror = () => {
      // Not in Salesforce iframe
      console.log("[CTI] Open CTI library not available (standalone mode)");
      setCtiReady(true);
    };
    document.head.appendChild(script);

    // Create audio element
    let el = document.getElementById("cti-remote-audio") as HTMLAudioElement;
    if (!el) {
      el = document.createElement("audio");
      el.id = "cti-remote-audio";
      el.autoplay = true;
      document.body.appendChild(el);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (webrtcClientRef.current) {
        try { webrtcClientRef.current.disconnect(); } catch { /* cleanup */ }
      }
    };
  }, []);

  // ── Connect WebRTC ─────────────────────────────────────
  async function connectWebRTC() {
    setError("");
    try {
      const res = await fetch(`${DASHBOARD_URL}/api/webrtc/token`, {
        method: "POST",
        headers: { "X-Dialer-Key": DIALER_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ repId: "cti-user" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const { Relay } = await import("@signalwire/js");
      const client = new Relay({ project: data.project, token: data.token });

      client.remoteElement = "cti-remote-audio";
      client.enableMicrophone();
      client.disableWebcam();

      client.on("signalwire.ready", () => {
        console.log("[CTI WebRTC] Connected");
        setCallState("idle");
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on("signalwire.notification", (notification: any) => {
        if (notification.type === "callUpdate") {
          const call = notification.call;
          switch (call.state) {
            case "trying": currentCallRef.current = call; break;
            case "early": setCallState("ringing"); break;
            case "active":
              setCallState("on_call");
              currentCallRef.current = call;
              callStartRef.current = new Date();
              screenPop();
              break;
            case "hangup":
            case "destroy":
              setCallState("wrap_up");
              currentCallRef.current = null;
              break;
          }
        }
      });

      client.connect();
      webrtcClientRef.current = client;
      setCallState("connecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "WebRTC connection failed");
    }
  }

  // ── Make a call ────────────────────────────────────────
  function makeCall(phoneNumber: string) {
    if (!webrtcClientRef.current) {
      setError("Not connected. Click Connect first.");
      return;
    }

    let digits = phoneNumber.replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (!digits.startsWith("+")) digits = "+" + digits;

    setCurrentNumber(digits);
    setCallState("ringing");
    setCallTimer(0);
    setNotes("");

    webrtcClientRef.current.newCall({
      destinationNumber: digits,
      callerNumber: "+14245508233", // Default caller ID
      audio: true,
      video: false,
    });
  }

  // ── Click-to-dial handler ──────────────────────────────
  function handleClickToDial(number: string, recordId: string, recordName: string, objectType: "Contact" | "Lead") {
    setCurrentContact({ id: recordId, name: recordName, phone: number, type: objectType });

    if (!webrtcClientRef.current) {
      connectWebRTC().then(() => {
        setTimeout(() => makeCall(number), 2000);
      });
    } else {
      makeCall(number);
    }
  }

  // ── Screen pop — open the record in SF ─────────────────
  function screenPop() {
    const cti = getSFCTI();
    if (!cti || !currentContact) return;

    cti.screenPop({
      type: cti.SCREENPOP_TYPE.SOBJECT,
      params: { recordId: currentContact.id },
      callback: (result: { success: boolean }) => {
        console.log("[CTI] Screen pop:", result.success ? "success" : "failed");
      },
    });
  }

  // ── Hang up ────────────────────────────────────────────
  function hangUp() {
    if (currentCallRef.current) {
      try { currentCallRef.current.hangup(); } catch { /* already ended */ }
    }
    setCallState("wrap_up");
  }

  // ── Toggle mute ────────────────────────────────────────
  function toggleMute() {
    if (!currentCallRef.current) return;
    if (isMuted) { currentCallRef.current.unmuteAudio(); } else { currentCallRef.current.muteAudio(); }
    setIsMuted(!isMuted);
  }

  // ── Set disposition + log to Salesforce ─────────────────
  async function handleDisposition(disposition: Disposition) {
    const duration = callStartRef.current
      ? Math.floor((Date.now() - callStartRef.current.getTime()) / 1000)
      : callTimer;

    // Log to Salesforce as a Task
    await logCallToSalesforce(disposition, duration);

    // Reset state
    setCallState("idle");
    setCurrentContact(null);
    setCurrentNumber("");
    setNotes("");
    setCallTimer(0);
    setIsMuted(false);
    callStartRef.current = null;
  }

  // ── Log call to Salesforce as Task ─────────────────────
  async function logCallToSalesforce(disposition: Disposition, durationSec: number) {
    const cti = getSFCTI();

    // Use Open CTI's saveLog if available
    if (cti && currentContact) {
      const dispLabel = DISPOSITIONS.find(d => d.value === disposition)?.label || disposition;

      cti.saveLog({
        value: {
          Subject: `Call - ${currentContact.name}`,
          Description: notes || `${dispLabel} call via TCG Power Dialer`,
          CallType: "Outbound",
          CallDisposition: dispLabel,
          CallDurationInSeconds: durationSec,
          Status: "Completed",
          ActivityDate: new Date().toISOString().split("T")[0],
          WhoId: currentContact.id,
        },
        callback: (result: { success: boolean; errors?: string[] }) => {
          if (result.success) {
            console.log("[CTI] Call logged to Salesforce");
          } else {
            console.error("[CTI] Failed to log call:", result.errors);
            // Fallback: try via our API
            logCallViaAPI(disposition, durationSec);
          }
        },
      });
    } else {
      // Not in SF or no contact — log via our API
      await logCallViaAPI(disposition, durationSec);
    }
  }

  // ── Fallback: log call via our Vercel API → SF REST ────
  async function logCallViaAPI(disposition: Disposition, durationSec: number) {
    try {
      await fetch(`${DASHBOARD_URL}/api/salesforce/log-call`, {
        method: "POST",
        headers: { "X-Dialer-Key": DIALER_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: currentNumber,
          contactId: currentContact?.id,
          contactType: currentContact?.type,
          disposition,
          duration: durationSec,
          notes,
        }),
      });
    } catch (err) {
      console.error("[CTI] API call log failed:", err);
    }
  }

  // ── Call timer ─────────────────────────────────────────
  useEffect(() => {
    if (callState === "on_call") {
      setCallTimer(0);
      timerRef.current = setInterval(() => setCallTimer(t => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  // ── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if ((callState === "wrap_up" || callState === "on_call") && e.key >= "1" && e.key <= "7") {
        const d = DISPOSITIONS[parseInt(e.key) - 1];
        if (d) { e.preventDefault(); handleDisposition(d.value); }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState, notes, currentContact, currentNumber]);

  const fmt = useCallback((s: number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`, []);

  // ── RENDER (Compact softphone layout) ──────────────────
  return (
    <div className="bg-gray-950 text-white min-h-screen p-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center">
            <span className="text-xs font-bold">T</span>
          </div>
          <span className="font-semibold text-xs">TCG Dialer</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            callState === "on_call" ? "bg-green-500 animate-pulse" :
            callState === "ringing" ? "bg-blue-500 animate-pulse" :
            callState === "connecting" ? "bg-yellow-500 animate-pulse" :
            webrtcClientRef.current ? "bg-green-500" : "bg-gray-500"
          }`} />
          <span className="text-[10px] text-gray-500">
            {callState === "on_call" ? "Live" :
             callState === "ringing" ? "Ringing" :
             callState === "connecting" ? "Connecting..." :
             webrtcClientRef.current ? "Ready" : "Disconnected"}
          </span>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-red-900/40 border border-red-800/50 rounded text-red-400 text-xs mb-2">
          {error}
          <button onClick={() => setError("")} className="ml-1 text-red-500">&times;</button>
        </div>
      )}

      {/* Not connected */}
      {!webrtcClientRef.current && callState !== "connecting" && (
        <div className="text-center py-6">
          <button onClick={connectWebRTC} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg">
            Connect Microphone
          </button>
          <p className="text-gray-600 text-[10px] mt-2">Click to enable browser calling</p>
        </div>
      )}

      {/* Connecting */}
      {callState === "connecting" && (
        <div className="text-center py-6">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-gray-400 text-xs">Connecting microphone...</p>
        </div>
      )}

      {/* Idle — manual dial */}
      {callState === "idle" && webrtcClientRef.current && (
        <div>
          <div className="flex gap-1.5 mb-3">
            <input
              type="tel"
              value={manualNumber}
              onChange={e => setManualNumber(e.target.value)}
              placeholder="Enter number..."
              className="flex-1 px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => { if (manualNumber.trim()) makeCall(manualNumber); }}
              disabled={!manualNumber.trim()}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium"
            >
              Call
            </button>
          </div>
          <p className="text-gray-600 text-[10px] text-center">Or click any phone number in Salesforce</p>
        </div>
      )}

      {/* Ringing */}
      {callState === "ringing" && (
        <div className="text-center py-4">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-blue-400 text-sm font-medium">Ringing...</p>
          {currentContact && <p className="text-gray-400 text-xs mt-1">{currentContact.name}</p>}
          <p className="text-gray-500 text-xs">{currentNumber}</p>
          <button onClick={hangUp} className="mt-3 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg">Cancel</button>
        </div>
      )}

      {/* On Call */}
      {callState === "on_call" && (
        <div>
          <div className="text-center mb-3">
            <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse mx-auto mb-1" />
            <p className="text-green-400 font-medium">Connected</p>
            {currentContact && <p className="text-white text-sm font-semibold">{currentContact.name}</p>}
            <p className="text-gray-500 text-xs">{currentNumber}</p>
            <p className="text-green-400 font-mono text-lg mt-1">{fmt(callTimer)}</p>
          </div>

          {/* Call controls */}
          <div className="flex justify-center gap-2 mb-3">
            <button onClick={toggleMute} className={`px-3 py-1.5 text-xs rounded-lg ${isMuted ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300"}`}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button onClick={hangUp} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg">
              End Call
            </button>
          </div>

          {/* Notes during call */}
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Call notes..."
            rows={2}
            className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Wrap Up */}
      {callState === "wrap_up" && (
        <div>
          <div className="text-center mb-3">
            <p className="text-orange-400 font-medium text-xs uppercase tracking-wider">Wrap Up</p>
            {currentContact && <p className="text-white text-sm">{currentContact.name}</p>}
            <p className="text-gray-500 text-xs">{fmt(callTimer)}</p>
          </div>

          {/* Disposition grid */}
          <div className="grid grid-cols-2 gap-1 mb-2">
            {DISPOSITIONS.map(d => (
              <button key={d.value} onClick={() => handleDisposition(d.value)}
                className={`${d.color} hover:opacity-90 text-white text-[11px] font-medium py-2 px-2 rounded transition-opacity`}>
                {d.label} <span className="opacity-50">{d.key}</span>
              </button>
            ))}
          </div>

          {/* Notes */}
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Call notes..."
            rows={2}
            className="w-full px-2.5 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}
