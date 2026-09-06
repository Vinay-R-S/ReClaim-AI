/**
 * System settings, shared by the admin screen that writes them and the LLM
 * layer that reads them.
 */

export type AIProvider =
  | 'groq_only'
  | 'gemini_only'
  | 'grok_only'
  | 'groq_with_fallback'
  | 'gemini_with_fallback'
  | 'grok_with_fallback';

export interface MapCenter {
  address: string;
  lat: number;
  lng: number;
}

export interface SystemSettings {
  aiProvider: AIProvider;
  mapCenter?: MapCenter;
  cctvEnabled: boolean;
  /** true = Testing (400 calls/day limit), false = Dev (unlimited) */
  testingMode: boolean;
  updatedAt?: FirebaseFirestore.FieldValue;
}

export const DEFAULT_SETTINGS: SystemSettings = {
  aiProvider: 'groq_only',
  cctvEnabled: true,
  testingMode: false,
};

/** The daily call budget testing mode applies. */
export const TESTING_DAILY_LIMIT = 400;
