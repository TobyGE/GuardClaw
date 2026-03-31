import { test } from 'node:test';
import * as assert from 'node:assert';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('Server index.js boots and responds to health check', async () => {
  const serverPath = join(__dirname, '../server/index.js');
  
  const child = spawn('node', [serverPath], {
    env: { ...process.env, PORT: '3009', BACKEND: 'fallback', GUARDCLAW_BLOCKING_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Wait for the server to start
  await new Promise((resolve, reject) => {
    let output = '';
    
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Server startup timed out. Output: ${output}`));
    }, 10000);

    child.stdout.on('data', (data) => {
      output += data.toString();
      // Server logs when it's listening
      if (output.includes('http://localhost:3009')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.stderr.on('data', (data) => {
      // Just in case it throws an error immediately
      if (data.toString().includes('Error:')) {
        clearTimeout(timeout);
        child.kill();
        reject(new Error(`Server failed to start: ${data.toString()}`));
      }
    });
    
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited prematurely with code ${code}`));
    });
  });

  try {
    // Ping the health endpoint
    const response = await fetch('http://localhost:3009/api/health');
    assert.strictEqual(response.status, 200);
    
    const data = await response.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.pid > 0);
  } finally {
    child.kill('SIGINT'); // Trigger graceful shutdown
    await new Promise(resolve => {
      child.on('exit', resolve);
      // Fallback kill
      setTimeout(() => child.kill('SIGKILL'), 2000);
    });
  }
});
