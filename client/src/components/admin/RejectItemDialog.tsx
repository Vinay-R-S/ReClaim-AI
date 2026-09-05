import { useState } from 'react';
import { X } from 'lucide-react';

interface RejectItemDialogProps {
  itemName: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Collects the reason a report is being rejected.
 *
 * The server requires one: it is the only record of what was wrong with the
 * report, and it is what the audit trail and the reporter end up seeing.
 */
export function RejectItemDialog({
  itemName,
  submitting,
  onCancel,
  onConfirm,
}: RejectItemDialogProps) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Reject report</h2>
            <p className="text-sm text-text-secondary">{itemName}</p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            title="Cancel"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <label htmlFor="reject-reason" className="block text-sm font-medium text-text-primary mb-2">
          Reason
        </label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="Why is this report being rejected?"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />

        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(trimmed)}
            disabled={!trimmed || submitting}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Rejecting...' : 'Reject report'}
          </button>
        </div>
      </div>
    </div>
  );
}
