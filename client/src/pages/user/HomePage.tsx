import { useState } from "react";
import { UserLayout } from "../../components/layout/UserLayout";
import { ChatInterface } from "../../components/ui/ChatInterface";
import { ReportItemModal } from "../../components/user/ReportItemModal";
import { Search, Package, MessageCircle, X } from "lucide-react";

type ReportType = "Lost" | "Found" | null;

export function HomePage() {
  const [reportType, setReportType] = useState<ReportType>(null);
  const [showChat, setShowChat] = useState(false);

  const handleReportSuccess = () => {
    // Could show a success toast or redirect
    setReportType(null);
  };

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Report Lost */}
          <div
            onClick={() => setReportType("Lost")}
            className="card p-6 cursor-pointer hover:shadow-lg transition-all hover:border-red-200 border-2 border-transparent"
          >
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Report Lost Item
            </h3>
            <p className="text-sm text-text-secondary">
              Lost something? Report it and we'll help you find it.
            </p>
          </div>

          {/* Report Found */}
          <div
            onClick={() => setReportType("Found")}
            className="card p-6 cursor-pointer hover:shadow-lg transition-all hover:border-green-200 border-2 border-transparent"
          >
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <Package className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Report Found Item
            </h3>
            <p className="text-sm text-text-secondary">
              Found something? Help reunite it with its owner.
            </p>
          </div>

          {/* Check Matches */}
          <div
            onClick={() => setShowChat(true)}
            className="card p-6 cursor-pointer hover:shadow-lg transition-all hover:border-blue-200 border-2 border-transparent"
          >
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <MessageCircle className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              Check Matches
            </h3>
            <p className="text-sm text-text-secondary">
              Chat with AI to check for potential matches or claim items.
            </p>
          </div>
        </div>

        {/* How it Works */}
        <div className="card p-6 mt-8">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            How It Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center mx-auto mb-3">
                1
              </div>
              <h3 className="font-medium text-text-primary mb-1">Report</h3>
              <p className="text-sm text-text-secondary">
                Take a photo and provide details about the item
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center mx-auto mb-3">
                2
              </div>
              <h3 className="font-medium text-text-primary mb-1">Match</h3>
              <p className="text-sm text-text-secondary">
                AI analyzes and matches lost & found items
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center mx-auto mb-3">
                3
              </div>
              <h3 className="font-medium text-text-primary mb-1">Reunite</h3>
              <p className="text-sm text-text-secondary">
                Verify ownership and collect your item
              </p>
            </div>
          </div>
        </div>

        {/* Report Modal */}
        {reportType && (
          <ReportItemModal
            type={reportType}
            onClose={() => setReportType(null)}
            onSuccess={handleReportSuccess}
          />
        )}

        {/* Chat Modal for Verification/Matches */}
        {showChat && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-lg font-semibold text-text-primary">
                  Chat Assistant
                </h2>
                <button
                  onClick={() => setShowChat(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden p-4">
                <ChatInterface />
              </div>
            </div>
          </div>
        )}
      </div>
    </UserLayout>
  );
}
