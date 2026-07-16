const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const PORT = 7373;
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(os.homedir(), '.token-usage-dashboard', 'config.json');

// --- persisted settings ------------------------------------------------------
const DEFAULT_CONFIG = { orbMetric: 'today' };
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch { /* non-fatal */ }
}
let config = loadConfig();

let orbWin = null;
let panelWin = null;
let dashboardWin = null;
let tray = null;
let serverProcess = null;
let panelHiddenAt = 0;

const ORB_SIZE = 112;      // window box; the glowing orb (62px) sits inside with halo margin
const PANEL_W = 300;
const PANEL_H = 430;

// ---- local server -----------------------------------------------------------

function pingServer() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/api/summary`, res => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await pingServer()) return;
  serverProcess = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    detached: false
  });
  // Wait until it answers (up to ~6s).
  for (let i = 0; i < 30; i++) {
    if (await pingServer()) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

// ---- windows ----------------------------------------------------------------

function appIcon() {
  const p = path.join(ROOT, 'assets', 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}

function createOrb() {
  const { workArea } = screen.getPrimaryDisplay();
  orbWin = new BrowserWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    x: workArea.x + workArea.width - ORB_SIZE - 24,
    y: workArea.y + 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  orbWin.setAlwaysOnTop(true, 'screen-saver');
  // Float on every Space so clicking never yanks you to another desktop.
  orbWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  orbWin.loadFile(path.join(__dirname, 'orb.html'));
}

function createPanel() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  // Same as the orb: show on the current Space instead of switching to the one
  // the panel was created on (which was the desktop-switch bug).
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
  panelWin.on('blur', () => { panelWin.hide(); panelHiddenAt = Date.now(); });
}

function positionPanelNearOrb() {
  const o = orbWin.getBounds();
  const { workArea } = screen.getDisplayMatching(o);
  let x = o.x + o.width / 2 - PANEL_W / 2;
  let y = o.y + o.height + 6;
  // keep on screen; flip above the orb if not enough room below
  x = Math.max(workArea.x + 6, Math.min(x, workArea.x + workArea.width - PANEL_W - 6));
  if (y + PANEL_H > workArea.y + workArea.height) y = o.y - PANEL_H - 6;
  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PANEL_W, height: PANEL_H });
}

function togglePanel() {
  if (!panelWin) createPanel();
  if (panelWin.isVisible()) {
    panelWin.hide();
    return;
  }
  // Clicking the orb while the panel is open first fires the panel's blur
  // (which hides it); without this guard the same click would immediately
  // reopen it. Skip reopening if the panel was just closed by that blur.
  if (Date.now() - panelHiddenAt < 250) return;
  positionPanelNearOrb();
  panelWin.webContents.send('panel:refresh');
  panelWin.show();
  panelWin.focus();
}

function openDashboard() {
  if (panelWin && panelWin.isVisible()) panelWin.hide();
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.show();
    dashboardWin.focus();
    return;
  }
  dashboardWin = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    movable: true,
    title: 'Token 用量看板',
    backgroundColor: '#0f0f11',
    icon: appIcon(),
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  dashboardWin.loadURL(`http://localhost:${PORT}`);
}

function toggleOrb() {
  if (!orbWin) return createOrb();
  if (orbWin.isVisible()) orbWin.hide();
  else { orbWin.show(); orbWin.focus(); }
}

// ---- tray -------------------------------------------------------------------

const METRIC_LABELS = { today: '今日', week: '本周', month: '本月', all: '全部' };

function setOrbMetric(metric) {
  config.orbMetric = metric;
  saveConfig(config);
  if (orbWin) orbWin.webContents.send('orb:metric-changed', metric);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  const metricItems = Object.keys(METRIC_LABELS).map(m => ({
    label: METRIC_LABELS[m],
    type: 'radio',
    checked: config.orbMetric === m,
    click: () => setOrbMetric(m)
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示/隐藏悬浮球', click: toggleOrb },
    { label: '打开完整看板', click: openDashboard },
    { type: 'separator' },
    { label: '悬浮球显示', submenu: metricItems },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}

// Native right-click menu shown at the orb.
function popupOrbMenu() {
  const metricItems = Object.keys(METRIC_LABELS).map(m => ({
    label: METRIC_LABELS[m],
    type: 'radio',
    checked: config.orbMetric === m,
    click: () => setOrbMetric(m)
  }));
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏面板', click: togglePanel },
    { label: '打开完整看板', click: openDashboard },
    { label: '悬浮球显示', submenu: metricItems },
    { type: 'separator' },
    { label: '隐藏悬浮球', click: () => orbWin && orbWin.hide() },
    { label: '退出', click: () => app.quit() }
  ]);
  menu.popup({ window: orbWin });
}

function createTray() {
  let img;
  const trayPath = path.join(ROOT, 'assets', 'trayTemplate.png');
  if (fs.existsSync(trayPath)) {
    img = nativeImage.createFromPath(trayPath);
    img.setTemplateImage(true);
  } else {
    img = nativeImage.createEmpty();
  }
  tray = new Tray(img);
  tray.setToolTip('Token 用量看板');
  buildTrayMenu();
  tray.on('click', togglePanel);
}

// ---- ipc --------------------------------------------------------------------

ipcMain.on('orb:move-by', (_e, { dx, dy }) => {
  if (!orbWin) return;
  const [x, y] = orbWin.getPosition();
  orbWin.setPosition(Math.round(x + dx), Math.round(y + dy));
  if (panelWin && panelWin.isVisible()) positionPanelNearOrb();
});
ipcMain.on('orb:toggle-panel', togglePanel);
ipcMain.on('orb:context-menu', popupOrbMenu);
ipcMain.on('panel:open-dashboard', openDashboard);
ipcMain.on('panel:close', () => panelWin && panelWin.hide());
ipcMain.on('app:quit', () => app.quit());
ipcMain.handle('app:port', () => PORT);
ipcMain.handle('app:orb-metric', () => config.orbMetric);
ipcMain.on('app:set-orb-metric', (_e, m) => {
  if (METRIC_LABELS[m]) setOrbMetric(m);
});

// ---- lifecycle --------------------------------------------------------------

app.whenReady().then(async () => {
  const icon = appIcon();
  if (icon && process.platform === 'darwin' && app.dock) app.dock.setIcon(icon);
  await ensureServer();
  createOrb();
  createPanel();
  createTray();

  const hotkey = process.platform === 'darwin' ? 'Cmd+Shift+T' : 'Ctrl+Shift+T';
  globalShortcut.register(hotkey, togglePanel);

  app.on('activate', () => { if (!orbWin) createOrb(); else orbWin.show(); });
});

app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (serverProcess) serverProcess.kill();
});
