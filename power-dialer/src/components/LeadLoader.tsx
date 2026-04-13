"use client";

import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";

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
}

interface StageGroup {
  label: string;
  stages: { key: string; label: string }[];
}

// Stage groups matching actual GHL pipelines and DB data
const REP_STAGE_GROUPS: StageGroup[] = [
  {
    label: "1. App Sent (Warm)",
    stages: [
      { key: "new_opportunity", label: "New Opportunity" },
      { key: "waiting_for_app", label: "Waiting for App/Statements" },
      { key: "second_attempt", label: "2nd Attempt" },
      { key: "follow_up_30", label: "Follow Up 30 Days" },
    ],
  },
  {
    label: "2. App Sent (Cold)",
    stages: [
      { key: "missing_in_action", label: "Missing In Action" },
      { key: "no_use_at_moment", label: "No Use At The Moment" },
      { key: "low_revenue", label: "Low Revenue" },
      { key: "unrealistic", label: "Unrealistic" },
      { key: "default_cold", label: "Default" },
    ],
  },
  {
    label: "Hold / Follow-Up",
    stages: [
      { key: "hold", label: "Hold" },
      { key: "follow_up", label: "Follow Up Date Has Hit" },
    ],
  },
  {
    label: "Pipeline (Active Deals)",
    stages: [
      { key: "approved_moving", label: "Approved - Moving Forward" },
      { key: "contracts_sent", label: "Contracts Requested/Sent" },
      { key: "renewal", label: "Renewal Prospecting" },
    ],
  },
];

const ADMIN_STAGE_GROUPS: StageGroup[] = [
  ...REP_STAGE_GROUPS,
  {
    label: "0. Marketing Leads",
    stages: [
      { key: "intake_form", label: "Intake Form Submitted" },
      { key: "application_started", label: "Application Started" },
      { key: "application_submitted", label: "Application Submitted" },
      { key: "statements_submitted", label: "Statements Submitted" },
    ],
  },
  {
    label: "Underwriting",
    stages: [
      { key: "submitted_underwriting", label: "Submitted to Underwriting" },
      { key: "sent_to_lenders", label: "Sent to Lenders" },
      { key: "requested_more_info", label: "Requested More Information" },
      { key: "approved", label: "Approved" },
    ],
  },
  {
    label: "Pipeline (Extended)",
    stages: [
      { key: "contracts_signed", label: "Contracts Signed" },
      { key: "additional_stips", label: "Additional Stips Needed" },
      { key: "final_underwriting", label: "Final Underwriting / BV" },
      { key: "funded", label: "Funded" },
    ],
  },
  {
    label: "Pipeline (Cold)",
    stages: [
      { key: "unqualified", label: "Unqualified" },
      { key: "declined", label: "Declined" },
      { key: "funded_elsewhere", label: "Funded Elsewhere" },
      { key: "dead_deal", label: "Killed In Final / Dead Deal" },
      { key: "balances_too_high", label: "Balances Too High" },
    ],
  },
  {
    label: "SBA Pipeline",
    stages: [
      { key: "sba_referral", label: "Referral In" },
      { key: "sba_prequalified", label: "Prequalified" },
    ],
  },
  {
    label: "Graveyard",
    stages: [
      { key: "disconnected", label: "Disconnected #" },
      { key: "do_not_contact", label: "Do Not Contact" },
    ],
  },
];

type LoadMode = "pipeline" | "custom" | "upload" | "dialpad";

