const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  ipcMain,
  shell,
  session,
} = require("electron");

Menu.setApplicationMenu(null);

const isWindows = process.platform === "win32";
const APP_ID = "com.whatsapp.web.desktop";

// Custom URI scheme used for notification activation. Clicking a toast from the
// Windows notification panel (Action Center) launches this URI, which re-opens
// the app even when it was sitting in the tray or fully closed.
const PROTOCOL = "whatsapp-webapp";

// On Windows this is required so notifications show the correct app name/icon
// (otherwise they appear as "electron.app.<id>" and may be silently dropped).
if (isWindows) {
  app.setAppUserModelId(APP_ID);
}

// Register ourselves as the handler for the PROTOCOL:// scheme.
if (process.defaultApp) {
  // Running unpackaged (electron .) — point the scheme at this electron binary.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

const WHATSAPP_URL = "https://web.whatsapp.com/";
const WHATSAPP_ORIGIN = new URL(WHATSAPP_URL).origin;
const TRAY_ICON_PATH = path.join(__dirname, "assets", "icon.png");
let mainWindow = null;
let tray = null;
let trayImage = nativeImage.createEmpty();
let unreadCount = 0;
const activeDownloadPaths = new Set();

// Disable GPU only on Linux (avoids MESA-LOADER errors on Nvidia).
// On Windows the GPU is fine and disabling it can cause black-screen issues.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-gpu");
}

// Resolve the user's Downloads folder in a cross-platform way and save
// everything from the app there directly.
function getDownloadDir() {
  let dir;
  try {
    dir = app.getPath("downloads");
  } catch (e) {
    dir = path.join(app.getPath("home"), "Downloads");
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function openDownloadsFolder() {
  shell.openPath(getDownloadDir()).then((errorMessage) => {
    if (errorMessage) console.error("Failed to open Downloads folder:", errorMessage);
  });
}

function getDownloadPath(downloadDir, filename) {
  const safeFileName = path.basename(filename).replace(/[\\/]/g, "_") || "download";
  const { name, ext } = path.parse(safeFileName);
  let suffix = 0;
  let filePath;

  do {
    const suffixText = suffix ? ` (${suffix})` : "";
    filePath = path.join(downloadDir, `${name}${suffixText}${ext}`);
    suffix += 1;
  } while (fs.existsSync(filePath) || activeDownloadPaths.has(filePath));

  return filePath;
}

// Bring the main window to the foreground, creating/un-hiding it as needed.
function revealWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  // On Windows, briefly pinning always-on-top reliably pulls the window to the
  // foreground from the tray; otherwise it can stay behind other apps.
  if (isWindows) {
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(false);
  }
  mainWindow.focus();
}

// Minimal XML escaping for values injected into the toast template.
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isWhatsAppUrl(url) {
  try {
    return new URL(url).origin === WHATSAPP_ORIGIN;
  } catch (e) {
    return false;
  }
}

function openExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:") {
      shell.openExternal(url);
    }
  } catch (e) {
    // Ignore malformed URLs from remote content.
  }
}

function createTrayImage() {
  if (!unreadCount || trayImage.isEmpty()) return trayImage;

  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount);
  const badgeSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
    `<image href="${trayImage.toDataURL()}" width="16" height="16"/>` +
    `<circle cx="12" cy="4" r="4" fill="#e53935"/>` +
    `<text x="12" y="6" fill="white" font-family="sans-serif" font-size="5" font-weight="bold" text-anchor="middle">${badgeText}</text>` +
    `</svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(badgeSvg).toString("base64")}`
  );
}

