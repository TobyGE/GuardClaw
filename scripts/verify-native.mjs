import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const major = Number(process.versions.node.split('.')[0]);

if (major !== 22) {
  console.error(`[GuardClaw] Unsupported Node runtime: ${process.version}`);
  console.error('[GuardClaw] Use Node 22.21.1 (see .nvmrc), then run `npm ci`.');
  process.exit(1);
}

try {
  require('better-sqlite3');
  console.log(`[GuardClaw] Native dependency check passed (Node ${process.version}, modules=${process.versions.modules})`);
} catch (error) {
  console.error('[GuardClaw] Native dependency check failed: better-sqlite3 could not be loaded.');
  console.error(`[GuardClaw] Runtime: Node ${process.version}, modules=${process.versions.modules}`);
  console.error('[GuardClaw] Fix: run `npm ci` in repo root (and `npm ci --prefix client` if needed) with Node 22.21.1.');
  console.error(`[GuardClaw] Error: ${error?.message || error}`);
  process.exit(1);
}
