import fs from 'fs';
import path from 'path';

class Logger {
  constructor(logFile = 'guardclaw.log') {
    this.logPath = path.join(process.cwd(), logFile);
    this.stream = fs.createWriteStream(this.logPath, { flags: 'a' }); // append mode
    
    // Log startup separator
    this.logStartup();
  }

  logStartup() {
    const sep = '='.repeat(80);
    this.info(sep);
    this.info('🛡️  GuardClaw Starting');
    this.info(`   Process ID: ${process.pid}`);
    this.info(`   Node version: ${process.version}`);
    this.info(`   Working directory: ${process.cwd()}`);
    this.info(`   Log file: ${this.logPath}`);
    this.info(sep);
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;
    
    // Write to file
    this.stream.write(logLine + '\n');
    
    // Also write to console
    console.log(logLine);
  }

  info(message) {
    this.log('INFO', message);
  }

  warn(message) {
    this.log('WARN', message);
  }

  error(message) {
    this.log('ERROR', message);
  }

  debug(message) {
    if (process.env.DEBUG) {
      this.log('DEBUG', message);
    }
  }

  close() {
    this.stream.end();
  }
}

// Export singleton instance
export const logger = new Logger();
