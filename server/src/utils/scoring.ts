/**
 * Scoring utilities for item matching.
 *
 * Shared by both entry points onto the matching pipeline. The weights below are
 * the whole scoring model: name, description and tags are covered by the
 * semantic component rather than by separate lexical scorers.
 *
 * Scoring breakdown (100 points total):
 * - Semantic: 50 points (LLM comparison of name, description and tags)
 * - Location: 15 points
 * - Image:    15 points
 * - Color:    10 points
 * - Time:     10 points
 *
 * A component that cannot run leaves the denominator too, so the pipeline
 * normalises against the weights that actually applied.
 */

export const MATCH_CONFIG = {
  // Scoring weights (must sum to 100)
  WEIGHTS: {
    semantic: 50,
    color: 10,
    location: 15,
    time: 10,
    image: 15,
  },

  // Threshold - Lowered to allow more matches
  THRESHOLD: 55, // Lower threshold = more lenient matching

  // Location scoring tiers (km)
  LOCATION: {
    maxDistance: 15, // Increased from 10km
    tier1: 0.6, // 0-600m: 15 points
    tier2: 2, // 600m-2km: 12 points
    tier3: 5, // 2-5km: 8 points
    tier4: 15, // 5-15km: 5 points
  },

  // Time scoring tiers (hours)
  TIME: {
    maxHours: 96, // Increased from 72h to 96h (4 days)
    tier1: 2, // 0-2 hours: 10 points
    tier2: 24, // 2-24 hours: 7 points
    tier3: 96, // 24-96 hours: 5 points
  },

  // Hard pre-filters. Tag overlap is deliberately not one of them: it is a
  // ranking signal in the pipeline, because a gate on exact token overlap
  // dropped genuine matches before the semantic scorer ever saw them.
  REQUIREMENTS: {
    maxDistance: 15, // km
    maxTimeDiff: 96, // hours
  },
};

/**
 * Calculate Haversine distance between two coordinates (in km)
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate time difference in hours
 */
export function calculateTimeDifference(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime()) / (1000 * 60 * 60);
}

/**
 * Helper to combine name and tags for better matching
 */
export function getTagsWithFallback(tags: string[] = [], name: string = ''): string[] {
  const finalTags = new Set((tags || []).map((t) => t.toLowerCase().trim()));

  // If name exists, add words from name as potential tags
  if (name) {
    name
      .toLowerCase()
      .split(/[\s,/-]+/)
      .filter((w) => w.length >= 2) // Allow 2 letter words like 'Mi', 'TV'
      .forEach((w) => finalTags.add(w));
  }

  return Array.from(finalTags);
}

/**
 * SCORE: Color Matching (0-10 points)
 * Exact match = full weight, similar = two thirds, none = 0
 */
export function calculateColorScore(color1?: string, color2?: string): number {
  if (!color1 || !color2) return 0;

  const c1 = color1.toLowerCase().trim();
  const c2 = color2.toLowerCase().trim();

  if (c1 === c2) {
    return MATCH_CONFIG.WEIGHTS.color;
  }

  if (areSimilarColors(c1, c2)) {
    return Math.round(MATCH_CONFIG.WEIGHTS.color * 0.67);
  }

  return 0;
}

/**
 * Check if two colors are similar
 */
