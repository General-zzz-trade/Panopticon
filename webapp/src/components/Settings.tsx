import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "./Modal";
import type { Settings as SettingsType } from "../types";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  settings: SettingsType;
  onSave: (settings: SettingsType) => void;
}

const API = "/api/v1";

export function Settings({ open, onClose, settings, onSave }: SettingsProps) {
  // Local form state -- initialized from props when modal opens
  const [dark, setDark] = useState(settings.dark);
  const [notify, setNotify] = useState(settings.notify);
  const [sound, setSound] = useState(settings.sound);
  const [mode, setMode] = useState(settings.mode);
  const [agentName, setAgentName] = useState(settings.agentName);
  const [apiKey, setApiKey] = useState(settings.apiKey);

  // JWT auth state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [jwtUser, setJwtUser] = useState<string | null>(null);
  const [jwtToken, setJwtToken] = useState<string | null>(null);

  // Sync local form state when modal opens or settings prop changes
  useEffect(() => {
    if (open) {
      setDark(settings.dark);
      setNotify(settings.notify);
      setSound(settings.sound);
      setMode(settings.mode);
      setAgentName(settings.agentName);
      setApiKey(settings.apiKey);
      setAuthError("");

      // Restore JWT state from localStorage
      const token = localStorage.getItem("jwtToken");
      if (token) {
        setJwtToken(token);
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          setJwtUser(payload.email || null);
        } catch {
          setJwtUser(null);
        }
      } else {
        setJwtToken(null);
        setJwtUser(null);
      }
    }
  }, [open, settings]);

  const handleSave = useCallback(() => {
    const updated: SettingsType = {
      ...settings,
      dark,
      notify,
      sound,
      mode,
      agentName: agentName || "Agent",
      apiKey,
    };
    localStorage.setItem("agentSettings", JSON.stringify(updated));
    onSave(updated);

    // Request notification permission if enabled
    if (
      notify &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }

    onClose();
  }, [dark, notify, sound, mode, agentName, apiKey, settings, onSave, onClose]);

  const handleLogin = useCallback(async () => {
    setAuthError("");
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setJwtToken(data.token);
      setJwtUser(data.user?.email || email);
      localStorage.setItem("jwtToken", data.token);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Login failed");
    }
  }, [email, password]);

  const handleRegister = useCallback(async () => {
    setAuthError("");
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: email.split("@")[0],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      setJwtToken(data.token);
      setJwtUser(data.user?.email || email);
      localStorage.setItem("jwtToken", data.token);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Registration failed");
    }
  }, [email, password]);

  const handleLogout = useCallback(() => {
    setJwtToken(null);
    setJwtUser(null);
    localStorage.removeItem("jwtToken");
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-4 text-sm">
        {/* Dark mode */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-gray-700 dark:text-gray-300">Dark mode</span>
          <input
            type="checkbox"
            checked={dark}
            onChange={(e) => setDark(e.target.checked)}
            className="accent-blue-500"
          />
        </label>

        {/* Notify */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-gray-700 dark:text-gray-300">
            Notify on complete
          </span>
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="accent-blue-500"
          />
        </label>

        {/* Sound */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-gray-700 dark:text-gray-300">
            Sound on complete
          </span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="accent-blue-500"
          />
        </label>

        {/* Execution mode */}
        <label className="block">
          <span className="block mb-1 text-gray-700 dark:text-gray-300">
            Execution mode
          </span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
          >
            <option value="">Auto</option>
            <option value="sequential">Fast</option>
            <option value="react">Deep</option>
            <option value="cli">Shell</option>
          </select>
        </label>

        {/* Agent name */}
        <label className="block">
          <span className="block mb-1 text-gray-700 dark:text-gray-300">
            Agent name
          </span>
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent"
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
          />
        </label>

        {/* API key */}
        <label className="block">
          <span className="block mb-1 text-gray-700 dark:text-gray-300">
            API key
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="X-API-Key"
            className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
          />
        </label>

        {/* JWT Authentication */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-500 mb-2">JWT Authentication</p>

          {jwtToken && jwtUser ? (
            <div>
              <p className="text-xs text-green-600 dark:text-green-400 mb-1">
                Logged in as <span className="font-medium">{jwtUser}</span>
              </p>
              <button
                onClick={handleLogout}
                className="text-xs text-red-600 hover:underline"
              >
                Logout
              </button>
            </div>
          ) : (
            <div>
              <div className="flex gap-2 mb-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email"
                  className="flex-1 border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLogin();
                  }}
                  className="flex-1 border border-gray-300 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleLogin}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition"
                >
                  Login
                </button>
                <button
                  onClick={handleRegister}
                  className="px-3 py-1 border border-gray-300 dark:border-gray-700 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition"
                >
                  Register
                </button>
              </div>
              {authError && (
                <p className="text-xs text-red-500 mt-1">{authError}</p>
              )}
            </div>
          )}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
        >
          Save Settings
        </button>
      </div>
    </Modal>
  );
}
