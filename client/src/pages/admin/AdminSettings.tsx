/**
 * Admin Settings Page - Configure system settings
 */

import { useState, useEffect } from "react";
import { Save, Bot, Loader2 } from "lucide-react";

type AIProvider =
  | "groq_only"
  | "gemini_only"
  | "groq_with_fallback"
  | "gemini_with_fallback";

interface SystemSettings {
  aiProvider: AIProvider;
}

const AI_PROVIDER_OPTIONS: {
  value: AIProvider;
  label: string;
  description: string;
}[] = [
  {
    value: "groq_only",
    label: "Groq Only",
    description: "Use Groq (LLaMA) exclusively. No fallback if Groq fails.",
  },
  {
    value: "gemini_only",
    label: "Gemini Only",
    description: "Use Google Gemini exclusively. No fallback if Gemini fails.",
  },
  {
    value: "groq_with_fallback",
    label: "Groq (with Gemini fallback)",
    description: "Primary: Groq. Fallback to Gemini if Groq fails.",
  },
  {
    value: "gemini_with_fallback",
    label: "Gemini (with Groq fallback)",
    description: "Primary: Gemini. Fallback to Groq if Gemini fails.",
  },
];

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function AdminSettings() {
  const [settings, setSettings] = useState<SystemSettings>({
    aiProvider: "groq_only",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle"
  );

  // Fetch current settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  // Save settings
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus("idle");

    try {
      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">
          Configure system-wide settings for ReClaim AI
        </p>
      </div>

      {/* AI Provider Section */}
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-text-primary">
              AI Provider
            </h2>
            <p className="text-sm text-text-secondary">
              Choose which AI model to use for chat and matching
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {AI_PROVIDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-all ${
                settings.aiProvider === option.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="aiProvider"
                value={option.value}
                checked={settings.aiProvider === option.value}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    aiProvider: e.target.value as AIProvider,
                  })
                }
                className="mt-1 w-4 h-4 text-primary focus:ring-primary"
              />
              <div>
                <span className="font-medium text-text-primary block">
                  {option.label}
                </span>
                <span className="text-sm text-text-secondary">
                  {option.description}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-6 py-2.5 
                     bg-[#4285F4]
                     hover:bg-[#3367D6]
                     text-white font-medium rounded-lg
                     shadow-md hover:shadow-lg
                     transform transition-all duration-200 
                     hover:scale-[1.02] active:scale-[0.98]
                     disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100
                     focus:outline-none focus:ring-2 focus:ring-[#4285F4] focus:ring-offset-2"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaving ? "Saving..." : "Save Settings"}
        </button>

        {saveStatus === "success" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#34A853] font-medium bg-[#34A853]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#34A853] rounded-full animate-pulse"></span>
            Settings saved successfully
          </span>
        )}
        {saveStatus === "error" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#EA4335] font-medium bg-[#EA4335]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#EA4335] rounded-full"></span>
            Failed to save settings
          </span>
        )}
      </div>
    </div>
  );
}
