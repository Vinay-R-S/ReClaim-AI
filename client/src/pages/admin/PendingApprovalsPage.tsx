import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Search, RefreshCw, Clock, Check, X } from 'lucide-react';
import { getItems, moderateItem } from '@/services/itemService';
import type { Item } from '@/types/domain';
import { RejectItemDialog } from '@/components/admin/RejectItemDialog';
import { Timestamp } from 'firebase/firestore';

export function PendingApprovalsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPendingItems = async () => {
    try {
      setLoading(true);
      const allItems = await getItems();
      // Awaiting review, which is not the same thing as awaiting a match: an
      // approved item sits at status Pending for as long as it takes to find a
      // counterpart. Items reported before review existed carry no moderation
      // field and are already live, so they are not queued here.
      setItems(allItems.filter((item) => item.moderation === 'pending'));
    } catch (err) {
      console.error('Failed to fetch pending items:', err);
      setError('Could not load the review queue.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Record a decision and drop the item from the queue.
   *
   * The list is updated optimistically and the item is put back if the server
   * refuses, which is the only way the admin finds out the decision did not
   * land: the row is gone by then.
   */
  const decide = async (item: Item, decision: 'approved' | 'rejected', reason?: string) => {
    setPendingId(item.id);
    setError(null);
    setItems((current) => current.filter((entry) => entry.id !== item.id));

    try {
      await moderateItem(item.id, decision, reason);
      setRejecting(null);
    } catch (err) {
      setItems((current) => [item, ...current]);
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setPendingId(null);
    }
  };

  useEffect(() => {
    fetchPendingItems();
  }, []);

  const filteredItems = items.filter((item) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      item.name.toLowerCase().includes(searchLower) ||
      item.location.toLowerCase().includes(searchLower) ||
      item.type.toLowerCase().includes(searchLower)
    );
  });

  // Format date for display
  const formatDate = (date: Timestamp | Date | unknown) => {
    try {
      if (!date) return 'N/A';

      let d: Date;
      if (date instanceof Timestamp) {
        d = date.toDate();
      } else if (date instanceof Date) {
        d = date;
      } else if (typeof date === 'object' && date !== null && '_seconds' in date) {
        d = new Date((date as { _seconds: number })._seconds * 1000);
      } else if (typeof date === 'object' && date !== null && 'seconds' in date) {
        d = new Date((date as { seconds: number }).seconds * 1000);
      } else {
        d = new Date(date as string | number);
      }

      if (isNaN(d.getTime())) {
        return 'N/A';
      }

      return format(d, 'MMM d, yyyy');
    } catch {
      return 'N/A';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pending Approvals</h1>
          <p className="text-text-secondary">
            Reports awaiting review. Approving one publishes it and starts matching.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              placeholder="Search pending items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <button
            onClick={fetchPendingItems}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5 text-text-secondary" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Stats Card */}
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
          <Clock className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <p className="text-lg font-bold text-orange-700">{items.length} Awaiting Review</p>
          <p className="text-sm text-orange-600">
            Not yet visible to users or eligible for matching
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Item
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Type
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Location
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Reported On
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-text-secondary">
                    Decision
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-text-secondary">
                      {searchTerm
                        ? 'No items awaiting review match your search'
                        : 'Nothing is waiting for review'}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {item.cloudinaryUrls?.[0] || item.imageUrl ? (
                            <img
                              src={item.cloudinaryUrls?.[0] || item.imageUrl}
                              alt={item.name}
                              className="w-10 h-10 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                              <Clock className="w-5 h-5 text-gray-400" />
                            </div>
                          )}
                          <span className="text-sm font-medium text-text-primary">{item.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            item.type === 'Lost'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {item.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-text-secondary">
                        {item.location.split(',').slice(0, 2).join(', ')}
                      </td>
                      <td className="py-3 px-4 text-sm text-text-secondary">
                        {formatDate(item.createdAt || item.date)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                          Awaiting review
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => decide(item, 'approved')}
                            disabled={pendingId === item.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            onClick={() => setRejecting(item)}
                            disabled={pendingId === item.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rejecting && (
        <RejectItemDialog
          itemName={rejecting.name}
          submitting={pendingId === rejecting.id}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => decide(rejecting, 'rejected', reason)}
        />
      )}
    </div>
  );
}