function areSimilarColors(color1: string, color2: string): boolean {
  const similarGroups = [
    // Blacks / Darks
    [
      'black',
      'dark grey',
      'dark gray',
      'charcoal',
      'ebony',
      'jet black',
      'onyx',
      'midnight',
      'ink',
    ],
    // Whites / Light
    [
      'white',
      'off-white',
      'cream',
      'ivory',
      'beige',
      'pearl',
      'snow',
      'alabaster',
      'eggshell',
      'bone',
      'vanilla',
    ],
    // Reds
    [
      'red',
      'maroon',
      'burgundy',
      'crimson',
      'scarlet',
      'ruby',
      'cherry',
      'brick',
      'wine',
      'rosewood',
    ],
    // Blues
    [
      'blue',
      'navy',
      'dark blue',
      'royal blue',
      'sky blue',
      'azure',
      'sapphire',
      'teal',
      'turquoise',
      'cyan',
      'indigo',
      'cobalt',
      'denim',
      'baby blue',
    ],
    // Greens
    [
      'green',
      'dark green',
      'forest green',
      'olive',
      'emerald',
      'lime',
      'mint',
      'sage',
      'jade',
      'kelley',
      'army green',
      'moss',
    ],
    // Greys / Silvers
    [
      'gray',
      'grey',
      'silver',
      'ash',
      'metal',
      'gunmetal',
      'slate',
      'graphite',
      'chrome',
      'platinum',
      'steel',
    ],
    // Browns / Earth Tones
    [
      'brown',
      'tan',
      'khaki',
      'chocolate',
      'coffee',
      'bronze',
      'copper',
      'mocha',
      'camel',
      'sand',
      'taupe',
      'mahogany',
      'rust',
      'sienna',
    ],
    // Pinks
    [
      'pink',
      'light pink',
      'rose',
      'magenta',
      'salmon',
      'fuchsia',
      'coral',
      'blush',
      'peach',
      'hot pink',
    ],
    // Yellows / Golds
    ['yellow', 'gold', 'golden', 'mustard', 'lemon', 'canary', 'amber', 'blonde', 'honey'],
    // Oranges
    ['orange', 'amber', 'rust', 'tangerine', 'apricot', 'burnt orange', 'ginger', 'carrot'],
    // Purples
    [
      'purple',
      'violet',
      'lavender',
      'lilac',
      'indigo',
      'plum',
      'mauve',
      'grape',
      'amethyst',
      'eggplant',
    ],
  ];

  for (const group of similarGroups) {
    if (group.includes(color1) && group.includes(color2)) {
      return true;
    }
  }

  return false;
}

/**
 * Ceiling of the text-only location branch.
 *
 * Without coordinates the best a pair can score is an exact string match, so
 * the full location weight is not achievable and must not sit in the
 * denominator.
 */
export const LOCATION_TEXT_MAX_SCORE = 8;

/**
 * SCORE: Location Proximity (0-15 points, 0-8 without coordinates)
 * Based on distance between coordinates
 */
export function calculateLocationScore(
  coords1?: { lat: number; lng: number },
  coords2?: { lat: number; lng: number },
  loc1?: string,
  loc2?: string,
): number {
  // 1. Precise Coordinate Matching (Max 15 points)
  if (coords1 && coords2) {
    const distance = haversineDistance(coords1.lat, coords1.lng, coords2.lat, coords2.lng);

    // Tiered scoring
    if (distance <= MATCH_CONFIG.LOCATION.tier1) return 15; // 0-600m
    if (distance <= MATCH_CONFIG.LOCATION.tier2) return 12; // 600m-2km
    if (distance <= MATCH_CONFIG.LOCATION.tier3) return 8; // 2-5km
    if (distance <= MATCH_CONFIG.LOCATION.tier4) return 5; // 5-15km

    return 0; // > 15km is a hard fail for coordinates
  }

  // 2. Text-based Fallback (Max 8 points)
  // If coordinates are missing, we check if the location names are similar
  if (loc1 && loc2) {
    const s1 = loc1.toLowerCase();
    const s2 = loc2.toLowerCase();

    // Exact match of strings (e.g. "College Canteen")
    if (s1 === s2) return LOCATION_TEXT_MAX_SCORE;

    // Check for common words (e.g. "Rajarajeshwari Nagar" vs "Rajarajeshwari Nagar, Bengaluru")
    const words1 = s1.split(/[\s,]+/).filter((w) => w.length > 3);
    const words2 = s2.split(/[\s,]+/).filter((w) => w.length > 3);

    const common = words1.filter((w) => words2.includes(w));
    if (common.length > 0) return 5; // Significant overlap
  }

  return 0;
}

/**
 * SCORE: Time Window (0-10 points)
 * Based on time difference between lost and found
 */
export function calculateTimeScore(date1: Date, date2: Date): number {
  const hoursDiff = calculateTimeDifference(date1, date2);

  // Tiered scoring (Updated as per request)
  if (hoursDiff <= MATCH_CONFIG.TIME.tier1) return 10; // 0-24 hours
  if (hoursDiff <= MATCH_CONFIG.TIME.tier2) return 7; // 24-48 hours
  if (hoursDiff <= MATCH_CONFIG.TIME.tier3) return 5; // 48-72 hours

  return 0; // >72 hours
}
