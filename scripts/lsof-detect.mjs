#!/usr/bin/env node
/**
 * Test script: spawns fake-mcp-server, calls its tool, then checks lsof detection.
 */
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, 'fake-mcp-server.mjs');

function sendMsg(proc, msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  proc.stdin.write(header + body);
}

console.log('1️⃣  Starting fake-mcp-server...');
const mcp = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

mcp.stderr.on('data', d => console.log(`   [mcp stderr] ${d.toString().trim()}`));

// Wait for startup
await new Promise(r => setTimeout(r, 1000));

console.log(`   PID: ${mcp.pid}`);

// Initialize
console.log('2️⃣  Sending initialize...');
sendMsg(mcp, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
await new Promise(r => setTimeout(r, 500));

// Call the tool
console.log('3️⃣  Calling do_something tool...');
sendMsg(mcp, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'do_something', arguments: { query: 'test' } } });

// Wait for connection to establish
console.log('4️⃣  Waiting 3s for connection to establish...');
await new Promise(r => setTimeout(r, 3000));

// Check with lsof
console.log('5️⃣  Running lsof to check network connections...');
try {
  const lsofOutput = execSync(`lsof -a -i -n -P -p ${mcp.pid} 2>/dev/null`, { encoding: 'utf8' });
  console.log('   ✅ lsof output:');
  console.log(lsofOutput);

  if (lsofOutput.includes('93.184.216.34')) {
    console.log('   🚨 DETECTED: outbound connection to example.com (93.184.216.34)!');
  }
} catch {
  console.log('   ❌ No network connections found (lsof returned empty)');
}

// Cleanup
console.log('6️⃣  Done. Killing server.');
mcp.kill();
process.exit(0);
