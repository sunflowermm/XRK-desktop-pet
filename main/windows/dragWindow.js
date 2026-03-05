const { BrowserWindow } = require('electron');
const path = require('path');

let dragWindow = null;

function createDragWindow(size) {
  if (dragWindow && !dragWindow.isDestroyed()) {
    // 如果窗口已存在，只更新大小（如果需要）
    // 注意：拖动时不应该调用此函数更新大小
    if (size && size.width > 0 && size.height > 0) {
      const [cw, ch] = dragWindow.getContentSize();
      if (cw !== size.width || ch !== size.height) {
        dragWindow.setContentSize(size.width, size.height);
      }
    }
    return dragWindow;
  }

  if (!size || size.width <= 0 || size.height <= 0) return null;

  dragWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    resizable: false,
    useContentSize: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
      enableWebSQL: false,
      backgroundThrottling: false,
      offscreen: false,
      hardwareAcceleration: true,
      v8CacheOptions: 'none',
      enableBlinkFeatures: 'CSSColorSchemeUARendering',
      disableDialogs: true,
      autoplayPolicy: 'no-user-gesture-required'
    },
    paintWhenInitiallyHidden: false,
    show: false
  });

  // 确保没有默认菜单栏（Windows 上避免出现 File/Edit/...）
  try { dragWindow.setMenu(null); } catch (_) {}
  try { dragWindow.setMenuBarVisibility(false); } catch (_) {}

  dragWindow.loadFile(path.join(__dirname, '..', '..', 'overlay.html'));

  try {
    dragWindow.setAlwaysOnTop(true, 'screen-saver');
    dragWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    dragWindow.setIgnoreMouseEvents(false);
  } catch (e) {}
  
  if (process.platform === 'win32') {
    try {
      const { exec } = require('child_process');
      dragWindow.webContents.once('did-finish-load', () => {
        const rendererPid = dragWindow.webContents.getOSProcessId();
        if (rendererPid) {
          exec(`wmic process where processid=${rendererPid} call setpriority "high priority"`, () => {});
          setTimeout(() => {
            exec(`powershell -Command "$p = Get-Process -Id ${rendererPid}; $p.PriorityClass = 'High'"`, () => {});
          }, 100);
        }
      });
    } catch (e) {}
  }

  // 禁止窗口resize（大小由主窗口控制）
  dragWindow.on('will-resize', (e) => {
    try { e.preventDefault(); } catch (_) {}
  });

  dragWindow.on('closed', () => {
    dragWindow = null;
  });

  return dragWindow;
}

function getDragWindow() {
  return dragWindow && !dragWindow.isDestroyed() ? dragWindow : null;
}

module.exports = {
  createDragWindow,
  getDragWindow,
};

