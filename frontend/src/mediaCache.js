/**
 * Tapchat Offline Media Caching Service
 * Uses browser Cache Storage API to store and serve media attachments (images/videos/audios).
 */

const CACHE_NAME = "tapchat-media-cache";

/**
 * Downloads and caches a media URL if it is not already cached.
 * @param {string} url - The absolute or relative media URL to cache.
 */
export async function cacheMediaFile(url) {
  if (!url || typeof window === "undefined" || !('caches' in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    if (!match) {
      // Fetch and store in cache
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        console.log(`[MediaCache] File cached: ${url}`);
      }
    }
  } catch (err) {
    console.warn(`[MediaCache] Failed to cache file (${url}):`, err.message);
  }
}

/**
 * Resolves a media URL. If offline and cached, returns a local object URL.
 * Otherwise, returns the original URL.
 * @param {string} url - The original media URL.
 * @returns {Promise<string>} - Resolved URL (remote or object URL).
 */
export async function getCachedMediaUrl(url) {
  if (!url || typeof window === "undefined" || !('caches' in window)) return url;
  try {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(url);
    if (match) {
      const blob = await match.blob();
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn(`[MediaCache] Error reading from cache for ${url}:`, err.message);
  }
  return url;
}
