/**
 * storage.js — Chrome storage wrapper with TTL-based caching and retention policy
 * 
 * Two storage areas:
 * - chrome.storage.session: Auth context ONLY (cleared on browser close)
 * - chrome.storage.local: Cached analytics data (non-sensitive, with TTL)
 * 
 * NEVER stores tokens, passwords, or credentials in local storage.
 */

const CACHE_PREFIX = 'cache_';
const AUTH_KEY = 'authContext';
const RETENTION_DAYS = 90;

// Cache TTLs
const TTL_TODAY = 15 * 60 * 1000;       // 15 minutes for today's data
const TTL_HISTORICAL = 24 * 60 * 60 * 1000; // 24 hours for historical data

// ============================================================
// Auth Context (session storage only)
// ============================================================

/**
 * Store auth context in session storage.
 * Session storage is cleared when the browser closes.
 */
async function setAuthContext(context) {
  await chrome.storage.session.set({ [AUTH_KEY]: context });
}

/**
 * Get auth context from session storage.
 * @returns {Object|null} Auth context or null
 */
async function getAuthContext() {
  const result = await chrome.storage.session.get(AUTH_KEY);
  return result[AUTH_KEY] || null;
}

/**
 * Clear auth context.
 */
async function clearAuthContext() {
  await chrome.storage.session.remove(AUTH_KEY);
}

// ============================================================
// Data Cache (local storage)
// ============================================================

/**
 * Store cached data with a TTL.
 * 
 * @param {string} key - Cache key (will be prefixed)
 * @param {*} data - Data to cache (must be JSON-serializable)
 * @param {number} [ttlMs] - Time-to-live in milliseconds
 */
async function setCachedData(key, data, ttlMs = TTL_HISTORICAL) {
  const cacheKey = CACHE_PREFIX + key;
  const entry = {
    data,
    timestamp: Date.now(),
    ttl: ttlMs
  };
  await chrome.storage.local.set({ [cacheKey]: entry });
}

/**
 * Get cached data if still valid.
 * 
 * @param {string} key - Cache key
 * @returns {*|null} Cached data or null if expired/missing
 */
async function getCachedData(key) {
  const cacheKey = CACHE_PREFIX + key;
  const result = await chrome.storage.local.get(cacheKey);
  const entry = result[cacheKey];

  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > entry.ttl) {
    // Expired — remove it
    await chrome.storage.local.remove(cacheKey);
    return null;
  }

  return entry.data;
}

/**
 * Check if cache is still valid.
 * 
 * @param {string} key - Cache key
 * @returns {boolean}
 */
async function isCacheValid(key) {
  const data = await getCachedData(key);
  return data !== null;
}

/**
 * Get the appropriate TTL for a date.
 * Today's data gets a short TTL, historical data gets a long TTL.
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {number} TTL in milliseconds
 */
function getTTLForDate(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today ? TTL_TODAY : TTL_HISTORICAL;
}

/**
 * Clear all cached data (for "Refresh Data" button).
 * Does NOT clear auth context.
 */
async function clearAllCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }
}

/**
 * Clear today's cached data specifically.
 * Called after manual refresh to force re-fetch of current day.
 */
async function clearTodayCache() {
  const today = new Date().toISOString().split('T')[0];
  const all = await chrome.storage.local.get(null);
  const todayKeys = Object.keys(all).filter(k =>
    k.startsWith(CACHE_PREFIX) && k.includes(today)
  );
  if (todayKeys.length > 0) {
    await chrome.storage.local.remove(todayKeys);
  }
}

/**
 * Enforce retention policy: remove cached data older than RETENTION_DAYS.
 * Should be called on extension startup.
 */
async function enforceRetention() {
  const maxAge = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const all = await chrome.storage.local.get(null);
  const expiredKeys = [];

  Object.entries(all).forEach(([key, entry]) => {
    if (key.startsWith(CACHE_PREFIX) && entry?.timestamp) {
      const age = Date.now() - entry.timestamp;
      if (age > maxAge) {
        expiredKeys.push(key);
      }
    }
  });

  if (expiredKeys.length > 0) {
    await chrome.storage.local.remove(expiredKeys);
  }
}

// Export
if (typeof globalThis !== 'undefined') {
  globalThis.Storage = {
    setAuthContext,
    getAuthContext,
    clearAuthContext,
    setCachedData,
    getCachedData,
    isCacheValid,
    getTTLForDate,
    clearAllCache,
    clearTodayCache,
    enforceRetention,
    TTL_TODAY,
    TTL_HISTORICAL
  };
}
