import { useState } from "react";
import { Camera, MapPin, Mic, Send } from "lucide-react";
import { cn } from "../../lib/utils";

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  chips?: { label: string; icon?: string }[];
}

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
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: inputValue,
    };

    const assistantResponse: Message = {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content:
        "I'll help you report your lost laptop bag. To improve matching accuracy, can you share a photo or describe more details? (brand, size, distinctive marks)",
      chips: [
        { label: "Upload photo", icon: "📷" },
        { label: "Add more details", icon: "✏️" },
      ],
    };

    setMessages([...messages, userMessage, assistantResponse]);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
                  <div className="chat-bubble chat-bubble-assistant inline-block">
                    <p className="text-sm">{message.content}</p>
                  </div>
                  {message.chips && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {message.chips.map((chip, index) => (
                        <button key={index} className="chip">
                          {chip.icon && <span>{chip.icon}</span>}
                          {chip.label}
                        </button>
                      ))}
                    </div>
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
                    <span className="text-white text-xs font-medium">JS</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
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
          />
          <div className="absolute right-2 flex items-center gap-1">
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
              <Camera className="w-5 h-5 text-text-secondary" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
              <MapPin className="w-5 h-5 text-text-secondary" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
              <Mic className="w-5 h-5 text-text-secondary" />
            </button>
            <button
              onClick={handleSend}
              className="p-2 rounded-full bg-primary text-white hover:bg-primary-hover transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
