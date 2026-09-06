import { useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { User } from '../types/domain';

/**
 * The filter and sort state behind the users table.
 *
 * Seven pieces of filter state, two sort toggles and a 140-line `useMemo` that
 * combined them all lived in the screen, which is most of why that file was
 * 760 lines.
 */

export type SortOrder = 'asc' | 'desc' | null;
export type StatusFilter = 'all' | 'active' | 'blocked';
export type ItemsFilter = 'all' | '0' | '1-5' | '6-10' | '11+';
export type DateRangeFilter = 'all' | '7days' | '30days' | '90days' | '1year' | 'custom';
export type ItemTypeFilter = 'all' | 'lost' | 'found' | 'both';
export type ItemTypeSort = 'lost' | 'found' | null;

export interface UserWithItemCounts extends User {
  itemsCount: number;
  lostCount: number;
  foundCount: number;
}

export function useUserFilters(users: UserWithItemCounts[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const [nameSort, setNameSort] = useState<SortOrder>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [itemsFilter, setItemsFilter] = useState<ItemsFilter>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>('all');
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  const [itemTypeSort, setItemTypeSort] = useState<ItemTypeSort>(null);
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  const filteredAndSortedUsers = useMemo(() => {
    let result = [...users];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((user) => {
        const displayName = (user.displayName || '').trim().toLowerCase();
        const email = (user.email || '').toLowerCase();
        return displayName.includes(query) || email.includes(query);
      });
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((user) => {
        const userStatus = user.status || 'active';
        return userStatus === statusFilter;
      });
    }

    // Apply items count filter
    if (itemsFilter !== 'all') {
      result = result.filter((user) => {
        const count = user.itemsCount;
        switch (itemsFilter) {
          case '0':
            return count === 0;
          case '1-5':
            return count >= 1 && count <= 5;
          case '6-10':
            return count >= 6 && count <= 10;
          case '11+':
            return count >= 11;
          default:
            return true;
        }
      });
    }

    // Apply date range filter
    if (dateRangeFilter !== 'all') {
      const now = new Date();
      let startDate: Date | null = null;

      switch (dateRangeFilter) {
        case '7days':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90days':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '1year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case 'custom':
          if (customDateFrom) {
            startDate = new Date(customDateFrom);
          }
          break;
      }

      result = result.filter((user) => {
        if (!user.createdAt) return false;
        const userDate =
          user.createdAt instanceof Timestamp ? user.createdAt.toDate() : new Date(user.createdAt);

        if (dateRangeFilter === 'custom') {
          const fromDate = customDateFrom ? new Date(customDateFrom) : null;
          const toDate = customDateTo ? new Date(customDateTo) : null;

          if (fromDate && userDate < fromDate) return false;
          if (toDate && userDate > toDate) return false;
          return true;
        }

        return startDate ? userDate >= startDate : true;
      });
    }

    // Apply Lost/Found item type filter
    if (itemTypeFilter !== 'all') {
      result = result.filter((user) => {
        switch (itemTypeFilter) {
          case 'lost':
            return user.lostCount > 0;
          case 'found':
            return user.foundCount > 0;
          case 'both':
            return user.lostCount > 0 && user.foundCount > 0;
          default:
            return true;
        }
      });
    }

    // Apply name sorting
    if (nameSort) {
      result.sort((a, b) => {
        const nameA = (a.displayName || a.email || '').toLowerCase();
        const nameB = (b.displayName || b.email || '').toLowerCase();
        if (nameSort === 'asc') {
          return nameA.localeCompare(nameB);
        } else {
          return nameB.localeCompare(nameA);
        }
      });
    }

    // Apply Lost/Found sorting
    if (itemTypeSort) {
      result.sort((a, b) => {
        if (itemTypeSort === 'lost') {
          return b.lostCount - a.lostCount; // Desc by default
        } else if (itemTypeSort === 'found') {
          return b.foundCount - a.foundCount; // Desc by default
        }
        return 0;
      });
    }

    return result;
  }, [
    users,
    searchQuery,
    statusFilter,
    itemsFilter,
    dateRangeFilter,
    itemTypeFilter,
    itemTypeSort,
    nameSort,
    customDateFrom,
    customDateTo,
  ]);

  // Handle name sort toggle

  const handleNameSort = () => {
    if (nameSort === null) {
      setNameSort('asc');
    } else if (nameSort === 'asc') {
      setNameSort('desc');
    } else {
      setNameSort(null);
    }
  };

  // Handle Lost/Found sort toggle
  const handleItemTypeSort = (type: 'lost' | 'found') => {
    if (itemTypeSort === type) {
      setItemTypeSort(null);
    } else {
      setItemTypeSort(type);
    }
  };

  // Export to Excel (ExcelJS loaded dynamically to reduce initial bundle size)

  const activeFilterCount = [
    statusFilter !== 'all',
    itemsFilter !== 'all',
    dateRangeFilter !== 'all',
    itemTypeFilter !== 'all',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setStatusFilter('all');
    setItemsFilter('all');
    setDateRangeFilter('all');
    setItemTypeFilter('all');
    setCustomDateFrom('');
    setCustomDateTo('');
  };

  return {
    filteredAndSortedUsers,
    activeFilterCount,
    resetFilters,
    handleNameSort,
    handleItemTypeSort,
    searchQuery,
    setSearchQuery,
    nameSort,
    statusFilter,
    setStatusFilter,
    itemsFilter,
    setItemsFilter,
    dateRangeFilter,
    setDateRangeFilter,
    itemTypeFilter,
    setItemTypeFilter,
    itemTypeSort,
    customDateFrom,
    setCustomDateFrom,
    customDateTo,
    setCustomDateTo,
  };
}
