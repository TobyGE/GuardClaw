/**
 * Decrypt encrypted LoRA adapter files at runtime.
 * Key is derived from device hardware UUID — adapters only work on the machine they were encrypted on.
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SALT = 'guardclaw-lora-v1';

let _hwUUID = null;

function getHardwareUUID() {
  if (_hwUUID) return _hwUUID;
  try {
    const output = execSync('ioreg -d2 -c IOPlatformExpertDevice', { encoding: 'utf8' });
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (match) {
      _hwUUID = match[1];
      return _hwUUID;
    }
  } catch {}
  throw new Error('Could not read hardware UUID');
}

function deriveKey(hwUUID) {
  return crypto.pbkdf2Sync(hwUUID, SALT, 100000, 32, 'sha256');
}

function decryptFile(encPath) {
  const data = fs.readFileSync(encPath);
  const ivLen = data.readUInt32LE(0);
  const iv = data.subarray(4, 4 + ivLen);
  const tag = data.subarray(4 + ivLen, 4 + ivLen + 16);
  const encrypted = data.subarray(4 + ivLen + 16);

  const key = deriveKey(getHardwareUUID());
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Decrypt encrypted adapter files to a temporary directory.
 * Returns the temp dir path. Caller should clean up after loading.
 *
 * @param {string} encDir - Directory containing .enc files
 * @returns {{ tmpDir: string, cleanup: () => void }}
 */
export function decryptAdapterToTemp(encDir) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardclaw-adapter-'));
  const files = ['adapters.safetensors.enc', 'adapter_config.json.enc'];

  for (const encFile of files) {
    const encPath = path.join(encDir, encFile);
    if (!fs.existsSync(encPath)) continue;

    const plainName = encFile.replace('.enc', '');
    const plaintext = decryptFile(encPath);
    fs.writeFileSync(path.join(tmpDir, plainName), plaintext);
  }

  const cleanup = () => {
    try {
      // Overwrite files with random data before deleting
      for (const f of fs.readdirSync(tmpDir)) {
        const fp = path.join(tmpDir, f);
        const stat = fs.statSync(fp);
        fs.writeFileSync(fp, crypto.randomBytes(stat.size));
        fs.unlinkSync(fp);
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  };

  return { tmpDir, cleanup };
}

/**
 * Check if an encrypted adapter exists.
 */
export function hasEncryptedAdapter(encDir) {
  return fs.existsSync(path.join(encDir, 'adapters.safetensors.enc'));
}
