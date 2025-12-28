import { useState, useRef, useEffect } from "react";
import { Paperclip, MapPin, Send, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  startConversation,
  sendMessage,
  fileToBase64,
  getUserCredits,
} from "../../services/chatService";
import type { ConversationContext } from "../../services/chatService";
import { LocationModal } from "./LocationModal";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  chips?: { label: string; icon?: string }[];
  isLoading?: boolean;
}

const CONTEXT_MAP: Record<string, ConversationContext> = {
  "Report lost item": "report_lost",
  "Report found item": "report_found",
  "Check matches": "check_matches",
  "Find collection point": "find_collection",
};

const initialMessages: Message[] = [
  {
    id: "1",
    type: "assistant",
    content:
      "Hello! I'm your ReClaim assistant. I can help you report lost items, log found items, or check for potential matches. What would you like to do?",
    chips: [
      { label: "Report lost item", icon: "🔍" },
      { label: "Report found item", icon: "📦" },
      { label: "Check matches", icon: "🔔" },
      { label: "Find collection point", icon: "📍" },
    ],
  },
];

export function ChatInterface() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [currentContext, setCurrentContext] =
    useState<ConversationContext | null>(null);
  const [credits, setCredits] = useState<number>(0);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load user credits
  useEffect(() => {
    if (user?.uid) {
      getUserCredits(user.uid)
        .then((data) => setCredits(data.credits))
        .catch(console.error);
    }
  }, [user]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleChipClick = async (label: string) => {
    // Handle location chip - open location modal
    if (
      label.toLowerCase().includes("location") ||
      label.toLowerCase().includes("📍")
    ) {
      setShowLocationModal(true);
      return;
    }

    // Handle Add photo chip - open file picker
    if (
      label.toLowerCase().includes("photo") ||
      label.toLowerCase().includes("📷")
    ) {
      fileInputRef.current?.click();
      return;
    }

    // Handle Confirm chip - send confirmation to backend
    if (
      label.toLowerCase().includes("confirm") ||
      label.toLowerCase().includes("✅")
    ) {
      if (!user?.uid || !conversationId) return;

      setIsLoading(true);
      const userMessage: Message = {
        id: Date.now().toString(),
        type: "user",
        content: "✅ Confirmed",
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const response = await sendMessage(user.uid, "confirm", {
          conversationId,
          context: currentContext ?? undefined,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: "assistant",
            content: response.message,
            chips: response.chips,
          },
        ]);
      } catch (error) {
        console.error("Failed to confirm:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Handle Edit details chip - ask user to provide corrections
    if (
      label.toLowerCase().includes("edit") ||
      label.toLowerCase().includes("✏️")
    ) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          type: "assistant",
          content:
            "What would you like to change? You can update the name, description, location, or date.",
        },
      ]);
      return;
    }

    // Handle initial context chips (Report lost, Report found, etc.)
    const context = CONTEXT_MAP[label];
    if (!context || !user?.uid) return;

    setIsLoading(true);
    setCurrentContext(context);

    // Add user's selection as message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: label,
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await startConversation(user.uid, context);
      setConversationId(response.conversationId);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: response.message,
        chips: response.chips,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Failed to start conversation:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "Sorry, I'm having trouble connecting. Please try again.",
        chips: initialMessages[0].chips,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !user?.uid || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue,
    };

    // Add loading indicator
    const loadingMessage: Message = {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content: "",
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMessage, loadingMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await sendMessage(user.uid, inputValue, {
        conversationId: conversationId ?? undefined,
        context: currentContext ?? undefined,
      });

      if (!conversationId) {
        setConversationId(response.conversationId);
      }

      // Replace loading message with actual response
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: response.message,
            chips: response.chips,
          },
        ];
      });

      // If conversation is complete, show initial buttons again
      if (response.isComplete) {
        setConversationId(null);
        setCurrentContext(null);
        // Refresh credits if they might have changed
        getUserCredits(user.uid)
          .then((data) => setCredits(data.credits))
          .catch(console.error);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: "Sorry, something went wrong. Please try again.",
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;

    setIsLoading(true);

    try {
      const base64 = await fileToBase64(file);

      // Add message indicating image upload
      const userMessage: Message = {
        id: Date.now().toString(),
        type: "user",
        content: "📷 [Image uploaded]",
      };

      const loadingMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "",
        isLoading: true,
      };

      setMessages((prev) => [...prev, userMessage, loadingMessage]);

      const response = await sendMessage(
        user.uid,
        "I've uploaded an image of the item.",
        {
          conversationId: conversationId ?? undefined,
          context: currentContext ?? undefined,
          imageData: base64,
        }
      );

      if (!conversationId) {
        setConversationId(response.conversationId);
      }

      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: response.message,
            chips: response.chips,
          },
        ];
      });
    } catch (error) {
      console.error("Failed to upload image:", error);
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: "Failed to process the image. Please try again.",
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Open location modal instead of using GPS directly
  const handleLocationShare = () => {
    setShowLocationModal(true);
  };

  // Handle location selection from modal
  const handleLocationSelect = async (locationName: string) => {
    if (!user?.uid) return;

    setIsLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: `📍 Location: ${locationName}`,
    };

    const loadingMessage: Message = {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content: "",
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMessage, loadingMessage]);

    try {
      const response = await sendMessage(
        user.uid,
        `The location is: ${locationName}`,
        {
          conversationId: conversationId ?? undefined,
          context: currentContext ?? undefined,
        }
      );

      if (!conversationId) {
        setConversationId(response.conversationId);
      }

      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isLoading);
        return [
          ...filtered,
          {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: response.message,
            chips: response.chips,
          },
        ];
      });
    } catch (error) {
      console.error("Failed to send location:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getUserInitials = () => {
    if (user?.displayName) {
      return user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U";
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      {/* Assistant Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-google-blue via-google-green to-google-yellow flex items-center justify-center">
          <span className="text-white text-lg">✨</span>
        </div>
        <div>
          <h2 className="font-medium text-text-primary">ReClaim Assistant</h2>
          <p className="text-xs text-text-secondary">
            Powered by Google Gemini
          </p>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        {messages.map((message) => (
          <div key={message.id}>
            {message.type === "assistant" ? (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-google-blue to-google-green flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm">✨</span>
                </div>
                <div className="flex-1">
                  {message.isLoading ? (
                    <div className="chat-bubble chat-bubble-assistant inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  ) : (
                    <>
                      <div className="chat-bubble chat-bubble-assistant inline-block">
                        <p className="text-sm whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>
                      {message.chips && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {message.chips.map((chip, index) => (
                            <button
                              key={index}
                              className="chip"
                              onClick={() => handleChipClick(chip.label)}
                              disabled={isLoading}
                            >
                              {chip.icon && <span>{chip.icon}</span>}
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="flex items-end gap-2">
                  <div className="chat-bubble chat-bubble-user">
                    <p className="text-sm">{message.content}</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-google-red flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-medium">
                      {getUserInitials()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder="Describe your item or ask a question..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="chat-input pr-32"
            disabled={isLoading}
          />
          <div className="absolute right-2 flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
            <button
              className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="Attach file"
            >
              <Paperclip className="w-5 h-5 text-text-secondary" />
            </button>
            <button
              className="p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50"
              onClick={handleLocationShare}
              disabled={isLoading}
              title="Share location"
            >
              <MapPin className="w-5 h-5 text-text-secondary" />
            </button>
            <button
              onClick={handleSend}
              disabled={isLoading || !inputValue.trim()}
              className="p-2 rounded-full bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
              title="Send message"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Location Modal */}
      <LocationModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelectLocation={handleLocationSelect}
      />
    </div>
  );
}
