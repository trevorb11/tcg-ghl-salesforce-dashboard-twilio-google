"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Rep {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export default function LoginScreen({
  onLogin,
}: {
  onLogin: (rep: Rep, apiKey: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [apiKey, setApiKeyInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Test the API key by making the auth call with it
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-Dialer-Key": apiKey } : {}),
        },
        body: JSON.stringify({ email, phone }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      onLogin(data, apiKey);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">TCG Power Dialer</h1>
          <p className="text-gray-400 mt-2">Sign in to start dialing</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@todaycapitalgroup.com"
              required
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Your Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              required
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              We&apos;ll call this number when you start a dialing session
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Your dialer API key"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Ask your admin for the API key. Not required in dev mode.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
