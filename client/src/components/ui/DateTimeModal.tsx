import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { X, Calendar, Clock } from "lucide-react";
import "react-day-picker/dist/style.css";

interface DateTimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDateTime: (dateTime: Date) => void;
}

export function DateTimeModal({
  isOpen,
  onClose,
  onSelectDateTime,
}: DateTimeModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date()
  );
  const [selectedHour, setSelectedHour] = useState("12");
  const [selectedMinute, setSelectedMinute] = useState("00");
  const [ampm, setAmpm] = useState<"AM" | "PM">("PM");

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!selectedDate) return;

    const date = new Date(selectedDate);
    let hour = parseInt(selectedHour);

    // Convert to 24-hour format
    if (ampm === "PM" && hour !== 12) {
      hour += 12;
    } else if (ampm === "AM" && hour === 12) {
      hour = 0;
    }

    date.setHours(hour, parseInt(selectedMinute), 0, 0);
    onSelectDateTime(date);
    onClose();
  };

  const hours = Array.from({ length: 12 }, (_, i) =>
    (i + 1).toString().padStart(2, "0")
  );
  const minutes = ["00", "15", "30", "45"];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[380px] max-w-[95vw] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-blue-600">
          <div className="flex items-center gap-2 text-white">
            <Calendar className="w-5 h-5" />
            <h3 className="font-semibold">Select Date and Time</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Calendar */}
        <div className="p-4 flex justify-center">
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            className="!m-0"
            styles={{
              caption: { color: "#1e40af" },
              day_selected: { backgroundColor: "#3b82f6" },
            }}
          />
        </div>

        {/* Time Selection */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-3 text-gray-600">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Time</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedHour}
              onChange={(e) => setSelectedHour(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-xl font-bold text-gray-400">:</span>
            <select
              value={selectedMinute}
              onChange={(e) => setSelectedMinute(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {minutes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => setAmpm("AM")}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  ampm === "AM"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                AM
              </button>
              <button
                onClick={() => setAmpm("PM")}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  ampm === "PM"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                PM
              </button>
            </div>
          </div>
        </div>

        {/* Selected Preview */}
        {selectedDate && (
          <div className="px-4 pb-4">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-sm text-blue-600 font-medium">
                {format(selectedDate, "EEEE, MMMM d, yyyy")} at {selectedHour}:
                {selectedMinute} {ampm}
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedDate}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
