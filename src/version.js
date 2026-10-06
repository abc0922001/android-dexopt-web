/**
 * Global Semantic Version of Android Dexopt Studio Web (SemVer: Major.Minor.Patch)
 * Synchronized with package.json version
 */
export const APP_VERSION = '1.1.0';

/**
 * Returns the version string with 'v' prefix
 * @returns {string} e.g. "v1.1.0"
 */
export function getFormattedVersion() {
  return `v${APP_VERSION}`;
}
