"use client";

import { useState, useEffect } from "react";
import LoginScreen from "@/components/LoginScreen";
import LeadLoader from "@/components/LeadLoader";
import DialerDashboard from "@/components/DialerDashboard";
import { setApiKey, apiFetch } from "@/lib/api-client";

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
  pipelineId: string;
  pipelineStageId: string;
  stageName: string;
  opportunityId?: string;
  tags?: string[];
  lastContactedAt?: string;
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
}

type Screen = "login" | "load_leads" | "dialer" | "auto_connecting";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("login");
  const [rep, setRep] = useState<Rep | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [autoSessionId, setAutoSessionId] = useState<string | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);

  // On mount: check for ?token= auto-login param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const sessionId = params.get("sessionId");

    if (!token) return;

    setScreen("auto_connecting");

    // Verify token server-side
    fetch("/api/auth/verify-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setAutoError(data.error);
          setScreen("login");
          return;
        }

        // Set up API auth
        setApiKey(data.dialerKey);

        const repData: Rep = {
          id: data.id,
          name: data.name,
          email: data.email,
          phone: data.phone,
          role: data.role,
        };
        setRep(repData);

        // If a sessionId was provided (Claude started a session),
        // go straight to the dialer in monitoring mode
        const sid = sessionId || data.sessionId;
        if (sid) {
          setAutoSessionId(sid);
          // Fetch the session status to get the leads
          apiFetch(`/api/dialer/status?sessionId=${sid}`)
            .then((r) => r.json())
            .then((status) => {
              if (status.error) {
                // Session not found — fall back to lead loader
                setScreen("load_leads");
              } else {
                // Session is live — go to dialer with whatever leads we have
                setLeads(status.leads || []);
                setScreen("dialer");
              }
            })
            .catch(() => {
              setScreen("load_leads");
            });
        } else {
          // No session — let them pick leads
          setScreen("load_leads");
        }

        // Clean URL (remove token from address bar)
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        setAutoError("Failed to verify login token");
        setScreen("login");
      });
  }, []);

  function handleLogin(repData: Rep, apiKey: string) {
    setApiKey(apiKey);
    setRep(repData);
    setScreen("load_leads");
  }

  function handleLeadsLoaded(loadedLeads: Lead[]) {
    setLeads(loadedLeads);
    setScreen("dialer");
  }

  function handleSessionEnd() {
    setLeads([]);
    setAutoSessionId(null);
    setScreen("load_leads");
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {screen === "auto_connecting" && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
              <span className="text-2xl font-bold text-white">T</span>
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">Connecting to session...</h1>
            <p className="text-gray-500 text-sm">Claude is setting up your dashboard</p>
          </div>
        </div>
      )}

      {screen === "login" && (
        <>
          {autoError && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-900/80 border border-red-700 rounded-lg text-red-300 text-sm">
              {autoError}
            </div>
          )}
          <LoginScreen onLogin={handleLogin} />
        </>
      )}

      {screen === "load_leads" && rep && (
        <LeadLoader rep={rep} onLeadsLoaded={handleLeadsLoaded} />
      )}

      {screen === "dialer" && rep && (
        <DialerDashboard
          rep={rep}
          leads={leads}
          onEnd={handleSessionEnd}
          sessionId={autoSessionId || undefined}
        />
      )}
    </main>
  );
}
