# WhatsApp Web Desktop

WhatsApp Web wrapper built with Electron. Runs on **Windows** and **Linux**.

## Features

- **Privacy Blur Mode**: Built-in toggle switch to blur inactive chat lists to protect your privacy from prying eyes.
- System tray icon (single-click to open, right-click menu)
- Close-to-tray (app keeps running in the background)
- Native desktop notifications (click to focus the chat)
- Downloads saved to `Downloads/`
- External links open in your default browser
- Single-instance (re-launching focuses the existing window)

## Install

### Windows

Download the latest `${name}-${version}-${arch}-setup.exe` (e.g. `whatsapp-web-desktop-1.0.0-x64-setup.exe`) from
[Releases](https://github.com/Rudraksh919/whatsapp-linux/releases) and run it.
The NSIS installer lets you choose the install folder and creates Desktop and
Start Menu shortcuts.

## Build from source

```bash
npm install

# Windows installer (Setup .exe) -> dist/
npm run dist
```

Run in development:

```bash
npm start
```
