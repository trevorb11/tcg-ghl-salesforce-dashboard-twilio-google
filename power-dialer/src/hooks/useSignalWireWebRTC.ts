"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface WebRTCConfig {
  token: string;
  resource: string;
  project: string;
  callerNumber: string; // The SignalWire phone number to use as caller ID
}

interface UseSignalWireWebRTCReturn {
  isConnected: boolean;
  isOnCall: boolean;
  isMuted: boolean;
  callState: string;
  error: string | null;
  connect: (config: WebRTCConfig) => void;
  disconnect: () => void;
  makeCall: (phoneNumber: string) => void;
  hangupCall: () => void;
  toggleMute: () => void;
  sendDTMF: (digit: string) => void;
}

export function useSignalWireWebRTC(): UseSignalWireWebRTCReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isOnCall, setIsOnCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callState, setCallState] = useState("idle");
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentCallRef = useRef<any>(null);
  const configRef = useRef<WebRTCConfig | null>(null);

  // Ring tone generator — plays a US-style ringback tone using Web Audio API
  const ringCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startRingTone() {
    if (typeof window === "undefined") return;
    stopRingTone();
    try {
      const ctx = new AudioContext();
      ringCtxRef.current = ctx;

      // US ringback: 440Hz + 480Hz, 2s on / 4s off
      function playRingBurst() {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.frequency.value = 440;
        osc2.frequency.value = 480;
        gain.gain.value = 0.15; // Louder but not jarring
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 2);
        osc2.stop(now + 2);
      }

      playRingBurst();
      ringIntervalRef.current = setInterval(playRingBurst, 6000); // 2s tone + 4s silence
    } catch { /* AudioContext not available */ }
  }

  function playConnectedChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }

  function stopRingTone() {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null; }
    if (ringCtxRef.current) { try { ringCtxRef.current.close(); } catch {} ringCtxRef.current = null; }
  }

  // Create hidden audio element for remote audio
  useEffect(() => {
    if (typeof window === "undefined") return;

    let el = document.getElementById("sw-remote-audio") as HTMLAudioElement;
    if (!el) {
      el = document.createElement("audio");
      el.id = "sw-remote-audio";
      el.autoplay = true;
      document.body.appendChild(el);
    }

    return () => {
      if (clientRef.current) {
        try { clientRef.current.disconnect(); } catch { /* cleanup */ }
      }
    };
  }, []);

  const connect = useCallback(async (config: WebRTCConfig) => {
    setError(null);
    configRef.current = config;

    try {
      const { Relay } = await import("@signalwire/js");

      const client = new Relay({
        project: config.project,
        token: config.token,
      });

      // Audio only
      client.remoteElement = "sw-remote-audio";
      client.enableMicrophone();
      client.disableWebcam();

      client.on("signalwire.ready", () => {
        console.log("[WebRTC] Connected to SignalWire, ready to make calls");
        setIsConnected(true);
        setError(null);
      });

      client.on("signalwire.error", (err: Error) => {
        console.error("[WebRTC] Error:", err);
        setError(err.message || "WebRTC connection error");
      });

      client.on("signalwire.socket.close", () => {
        console.log("[WebRTC] Disconnected");
        setIsConnected(false);
        setIsOnCall(false);
        setCallState("idle");
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on("signalwire.notification", (notification: any) => {
        if (notification.type === "callUpdate") {
          const call = notification.call;
          const prevState = call.prevState || "unknown";
          console.log(`[WebRTC] Call: ${prevState} -> ${call.state}`);
          setCallState(call.state);

          switch (call.state) {
            case "trying":
              // Outbound call initiated — start ring tone
              currentCallRef.current = call;
              startRingTone();
              break;
            case "early":
              // Ringing / early media — keep ring tone going
              break;
            case "active":
              // Call connected — lead answered! Stop ring tone, play chime
              stopRingTone();
              playConnectedChime();
              setIsOnCall(true);
              currentCallRef.current = call;
              break;
            case "hangup":
            case "destroy":
              stopRingTone();
              setIsOnCall(false);
              setCallState("idle");
              currentCallRef.current = null;
              break;
            case "ringing":
              // Inbound call — auto-answer (fallback for conference mode)
              call.answer();
              currentCallRef.current = call;
              break;
          }
        }

        if (notification.type === "userMediaError") {
          setError("Microphone access denied. Please allow microphone access and try again.");
        }
      });

      client.connect();
      clientRef.current = client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect WebRTC";
      console.error("[WebRTC] Connect error:", msg);
      setError(msg);
    }
  }, []);

  // Make an outbound call directly from the browser
  const makeCall = useCallback((phoneNumber: string) => {
    const client = clientRef.current;
    const config = configRef.current;

    if (!client || !config) {
      setError("Not connected to SignalWire. Please wait for connection.");
      return;
    }

    setError(null);
    setCallState("trying");

    try {
      console.log(`[WebRTC] Dialing ${phoneNumber} from ${config.callerNumber}`);
      client.newCall({
        destinationNumber: phoneNumber,
        callerNumber: config.callerNumber,
        audio: true,
        video: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to initiate call";
      console.error("[WebRTC] Call error:", msg);
      setError(msg);
      setCallState("idle");
    }
  }, []);

  // Hang up the current call
  const hangupCall = useCallback(() => {
    if (currentCallRef.current) {
      try {
        currentCallRef.current.hangup();
      } catch {
        // Already ended
      }
      currentCallRef.current = null;
    }
    setIsOnCall(false);
    setCallState("idle");
    setIsMuted(false);
  }, []);

  const disconnect = useCallback(() => {
    hangupCall();
    stopRingTone();
    if (clientRef.current) {
      try { clientRef.current.disconnect(); } catch { /* cleanup */ }
      clientRef.current = null;
    }
    setIsConnected(false);
  }, [hangupCall]);

  const toggleMute = useCallback(() => {
    if (currentCallRef.current) {
      if (isMuted) {
        currentCallRef.current.unmuteAudio();
      } else {
        currentCallRef.current.muteAudio();
      }
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const sendDTMF = useCallback((digit: string) => {
    if (currentCallRef.current) {
      try { currentCallRef.current.dtmf(digit); } catch { /* not supported or call ended */ }
    }
  }, []);

  return {
    isConnected, isOnCall, isMuted, callState, error,
    connect, disconnect, makeCall, hangupCall, toggleMute, sendDTMF,
  };
}
