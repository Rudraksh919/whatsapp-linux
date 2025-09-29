const fs = require("fs");
const os = require("os");
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
const path = require("path");
// Ensure WhatsApp download folder exists
const downloadDir = path.join(os.homedir(), "Downloads", "Whatsapp");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

const WHATSAPP_URL = "https://web.whatsapp.com/";
let mainWindow = null;
let tray = null;

// Disable GPU (avoids MESA-LOADER errors on Linux/Nvidia)
app.commandLine.appendSwitch("disable-gpu");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    show: false,
    icon: path.join(__dirname, "assets", "icon.png"), // <-- your app icon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Spoof user agent
  const ua =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.loadURL(WHATSAPP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); // launches in your default browser
    return { action: "deny" }; // prevent new window in-app
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== WHATSAPP_URL) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // 🟢 Intercept close → hide instead of quit
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
  app.quit(); // Quit if another instance is already running
} else {
  app.on('second-instance', () => {
    // Someone tried to start a second instance, just show the main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on("ready", () => {
  // Tray
  const iconPath = path.join(__dirname, "assets", "icon.png");
  let trayImg;
  try {
    trayImg = nativeImage.createFromPath(iconPath);
  } catch (e) {
    trayImg = nativeImage.createEmpty();
  }
  tray = new Tray(trayImg);
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: "Show", 
      click: () => mainWindow && mainWindow.show() 
    },
    { 
      label: "Quit", 
      click: () => {
        app.isQuiting = true;  // tell the close handler to allow quitting
        app.quit();
      } 
    },
  ]);
  tray.setToolTip("WhatsApp Web");
  tray.setContextMenu(contextMenu);


  createWindow();

  // ✅ Only run after app is ready
  const downloadDir = path.join(os.homedir(), "Downloads", "Whatsapp");
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  session.defaultSession.on("will-download", (event, item, webContents) => {
    const filePath = path.join(downloadDir, item.getFilename());

    if (fs.existsSync(filePath)) {
      event.preventDefault();
      shell.openPath(filePath);
      return;
    }

    item.setSavePath(filePath);

    item.once("done", (e, state) => {
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
  // On Linux keep running in tray until quit is chosen
});

// Native notifications
ipcMain.on("notify", (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title || "WhatsApp",
      body: body || "",
    });

    // Open/focus main window when notification is clicked
    notification.on("click", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    notification.show();
  }
});
