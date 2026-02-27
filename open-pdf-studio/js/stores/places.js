const STORAGE_KEY = 'savedPlaces';

/**
 * Get all saved places from localStorage.
 * @returns {Array<{name: string, path: string, timestamp: number}>}
 */
export function getSavedPlaces() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to read saved places:', e);
  }
  return [];
}

/**
 * Add a folder as a saved place.
 * @param {string} folderPath - Full folder path
 * @param {string} [name] - Optional display name (defaults to folder name)
 */
export function addPlace(folderPath, name) {
  try {
    let places = getSavedPlaces();

    // Don't add duplicate
    if (places.some(p => p.path === folderPath)) return;

    // Extract folder name from path
    const displayName = name || folderPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || folderPath;

    places.push({
      name: displayName,
      path: folderPath,
      timestamp: Date.now()
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch (e) {
    console.warn('Failed to add place:', e);
  }
}

/**
 * Remove a saved place by path.
 * @param {string} folderPath - Path of the place to remove
 */
export function removePlace(folderPath) {
  try {
    let places = getSavedPlaces();
    places = places.filter(p => p.path !== folderPath);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch (e) {
    console.warn('Failed to remove place:', e);
  }
}
