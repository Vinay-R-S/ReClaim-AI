import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { handoverService } from "../services/handoverService";
import { AlertTriangle, CheckCircle, Lock } from "lucide-react";

export default function VerifyHandoverPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [code, setCode] = useState<string[]>(["", "", "", "", "", ""]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error" | "blocked"
  >("idle");
  const [message, setMessage] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (matchId) {
      checkStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const checkStatus = async () => {
    if (!matchId) return;
    try {
      const statusData = await handoverService.getStatus(matchId);
      setAttemptsLeft(statusData.maxAttempts - statusData.attempts);

      if (statusData.status === "completed") {
        setStatus("success");
        setMessage("This handover has already been completed.");
      } else if (
        statusData.status === "failed" ||
        statusData.status === "blocked"
      ) {
        setStatus("blocked");
        setMessage("Too many failed attempts. This handover is blocked.");
      }
    } catch (error: any) {
      console.error("Failed to get status", error);
      // If 404, handover session doesn't exist
      if (
        error?.message?.includes("404") ||
        error?.message?.includes("Failed")
      ) {
        setStatus("error");
        setMessage(
          "Handover session not found. The verification link may be invalid or expired.",
        );
      }
    }
  };

  const handleInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").slice(0, 6).split("");
    if (pastedData.every((char) => /^\d$/.test(char))) {
      const newCode = [...code];
      pastedData.forEach((char, i) => {
        if (i < 6) newCode[i] = char;
      });
      setCode(newCode);
      inputRefs.current[Math.min(pastedData.length, 5)]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchId) return;

    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      setMessage("Please enter a complete 6-digit code.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const result = await handoverService.verifyCode(matchId, fullCode);

      if (result.success) {
        setStatus("success");
        setMessage(
          "Handover verified successfully! Thank you for helping return the item.",
        );
      } else {
        setStatus("error");
        setMessage(result.message || "Invalid code. Please try again.");
        if (result.attemptsRemaining !== undefined) {
          setAttemptsLeft(result.attemptsRemaining);
        }
        // Refresh status to check if blocked
        checkStatus();
      }
    } catch (error: any) {
      console.error("Verification error:", error);
      setStatus("error");
      setMessage(
        error.response?.data?.error || "Verification failed. Please try again.",
      );
    }
  };

  // Google Colors
  const googleBlue = "#4285F4";
  const googleRed = "#EA4335";
  const googleYellow = "#FBBC05";
  const googleGreen = "#34A853";

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Simple Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <img src="/Logo.webp" alt="ReClaim" className="w-8 h-8" />
          <span className="font-medium text-lg text-gray-800">ReClaim AI</span>
        </Link>
      </header>

      <div className="flex-grow flex items-center justify-center p-4">
        <div
          className="max-w-md w-full bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden transition-all duration-300"
          style={{ borderRadius: "8px" }}
        >
          {/* Google-style Header */}
          <div className="pt-8 pb-4 px-8 text-center border-b border-gray-100">
            <div className="flex justify-center items-center gap-2 mb-4">
              <img src="/Logo.webp" alt="ReClaim Logo" className="w-10 h-10" />
              <span
                className="text-2xl font-medium"
                style={{ fontFamily: "'Product Sans', 'Roboto', sans-serif" }}
              >
                <span style={{ color: googleBlue }}>R</span>
                <span style={{ color: googleRed }}>e</span>
                <span style={{ color: googleYellow }}>C</span>
                <span style={{ color: googleBlue }}>l</span>
                <span style={{ color: googleGreen }}>a</span>
                <span style={{ color: googleRed }}>i</span>
                <span style={{ color: googleBlue }}>m</span>
              </span>
            </div>

            <h1 className="text-xl font-normal text-gray-800 mb-1">
              Verify Handover
            </h1>
            <p className="text-gray-500 text-sm">
              Enter the 6-digit code to confirm the item exchange
            </p>
          </div>

          <div className="p-8">
            {status === "success" ? (
              <div className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: "#E6F4EA" }}
                >
                  <CheckCircle
                    className="w-8 h-8"
                    style={{ color: googleGreen }}
                  />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  Handover Verified
                </h3>
                <p className="text-gray-600 mb-6 text-sm">{message}</p>
                <button
                  onClick={() => navigate("/")}
                  className="px-6 py-2 rounded text-white font-medium text-sm transition-colors hover:opacity-90"
                  style={{ backgroundColor: googleBlue }}
                >
                  Return to Home
                </button>
              </div>
            ) : status === "blocked" ? (
              <div className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: "#FCE8E6" }}
                >
                  <AlertTriangle
                    className="w-8 h-8"
                    style={{ color: googleRed }}
                  />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  Verification Failed
                </h3>
                <p className="text-gray-600 mb-6 text-sm">
                  Too many failed attempts. For security, this transaction has
                  been blocked.
                </p>
                <button
                  onClick={() => navigate("/contact")}
                  className="text-sm font-medium hover:underline"
                  style={{ color: googleBlue }}
                >
                  Contact Support
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <div
                  className="flex gap-3 justify-center mb-6"
                  onPaste={handlePaste}
                >
                  {code.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (inputRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleInput(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      className="w-11 h-12 border border-gray-300 rounded text-center text-xl font-medium focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-gray-800"
                      disabled={status === "loading"}
                    />
                  ))}
                </div>

                {message && status === "error" && (
                  <div
                    className="flex items-start gap-3 text-left mb-4 text-sm p-3 rounded"
                    style={{ backgroundColor: "#FCE8E6", color: "#D93025" }}
                  >
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{message}</span>
                  </div>
                )}

                {attemptsLeft !== null && attemptsLeft <= 2 && (
                  <p
                    className="text-center text-sm font-medium mb-4"
                    style={{ color: "#D93025" }}
                  >
                    {attemptsLeft} attempts remaining
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === "loading" || code.join("").length !== 6}
                  className={`w-full py-3 rounded font-medium text-sm transition-all ${
                    status === "loading" || code.join("").length !== 6
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                      : "text-white hover:shadow-md"
                  }`}
                  style={{
                    backgroundColor:
                      status === "loading" || code.join("").length !== 6
                        ? "#F1F3F4"
                        : googleBlue,
                  }}
                >
                  {status === "loading" ? "Verifying..." : "Verify Code"}
                </button>
              </form>
            )}
          </div>

          <div className="bg-gray-50 border-t border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
              <Lock className="w-3 h-3" />
              Secure Item Handover Protocol
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
