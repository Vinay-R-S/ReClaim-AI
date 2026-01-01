import { useState, useEffect, useMemo } from "react";
import { Eye, Ban, CheckCircle, Search, ArrowUp, ArrowDown, Download, Filter, X } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  type User,
  getUsers,
  updateUserStatus,
  getUserItemsCount,
} from "../../services/userService";
import { UserDetailModal } from "../../components/admin/UserDetailModal";
import { Timestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { getItems, type Item } from "../../services/itemService";

type SortOrder = "asc" | "desc" | null;
type StatusFilter = "all" | "active" | "blocked";
type ItemsFilter = "all" | "0" | "1-5" | "6-10" | "11+";
type DateRangeFilter = "all" | "7days" | "30days" | "90days" | "1year" | "custom";
type ItemTypeFilter = "all" | "lost" | "found" | "both";
type ItemTypeSort = "lost" | "found" | null;

interface UserWithItemCounts extends User {
  itemsCount: number;
  lostCount: number;
  foundCount: number;
}

export function UsersManagement() {
  const [users, setUsers] = useState<UserWithItemCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserWithItemCounts | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nameSort, setNameSort] = useState<SortOrder>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [itemsFilter, setItemsFilter] = useState<ItemsFilter>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>("all");
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>("all");
  const [itemTypeSort, setItemTypeSort] = useState<ItemTypeSort>(null);
  const [customDateFrom, setCustomDateFrom] = useState<string>("");
  const [customDateTo, setCustomDateTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  // Fetch users and their item counts
  const fetchUsers = async () => {
    try {
      setLoading(true);
      const fetchedUsers = await getUsers();

      // Use stored counts from user data instead of calculating
      const usersWithCounts = fetchedUsers.map((user) => {
        const lostCount = user.lostItemsCount || 0;
        const foundCount = user.foundItemsCount || 0;
        const itemsCount = user.totalItemsCount || 0;
        
        return { 
          ...user, 
          itemsCount,
          lostCount,
          foundCount
        };
      });

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

  // Close filter modal on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showFilters) {
        setShowFilters(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showFilters]);

  // Handle block/unblock toggle
  const handleToggleStatus = async (user: UserWithItemCounts) => {
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

  // Filter and sort users
  const filteredAndSortedUsers = useMemo(() => {
    let result = [...users];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((user) => {
        const displayName = (user.displayName || "").trim().toLowerCase();
        const email = (user.email || "").toLowerCase();
        return displayName.includes(query) || email.includes(query);
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((user) => {
        const userStatus = user.status || "active";
        return userStatus === statusFilter;
      });
    }

    // Apply items count filter
    if (itemsFilter !== "all") {
      result = result.filter((user) => {
        const count = user.itemsCount;
        switch (itemsFilter) {
          case "0":
            return count === 0;
          case "1-5":
            return count >= 1 && count <= 5;
          case "6-10":
            return count >= 6 && count <= 10;
          case "11+":
            return count >= 11;
          default:
            return true;
        }
      });
    }

    // Apply date range filter
    if (dateRangeFilter !== "all") {
      const now = new Date();
      let startDate: Date | null = null;

      switch (dateRangeFilter) {
        case "7days":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30days":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "90days":
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "1year":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        case "custom":
          if (customDateFrom) {
            startDate = new Date(customDateFrom);
          }
          break;
      }

      result = result.filter((user) => {
        if (!user.createdAt) return false;
        const userDate = user.createdAt instanceof Timestamp 
          ? user.createdAt.toDate() 
          : new Date(user.createdAt);
        
        if (dateRangeFilter === "custom") {
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
    if (itemTypeFilter !== "all") {
      result = result.filter((user) => {
        switch (itemTypeFilter) {
          case "lost":
            return user.lostCount > 0;
          case "found":
            return user.foundCount > 0;
          case "both":
            return user.lostCount > 0 && user.foundCount > 0;
          default:
            return true;
        }
      });
    }

    // Apply name sorting
    if (nameSort) {
      result.sort((a, b) => {
        const nameA = (a.displayName || a.email || "").toLowerCase();
        const nameB = (b.displayName || b.email || "").toLowerCase();
        if (nameSort === "asc") {
          return nameA.localeCompare(nameB);
        } else {
          return nameB.localeCompare(nameA);
        }
      });
    }

    // Apply Lost/Found sorting
    if (itemTypeSort) {
      result.sort((a, b) => {
        if (itemTypeSort === "lost") {
          return b.lostCount - a.lostCount; // Desc by default
        } else if (itemTypeSort === "found") {
          return b.foundCount - a.foundCount; // Desc by default
        }
        return 0;
      });
    }

    return result;
  }, [users, searchQuery, statusFilter, itemsFilter, dateRangeFilter, itemTypeFilter, itemTypeSort, nameSort, customDateFrom, customDateTo]);

  // Handle name sort toggle
  const handleNameSort = () => {
    if (nameSort === null) {
      setNameSort("asc");
    } else if (nameSort === "asc") {
      setNameSort("desc");
    } else {
      setNameSort(null);
    }
  };

  // Handle Lost/Found sort toggle
  const handleItemTypeSort = (type: "lost" | "found") => {
    if (itemTypeSort === type) {
      setItemTypeSort(null);
    } else {
      setItemTypeSort(type);
    }
  };

  // Export to Excel
  const handleExportToExcel = () => {
    const dataToExport = filteredAndSortedUsers.map((user) => ({
      "User Name": user.displayName || "No Name",
      Email: user.email,
      Status: (user.status || "active") === "active" ? "Active" : "Blocked",
      "Items Submitted": user.itemsCount,
      "Lost Items": user.lostCount,
      "Found Items": user.foundCount,
      "Joined On": formatDate(user.createdAt),
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Users");

    // Generate Excel file
    const fileName = `users_export_${new Date().toISOString().split("T")[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

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
                "btn-pill btn-secondary text-sm flex items-center gap-2",
                (statusFilter !== "all" || itemsFilter !== "all" || dateRangeFilter !== "all" || itemTypeFilter !== "all") && "bg-primary/10 text-primary"
              )}
            >
              <Filter className="w-4 h-4" />
              Filter
              {(statusFilter !== "all" || itemsFilter !== "all" || dateRangeFilter !== "all" || itemTypeFilter !== "all") && (
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
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowFilters(false);
              }
            }}
          >
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-lg font-medium text-text-primary">Filters</h2>
                <button
                  onClick={() => setShowFilters(false)}
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
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Status
                    </label>
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
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Joined On
                    </label>
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
                  {dateRangeFilter === "custom" && (
                    <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                      <div>
                        <label className="block text-sm text-text-secondary mb-2">
                          From Date
                        </label>
                        <input
                          type="date"
                          value={customDateFrom}
                          onChange={(e) => setCustomDateFrom(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm 
                                   focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-secondary mb-2">
                          To Date
                        </label>
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
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Item Type
                    </label>
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
                {(statusFilter !== "all" || itemsFilter !== "all" || dateRangeFilter !== "all" || itemTypeFilter !== "all") && (
                  <button
                    onClick={() => {
                      setStatusFilter("all");
                      setItemsFilter("all");
                      setDateRangeFilter("all");
                      setItemTypeFilter("all");
                      setCustomDateFrom("");
                      setCustomDateTo("");
                    }}
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    Clear all filters
                  </button>
                )}
                <div className="ml-auto">
                  <button
                    onClick={() => setShowFilters(false)}
                    className="btn-pill btn-primary text-sm px-4 py-2"
                  >
                    Apply Filters
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
              <p className="text-text-secondary">
                No users match the current filters
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    <button
                      onClick={handleNameSort}
                      className="flex items-center gap-2 hover:text-text-primary transition-colors"
                    >
                      User Name
                      {nameSort === "asc" && <ArrowUp className="w-4 h-4" />}
                      {nameSort === "desc" && <ArrowDown className="w-4 h-4" />}
                    </button>
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
                    <button
                      onClick={() => handleItemTypeSort("lost")}
                      className="flex items-center gap-2 hover:text-text-primary transition-colors"
                    >
                      Lost Items
                      {itemTypeSort === "lost" && <ArrowDown className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-secondary">
                    <button
                      onClick={() => handleItemTypeSort("found")}
                      className="flex items-center gap-2 hover:text-text-primary transition-colors"
                    >
                      Found Items
                      {itemTypeSort === "found" && <ArrowDown className="w-4 h-4" />}
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
                      <span className={cn(
                        "inline-block px-2 py-1 rounded text-xs font-medium",
                        user.lostCount > 0 ? "bg-google-red/10 text-google-red" : "text-text-secondary"
                      )}>
                        {user.lostCount}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      <span className={cn(
                        "inline-block px-2 py-1 rounded text-xs font-medium",
                        user.foundCount > 0 ? "bg-google-green/10 text-google-green" : "text-text-secondary"
                      )}>
                        {user.foundCount}
                      </span>
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
