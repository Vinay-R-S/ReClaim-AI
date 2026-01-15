/**
 * Authenticated API Utility
 * Provides helper functions for making authenticated API calls with Firebase ID tokens
 */

import { auth } from './firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Get the current user's Firebase ID token
 * Returns null if user is not authenticated
 */
export async function getAuthToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) {
        return null;
    }

    try {
        // Force refresh ensures token is valid
        return await user.getIdToken(true);
    } catch (error) {
        console.error('Failed to get auth token:', error);
        return null;
    }
}

/**
 * Make an authenticated fetch request
 * Automatically adds the Authorization header with Firebase ID token
 */
export async function authFetch(
    endpoint: string,
    options: RequestInit = {}
): Promise<Response> {
    const token = await getAuthToken();

    if (!token) {
        throw new Error('Authentication required. Please sign in.');
    }

    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');

    const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

    return fetch(url, {
        ...options,
        headers,
    });
}

/**
 * Authenticated GET request
 */
export async function authGet<T>(endpoint: string): Promise<T> {
    const response = await authFetch(endpoint, { method: 'GET' });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `Request failed with status ${response.status}`);
    }

    return response.json();
}

/**
 * Authenticated POST request
 */
export async function authPost<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await authFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `Request failed with status ${response.status}`);
    }

    return response.json();
}

/**
 * Authenticated PUT request
 */
export async function authPut<T>(endpoint: string, data: unknown): Promise<T> {
    const response = await authFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `Request failed with status ${response.status}`);
    }

    return response.json();
}

/**
 * Authenticated DELETE request
 */
export async function authDelete<T>(endpoint: string): Promise<T> {
    const response = await authFetch(endpoint, { method: 'DELETE' });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `Request failed with status ${response.status}`);
    }

    return response.json();
}

/**
 * Handle API errors consistently
 */
export function handleApiError(error: unknown): string {
    if (error instanceof Error) {
        // Handle specific error messages
        if (error.message.includes('Token expired')) {
            return 'Your session has expired. Please sign in again.';
        }
        if (error.message.includes('Authentication required')) {
            return 'Please sign in to continue.';
        }
        if (error.message.includes('Too many')) {
            return 'Too many requests. Please wait a moment and try again.';
        }
        return error.message;
    }
    return 'An unexpected error occurred. Please try again.';
}
