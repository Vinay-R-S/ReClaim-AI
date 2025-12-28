import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import {
    ref,
    deleteObject,
} from "firebase/storage";
import { db, storage } from "../lib/firebase";

// Item type definition
export interface Item {
    id: string;
    name: string;
    description: string;
    imageUrl?: string;
    cloudinaryUrls?: string[]; // Images from chat flow
    type: "Lost" | "Found";
    location: string;
    date: Timestamp | Date;
    status: "Pending" | "Matched" | "Claimed";
    matchScore?: number;
    tags?: string[];
    images?: string[];
    contactEmail?: string; // Email for contact
    collectionLocation?: string; // Where to collect found items
    reportedBy?: string; // User ID who reported
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

// Input type for creating/updating items (without id and timestamps)
export interface ItemInput {
    name: string;
    description: string;
    imageUrl?: string;
    type: "Lost" | "Found";
    location: string;
    date: Date;
    status: "Pending" | "Matched" | "Claimed";
    matchScore?: number;
    tags?: string[];
    images?: string[]; // Array of base64 strings for multiple images
}

const ITEMS_COLLECTION = "items";

// Get all items
export async function getItems(): Promise<Item[]> {
    const itemsRef = collection(db, ITEMS_COLLECTION);
    const q = query(itemsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
    })) as Item[];
}

// Get single item by ID
export async function getItemById(id: string): Promise<Item | null> {
    const docRef = doc(db, ITEMS_COLLECTION, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
        return null;
    }

    return {
        id: docSnap.id,
        ...docSnap.data(),
    } as Item;
}

// Add new item
export async function addItem(item: ItemInput): Promise<string> {
    const itemsRef = collection(db, ITEMS_COLLECTION);

    const docRef = await addDoc(itemsRef, {
        ...item,
        date: Timestamp.fromDate(item.date),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });

    return docRef.id;
}

// Update existing item
export async function updateItem(
    id: string,
    updates: Partial<ItemInput>
): Promise<void> {
    const docRef = doc(db, ITEMS_COLLECTION, id);

    const updateData: Record<string, unknown> = {
        ...updates,
        updatedAt: serverTimestamp(),
    };

    // Convert date if provided
    if (updates.date) {
        updateData.date = Timestamp.fromDate(updates.date);
    }

    await updateDoc(docRef, updateData);
}

// Delete item
export async function deleteItem(id: string, imageUrl?: string): Promise<void> {
    // Delete image from storage if exists
    if (imageUrl) {
        try {
            const imageRef = ref(storage, imageUrl);
            await deleteObject(imageRef);
        } catch (err) {
            console.warn("Error deleting image:", err);
        }
    }

    const docRef = doc(db, ITEMS_COLLECTION, id);
    await deleteDoc(docRef);
}

// Helper to compress image
async function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;

                // Resize to max 800px width/height to keep size low (< 500KB)
                const MAX_SIZE = 800;
                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0, width, height);

                // Compress to JPEG 0.7 quality
                const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// Store image as Base64 in Firestore (Bypassing Storage Bucket)
export async function uploadItemImage(file: File): Promise<string> {
    try {
        console.log("Compressing image for Firestore storage...");
        const base64String = await compressImage(file);
        console.log("Image compressed successfully. Length:", base64String.length);

        if (base64String.length > 900000) { // Safety check for 1MB limit
            throw new Error("Image too large even after compression. Please use a smaller image.");
        }

        return base64String;
    } catch (error) {
        console.error("Error processing image:", error);
        throw new Error("Failed to process image for local storage");
    }
}
