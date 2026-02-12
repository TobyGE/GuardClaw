import fs from 'fs';
import path from 'path';

class InstallTracker {
  constructor() {
    this.dataDir = path.join(process.cwd(), '.guardclaw');
    this.installFile = path.join(this.dataDir, 'install.json');
    this.ensureDataDir();
    this.ensureInstallDate();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  ensureInstallDate() {
    if (!fs.existsSync(this.installFile)) {
      // First time running - record install date
      const installData = {
        installedAt: new Date().toISOString(),
        version: this.getVersion()
      };
      fs.writeFileSync(this.installFile, JSON.stringify(installData, null, 2));
    }
  }

  getVersion() {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version;
    } catch (error) {
      return 'unknown';
    }
  }

  getInstallData() {
    try {
      const data = JSON.parse(fs.readFileSync(this.installFile, 'utf8'));
      return data;
    } catch (error) {
      return null;
    }
  }

  getDaysSinceInstall() {
    const data = this.getInstallData();
    if (!data || !data.installedAt) {
      return 0;
    }

    const installDate = new Date(data.installedAt);
    const now = new Date();
    const diffMs = now - installDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }

  getStats() {
    const data = this.getInstallData();
    const days = this.getDaysSinceInstall();
    
    return {
      installedAt: data?.installedAt || null,
      daysSinceInstall: days,
      version: data?.version || 'unknown'
    };
  }
}

export const installTracker = new InstallTracker();
