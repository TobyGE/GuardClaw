#!/usr/bin/env node

/**
 * Encrypt LoRA adapter files with AES-256-GCM, key derived from device hardware UUID.
 * Output: adapters.safetensors.enc + adapter_config.json.enc
 *
 * Usage: node encrypt-adapter.js [--input ./adapters] [--output ./adapters-enc]
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SALT = 'guardclaw-lora-v1';  // Fixed salt for key derivation

function getHardwareUUID() {
  const output = execSync('ioreg -d2 -c IOPlatformExpertDevice', { encoding: 'utf8' });
  const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Could not read hardware UUID');
  return match[1];
}

function deriveKey(hwUUID) {
  return crypto.pbkdf2Sync(hwUUID, SALT, 100000, 32, 'sha256');
}

function encryptFile(inputPath, outputPath, key) {
  const plaintext = fs.readFileSync(inputPath);
  const iv = crypto.randomBytes(12);  // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: [4 bytes IV len][IV][16 bytes auth tag][encrypted data]
  const header = Buffer.alloc(4);
  header.writeUInt32LE(iv.length);
  fs.writeFileSync(outputPath, Buffer.concat([header, iv, tag, encrypted]));
  return { inputSize: plaintext.length, outputSize: header.length + iv.length + tag.length + encrypted.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const inputDir = args.includes('--input') ? args[args.indexOf('--input') + 1] : path.join(__dirname, 'adapters');
const outputDir = args.includes('--output') ? args[args.indexOf('--output') + 1] : path.join(__dirname, 'adapters-enc');

fs.mkdirSync(outputDir, { recursive: true });

const hwUUID = getHardwareUUID();
const key = deriveKey(hwUUID);

console.log('━━━ GuardClaw Adapter Encryption ━━━');
console.log(`Device:  ${hwUUID.slice(0, 8)}...`);
console.log(`Input:   ${inputDir}`);
console.log(`Output:  ${outputDir}`);
console.log();

const files = ['adapters.safetensors', 'adapter_config.json'];
for (const file of files) {
  const inputPath = path.join(inputDir, file);
  if (!fs.existsSync(inputPath)) {
    console.log(`⚠️  Skipping ${file} (not found)`);
    continue;
  }
  const outputPath = path.join(outputDir, file + '.enc');
  const { inputSize, outputSize } = encryptFile(inputPath, outputPath, key);
  console.log(`✓ ${file} → ${file}.enc (${(inputSize / 1024).toFixed(0)}KB → ${(outputSize / 1024).toFixed(0)}KB)`);
}

console.log();
console.log('✅ Encryption complete. Encrypted adapters are device-locked.');
console.log('   They can only be decrypted on this machine.');
