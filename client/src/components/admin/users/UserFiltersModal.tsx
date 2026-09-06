/**
 * The users filter panel.
 *
 * Four filter groups and a custom date range, which together were 150 lines
 * inside a screen that was already the second largest in the app.
 */

import { X } from 'lucide-react';
import type {
  DateRangeFilter,
  ItemTypeFilter,
  ItemsFilter,
  StatusFilter,
} from '../../../hooks/useUserFilters';

interface UserFiltersModalProps {
  onClose: () => void;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  itemsFilter: ItemsFilter;
  setItemsFilter: (value: ItemsFilter) => void;
  dateRangeFilter: DateRangeFilter;
  setDateRangeFilter: (value: DateRangeFilter) => void;
  itemTypeFilter: ItemTypeFilter;
  setItemTypeFilter: (value: ItemTypeFilter) => void;
  customDateFrom: string;
  setCustomDateFrom: (value: string) => void;
  customDateTo: string;
  setCustomDateTo: (value: string) => void;
  onReset: () => void;
}

export function UserFiltersModal({
  onClose,
  statusFilter,
  setStatusFilter,
  itemsFilter,
  setItemsFilter,
  dateRangeFilter,
  setDateRangeFilter,
  itemTypeFilter,
  setItemTypeFilter,
  customDateFrom,
  setCustomDateFrom,
  customDateTo,
  setCustomDateTo,
  onReset,
}: UserFiltersModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-medium text-text-primary">Filters</h2>
          <button
            onClick={() => onClose()}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-6">
            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                               focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            {/* Items Count Filter */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Items Submitted
              </label>
              <select
                value={itemsFilter}
                onChange={(e) => setItemsFilter(e.target.value as ItemsFilter)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                               focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="all">All</option>
                <option value="0">0</option>
                <option value="1-5">1-5</option>
                <option value="6-10">6-10</option>
                <option value="11+">11+</option>
              </select>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Joined On</label>
              <select
                value={dateRangeFilter}
                onChange={(e) => setDateRangeFilter(e.target.value as DateRangeFilter)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                               focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="all">All time</option>
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="90days">Last 90 days</option>
                <option value="1year">Last year</option>
                <option value="custom">Custom range</option>
              </select>
            </div>

            {/* Custom Date Range */}
            {dateRangeFilter === 'custom' && (
              <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                <div>
                  <label className="block text-sm text-text-secondary mb-2">From Date</label>
                  <input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                                   focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-2">To Date</label>
                  <input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                                   focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Lost/Found Filter */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Item Type</label>
              <select
                value={itemTypeFilter}
                onChange={(e) => setItemTypeFilter(e.target.value as ItemTypeFilter)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                               focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="all">All</option>
                <option value="lost">Lost items only</option>
                <option value="found">Found items only</option>
                <option value="both">Both Lost & Found</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-gray-50/50">
          {(statusFilter !== 'all' ||
            itemsFilter !== 'all' ||
            dateRangeFilter !== 'all' ||
            itemTypeFilter !== 'all') && (
            <button onClick={onReset} className="text-sm text-primary hover:underline font-medium">
              Clear all filters
            </button>
          )}
          <div className="ml-auto">
            <button onClick={() => onClose()} className="btn-pill btn-primary text-sm px-4 py-2">
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
