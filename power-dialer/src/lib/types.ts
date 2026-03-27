// ============================================================
// TCG Power Dialer — Core Types
// ============================================================

export interface Rep {
  id: string;
  name: string;
  email: string;
  phone: string; // Rep's phone number (Twilio calls this first)
  ghlUserId?: string;
}

export interface Lead {
  id: string; // GHL contact ID
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
}

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";

export type Disposition =
  | "interested"
  | "callback"
  | "not_interested"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "disconnected";

export interface CallAnalysis {
  summary: string;
  disposition: Disposition;
  dispositionReason: string;
  keyPoints: string[];
  followUpActions: string[];
  leadSentiment: "positive" | "neutral" | "negative";
  ghlNote: string;
}

export interface CallRecord {
  id: string;
  leadId: string;
  leadName: string;
  leadBusinessName: string;
  leadPhone: string;
  repId: string;
  status: CallStatus;
  disposition?: Disposition;
  notes?: string;
  duration?: number;
  recordingUrl?: string;
  recordingSid?: string;
  transcription?: string;
  analysis?: CallAnalysis;
  twilioCallSid?: string;
  startedAt: string;
  endedAt?: string;
}

export interface DialerSession {
  id: string;
  repId: string;
  repName: string;
  repPhone: string;
  conferenceName: string;
  conferenceCallSid?: string; // SID of the rep's call in conference
  leads: Lead[];
  currentLeadIndex: number;
  callLog: CallRecord[];
  status: "idle" | "connecting_rep" | "dialing" | "on_call" | "wrap_up" | "ended";
  startedAt: string;
  endedAt?: string;
}

// In-memory session store (for Phase 1 — replace with DB later)
export const sessions = new Map<string, DialerSession>();

// Rep directory — Phase 1 uses a static list; Phase 2 pulls from GHL/Salesforce
export const REP_DIRECTORY: Rep[] = [
  {
    id: "dillon",
    name: "Dillon LeBlanc",
    email: "dillon@todaycapitalgroup.com",
    phone: "", // Rep provides their phone at login
  },
  {
    id: "ryan",
    name: "Ryan Wilcox",
    email: "ryan@todaycapitalgroup.com",
    phone: "",
  },
  {
    id: "julius",
    name: "Julius Speck",
    email: "julius@todaycapitalgroup.com",
    phone: "",
  },
  {
    id: "kenny",
    name: "Kenny Nwobi",
    email: "kenny@todaycapitalgroup.com",
    phone: "",
  },
  {
    id: "gregory",
    name: "Gregory Dergevorkian",
    email: "gregory@todaycapitalgroup.com",
    phone: "",
  },
];
