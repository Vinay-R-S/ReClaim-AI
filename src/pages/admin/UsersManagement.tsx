import { useState, useEffect, useMemo } from "react";
import { Eye, Ban, CheckCircle, Search } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  type User,
  getUsers,
  updateUserStatus,
  getUserItemsCount,
} from "../../services/userService";
import { UserDetailModal } from "../../components/admin/UserDetailModal";
import { Timestamp } from "firebase/firestore";

export function UsersManagement() {
  const [users, setUsers] = useState<(User & { itemsCount: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<
    (User & { itemsCount: number }) | null
  >(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch users and their item counts
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const fetchedUsers = await getUsers();

      // Fetch item counts for each user
      const usersWithCounts = await Promise.all(
        fetchedUsers.map(async (user) => {
          const itemsCount = await getUserItemsCount(user.email, user.uid);
          return { ...user, itemsCount };
        })
      );

      setUsers(usersWithCounts);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Handle block/unblock toggle
  const handleToggleStatus = async (user: User & { itemsCount: number }) => {
    if (!user.uid) return;

    const currentStatus = user.status || "active";
    const newStatus = currentStatus === "active" ? "blocked" : "active";

    // Confirmation dialog for blocking (fraud warning)
    if (newStatus === "blocked") {
      const confirmed = window.confirm(
        `⚠️ WARNING: Blocking User: ${user.displayName || user.email}\n\n` +
        `This action will:\n` +
        `• Immediately prevent the user from logging in\n` +
        `• Sign them out of all active sessions\n` +
        `• Block access to all features\n\n` +
        `Are you sure you want to block this user?`
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
          u.uid === user.uid
            ? { ...u, status: newStatus as "active" | "blocked" }
            : u
        )
      );
    } catch (error) {
      console.error("Error updating user status:", error);
      alert("Failed to update user status. Please try again.");
    } finally {
      setUpdatingUserId(null);
    }
  };

  // Filter users based on search query (case-insensitive, partial match)
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) {
      return users;
    }

    const query = searchQuery.toLowerCase().trim();
    return users.filter((user) => {
      // Get display name (User Name column) - this is the primary search field
      const displayName = (user.displayName || "").trim().toLowerCase();
      // Get full email
      const email = (user.email || "").toLowerCase();
      
      // Search in: displayName (User Name) and full email
      return displayName.includes(query) || email.includes(query);
    });
  }, [users, searchQuery]);

  // Format date for display
  const formatDate = (date: Timestamp | Date | undefined) => {
    if (!date) return "N/A";
    const d = date instanceof Timestamp ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-medium text-text-primary">Users Management</h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage user accounts and permissions
        </p>
      </div>

      {/* Users Table */}
      <div className="card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-medium text-text-primary">All Users</h2>
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
        </div>

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
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-text-secondary">
                No users match "{searchQuery}"
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    User Name
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Email
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Status
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    Items Submitted
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
                {filteredUsers.map((user) => (
                  <tr
                    key={user.uid}
                    className={cn(
                      "border-b border-border transition-colors",
                      (user.status || "active") === "blocked"
                        ? "bg-gray-50/50 opacity-75"
                        : "hover:bg-gray-50"
                    )}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {user.photoURL ? (
                          <img
                            src={user.photoURL}
                            alt={user.displayName || user.email}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-medium">
                            {user.displayName
                              ? user.displayName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .toUpperCase()
                                  .slice(0, 2)
                              : user.email[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {user.displayName || "No Name"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {user.email}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={cn(
                          "badge px-3 py-1",
                          (user.status || "active") === "active"
                            ? "badge-active"
                            : "badge-blocked"
                        )}
                      >
                        {(user.status || "active") === "active" ? "Active" : "Blocked"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {user.itemsCount}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-primary"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(user)}
                          disabled={updatingUserId === user.uid}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            (user.status || "active") === "active"
                              ? "text-google-red hover:bg-red-50"
                              : "text-google-green hover:bg-green-50",
                            updatingUserId === user.uid && "opacity-50 cursor-not-allowed"
                          )}
                          title={
                            (user.status || "active") === "active" ? "Block User" : "Unblock User"
                          }
                        >
                          {(user.status || "active") === "active" ? (
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
