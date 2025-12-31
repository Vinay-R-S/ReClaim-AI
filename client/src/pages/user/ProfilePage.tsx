import { useState, useEffect, useRef } from "react";
import { UserLayout } from "../../components/layout/UserLayout";
import { useAuth } from "../../context/AuthContext";
import { type Item } from "../../services/itemService";
import { Mail, Calendar, Award, Package, Search, CheckCircle, Camera, Loader2, Clock } from "lucide-react";
import { Timestamp, doc, getDoc, updateDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { db } from "../../lib/firebase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface UserStats {
  totalReports: number;
  lostItems: number;
  foundItems: number;
  matchedItems: number;
  claimedItems: number;
  credits: number;
}

// Extract name from email (e.g., "john.doe@example.com" -> "John Doe")
function getNameFromEmail(email: string | null | undefined): string {
  if (!email) return "User";
  
  // If email has a display name format, extract it
  const localPart = email.split("@")[0];
  
  // Convert "john.doe" to "John Doe" or "johndoe" to "Johndoe"
  const nameParts = localPart
    .split(/[._-]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  
  return nameParts || email;
}

export function ProfilePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UserStats>({
    totalReports: 0,
    lostItems: 0,
    foundItems: 0,
    matchedItems: 0,
    claimedItems: 0,
    credits: 0,
  });
  const [userData, setUserData] = useState<{
    createdAt?: Timestamp | Date;
    lastLoginAt?: Timestamp | Date;
  } | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch user stats and data
  useEffect(() => {
    if (!user?.uid) return;

    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch user document from Firestore
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData({
            createdAt: data.createdAt,
            lastLoginAt: data.lastLoginAt,
          });
        }

        // Fetch user's items
        const itemsResponse = await fetch(`${API_URL}/api/items?reportedBy=${user.uid}`);
        if (itemsResponse.ok) {
          const itemsData = await itemsResponse.json();
          const items: Item[] = itemsData.items || [];

          const lostItems = items.filter((item) => item.type === "Lost").length;
          const foundItems = items.filter((item) => item.type === "Found").length;
          const matchedItems = items.filter((item) => item.status === "Matched").length;
          const claimedItems = items.filter((item) => item.status === "Claimed" || item.status === "Resolved").length;

          setStats((prev) => ({
            ...prev,
            totalReports: items.length,
            lostItems,
            foundItems,
            matchedItems,
            claimedItems,
          }));
        }

        // Fetch credits
        const creditsResponse = await fetch(`${API_URL}/api/credits/${user.uid}`);
        if (creditsResponse.ok) {
          const creditsData = await creditsResponse.json();
          setStats((prev) => ({
            ...prev,
            credits: creditsData.credits || 0,
          }));
        }
      } catch (error) {
        console.error("Error fetching profile data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid]);

  // Get display name from user's email (use displayName if available, otherwise extract from email)
  const displayName = user?.displayName || getNameFromEmail(user?.email);

  const formatDate = (date: Timestamp | Date | unknown) => {
    try {
      if (!date) return "Not available";

      let d: Date;
      if (date instanceof Timestamp) {
        d = date.toDate();
      } else if (date instanceof Date) {
        d = date;
      } else if (
        typeof date === "object" &&
        date !== null &&
        ("seconds" in date || "_seconds" in date)
      ) {
        const seconds =
          (date as { seconds?: number; _seconds?: number }).seconds ??
          (date as { _seconds: number })._seconds;
        d = new Date(seconds * 1000);
      } else if (typeof date === "string") {
        d = new Date(date);
      } else {
        d = new Date(date as number);
      }

      if (isNaN(d.getTime())) {
        return "Not available";
      }

      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "Not available";
    }
  };

  const getUserInitials = () => {
    if (displayName) {
      return displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(dataUrl);
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image size must be less than 5MB");
      return;
    }

    try {
      setUploadingPhoto(true);

      // Create preview immediately
      const previewPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          setPhotoPreview(result);
          resolve(result);
        };
        reader.readAsDataURL(file);
      });

      await previewPromise;

      // Compress image to base64
      const compressedBase64 = await compressImage(file);

      // Upload to server (Cloudinary)
      const response = await fetch(`${API_URL}/api/settings/profile-picture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: user.uid,
          imageData: compressedBase64,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload profile picture");
      }

      const data = await response.json();

      // Update Firebase Auth profile locally
      await updateProfile(user, { photoURL: data.photoURL });

      // Update Firestore user document locally
      await updateDoc(doc(db, "users", user.uid), {
        photoURL: data.photoURL,
      });

      // Clear preview after successful upload
      setPhotoPreview(null);
      
      // Show success message
      alert("Profile picture updated successfully!");
    } catch (error: any) {
      console.error("Error uploading profile picture:", error);
      const errorMessage = error?.message || "Unknown error occurred";
      console.error("Full error:", error);
      alert(`Failed to upload profile picture: ${errorMessage}. Please try again.`);
      setPhotoPreview(null);
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (loading) {
    return (
      <UserLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </UserLayout>
    );
  }

  return (
    <UserLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Profile</h1>
          <p className="text-text-secondary mt-1">
            View your account information and statistics
          </p>
        </div>

        {/* Profile Card */}
        <div className="card p-8">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0 relative">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center overflow-hidden shadow-lg">
                {photoPreview || user?.photoURL ? (
                  <img
                    src={photoPreview || user.photoURL || ""}
                    alt={displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-primary text-white flex items-center justify-center text-4xl font-medium">
                    {getUserInitials()}
                  </div>
                )}
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-white animate-spin" />
                  </div>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
                className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shadow-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Change profile picture"
              >
                <Camera className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
            </div>

            {/* User Info */}
            <div className="flex-1 text-center md:text-left">
              <h2 className="text-3xl font-semibold text-text-primary mb-4">
                {displayName}
              </h2>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-text-secondary justify-center md:justify-start">
                  <Mail className="w-5 h-5" />
                  <span className="text-base">{user?.email}</span>
                </div>
                {userData?.createdAt && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary justify-center md:justify-start">
                    <Calendar className="w-5 h-5" />
                    <span><span className="font-semibold text-text-primary">Member since:</span> {formatDate(userData.createdAt)}</span>
                  </div>
                )}
                {userData?.lastLoginAt && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary justify-center md:justify-start">
                    <Clock className="w-5 h-5" />
                    <span><span className="font-semibold text-text-primary">Last login:</span> {formatDate(userData.lastLoginAt)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Grid */}
        <div>
          <h2 className="text-xl font-semibold text-text-primary mb-4">Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Total Reports */}
            <div className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Total Reports</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.totalReports}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center">
                  <Package className="w-7 h-7 text-blue-600" />
                </div>
              </div>
            </div>

            {/* Lost Items */}
            <div className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Lost Items</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.lostItems}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
                  <Search className="w-7 h-7 text-red-600" />
                </div>
              </div>
            </div>

            {/* Found Items */}
            <div className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Found Items</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.foundItems}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
                  <Package className="w-7 h-7 text-green-600" />
                </div>
              </div>
            </div>

            {/* Matched Items */}
            <div className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Matched Items</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.matchedItems}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-yellow-50 flex items-center justify-center">
                  <CheckCircle className="w-7 h-7 text-yellow-600" />
                </div>
              </div>
            </div>

            {/* Claimed Items */}
            <div className="card p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Claimed Items</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.claimedItems}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center">
                  <Award className="w-7 h-7 text-purple-600" />
                </div>
              </div>
            </div>

            {/* Credits */}
            <div className="card p-6 hover:shadow-md transition-shadow bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Credits</p>
                  <p className="text-3xl font-bold text-text-primary">{stats.credits}</p>
                </div>
                <div className="w-14 h-14 rounded-full bg-yellow-200 flex items-center justify-center">
                  <span className="text-3xl">🪙</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </UserLayout>
  );
}

