import { useEffect, useState } from 'react';
import { Download, Filter, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getUsers, updateUserStatus } from '../../services/userService';
import { UserDetailModal } from '../../components/admin/UserDetailModal';
import { Timestamp } from 'firebase/firestore';
// ExcelJS is loaded dynamically on export to reduce bundle size
import { getItems } from '../../services/itemService';
import { useFeedback } from '../../hooks/useFeedback';
import { useUserFilters, type UserWithItemCounts } from '../../hooks/useUserFilters';
import { UserFiltersModal } from '../../components/admin/users/UserFiltersModal';
import { UsersTable } from '../../components/admin/users/UsersTable';
import { Feedback } from '../../components/ui/Feedback';

export function UsersManagement() {
  const { feedback, showError, clear } = useFeedback();
  const [users, setUsers] = useState<UserWithItemCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserWithItemCounts | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const {
    filteredAndSortedUsers,
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
  } = useUserFilters(users);

  // Fetch users and their item counts
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const fetchedUsers = await getUsers();
      const allItems = await getItems();

      const usersWithCounts = fetchedUsers.map((user) => {
        const userLostItems = allItems.filter(
          (item) => item.reportedBy === user.uid && item.type === 'Lost',
        );
        const userFoundItems = allItems.filter(
          (item) => item.reportedBy === user.uid && item.type === 'Found',
        );

        const lostCount = userLostItems.length;
        const foundCount = userFoundItems.length;
        const itemsCount = lostCount + foundCount;

        return {
          ...user,
          itemsCount,
          lostCount,
          foundCount,
        };
      });

      setUsers(usersWithCounts);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Close filter modal on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showFilters) {
        setShowFilters(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showFilters]);

  // Handle block/unblock toggle
  const handleToggleStatus = async (user: UserWithItemCounts) => {
    if (!user.uid) return;

    const currentStatus = user.status || 'active';
    const newStatus = currentStatus === 'active' ? 'blocked' : 'active';

    // Confirmation dialog for blocking (fraud warning)
    if (newStatus === 'blocked') {
      const confirmed = window.confirm(
        `WARNING: Blocking User: ${user.displayName || user.email}\n\n` +
          `This action will:\n` +
          `• Immediately prevent the user from logging in\n` +
          `• Sign them out of all active sessions\n` +
          `• Block access to all features\n\n` +
          `Are you sure you want to block this user?`,
      );

      if (!confirmed) {
        return;
      }
    }

    try {
      setUpdatingUserId(user.uid);
      await updateUserStatus(user.uid, newStatus);

      // Update local state
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid ? { ...u, status: newStatus as 'active' | 'blocked' } : u,
        ),
      );
    } catch (error) {
      console.error('Error updating user status:', error);
      showError('Failed to update user status. Please try again.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  // Filter and sort users
  const handleExportToExcel = async () => {
    // Dynamic import - ExcelJS is only loaded when user clicks Export
    const ExcelJS = (await import('exceljs')).default;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Users');

    // Add header row
    worksheet.columns = [
      { header: 'User Name', key: 'userName', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Items Submitted', key: 'itemsSubmitted', width: 15 },
      { header: 'Lost Items', key: 'lostItems', width: 12 },
      { header: 'Found Items', key: 'foundItems', width: 12 },
      { header: 'Joined On', key: 'joinedOn', width: 15 },
    ];

    // Add data rows
    filteredAndSortedUsers.forEach((user) => {
      worksheet.addRow({
        userName: user.displayName || 'No Name',
        email: user.email,
        status: (user.status || 'active') === 'active' ? 'Active' : 'Blocked',
        itemsSubmitted: user.itemsCount,
        lostItems: user.lostCount,
        foundItems: user.foundCount,
        joinedOn: formatDate(user.createdAt),
      });
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };

    // Generate Excel file and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `users_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Format date for display
  const formatDate = (date: Timestamp | Date | undefined) => {
    if (!date) return 'N/A';
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {feedback && <Feedback {...feedback} onDismiss={clear} />}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-medium text-text-primary">Users Management</h1>
        <p className="text-sm text-text-secondary mt-1">Manage user accounts and permissions</p>
      </div>

      {/* Users Table */}
      <div className="card">
        <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-4">
          <h2 className="font-medium text-text-primary">All Users</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 pl-10 pr-4 py-2 rounded-lg border border-border bg-gray-50 text-sm 
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'btn-pill btn-secondary text-sm flex items-center gap-2',
                (statusFilter !== 'all' ||
                  itemsFilter !== 'all' ||
                  dateRangeFilter !== 'all' ||
                  itemTypeFilter !== 'all') &&
                  'bg-primary/10 text-primary',
              )}
            >
              <Filter className="w-4 h-4" />
              Filter
              {(statusFilter !== 'all' ||
                itemsFilter !== 'all' ||
                dateRangeFilter !== 'all' ||
                itemTypeFilter !== 'all') && (
                <span className="ml-1 w-2 h-2 bg-primary rounded-full"></span>
              )}
            </button>
            <button
              onClick={handleExportToExcel}
              className="btn-pill btn-secondary text-sm flex items-center gap-2"
              disabled={filteredAndSortedUsers.length === 0}
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Filter Modal */}
        {showFilters && (
          <UserFiltersModal
            onClose={() => setShowFilters(false)}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            itemsFilter={itemsFilter}
            setItemsFilter={setItemsFilter}
            dateRangeFilter={dateRangeFilter}
            setDateRangeFilter={setDateRangeFilter}
            itemTypeFilter={itemTypeFilter}
            setItemTypeFilter={setItemTypeFilter}
            customDateFrom={customDateFrom}
            setCustomDateFrom={setCustomDateFrom}
            customDateTo={customDateTo}
            setCustomDateTo={setCustomDateTo}
            onReset={resetFilters}
          />
        )}

        <UsersTable
          loading={loading}
          users={users}
          filteredAndSortedUsers={filteredAndSortedUsers}
          nameSort={nameSort}
          itemTypeSort={itemTypeSort}
          updatingUserId={updatingUserId}
          onNameSort={handleNameSort}
          onItemTypeSort={handleItemTypeSort}
          onSelectUser={setSelectedUser}
          onToggleStatus={handleToggleStatus}
          formatDate={formatDate}
        />
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          itemsCount={selectedUser.itemsCount}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
}