function updateUnreadBadge(title) {
  const match = /^\((\d+)\)/.exec(title);
  unreadCount = match ? Number(match[1]) : 0;
  if (!tray) return;

  tray.setImage(createTrayImage());
  tray.setToolTip(
    unreadCount ? `WhatsApp Web (${unreadCount} unread)` : "WhatsApp Web"
  );
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    show: false,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Spoof a desktop Chrome user agent matching the host platform so WhatsApp
  // Web serves the full desktop experience.
  const ua = isWindows
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.loadURL(WHATSAPP_URL);

  mainWindow.webContents.on("page-title-updated", (event, title) => {
    updateUnreadBadge(title);
  });

  // Open any popup (new window) link in the default browser instead of in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  // Keep WhatsApp navigation in-app, send every other link to the browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isWhatsAppUrl(url)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Intercept close → hide to tray instead of quitting.
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // A second launch (including a PROTOCOL:// notification activation from the
  // Action Center) lands here in the already-running instance — reveal the app.
  app.on("second-instance", () => {
    revealWindow();
  });
}

function isAutoLaunchEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Start hidden in the tray on login rather than popping the window open.
    openAsHidden: true,
    args: ["--hidden"],
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Open WhatsApp",
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Reload WhatsApp",
      click: () => {
        revealWindow();
        mainWindow.webContents.reloadIgnoringCache();
      },
    },
    {
      label: "Open Downloads Folder",
      click: () => {
        openDownloadsFolder();
      },
    },
    { type: "separator" },
    {
      label: "Start on login",
      type: "checkbox",
      checked: isAutoLaunchEnabled(),
      click: (item) => {
        setAutoLaunch(item.checked);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
}

app.on("ready", () => {
  // Tray — load the app icon and resize it down for a crisp tray glyph.
  try {
    trayImage = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (!trayImage.isEmpty()) {
      trayImage = trayImage.resize({ width: 16, height: 16 });
    }
  } catch (e) {
    trayImage = nativeImage.createEmpty();
  }
  tray = new Tray(createTrayImage());
  tray.setToolTip("WhatsApp Web");
  tray.setContextMenu(buildTrayMenu());

  // On Windows, a single click on the tray icon shows the window.
  tray.on("click", () => {
    if (!mainWindow) createWindow();
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });

  createWindow();

  // If launched at login (--hidden), start minimized to the tray.
  const launchedHidden =
    process.argv.includes("--hidden") ||
    app.getLoginItemSettings().wasOpenedAsHidden;
  if (launchedHidden && mainWindow) {
    mainWindow.once("ready-to-show", () => mainWindow.hide());
  }

  // Save every download into the user's Downloads folder.
  const downloadDir = getDownloadDir();
  session.defaultSession.on("will-download", (event, item) => {
    const filePath = getDownloadPath(downloadDir, item.getFilename());

    activeDownloadPaths.add(filePath);
    item.setSavePath(filePath);
    item.once("done", (e, state) => {
      activeDownloadPaths.delete(filePath);
      if (state === "completed") {
        console.log("Download finished:", filePath);
      } else {
        console.log("Download failed:", state);
      }
    });
  });
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
  else mainWindow.show();
});

app.on("window-all-closed", () => {
  // Keep running in the tray on all platforms until "Quit" is chosen.
});

ipcMain.on("open-downloads", (event) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    openDownloadsFolder();
  }
});

// Native notifications forwarded from the renderer/preload.
ipcMain.on("notify", (event, { title, body }) => {
  if (!Notification.isSupported()) return;

  const safeTitle = title || "WhatsApp";
  const safeBody = body || "";

  const options = {
    title: safeTitle,
    body: safeBody,
    icon: path.join(__dirname, "assets", "icon.png"),
  };

  // On Windows, route the toast through protocol activation so clicking it from
  // the notification panel (Action Center) — not just the live toast — re-opens
  // the app. Electron's plain "click" event only fires for the live toast.
  if (isWindows) {
    options.toastXml =
      `<toast activationType="protocol" launch="${PROTOCOL}://open">` +
      `<visual><binding template="ToastGeneric">` +
      `<text>${escapeXml(safeTitle)}</text>` +
      `<text>${escapeXml(safeBody)}</text>` +
      `</binding></visual></toast>`;
  }

  const notification = new Notification(options);
  // Fallback for the live-toast click on platforms where the event fires.
  notification.on("click", revealWindow);
  notification.show();
});
