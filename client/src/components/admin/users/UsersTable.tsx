/**
 * The users table.
 *
 * Rendering only: the sorting handlers and the filtered list come from
 * `useUserFilters`, and the block/unblock action from the screen.
 */

import { ArrowDown, ArrowUp, Ban, CheckCircle, Eye } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Timestamp } from 'firebase/firestore';
import type { ItemTypeSort, SortOrder, UserWithItemCounts } from '../../../hooks/useUserFilters';

interface UsersTableProps {
  loading: boolean;
  users: UserWithItemCounts[];
  filteredAndSortedUsers: UserWithItemCounts[];
  nameSort: SortOrder;
  itemTypeSort: ItemTypeSort;
  updatingUserId: string | null;
  onNameSort: () => void;
  onItemTypeSort: (type: 'lost' | 'found') => void;
  onSelectUser: (user: UserWithItemCounts) => void;
  onToggleStatus: (user: UserWithItemCounts) => void;
  formatDate: (date: Timestamp | Date | undefined) => string;
}

export function UsersTable({
  loading,
  users,
  filteredAndSortedUsers,
  nameSort,
  itemTypeSort,
  updatingUserId,
  onNameSort,
  onItemTypeSort,
  onSelectUser,
  onToggleStatus,
  formatDate,
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto">
      {loading ? (
        <div className="p-8 text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-text-secondary">Loading users...</p>
        </div>
      ) : users.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-text-secondary">No users found</p>
        </div>
      ) : filteredAndSortedUsers.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-text-secondary">No users match the current filters</p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                <button
                  onClick={onNameSort}
                  className="flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                  User Name
                  {nameSort === 'asc' && <ArrowUp className="w-4 h-4" />}
                  {nameSort === 'desc' && <ArrowDown className="w-4 h-4" />}
                </button>
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">Email</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                Status
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                Items Submitted
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                <button
                  onClick={() => onItemTypeSort('lost')}
                  className="flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                  Lost Items
                  {itemTypeSort === 'lost' && <ArrowDown className="w-4 h-4" />}
                </button>
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                <button
                  onClick={() => onItemTypeSort('found')}
                  className="flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                  Found Items
                  {itemTypeSort === 'found' && <ArrowDown className="w-4 h-4" />}
                </button>
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                Joined On
              </th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedUsers.map((user) => (
              <tr
                key={user.uid}
                className={cn(
                  'border-b border-border transition-colors',
                  (user.status || 'active') === 'blocked'
                    ? 'bg-gray-50/50 opacity-75'
                    : 'hover:bg-gray-50',
                )}
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || user.email}
                        className="w-8 h-8 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-medium">
                        {user.displayName
                          ? user.displayName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)
                          : user.email[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        {user.displayName || 'No Name'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm text-text-primary">{user.email}</td>
                <td className="py-3 px-4">
                  <span
                    className={cn(
                      'badge px-3 py-1',
                      (user.status || 'active') === 'active' ? 'badge-active' : 'badge-blocked',
                    )}
                  >
                    {(user.status || 'active') === 'active' ? 'Active' : 'Blocked'}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-text-primary">{user.itemsCount}</td>
                <td className="py-3 px-4 text-sm text-text-primary">
                  <span
                    className={cn(
                      'inline-block px-2 py-1 rounded text-xs font-medium',
                      user.lostCount > 0
                        ? 'bg-google-red/10 text-google-red'
                        : 'text-text-secondary',
                    )}
                  >
                    {user.lostCount}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-text-primary">
                  <span
                    className={cn(
                      'inline-block px-2 py-1 rounded text-xs font-medium',
                      user.foundCount > 0
                        ? 'bg-google-green/10 text-google-green'
                        : 'text-text-secondary',
                    )}
                  >
                    {user.foundCount}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-text-primary">
                  {formatDate(user.createdAt)}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectUser(user)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-primary"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onToggleStatus(user)}
                      disabled={updatingUserId === user.uid}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors',
                        (user.status || 'active') === 'active'
                          ? 'text-google-red hover:bg-red-50'
                          : 'text-google-green hover:bg-green-50',
                        updatingUserId === user.uid && 'opacity-50 cursor-not-allowed',
                      )}
                      title={(user.status || 'active') === 'active' ? 'Block User' : 'Unblock User'}
                    >
                      {(user.status || 'active') === 'active' ? (
                        <Ban className="w-4 h-4" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
