import path from 'path';

/**
 * Returns the base directory for GuardClaw data files.
 * Uses GUARDCLAW_DATA_DIR env var if set (for embedded/packaged mode),
 * otherwise falls back to process.cwd().
 */
export function getDataDir() {
  return process.env.GUARDCLAW_DATA_DIR || process.cwd();
}

/**
 * Returns the .guardclaw subdirectory path for databases and state.
 */
export function getGuardClawDir() {
  return path.join(getDataDir(), '.guardclaw');
}
