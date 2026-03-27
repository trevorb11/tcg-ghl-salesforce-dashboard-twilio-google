// ============================================================
// TCG Power Dialer — Core Types
// ============================================================

export interface Rep {
  id: string;
  name: string;
  email: string;
  phone: string; // Rep's phone number (Twilio calls this first)
  password: string; // Simple password for dashboard login
  role: "rep" | "admin";
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
  twilioCallSid?: string;  // Call SID (works for both Twilio and SignalWire)
  carrier?: "twilio" | "signalwire"; // Which carrier handled this call
  startedAt: string;
  endedAt?: string;
}

export type DialMode = "single" | "multi";

// Tracks a batch of parallel outbound calls (multi-line mode)
export interface DialBatch {
  callSids: string[];       // All call SIDs fired in this batch
  leadIndices: number[];    // Which lead indices were dialed
  connectedSid?: string;    // The SID that connected first
  connectedLeadIndex?: number; // Which lead answered
  settled: boolean;         // true once winner picked & losers hung up
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

  // Multi-line dialing
  dialMode: DialMode;       // "single" (default) or "multi"
  lines: number;            // How many lines to dial at once (1-5, default 1)
  currentBatch?: DialBatch; // Active batch of parallel calls (multi-line only)
  abandonedCalls: number;   // Count of calls where lead answered but got dropped
  totalConnected: number;   // Count of calls where lead actually talked to rep
}

// In-memory session store (for Phase 1 — replace with DB later)
export const sessions = new Map<string, DialerSession>();

// Rep directory — Phase 1 uses a static list; Phase 2 pulls from GHL/Salesforce
export const REP_DIRECTORY: Rep[] = [
  {
    id: "admin",
    name: "Admin",
    email: "admin@todaycapitalgroup.com",
    phone: "",
    password: "Tcg1!tcg",
    role: "admin",
  },
  {
    id: "dillon",
    name: "Dillon LeBlanc",
    email: "dillon@todaycapitalgroup.com",
    phone: "",
    password: "tcg-dillon-2026",
    role: "rep",
  },
  {
    id: "ryan",
    name: "Ryan Wilcox",
    email: "ryan@todaycapitalgroup.com",
    phone: "",
    password: "tcg-ryan-2026",
    role: "rep",
  },
  {
    id: "julius",
    name: "Julius Speck",
    email: "julius@todaycapitalgroup.com",
    phone: "",
    password: "tcg-julius-2026",
    role: "rep",
  },
  {
    id: "kenny",
    name: "Kenny Nwobi",
    email: "kenny@todaycapitalgroup.com",
    phone: "",
    password: "tcg-kenny-2026",
    role: "rep",
  },
  {
    id: "gregory",
    name: "Gregory Dergevorkian",
    email: "gregory@todaycapitalgroup.com",
    phone: "",
    password: "tcg-gregory-2026",
    role: "rep",
  },
];
