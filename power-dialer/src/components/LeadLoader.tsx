"use client";

import { useState, useRef } from "react";
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

const REP_STAGE_GROUPS: StageGroup[] = [
  {
    label: "Absent / Cold Leads",
    stages: [
      { key: "missing_in_action", label: "Missing In Action" },
      { key: "no_use_at_moment", label: "No Use At The Moment" },
      { key: "low_revenue", label: "Low Revenue" },
    ],
  },
  {
    label: "App Sent (Warm)",
    stages: [
      { key: "new_opportunity", label: "New Opportunity" },
      { key: "waiting_for_app", label: "Waiting for App/Statements" },
      { key: "second_attempt", label: "2nd Attempt" },
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
  {
    label: "Hold / Follow-Up",
    stages: [
      { key: "hold", label: "Hold" },
      { key: "follow_up", label: "Follow Up Date Has Hit" },
    ],
  },
];

const ADMIN_STAGE_GROUPS: StageGroup[] = [
  ...REP_STAGE_GROUPS,
  {
    label: "Marketing Leads",
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
    label: "Pipeline (All Stages)",
    stages: [
      { key: "contracts_signed", label: "Contracts Signed" },
      { key: "additional_stips", label: "Additional Stips Needed" },
      { key: "final_underwriting", label: "Final Underwriting / BV" },
      { key: "funded", label: "Funded" },
    ],
  },
  {
    label: "Cold / Graveyard",
    stages: [
      { key: "unrealistic", label: "Unrealistic" },
      { key: "funded_elsewhere", label: "Funded Elsewhere" },
      { key: "dead_deal", label: "Killed In Final / Dead Deal" },
      { key: "declined", label: "Declined" },
      { key: "disconnected", label: "Disconnected #" },
      { key: "do_not_contact", label: "Do Not Contact" },
    ],
  },
];

type LoadMode = "ghl" | "upload";

export default function LeadLoader({
  rep,
  onLeadsLoaded,
}: {
  rep: Rep;
  onLeadsLoaded: (leads: Lead[]) => void;
}) {
  const STAGE_GROUPS = rep.role === "admin" ? ADMIN_STAGE_GROUPS : REP_STAGE_GROUPS;
  const [mode, setMode] = useState<LoadMode>("ghl");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStage, setSelectedStage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeGroup = STAGE_GROUPS.find((g) => g.label === selectedCategory);

  async function loadLeads() {
    if (!selectedStage) return;
    setLoading(true);
    setError("");

    try {
      const res = await apiFetch(`/api/leads?stage=${selectedStage}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setLeads(data.leads);
      setLoaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load leads";
      setError(msg);
    } finally {
      setLoading(false);
    }
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
  }

  const stageName = activeGroup?.stages.find((s) => s.key === selectedStage)?.label || "";

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

        {/* Mode Tabs */}
        <div className="flex rounded-lg bg-gray-900 p-1 mb-6">
          <button
            onClick={() => { setMode("ghl"); resetState(); }}
            className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
              mode === "ghl"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-300"
            }`}
          >
            GHL Pipeline
          </button>
          <button
            onClick={() => { setMode("upload"); resetState(); }}
            className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors ${
              mode === "upload"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-300"
            }`}
          >
            Upload List
          </button>
        </div>

        {/* GHL Two-Step Dropdowns */}
        {mode === "ghl" && !loaded && (
          <div className="space-y-4">
            {/* Step 1: Category */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                1. Choose a category
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setSelectedStage("");
                }}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none cursor-pointer"
              >
                <option value="">Select a category...</option>
                {STAGE_GROUPS.map((group) => (
                  <option key={group.label} value={group.label}>
                    {group.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 2: Stage */}
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

            {/* Load Button */}
            {selectedStage && (
              <button
                onClick={loadLeads}
                disabled={loading}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Loading from GHL...
                  </>
                ) : (
                  `Load ${stageName} Leads`
                )}
              </button>
            )}
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
            {/* Summary bar */}
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
                {stageName && (
                  <p className="text-gray-500 text-xs mt-0.5">{stageName}</p>
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
                <p>No leads with phone numbers found in this stage.</p>
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
