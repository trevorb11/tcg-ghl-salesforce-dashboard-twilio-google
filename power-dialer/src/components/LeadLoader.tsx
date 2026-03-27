"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

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

const STAGE_GROUPS = [
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

export default function LeadLoader({
  rep,
  onLeadsLoaded,
}: {
  rep: Rep;
  onLeadsLoaded: (leads: Lead[]) => void;
}) {
  const [selectedStage, setSelectedStage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

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

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-2xl p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Welcome, {rep.name}</h1>
          <p className="text-gray-400 mt-1">
            Select a lead stage to start dialing
          </p>
        </div>

        {/* Stage Selector */}
        <div className="space-y-4 mb-6">
          {STAGE_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
                {group.label}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.stages.map((stage) => (
                  <button
                    key={stage.key}
                    onClick={() => {
                      setSelectedStage(stage.key);
                      setLoaded(false);
                      setLeads([]);
                    }}
                    className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedStage === stage.key
                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                        : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    {stage.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Load Button */}
        {selectedStage && !loaded && (
          <button
            onClick={loadLeads}
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-semibold rounded-lg transition-colors mb-4"
          >
            {loading ? "Loading leads from GHL..." : "Load Leads"}
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Lead Preview */}
        {loaded && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {leads.length} leads ready to dial
              </h3>
              {leads.length > 0 && (
                <button
                  onClick={() => onLeadsLoaded(leads)}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                >
                  Start Dialing Session
                </button>
              )}
            </div>

            {leads.length === 0 ? (
              <p className="text-gray-400">
                No leads with phone numbers found in this stage.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-1 rounded-lg border border-gray-800">
                {leads.map((lead, i) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between px-4 py-2.5 bg-gray-900 even:bg-gray-900/50"
                  >
                    <div>
                      <span className="text-gray-500 text-sm mr-3">
                        {i + 1}.
                      </span>
                      <span className="font-medium">{lead.name}</span>
                      {lead.businessName && (
                        <span className="text-gray-400 ml-2">
                          — {lead.businessName}
                        </span>
                      )}
                    </div>
                    <span className="text-gray-500 text-sm">{lead.phone}</span>
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