export default function LeadLoader({
  rep,
  onLeadsLoaded,
  initialDialNumber,
}: {
  rep: Rep;
  onLeadsLoaded: (leads: Lead[]) => void;
  initialDialNumber?: string | null;
}) {
  const STAGE_GROUPS = rep.role === "admin" ? ADMIN_STAGE_GROUPS : REP_STAGE_GROUPS;
  const [mode, setMode] = useState<LoadMode>(initialDialNumber ? "dialpad" : "pipeline");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [listLabel, setListLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dialpad state
  const [dialpadNumber, setDialpadNumber] = useState(initialDialNumber || "");
  const [dialpadName, setDialpadName] = useState("");
  const [dialpadBusiness, setDialpadBusiness] = useState("");
  const initialLookupDone = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dialpadContact, setDialpadContact] = useState<any>(null);
  const [dialpadLooking, setDialpadLooking] = useState(false);
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session history
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Fetch recent session history on mount
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await apiFetch("/api/dialer/history?repId=" + rep.id);
        if (res.ok) {
          const data = await res.json();
          setSessionHistory(data.sessions || []);
        }
      } catch { /* non-fatal */ }
      setHistoryLoaded(true);
    }
    fetchHistory();
  }, [rep.id]);

  // Custom criteria state
  const [filterTags, setFilterTags] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterAssignedTo, setFilterAssignedTo] = useState("");
  const [filterRevenueNotEmpty, setFilterRevenueNotEmpty] = useState(false);
  const [filterHasApproval, setFilterHasApproval] = useState(false);
  const [filterPreviouslyFunded, setFilterPreviouslyFunded] = useState("");
  const [filterPipeline, setFilterPipeline] = useState("");
  const [filterLimit, setFilterLimit] = useState(200);

  // Smart search
  const [smartQuery, setSmartQuery] = useState("");
  const [smartDescription, setSmartDescription] = useState("");
  const [smartSearchSuccess, setSmartSearchSuccess] = useState(false);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<{name: string; query: string}[]>([]);

  // Callback queue
  const [callbackLeads, setCallbackLeads] = useState<Lead[]>([]);
  const [callbackCount, setCallbackCount] = useState(0);
  const [callbackDismissed, setCallbackDismissed] = useState(false);

  // Load saved searches from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("tcg-saved-searches");
      if (stored) setSavedSearches(JSON.parse(stored));
    } catch { /* non-fatal */ }
  }, []);

  // Check for due callbacks after session history loads
  useEffect(() => {
    if (!historyLoaded) return;
    async function checkCallbacks() {
      try {
        const res = await apiFetch("/api/leads/query", {
          method: "POST",
          body: JSON.stringify({
            assignedTo: rep.name,
            lastDisposition: "Callback",
            limit: 50,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.leads && data.leads.length > 0) {
            setCallbackLeads(data.leads);
            setCallbackCount(data.leads.length);
          }
        }
      } catch { /* non-fatal */ }
    }
    checkCallbacks();
  }, [historyLoaded, rep.name]);

  // Auto-lookup when opened with a dial number (e.g., from Salesforce click-to-dial)
  useEffect(() => {
    if (initialDialNumber && !initialLookupDone.current) {
      initialLookupDone.current = true;
      lookupContact(initialDialNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDialNumber]);

  const activeGroup = STAGE_GROUPS.find((g) => g.label === selectedCategory);

  async function loadLeads() {
    if (!selectedStage) return;
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch(`/api/leads?stage=${selectedStage}&rep=${encodeURIComponent(rep.name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLeads(data.leads);
      setListLabel(activeGroup?.stages.find((s) => s.key === selectedStage)?.label || "");
      setLoaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load leads";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function smartSearch(queryOverride?: string) {
    const q = queryOverride || smartQuery;
    if (!q.trim()) return;
    if (!queryOverride) setSmartQuery(q);
    setLoading(true);
    setError("");
    setSmartDescription("");
    setSmartSearchSuccess(false);

    try {
      // Use AI-powered search (Claude Haiku) — falls back to pattern matching if AI unavailable
      const res = await apiFetch(`/api/leads/ai-search?q=${encodeURIComponent(q)}&rep=${encodeURIComponent(rep.name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLeads(data.leads);
      setListLabel(`${data.count} leads found`);
      setSmartDescription(data.description || "");
      setLoaded(true);
      setSmartSearchSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Search failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function saveCurrentSearch() {
    const name = prompt("Name this search:");
    if (!name?.trim()) return;
    const updated = [...savedSearches, { name: name.trim(), query: smartQuery }];
    setSavedSearches(updated);
    localStorage.setItem("tcg-saved-searches", JSON.stringify(updated));
    setSmartSearchSuccess(false);
  }

  function deleteSavedSearch(index: number) {
    const updated = savedSearches.filter((_, i) => i !== index);
    setSavedSearches(updated);
    localStorage.setItem("tcg-saved-searches", JSON.stringify(updated));
  }

  function loadSavedSearch(search: {name: string; query: string}) {
    setSmartQuery(search.query);
    smartSearch(search.query);
  }

  async function loadCustomList() {
    setLoading(true);
    setError("");

    const filters: Record<string, unknown> = { limit: filterLimit };

    if (filterTags.trim()) {
      filters.tags = filterTags.split(",").map((t) => t.trim()).filter(Boolean);
    }
    if (filterIndustry.trim()) filters.industry = filterIndustry.trim();
    if (filterAssignedTo.trim()) filters.assignedTo = filterAssignedTo.trim();
    if (filterRevenueNotEmpty) filters.monthlyRevenueMin = "notempty";
    if (filterHasApproval) filters.hasApproval = true;
    if (filterPreviouslyFunded) filters.previouslyFunded = filterPreviouslyFunded;
    if (filterPipeline.trim()) filters.pipeline = filterPipeline.trim();

    try {
      const res = await apiFetch("/api/leads/query", {
        method: "POST",
        body: JSON.stringify(filters),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLeads(data.leads);
      setListLabel("Custom List");
      setLoaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load leads";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleDialpadNumberChange(value: string) {
    setDialpadNumber(value);
    setDialpadContact(null);

    // Debounce lookup — trigger when 10+ digits entered
    if (lookupTimerRef.current) clearTimeout(lookupTimerRef.current);
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 10) {
      lookupTimerRef.current = setTimeout(() => lookupContact(value), 400);
    }
  }

  async function lookupContact(phone: string) {
    let digits = phone.replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (!digits.startsWith("+")) digits = "+" + digits;

    setDialpadLooking(true);
    try {
      const res = await apiFetch(`/api/contacts/lookup?phone=${encodeURIComponent(digits)}`);
      const data = await res.json();
      if (data.found) {
        setDialpadContact(data.contact);
        // Auto-fill name/business if rep hasn't typed anything
        if (!dialpadName.trim()) setDialpadName(data.contact.name || "");
        if (!dialpadBusiness.trim()) setDialpadBusiness(data.contact.businessName || "");
      } else {
        setDialpadContact(null);
      }
    } catch {
      // Lookup failure is non-fatal
    } finally {
      setDialpadLooking(false);
    }
  }

  function handleDialpadDial() {
    let digits = dialpadNumber.replace(/\D/g, "");
    if (digits.length === 10) digits = "1" + digits;
    if (!digits.startsWith("+")) digits = "+" + digits;
    if (digits.length < 11) {
      setError("Enter a valid phone number");
      return;
    }

    const c = dialpadContact;
    const lead: Lead = {
      id: c?.id || `dialpad-${Date.now()}`,
      name: dialpadName.trim() || c?.name || "Manual Dial",
      businessName: dialpadBusiness.trim() || c?.businessName || "",
      phone: digits,
      email: c?.email || "",
      pipelineId: c?.pipeline || "dialpad",
      pipelineStageId: c?.stage || "dialpad",
      stageName: c?.stage || "Manual Dial",
    };

    // Attach extended fields if contact was found in DB
    if (c) {
      Object.assign(lead, {
        _monthlyRevenue: c.monthlyRevenue,
        _industry: c.industry,
        _yearsInBusiness: c.yearsInBusiness,
        _amountRequested: c.amountRequested,
        _creditScore: c.creditScore,
        _lastNote: c.lastNote,
        _lastDisposition: c.lastDisposition,
        _approvalLetter: c.approvalLetter,
        _previouslyFunded: c.previouslyFunded,
        _currentPositions: c.currentPositions,
        tags: c.tags ? c.tags.split(",").map((t: string) => t.trim()) : [],
        lastContactedAt: c.lastContacted,
      });
    }

    onLeadsLoaded([lead]);
  }

  function formatDialpadDisplay(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    setSkippedCount(0);

    try {
      const text = await file.text();
      const res = await apiFetch("/api/leads/upload", {
        method: "POST",
        body: JSON.stringify({ csv: text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLeads(data.leads);
      setSkippedCount(data.skippedCount || 0);
      setListLabel("Uploaded List");
      setLoaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to parse file";
      setError(msg);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resetState() {
    setLeads([]);
    setLoaded(false);
    setError("");
    setSkippedCount(0);
    setSelectedStage("");
    setSelectedCategory("");
    setListLabel("");
  }

  const hasCustomFilter = filterTags.trim() || filterIndustry.trim() || filterAssignedTo.trim() ||
    filterRevenueNotEmpty || filterHasApproval || filterPreviouslyFunded || filterPipeline.trim();

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-xl p-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">TCG Power Dialer</h1>
          <p className="text-gray-400 mt-2">
            Welcome back, <span className="text-white font-medium">{rep.name}</span>
          </p>
        </div>

        {/* Session History */}
        {historyLoaded && sessionHistory.length > 0 && !loaded && (
          <div className="mb-5 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
            <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Recent Sessions</h3>
            <div className="space-y-2">
              {sessionHistory.slice(0, 3).map((s, i) => {
                const date = s.started_at ? new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 w-12">{date}</span>
                      <span className="text-gray-300">{s.total_calls || 0} calls</span>
                      <span className="text-green-500">{s.connected || 0} connects</span>
                      <span className="text-green-400">{s.interested || 0} interested</span>
                    </div>
                    {s.duration_minutes && (
                      <span className="text-gray-600">{s.duration_minutes}m</span>
                    )}
                  </div>
                );
              })}
            </div>
            {sessionHistory[0]?.ai_recap && (
              <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-800 line-clamp-2">
                {sessionHistory[0].ai_recap}
              </p>
            )}
            {sessionHistory[0]?.follow_up_plan && (() => {
              try {
                const plan = typeof sessionHistory[0].follow_up_plan === "string"
                  ? JSON.parse(sessionHistory[0].follow_up_plan)
                  : sessionHistory[0].follow_up_plan;
                if (Array.isArray(plan) && plan.length > 0) {
                  return (
                    <div className="mt-2">
                      <p className="text-[10px] text-blue-400 uppercase tracking-wider mb-1">Follow-ups from last session</p>
                      {plan.slice(0, 2).map((item: string, j: number) => (
                        <p key={j} className="text-xs text-gray-400">{j + 1}. {item}</p>
                      ))}
                    </div>
                  );
                }
              } catch { /* non-fatal */ }
              return null;
            })()}
          </div>
        )}

        {/* Callback Queue Banner */}
        {callbackCount > 0 && !callbackDismissed && !loaded && (
          <div className="mb-5 bg-blue-900/20 border border-blue-700/40 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-blue-300 font-medium text-sm">You have {callbackCount} callback{callbackCount !== 1 ? "s" : ""} due today.</p>
              <p className="text-blue-400/60 text-xs mt-0.5">Load them into the dialer?</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setLeads(callbackLeads);
                  setListLabel("Callbacks Due");
                  setLoaded(true);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Load Callbacks
              </button>
              <button
                onClick={() => setCallbackDismissed(true)}
                className="text-gray-500 hover:text-gray-400 px-2 py-1 text-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Mode Tabs */}
        <div className="flex rounded-lg bg-gray-900 p-1 mb-6">
          {(["pipeline", "custom", "dialpad", "upload"] as LoadMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); resetState(); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-300"
              }`}
            >
              {m === "pipeline" ? "Pipeline" : m === "custom" ? "Custom" : m === "dialpad" ? "Dialpad" : "Upload"}
            </button>
          ))}
        </div>

        {/* Pipeline Two-Step Dropdowns */}
        {mode === "pipeline" && !loaded && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                1. Choose a pipeline
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setSelectedStage("");
                }}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer"
              >
                <option value="">Select a pipeline...</option>
                {STAGE_GROUPS.map((group) => (
                  <option key={group.label} value={group.label}>
                    {group.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedCategory && activeGroup && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  2. Choose a stage
                </label>
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer"
                >
                  <option value="">Select a stage...</option>
                  {activeGroup.stages.map((stage) => (
                    <option key={stage.key} value={stage.key}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedStage && (
              <button
                onClick={loadLeads}
                disabled={loading}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Loading leads...
                  </>
                ) : (
                  "Load Leads"
                )}
              </button>
            )}
          </div>
        )}

        {/* Custom List Builder */}
        {mode === "custom" && !loaded && (
          <div className="space-y-4">
            {/* Saved Searches */}
            {savedSearches.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-gray-600 uppercase tracking-wider mr-1">Saved:</span>
                {savedSearches.map((s, i) => (
                  <button
                    key={i}
                    className="group flex items-center gap-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-full transition-colors"
                  >
                    <span onClick={() => loadSavedSearch(s)}>{s.name}</span>
                    <span
                      onClick={(e) => { e.stopPropagation(); deleteSavedSearch(i); }}
                      className="text-gray-600 hover:text-red-400 ml-0.5 transition-colors"
                    >&times;</span>
                  </button>
                ))}
              </div>
            )}

            {/* Smart Search */}
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={smartQuery}
                  onChange={(e) => setSmartQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") smartSearch(); }}
                  placeholder="Describe the list you want... e.g. construction in Florida revenue over $30k"
                  className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  onClick={() => smartSearch()}
                  disabled={loading || !smartQuery.trim()}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg text-sm"
                >
                  {loading ? "..." : "Search"}
                </button>
              </div>
              {smartDescription && (
                <div className="flex items-center gap-2 mt-1.5">
                  <p className="text-xs text-blue-400">Searching: {smartDescription}</p>
                  {smartSearchSuccess && (
                    <button
                      onClick={saveCurrentSearch}
                      className="text-xs text-gray-500 hover:text-blue-400 transition-colors"
                    >
                      Save this search
                    </button>
                  )}
                </div>
              )}
              <p className="text-[10px] text-gray-600 mt-1">
                AI-powered — understands revenue ranges, industries, locations, credit scores, tags, and more
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-800" />
              <span className="text-[10px] text-gray-600 uppercase">or set filters manually</span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                Tags <span className="text-gray-600">(comma-separated, matches any)</span>
              </label>
              <input
                type="text"
                value={filterTags}
                onChange={(e) => setFilterTags(e.target.value)}
                placeholder="e.g. sba interest, ucc leads, top tier prospects"
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Industry + Assigned To */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                  Industry
                </label>
                <input
                  type="text"
                  value={filterIndustry}
                  onChange={(e) => setFilterIndustry(e.target.value)}
                  placeholder="e.g. trucking"
                  className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                  Assigned To
                </label>
                <input
                  type="text"
                  value={filterAssignedTo}
                  onChange={(e) => setFilterAssignedTo(e.target.value)}
                  placeholder="e.g. Dillon LeBlanc"
                  className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Pipeline filter */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                Pipeline
              </label>
              <input
                type="text"
                value={filterPipeline}
                onChange={(e) => setFilterPipeline(e.target.value)}
                placeholder="e.g. App Sent, Underwriting, Hold"
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Toggle filters */}
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterRevenueNotEmpty}
                  onChange={(e) => setFilterRevenueNotEmpty(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-300">Has monthly revenue</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterHasApproval}
                  onChange={(e) => setFilterHasApproval(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="text-sm text-gray-300">Has approval letter</span>
              </label>
            </div>

            {/* Previously funded */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                Previously Funded
              </label>
              <select
                value={filterPreviouslyFunded}
                onChange={(e) => setFilterPreviouslyFunded(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm appearance-none cursor-pointer"
              >
                <option value="">Any</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>

            {/* Limit */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                Max leads: {filterLimit}
              </label>
              <input
                type="range"
                min={25}
                max={500}
                step={25}
                value={filterLimit}
                onChange={(e) => setFilterLimit(parseInt(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <button
              onClick={loadCustomList}
              disabled={loading || !hasCustomFilter}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Querying database...
                </>
              ) : (
                "Build List"
              )}
            </button>
          </div>
        )}

        {/* Dialpad */}
        {mode === "dialpad" && (
          <div className="space-y-5">
            <p className="text-gray-500 text-sm text-center">
              Dial any number directly
            </p>

            {/* Phone number display */}
            <div className="text-center">
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-6 py-4 mb-4">
                <p className="text-3xl font-mono text-white tracking-wider min-h-[2.5rem]">
                  {dialpadNumber ? formatDialpadDisplay(dialpadNumber) : (
                    <span className="text-gray-700">Enter a number</span>
                  )}
                </p>
              </div>

              {/* Number pad */}
              <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto mb-4">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((key) => (
                  <button
                    key={key}
                    onClick={() => handleDialpadNumberChange(dialpadNumber + key)}
                    className="py-3.5 bg-gray-800 hover:bg-gray-700 text-white text-xl font-medium rounded-lg transition-colors"
                  >
                    {key}
                  </button>
                ))}
              </div>

              {/* Backspace */}
              <button
                onClick={() => handleDialpadNumberChange(dialpadNumber.slice(0, -1))}
                className="text-gray-500 hover:text-gray-300 text-sm mb-4 transition-colors"
              >
                Delete
              </button>
            </div>

            {/* Contact match card */}
            {dialpadLooking && (
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500 text-sm">Looking up contact...</span>
              </div>
            )}

            {dialpadContact && !dialpadLooking && (
              <div className="bg-green-900/15 border border-green-800/40 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full" />
                  <span className="text-green-400 text-xs font-semibold uppercase tracking-wider">Contact Found</span>
                </div>
                <p className="text-white font-medium">{dialpadContact.name}</p>
                {dialpadContact.businessName && (
                  <p className="text-gray-400 text-sm">{dialpadContact.businessName}</p>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  {dialpadContact.industry && (
                    <div>
                      <span className="text-[10px] text-gray-600">Industry</span>
                      <p className="text-xs text-gray-400">{dialpadContact.industry}</p>
                    </div>
                  )}
                  {dialpadContact.monthlyRevenue && (
                    <div>
                      <span className="text-[10px] text-gray-600">Revenue</span>
                      <p className="text-xs text-gray-400">{dialpadContact.monthlyRevenue}</p>
                    </div>
                  )}
                  {dialpadContact.stage && (
                    <div>
                      <span className="text-[10px] text-gray-600">Stage</span>
                      <p className="text-xs text-gray-400">{dialpadContact.stage}</p>
                    </div>
                  )}
                  {dialpadContact.lastDisposition && (
                    <div>
                      <span className="text-[10px] text-gray-600">Last Disposition</span>
                      <p className="text-xs text-gray-400">{dialpadContact.lastDisposition}</p>
                    </div>
                  )}
                  {dialpadContact.assignedTo && (
                    <div>
                      <span className="text-[10px] text-gray-600">Assigned To</span>
                      <p className="text-xs text-gray-400">{dialpadContact.assignedTo}</p>
                    </div>
                  )}
                  {dialpadContact.lastContacted && (
                    <div>
                      <span className="text-[10px] text-gray-600">Last Contacted</span>
                      <p className="text-xs text-gray-400">{dialpadContact.lastContacted}</p>
                    </div>
                  )}
                </div>
                {dialpadContact.lastNote && (
                  <div className="mt-2 pt-2 border-t border-green-800/30">
                    <span className="text-[10px] text-gray-600">Last Note</span>
                    <p className="text-xs text-gray-400 line-clamp-2">{dialpadContact.lastNote}</p>
                  </div>
                )}
                {dialpadContact.id && (
                  <a
                    href={`https://app.gohighlevel.com/v2/location/n778xwOps9t8Q34eRPfM/contacts/detail/${dialpadContact.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-orange-400 text-xs hover:text-orange-300"
                  >
                    Open in GHL &rarr;
                  </a>
                )}
              </div>
            )}

            {dialpadNumber.replace(/\D/g, "").length >= 10 && !dialpadContact && !dialpadLooking && (
              <div className="px-4 py-2 bg-gray-900/50 border border-gray-800 rounded-lg">
                <p className="text-gray-600 text-sm">No matching contact in database</p>
              </div>
            )}

            {/* Name/business override */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                  Name {dialpadContact ? "" : "(optional)"}
                </label>
                <input
                  type="text"
                  value={dialpadName}
                  onChange={(e) => setDialpadName(e.target.value)}
                  placeholder={dialpadContact?.name || "Contact name"}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                  Business {dialpadContact ? "" : "(optional)"}
                </label>
                <input
                  type="text"
                  value={dialpadBusiness}
                  onChange={(e) => setDialpadBusiness(e.target.value)}
                  placeholder={dialpadContact?.businessName || "Business name"}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Or paste a number */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                Or paste a number
              </label>
              <input
                type="tel"
                value={dialpadNumber}
                onChange={(e) => handleDialpadNumberChange(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Dial button */}
            <button
              onClick={handleDialpadDial}
              disabled={dialpadNumber.replace(/\D/g, "").length < 10}
              className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-lg font-bold rounded-xl transition-colors"
            >
              Dial
            </button>
          </div>
        )}

        {/* CSV Upload */}
        {mode === "upload" && !loaded && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-blue-500/50 transition-colors">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-upload"
              />
              <label htmlFor="csv-upload" className="cursor-pointer">
                <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl text-gray-400">+</span>
                </div>
                <p className="text-gray-300 font-medium mb-1">
                  Click to upload a CSV file
                </p>
                <p className="text-gray-500 text-sm">
                  Needs a &quot;phone&quot; column. Optional: name, business name, email
                </p>
              </label>
              {loading && (
                <div className="mt-4">
                  <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-blue-400 text-sm mt-2">Parsing file...</p>
                </div>
              )}
            </div>

            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Example CSV</h4>
              <pre className="text-xs text-gray-500 font-mono leading-relaxed">
{`name,business_name,phone,email
John Smith,ABC Trucking,555-123-4567,john@abc.com
Jane Doe,Quick Mart,(555) 987-6543,jane@quick.com`}
              </pre>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800/50 rounded-lg text-red-400 text-sm mt-4">
            {error}
          </div>
        )}

        {/* Lead Preview */}
        {loaded && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {leads.length} lead{leads.length !== 1 ? "s" : ""} ready
                </h3>
                {skippedCount > 0 && (
                  <p className="text-yellow-500 text-xs mt-0.5">
                    {skippedCount} skipped (missing/invalid phone)
                  </p>
                )}
                {listLabel && (
                  <p className="text-gray-500 text-xs mt-0.5">{listLabel}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetState}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
                >
                  Back
                </button>
                {leads.length > 0 && (
                  <button
                    onClick={() => onLeadsLoaded(leads)}
                    className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-lg transition-colors"
                  >
                    Start Dialing
                  </button>
                )}
              </div>
            </div>

            {leads.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>No leads matched your criteria.</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800/50">
                {leads.map((lead, i) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-900/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-gray-600 text-xs font-mono w-5 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{lead.name}</p>
                        {lead.businessName && (
                          <p className="text-gray-500 text-xs truncate">{lead.businessName}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-600 text-xs font-mono shrink-0 ml-3">{lead.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
