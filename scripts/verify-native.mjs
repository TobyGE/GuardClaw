// sql.js is pure WASM — no native compilation needed.
// This script is kept for backwards compatibility but is now a no-op.

const major = Number(process.versions.node.split('.')[0]);

if (major < 18) {
  console.error(`[GuardClaw] Unsupported Node runtime: ${process.version}`);
  console.error('[GuardClaw] Node >= 18 is required.');
  process.exit(1);
}

console.log(`[GuardClaw] Runtime check passed (Node ${process.version})`);
