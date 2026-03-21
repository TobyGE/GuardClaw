const { app, BrowserWindow, dialog, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let tray = null;
let popoverWindow = null;
let detailedWindow = null;
let serverProcess = null;
let isQuitting = false;
const PORT = process.env.GUARDCLAW_DESKTOP_PORT || '3002';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function waitForServer(url, timeoutMs = 25000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for GuardClaw server at ${url}`));
        return;
      }

      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          setTimeout(tryConnect, 350);
        }
      });

      req.on('error', () => setTimeout(tryConnect, 350));
      req.setTimeout(1200, () => {
        req.destroy();
        setTimeout(tryConnect, 350);
      });
    };

    tryConnect();
  });
}

function startServer() {
  const appRoot = app.getAppPath();
  const serverEntry = path.join(appRoot, 'server', 'index.js');
  const staticDir = path.join(appRoot, 'client', 'dist');

  const dataDir = path.join(app.getPath('userData'), 'runtime');
  ensureDir(dataDir);

  const envPath = path.join(dataDir, '.env');
  const blockingConfigPath = path.join(dataDir, 'blocking-config.json');

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT,
    GUARDCLAW_STATIC_DIR: staticDir,
    GUARDCLAW_ENV_PATH: envPath,
    GUARDCLAW_BLOCKING_CONFIG_PATH: blockingConfigPath,
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: dataDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[GuardClaw:server] ${chunk}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[GuardClaw:server] ${chunk}`);
  });

  serverProcess.on('exit', (code, signal) => {
    if (!isQuitting) {
      dialog.showErrorBox(
        'GuardClaw Server Stopped',
        `Embedded server exited unexpectedly (code: ${code}, signal: ${signal}).`
      );
      app.quit();
    }
  });
}

function stopServer() {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
  } else {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already exited
      }
    }, 4000);
  }
}

function serverBaseUrl() {
  return `http://127.0.0.1:${PORT}`;
}

function createPopoverWindow() {
  if (popoverWindow) return popoverWindow;

  popoverWindow = new BrowserWindow({
    width: 372,
    height: 468,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    ...(process.platform === 'darwin' ? { vibrancy: 'popover', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  popoverWindow.loadURL(`${serverBaseUrl()}/?mode=essential`);

  popoverWindow.on('blur', () => {
    if (!isQuitting) popoverWindow.hide();
  });

  popoverWindow.on('closed', () => {
    popoverWindow = null;
  });

  return popoverWindow;
}

function createDetailedWindow() {
  if (detailedWindow) return detailedWindow;

  detailedWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'GuardClaw',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  detailedWindow.loadURL(`${serverBaseUrl()}/`);

  detailedWindow.on('closed', () => {
    detailedWindow = null;
  });

  return detailedWindow;
}

function showPopover() {
  if (!tray) return;
  const win = createPopoverWindow();
  const trayBounds = tray.getBounds();
  const { width, height } = win.getBounds();

  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.round(trayBounds.width / 2),
    y: trayBounds.y + Math.round(trayBounds.height / 2),
  });

  const margin = 8;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 6);

  x = Math.max(display.workArea.x + margin, Math.min(x, display.workArea.x + display.workArea.width - width - margin));
  y = Math.max(display.workArea.y + margin, Math.min(y, display.workArea.y + display.workArea.height - height - margin));

  win.setPosition(x, y, false);
  win.show();
  win.focus();
}

function hidePopover() {
  if (popoverWindow && popoverWindow.isVisible()) {
    popoverWindow.hide();
  }
}

function togglePopover() {
  if (!popoverWindow || !popoverWindow.isVisible()) {
    showPopover();
  } else {
    hidePopover();
  }
}

function openDetailedApp() {
  hidePopover();
  const win = createDetailedWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('GC');
  tray.setToolTip('GuardClaw');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open GuardClaw', click: openDetailedApp },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu());
}

ipcMain.on('guardclaw:open-detailed-app', () => {
  openDetailedApp();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!detailedWindow) openDetailedApp();
});

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer(`${serverBaseUrl()}/api/health`);

    if (process.platform === 'darwin') {
      app.dock.hide();
    }

    createTray();
    createPopoverWindow();
  } catch (error) {
    dialog.showErrorBox('GuardClaw Desktop Failed to Start', error.message);
    app.quit();
  }
});
