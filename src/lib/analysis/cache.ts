// AI Analysis Cache - prevents redundant API calls for same asset

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface CacheStore {
  [key: string]: CacheEntry<unknown>;
}

const cache: CacheStore = {};

// Default TTL: 5 minutes
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Generate a cache key from parameters
 */
export const getCacheKey = (
  type: string,
  ticker: string,
  horizon: string
): string => {
  return `${type}:${ticker}:${horizon}`;
};

/**
 * Get cached data if it exists and hasn't expired
 */
export const getFromCache = <T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null => {
  const entry = cache[key] as CacheEntry<T> | undefined;
  
  if (!entry) {
    return null;
  }
  
  const now = Date.now();
  const age = now - entry.timestamp;
  
  if (age > ttlMs) {
    // Entry expired, remove it
    delete cache[key];
    console.log(`Cache expired for ${key} (age: ${Math.round(age / 1000)}s)`);
    return null;
  }
  
  console.log(`Cache HIT for ${key} (age: ${Math.round(age / 1000)}s)`);
  return entry.data;
};

/**
 * Store data in cache
 */
export const setInCache = <T>(key: string, data: T): void => {
  cache[key] = {
    data,
    timestamp: Date.now(),
  };
  console.log(`Cache SET for ${key}`);
};

/**
 * Clear all cache entries
 */
export const clearCache = (): void => {
  Object.keys(cache).forEach(key => delete cache[key]);
  console.log('Cache cleared');
};

/**
 * Clear cache entries for a specific ticker
 */
export const clearCacheForTicker = (ticker: string): void => {
  Object.keys(cache)
    .filter(key => key.includes(`:${ticker}:`))
    .forEach(key => delete cache[key]);
  console.log(`Cache cleared for ticker: ${ticker}`);
};

/**
 * Get cache stats for debugging
 */
export const getCacheStats = (): { entries: number; keys: string[] } => {
  const keys = Object.keys(cache);
  return {
    entries: keys.length,
    keys,
  };
};
