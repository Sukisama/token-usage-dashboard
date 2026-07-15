const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 7373;
let mainWindow;
let tray;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('Server failed to start:', err);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createTray() {
  let trayIcon;
  const trayPath = path.join(__dirname, 'assets', 'trayTemplate.png');

  if (fs.existsSync(trayPath)) {
    trayIcon = nativeImage.createFromPath(trayPath);
  } else {
    // 16x16 transparent PNG fallback
    const transparentPng = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAABxpRE9UAAAAAgAAAAAAAAAIAAAAKAAAAAgAAAAIAAAARj7/9AAAAEJJREFUOE9jYMAHGPBg+L8YxMDAwMDw/z8DMgEJm5qa/gf5iA3///8f5COzAQMDAwMAtG4nC5M0TjAAAAAASUVORK5CYII=';
    trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${transparentPng}`);
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示/隐藏', click: toggleWindow },
    { type: 'separator' },
    { label: '退出', click: () => {
      stopServer();
      app.quit();
    }}
  ]);

  tray.setToolTip('Token 用量看板');
  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
}

app.whenReady().then(async () => {
  startServer();

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 1200));

  createWindow();
  createTray();

  // Register global shortcut: Cmd+Shift+T (macOS) / Ctrl+Shift+T (others)
  const shortcut = process.platform === 'darwin' ? 'Cmd+Shift+T' : 'Ctrl+Shift+T';
  const registered = globalShortcut.register(shortcut, toggleWindow);
  if (!registered) {
    console.warn(`无法注册全局快捷键 ${shortcut}`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopServer();
});

app.on('window-all-closed', () => {
  // Keep app running in tray on macOS
});
