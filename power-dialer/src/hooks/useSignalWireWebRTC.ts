"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface WebRTCConfig {
  token: string;
  resource: string;
  project: string;
}

interface UseSignalWireWebRTCReturn {
  isConnected: boolean;
  isOnCall: boolean;
  isMuted: boolean;
  error: string | null;
  connect: (config: WebRTCConfig) => void;
  disconnect: () => void;
  toggleMute: () => void;
}

export function useSignalWireWebRTC(): UseSignalWireWebRTCReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isOnCall, setIsOnCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentCallRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create a hidden audio element for remote audio
  useEffect(() => {
    if (typeof window === "undefined") return;

    let el = document.getElementById("sw-remote-audio") as HTMLAudioElement;
    if (!el) {
      el = document.createElement("audio");
      el.id = "sw-remote-audio";
      el.autoplay = true;
      document.body.appendChild(el);
    }
    audioRef.current = el;

    return () => {
      if (clientRef.current) {
        try { clientRef.current.disconnect(); } catch { /* cleanup */ }
      }
    };
  }, []);

  const connect = useCallback(async (config: WebRTCConfig) => {
    setError(null);

    try {
      // Dynamically import to avoid SSR issues
      const { Relay } = await import("@signalwire/js");

      const client = new Relay({
        project: config.project,
        token: config.token,
      });

      // Configure for audio only
      client.remoteElement = "sw-remote-audio";
      client.enableMicrophone();
      client.disableWebcam();

      client.on("signalwire.ready", () => {
        console.log("[WebRTC] Connected to SignalWire");
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
      });

      // Handle inbound calls (server calls our WebRTC client into the conference)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.on("signalwire.notification", (notification: any) => {
        if (notification.type === "callUpdate") {
          const call = notification.call;
          console.log("[WebRTC] Call state:", call.prevState, "->", call.state);

          switch (call.state) {
            case "ringing":
              // Auto-answer inbound calls (server calling us into conference)
              console.log("[WebRTC] Auto-answering inbound call");
              call.answer();
              currentCallRef.current = call;
              break;
            case "active":
              setIsOnCall(true);
              currentCallRef.current = call;
              break;
            case "hangup":
            case "destroy":
              setIsOnCall(false);
              currentCallRef.current = null;
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

  const disconnect = useCallback(() => {
    if (currentCallRef.current) {
      try { currentCallRef.current.hangup(); } catch { /* cleanup */ }
      currentCallRef.current = null;
    }
    if (clientRef.current) {
      try { clientRef.current.disconnect(); } catch { /* cleanup */ }
      clientRef.current = null;
    }
    setIsConnected(false);
    setIsOnCall(false);
    setIsMuted(false);
  }, []);

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

  return { isConnected, isOnCall, isMuted, error, connect, disconnect, toggleMute };
}
