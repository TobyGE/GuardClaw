import { ClawdbotClient } from './server/clawdbot-client.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new ClawdbotClient(
  process.env.CLAWDBOT_URL || 'ws://127.0.0.1:18789',
  process.env.CLAWDBOT_TOKEN
);

console.log('🔌 Connecting...');
await client.connect();

console.log('✅ Connected');

const sessions = await client.request('sessions.list', { limit: 3 });
console.log(`\n📋 Found ${sessions.sessions.length} sessions:`);

for (const session of sessions.sessions) {
  console.log(`\n🔍 Session: ${session.key}`);
  
  const history = await client.request('chat.history', {
    sessionKey: session.key,
    limit: 10
  });
  
  console.log(`   Messages: ${history.messages.length}`);
  
  // Look for exec commands
  for (const msg of history.messages) {
    if (msg.role !== 'assistant') continue;
    
    for (const block of msg.content || []) {
      if (block.type === 'tool_use' && block.name === 'exec') {
        console.log(`   📌 FOUND EXEC: ${block.input?.command}`);
      }
    }
  }
}

client.disconnect();
