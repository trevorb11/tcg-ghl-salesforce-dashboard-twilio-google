"use client";

import { useState } from "react";
import LoginScreen from "@/components/LoginScreen";
import LeadLoader from "@/components/LeadLoader";
import DialerDashboard from "@/components/DialerDashboard";

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
  pipelineId: string;
  pipelineStageId: string;
  stageName: string;
  opportunityId?: string;
}

type Screen = "login" | "load_leads" | "dialer";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("login");
  const [rep, setRep] = useState<Rep | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);

  function handleLogin(repData: Rep) {
    setRep(repData);
    setScreen("load_leads");
  }

  function handleLeadsLoaded(loadedLeads: Lead[]) {
    setLeads(loadedLeads);
    setScreen("dialer");
  }

  function handleSessionEnd() {
    setLeads([]);
    setScreen("load_leads");
  }

  return (
    <main className="min-h-screen">
      {screen === "login" && <LoginScreen onLogin={handleLogin} />}
      {screen === "load_leads" && rep && (
        <LeadLoader rep={rep} onLeadsLoaded={handleLeadsLoaded} />
      )}
      {screen === "dialer" && rep && (
        <DialerDashboard rep={rep} leads={leads} onEnd={handleSessionEnd} />
      )}
    </main>
  );
}
