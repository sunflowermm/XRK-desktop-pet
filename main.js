const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createTray, destroyTray } = require('./main/modules/tray');
const { startCursorBroadcast, stopCursorBroadcast } = require('./main/modules/cursorBroadcast');
const { registerDragIpc } = require('./main/modules/ipc-drag');
const { createDragWindow, getDragWindow } = require('./main/windows/dragWindow');
const { STAGE_SIZE_PRESETS } = require('./stageConfig');

let mainWindow;
let settingsWindow;
let stageDebugWindow;
let allowProgrammaticResize = false;
let stableMainSize = { width: 0, height: 0 };
let isDragging = false;
let currentModelKey = 'kuromi';
let isLocked = false;

// 获取配置路径（动态获取，支持打包后的情况）
function getConfigPath() {
  try {
    if (app.isPackaged) {
      return path.join(app.getPath('userData'), 'config.json');
    }
  } catch (_) {}
  return path.join(__dirname, 'config.json');
}

// 默认配置
const DEFAULT_CONFIG = {
  defaultModel: 'kuromi',
  defaultStageSize: 'small',
  isLocked: false,
  isAlwaysOnTop: true,
  skipTaskbar: true,
  debugMode: false
};

// 加载配置
function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch (e) {
    // 使用简单的 console.log，避免循环依赖
    if (process.env.npm_lifecycle_event === 'start') {
      console.error('[desktop-pet] load-config-error:', e);
    }
  }
  return { ...DEFAULT_CONFIG };
}

// 保存配置
function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    
    // 确保目录存在（打包后需要创建用户数据目录）
    try {
      if (app.isPackaged) {
        const userDataDir = app.getPath('userData');
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }
      } else {
        const configDir = path.dirname(configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
      }
    } catch (_) {}
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    // 更新缓存
    appConfig = config;
    getAppConfig._cache = config;
    dlog('config-saved', { path: configPath, config });
    return true;
  } catch (e) {
    dlog('save-config-error', { error: String(e) });
    return false;
  }
}

// 初始化配置（延迟加载）
let appConfig = null;

function disableDefaultAppMenu() {
  // 去掉默认的 File/Edit/View/Help 等菜单（尤其是 settingsWindow 这种有 frame 的窗口）
  try {
    Menu.setApplicationMenu(null);
  } catch (_) {}
}

function applyNoMenuBar(win) {
  if (!win || win.isDestroyed?.()) return;
  try {
    win.setMenu(null);
  } catch (_) {}
  try {
    win.setMenuBarVisibility(false);
  } catch (_) {}
  try {
    win.autoHideMenuBar = true;
  } catch (_) {}
}

function enforceFixedSizes() {
  if (isDragging) return;
  
  // 异步执行，避免阻塞渲染
  setImmediate(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [w, h] = mainWindow.getContentSize();
        if (w !== stableMainSize.width || h !== stableMainSize.height) {
          allowProgrammaticResize = true;
          const b = mainWindow.getBounds();
          mainWindow.setContentSize(stableMainSize.width, stableMainSize.height);
          mainWindow.setPosition(b.x, b.y);
        }
      }
    } catch (_) {} finally {
      setTimeout(() => { allowProgrammaticResize = false; }, 0);
    }

  // 优化：异步同步overlay窗口，避免阻塞
  setImmediate(() => {
    syncDragWindowToMain();
  });
  });
}

// 获取当前配置（延迟加载，避免循环依赖）
function getAppConfig() {
  if (!getAppConfig._cache) {
    getAppConfig._cache = loadConfig();
  }
  return getAppConfig._cache;
}

// 刷新配置缓存
function refreshAppConfig() {
  getAppConfig._cache = loadConfig();
  return getAppConfig._cache;
}

// 调试配置：从配置文件读取，或通过环境变量启用
function isDebugMode() {
  const config = getAppConfig();
  return config?.debugMode === true || process.env.npm_lifecycle_event === 'start';
}

function dlog(tag, payload) {
  if (!isDebugMode()) return;
  try {
    const ts = new Date().toISOString();
    const safe = payload ? JSON.stringify(payload).slice(0, 2000) : '';
    console.log(`[desktop-pet][${ts}][${tag}] ${safe}`);
  } catch (e) {
    try { console.log(`[desktop-pet][${tag}]`, payload); } catch (_) {}
  }
}

// 拖拽相关的计时逻辑已移动到 main/modules/ipc-drag.js 中

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  // 确保配置已加载
  const appConfigData = getAppConfig();

  mainWindow = new BrowserWindow({
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    alwaysOnTop: appConfigData.isAlwaysOnTop,
    skipTaskbar: appConfigData.skipTaskbar,
    resizable: false,
    useContentSize: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
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
  
  if (process.platform === 'win32') {
    try {
      const { exec } = require('child_process');
      mainWindow.webContents.once('did-finish-load', () => {
        const rendererPid = mainWindow.webContents.getOSProcessId();
        if (rendererPid) {
          exec(`wmic process where processid=${rendererPid} call setpriority "high priority"`, () => {});
          setTimeout(() => {
            exec(`powershell -Command "$p = Get-Process -Id ${rendererPid}; $p.PriorityClass = 'High'"`, () => {});
          }, 100);
        }
      });
    } catch (e) {}
  }

  applyNoMenuBar(mainWindow);

  // 应用锁定状态
  applyLockState();

  dlog('startup', {
    debug: isDebugMode(),
    lifecycle: process.env.npm_lifecycle_event,
    argv: process.argv,
    platform: process.platform,
    versions: process.versions
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 禁用开发者工具（不自动打开）
  // 如需调试，可通过设置窗口启用 autoOpenDevTools

  mainWindow.on('will-resize', (e) => {
    if (allowProgrammaticResize) return;
    if (isDragging) {
      try { e.preventDefault(); } catch (_) {}
      return;
    }
    try { e.preventDefault(); } catch (_) {}
  });
  mainWindow.on('resize', () => {
    if (isDragging) {
      // 拖动时禁止任何resize操作，避免干扰
      return;
    }
    // 优化：异步同步overlay窗口，避免阻塞
    setImmediate(() => {
      syncDragWindowToMain();
    });
  });

  mainWindow.on('closed', () => {
    const dw = getDragWindow();
    try {
      if (dw && !dw.isDestroyed()) dw.close();
    } catch (e) {}
    mainWindow = null;
  });
  
  mainWindow.on('show', () => {
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      const dw = getDragWindow();
      if (dw && !dw.isDestroyed()) {
        syncDragWindowToMain();
        dw.showInactive();
      }
    } catch (_) {}
  });

  // 设置窗口属性
  try {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch (e) {}

  mainWindow.once('ready-to-show', () => {
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (process.platform === 'win32') {
        try {
          const { exec } = require('child_process');
          setTimeout(() => {
            const rendererPid = mainWindow.webContents.getOSProcessId();
            if (rendererPid) {
              exec(`wmic process where processid=${rendererPid} call setpriority "high priority"`, () => {});
              exec(`powershell -Command "$p = Get-Process -Id ${rendererPid}; $p.PriorityClass = 'High'"`, () => {});
            }
          }, 200);
        } catch (e) {}
      }
      mainWindow.show();
    } catch (e) {}
  });

  mainWindow.webContents.once('did-finish-load', () => {
    try {
      const config = getAppConfig();
      // 发送配置信息到渲染进程
      mainWindow.webContents.send('app-config', config);
      
      // 初始化模型和窗口大小
      if (config.defaultModel) {
        currentModelKey = config.defaultModel;
        mainWindow.webContents.send('switch-model', config.defaultModel);
      }
      if (config.defaultStageSize) {
        mainWindow.webContents.send('set-stage-size-key', config.defaultStageSize);
      }
      
      if (stableMainSize.width > 0 && stableMainSize.height > 0) {
        syncDragWindowToMain();
        const dw = getDragWindow();
        if (dw && !dw.isDestroyed()) {
          dw.showInactive();
        }
      }
      // 窗口加载完成，不需要请求预设（直接从 JSON 读取）
    } catch (e) {}
  });

  mainWindow.on('move', () => {
    if (!isDragging) {
      // 优化：异步同步，避免阻塞主线程
      setImmediate(() => {
        syncDragWindowToMain();
      });
    }
  });
  return mainWindow;
}

// 应用锁定状态
function applyLockState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  const config = getAppConfig();
  isLocked = config.isLocked || false;
  
  try {
    if (isLocked) {
      // 锁定：窗口完全穿透，禁用所有交互
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      // 禁用拖拽窗口
      const dw = getDragWindow();
      if (dw && !dw.isDestroyed()) {
        dw.setIgnoreMouseEvents(true, { forward: true });
        // 通知overlay窗口锁定状态
        dw.webContents.send('lock-state-changed', true);
      }
    } else {
      // 解锁：恢复交互
      mainWindow.setIgnoreMouseEvents(true, { forward: true }); // 保持穿透，但通过overlay处理交互
      const dw = getDragWindow();
      if (dw && !dw.isDestroyed()) {
        dw.setIgnoreMouseEvents(false);
        // 通知overlay窗口解锁状态
        dw.webContents.send('lock-state-changed', false);
      }
    }
  } catch (e) {
    dlog('apply-lock-state-error', { error: String(e) });
  }
}

// 切换锁定状态
function toggleLock() {
  const config = getAppConfig();
  const newConfig = { ...config, isLocked: !config.isLocked };
  saveConfig(newConfig);
  refreshAppConfig();
  applyLockState();
  // 通知所有渲染进程
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lock-state-changed', newConfig.isLocked);
  }
  // 通知overlay窗口
  const dw = getDragWindow();
  if (dw && !dw.isDestroyed()) {
    dw.webContents.send('lock-state-changed', newConfig.isLocked);
  }
  // 更新托盘菜单
  if (global.trayInstance && global.trayInstance.updateMenu) {
    setTimeout(() => {
      global.trayInstance.updateMenu();
    }, 100);
  }
  return newConfig.isLocked;
}

// 创建设置窗口
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '向日葵桌面宠物 - 设置',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false  // 禁用开发者工具
    },
  });

  applyNoMenuBar(settingsWindow);

  try {
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  } catch (e) {
    dlog('settings-window-load-error', { error: String(e) });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

// 创建模型窗口调试面板
function createStageDebugWindow() {
  if (stageDebugWindow && !stageDebugWindow.isDestroyed()) {
    stageDebugWindow.focus();
    return stageDebugWindow;
  }

  stageDebugWindow = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '模型窗口调试',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: isDebugMode(),
    },
  });

  applyNoMenuBar(stageDebugWindow);

  try {
    stageDebugWindow.loadFile(path.join(__dirname, 'debug-panel.html'));
  } catch (e) {
    dlog('stage-debug-window-load-error', { error: String(e) });
  }

  stageDebugWindow.on('closed', () => {
    stageDebugWindow = null;
  });

  return stageDebugWindow;
}

ipcMain.on('reset-drag-window', () => {
  try {
    const dw = getDragWindow();
    if (dw && !dw.isDestroyed()) dw.close();
    
    const size = stableMainSize.width > 0 && stableMainSize.height > 0 
      ? stableMainSize 
      : (() => {
          const [w, h] = mainWindow?.getContentSize() || [0, 0];
          return w > 0 && h > 0 ? { width: w, height: h } : null;
        })();
    
    if (size) {
      createDragWindow(size);
      syncDragWindowToMain();
      const newDw = getDragWindow();
      if (newDw && !newDw.isDestroyed()) {
        newDw.showInactive();
      }
      dlog('reset-drag-window', {
        mainBounds: mainWindow?.getBounds?.(),
        dragBounds: getDragWindow()?.getBounds?.()
      });
    }
  } catch (_) {}
});

// 同步overlay窗口到主窗口：确保大小和位置完全同步（异步执行，不阻塞渲染）
function syncDragWindowToMain() {
  if (!mainWindow || mainWindow.isDestroyed() || isDragging) return;
  const dw = getDragWindow();
  if (!dw || dw.isDestroyed()) return;
  
  // 使用异步方式同步，避免阻塞渲染
  setImmediate(() => {
    try {
      const b = mainWindow.getBounds();
      const [cw, ch] = mainWindow.getContentSize();
      
      // 更新stableMainSize为主窗口的实际大小
      stableMainSize = { width: cw, height: ch };
      
      const [dwW, dwH] = dw.getContentSize();
      
      // 同步大小：overlay窗口必须和主窗口大小完全一致
      if (dwW !== cw || dwH !== ch) {
        dw.setContentSize(cw, ch);
      }
      // 同步位置：overlay窗口位置与主窗口完全一致（中心对齐，大小相同所以位置相同）
      if (Math.abs(dw.getBounds().x - b.x) > 0.5 || Math.abs(dw.getBounds().y - b.y) > 0.5) {
        dw.setPosition(b.x, b.y, false);
      }
    } catch (_) {}
  });
}

registerDragIpc({
  ipcMain,
  screen,
  getMainWindow: () => mainWindow,
  getDragWindow,
  syncDragWindowToMain,
  enforceFixedSizes,
  dlog,
  onDraggingChange: (dragging) => {
    isDragging = dragging;
  },
  getWindowSize: () => stableMainSize,
  setAllowProgrammaticResize: (value) => {
    allowProgrammaticResize = value;
  },
});

ipcMain.on('overlay-tap', (event) => {
  dlog('overlay-tap-main', { fromWebContentsId: event.sender?.id });
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('overlay-tap');
    }
  } catch (e) {}
});

// 统一的窗口大小/模型切换处理：保持当前位置，触发重绘
function handleWindowSizeChange(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  // 获取当前窗口位置，保持在当前位置切换
  let x, y;
  try {
    const b = mainWindow.getBounds();
    const [cw, ch] = mainWindow.getContentSize();
    // 计算窗口中心点
    const centerX = b.x + Math.round(cw / 2);
    const centerY = b.y + Math.round(ch / 2);
    // 新窗口以中心点为基准，确保位置不变
    x = centerX - Math.round(width / 2);
    y = centerY - Math.round(height / 2);
    
    // 确保窗口在屏幕范围内
    const wa = screen.getPrimaryDisplay().workArea;
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - height));
  } catch (_) {
    // 如果获取位置失败，使用屏幕中间
    const wa = screen.getPrimaryDisplay().workArea;
    x = Math.round((wa.width - width) / 2) + wa.x;
    y = Math.round((wa.height - height) / 2) + wa.y;
  }
  
  setImmediate(() => {
    try {
      allowProgrammaticResize = true;
      syncBothWindowsSizeAndPosition(width, height, x, y);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) {
          mainWindow.showInactive();
        }
        mainWindow.webContents.send('trigger-window-resize');
        mainWindow.webContents.invalidate();
        mainWindow.focus();
      }
      
      const dw = getDragWindow();
      if (dw && !dw.isDestroyed()) {
        dw.showInactive();
      }
      
      setTimeout(() => { allowProgrammaticResize = false; }, 0);
    } catch (e) {
      dlog('handle-window-size-change-error', { error: String(e) });
      setTimeout(() => { allowProgrammaticResize = false; }, 0);
    }
  });
}

ipcMain.on('renderer-init-stage-size', (event, payload) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const width = typeof payload?.width === 'number' && payload.width > 0 ? Math.round(payload.width) : null;
    const height = typeof payload?.height === 'number' && payload.height > 0 ? Math.round(payload.height) : null;
    if (!width || !height) return;
    
    handleWindowSizeChange(width, height);
  } catch (e) {
    dlog('renderer-init-stage-size-error', { error: String(e) });
  }
});

// 窗口重绘处理（优化：减少不必要的操作，避免闪烁）
function triggerWindowRepaint() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
    const dw = getDragWindow();
    if (dw && !dw.isDestroyed()) {
      dw.showInactive();
    }
  } catch (e) {
    dlog('trigger-window-repaint-error', { error: String(e) });
  }
}

function getStageSizePresets(modelKey) {
  return STAGE_SIZE_PRESETS[modelKey] || STAGE_SIZE_PRESETS.kuromi || [];
}

ipcMain.on('model-switched', (event, payload) => {
  if (payload?.modelKey) {
    currentModelKey = payload.modelKey;
  }
  triggerWindowRepaint();
  if (stageDebugWindow && !stageDebugWindow.isDestroyed()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('debug-request-stage-config');
    }
  }
});
ipcMain.on('stage-size-switched', (event, payload) => {
  triggerWindowRepaint();
  if (stageDebugWindow && !stageDebugWindow.isDestroyed()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('debug-request-stage-config');
    }
  }
});

// 渲染进程请求菜单数据（立即返回，不阻塞）
ipcMain.on('request-context-menu-data', (event) => {
  const sizePresets = getStageSizePresets(currentModelKey);
  const config = getAppConfig();
  event.reply('context-menu-data', {
    sizePresets,
    isAlwaysOnTop: mainWindow?.isAlwaysOnTop() ?? true,
    isLocked: config.isLocked || false,
  });
});

// ==================== 菜单窗口管理 ====================
let menuWindow = null;

function createMenuWindow(x, y, menuData) {
  // 关闭已存在的菜单窗口
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.close();
  }

  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  
  menuWindow = new BrowserWindow({
    width: 200,
    height: 400,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    hasShadow: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false  // 禁用开发者工具
    },
  });

  applyNoMenuBar(menuWindow);
  // 捕获本次创建的窗口引用，避免 menuWindow 被提前置空导致回调里崩溃
  const win = menuWindow;
  
  // 设置菜单窗口层级高于主窗口
  try {
    win.setAlwaysOnTop(true, 'pop-up-menu');
  } catch (e) {}
  
  win.loadFile(path.join(__dirname, 'menu.html'), {
    query: { data: JSON.stringify(menuData) }
  });

  win.on('closed', () => {
    if (menuWindow === win) menuWindow = null;
  });
  
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.setIgnoreMouseEvents(false);
    // 发送窗口位置给渲染进程
    const [x, y] = win.getPosition();
    win.webContents.send('menu-window-position', { x, y });
  });
  
  // 监听窗口移动，更新位置信息
  win.on('move', () => {
    if (!win.isDestroyed()) {
      const [x, y] = win.getPosition();
      win.webContents.send('menu-window-position', { x, y });
    }
  });
  
  // 接收菜单窗口的日志
  win.webContents.on('console-message', (event, level, message) => {
    if (message.includes('[MENU]') || message.includes('[MENU ERROR]')) {
      console.log(`[MenuWindow] ${message}`);
    }
  });

  // 体验优化：点击窗口外（失焦）时自动收起菜单
  // - 比 renderer 侧做全局 hook 更可靠（跨应用/桌面点击也会触发 blur）
  // - 延迟一拍，避免某些情况下刚创建时的瞬时 blur 误关
  win.on('blur', () => {
    setTimeout(() => {
      try {
        if (!win.isDestroyed()) win.close();
      } catch (_) {}
    }, 30);
  });
  
  return win;
}

function closeMenuWindow() {
  if (menuWindow && !menuWindow.isDestroyed()) {
    menuWindow.close();
  }
}

// ==================== 菜单 IPC 处理 ====================
ipcMain.on('show-menu-window', (event, screenX, screenY) => {
  const sizePresets = getStageSizePresets(currentModelKey);
  const config = getAppConfig();
  const menuData = {
    sizePresets,
    isAlwaysOnTop: mainWindow?.isAlwaysOnTop() ?? true,
    isLocked: config.isLocked || false,
  };
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const maxX = bounds.width - 200;
  const maxY = bounds.height - 400;
  const x = Math.max(bounds.x, Math.min(screenX, maxX));
    const y = Math.max(bounds.y, Math.min(screenY, maxY));
    createMenuWindow(x, y, menuData);
});

ipcMain.on('close-menu-window', closeMenuWindow);

ipcMain.on('resize-menu-window', (event, width, height) => {
  if (menuWindow && !menuWindow.isDestroyed()) {
    const [currentWidth, currentHeight] = menuWindow.getContentSize();
    dlog('resize-menu-window', { 
      requested: { width, height },
      current: { width: currentWidth, height: currentHeight }
    });
    if (currentWidth !== width || currentHeight !== height) {
      // 获取当前窗口位置，保持位置不变
      const [x, y] = menuWindow.getPosition();
      menuWindow.setContentSize(width, height);
      // 确保窗口位置不变（因为扩展窗口可能会改变位置）
      menuWindow.setPosition(x, y);
      dlog('Menu window resized (position unchanged)', { width, height, x, y });
      // 更新窗口位置信息
      menuWindow.webContents.send('menu-window-position', { x, y });
    }
  }
});

ipcMain.handle('get-window-position', () => {
  const dragWindow = getDragWindow();
  if (dragWindow && !dragWindow.isDestroyed()) {
    const [x, y] = dragWindow.getPosition();
    return { x, y };
  }
  return { x: 0, y: 0 };
});

ipcMain.handle('get-screen-bounds', () => {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y
  };
});

// 获取锁定状态
ipcMain.handle('get-lock-state', () => {
  const config = getAppConfig();
  return config.isLocked || false;
});

// ==================== 菜单动作处理 ====================
const menuActions = {
  'toggle-always-on-top': (payload) => {
    if (mainWindow) {
      try {
        const checked = payload?.checked ?? !mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(checked, checked ? 'screen-saver' : 'normal');
      } catch (e) {}
    }
  },
  'set-stage-size': (payload) => {
    mainWindow?.webContents.send('set-stage-size-key', payload?.key);
  },
  'switch-model': (payload) => {
    mainWindow?.webContents.send('switch-model', payload?.key);
  },
  'play-motion': (payload) => {
    mainWindow?.webContents.send('play-special-motion', payload?.kind);
  },
  'toggle-visibility': () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
        }
      } catch (e) {}
    }
  },
  'quit': () => {
    app.quit();
  },
  'toggle-lock': () => {
    const newLockState = toggleLock();
    return { isLocked: newLockState };
  },
  'open-settings': () => {
    createSettingsWindow();
  },
  'open-stage-debug-panel': () => {
    createStageDebugWindow();
  },
};

ipcMain.on('context-menu-action', (event, action, payload) => {
  setImmediate(() => {
    const handler = menuActions[action];
    if (handler) {
      handler(payload);
    }
  });
});

// 模型窗口调试 IPC 转发：debug 面板 <-> 主窗口
ipcMain.on('stage-debug-request-config', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-request-stage-config');
  }
});

ipcMain.on('debug-current-stage-config', (event, cfg) => {
  if (stageDebugWindow && !stageDebugWindow.isDestroyed()) {
    stageDebugWindow.webContents.send('stage-debug-current-config', cfg);
  }
});

ipcMain.on('stage-debug-update-config', (event, patch) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-update-stage-config', patch);
  }
});

// 从系统托盘切换锁定状态
ipcMain.on('toggle-lock-from-tray', () => {
  toggleLock();
});

// 设置窗口 IPC 处理
ipcMain.handle('settings-get-config', () => {
  const config = getAppConfig();
  return { ...config };
});

// 给渲染进程"启动初始化"用：保证在创建 app 前就能拿到配置
ipcMain.handle('app-get-config', () => {
  const config = getAppConfig();
  return { ...config };
});

ipcMain.handle('settings-save-config', (event, newConfig) => {
  try {
    const currentConfig = getAppConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    saveConfig(updatedConfig);
    
    // 刷新配置缓存
    refreshAppConfig();
    
    // 应用配置更改
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (newConfig.isAlwaysOnTop !== undefined) {
        mainWindow.setAlwaysOnTop(newConfig.isAlwaysOnTop, newConfig.isAlwaysOnTop ? 'screen-saver' : 'normal');
      }
      if (newConfig.skipTaskbar !== undefined) {
        mainWindow.setSkipTaskbar(newConfig.skipTaskbar);
      }
      if (newConfig.isLocked !== undefined) {
        applyLockState();
      }
      if (newConfig.defaultModel) {
        currentModelKey = newConfig.defaultModel;
        mainWindow.webContents.send('switch-model', newConfig.defaultModel);
      }
      if (newConfig.defaultStageSize) {
        mainWindow.webContents.send('set-stage-size-key', newConfig.defaultStageSize);
      }
    }
    
    return { success: true };
  } catch (e) {
    dlog('settings-save-config-error', { error: String(e) });
    return { success: false, error: String(e) };
  }
});

ipcMain.handle('settings-get-models', () => {
  return [
    { key: 'kuromi', label: 'Kuromi' },
    { key: 'mark', label: 'Mark' },
    { key: 'kaguya', label: 'Kaguya' },
    { key: 'cinamoroll', label: 'Cinnamoroll' },
    { key: 'robot', label: 'Robot' },
  ];
});

ipcMain.handle('settings-get-stage-sizes', () => {
  return ['small', 'medium', 'large'];
});

// 设置窗口关闭
ipcMain.on('settings-window-close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

// 统一的窗口同步函数：确保主窗口和overlay窗口大小和位置完全同步
function syncBothWindowsSizeAndPosition(width, height, x, y) {
  if (!mainWindow || mainWindow.isDestroyed() || isDragging) return;
  
  stableMainSize = { width, height };
  
  // 更新主窗口
  try {
    mainWindow.setContentSize(width, height);
    mainWindow.setPosition(x, y);
    if (!mainWindow.isVisible()) {
      mainWindow.showInactive();
    }
  } catch (e) {}
  
  // 同步更新overlay窗口
  const dw = getDragWindow();
  if (dw && !dw.isDestroyed()) {
    try {
      dw.setContentSize(width, height);
      dw.setPosition(x, y);
      dw.showInactive();
    } catch (e) {}
  } else if (width > 0 && height > 0) {
    try {
      createDragWindow(stableMainSize);
      const newDw = getDragWindow();
      if (newDw && !newDw.isDestroyed()) {
        newDw.setPosition(x, y);
        newDw.showInactive();
      }
    } catch (e) {}
  }
}

function setWindowSizeKeepCenter(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  // 异步执行，避免阻塞渲染
  setImmediate(() => {
    try {
      allowProgrammaticResize = true;
      const b = mainWindow.getBounds();
      const [cw, ch] = mainWindow.getContentSize();
      const centerX = b.x + Math.round(cw / 2);
      const centerY = b.y + Math.round(ch / 2);
      
      const display = screen.getDisplayMatching(b);
      const wa = display?.workArea || screen.getPrimaryDisplay().workArea;
      const x = Math.min(Math.max(centerX - Math.round(width / 2), wa.x), wa.x + wa.width - width);
      const y = Math.min(Math.max(centerY - Math.round(height / 2), wa.y), wa.y + wa.height - height);

      // 使用统一的同步函数，确保两个窗口完全同步
      syncBothWindowsSizeAndPosition(width, height, x, y);
    } catch (e) {
      dlog('set-window-size-error', { error: String(e), width, height });
      // 降级处理：也要同步overlay窗口
      try {
        const b = mainWindow.getBounds();
        let x, y;
        if (b.x === 0 && b.y === 0) {
          const wa = screen.getPrimaryDisplay().workArea;
          x = Math.round((wa.width - width) / 2) + wa.x;
          y = Math.round((wa.height - height) / 2) + wa.y;
        } else {
          x = b.x;
          y = b.y;
        }
        syncBothWindowsSizeAndPosition(width, height, x, y);
      } catch (e2) {
        dlog('set-window-size-fallback-error', { error: String(e2) });
      }
    }
    setTimeout(() => { allowProgrammaticResize = false; }, 0);
  });
}

try {
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-hang-monitor');
  app.commandLine.appendSwitch('disable-prompt-on-repost');
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-ipc-flooding-protection');
  app.commandLine.appendSwitch('disable-session-crashed-bubble');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('no-first-run');
  app.commandLine.appendSwitch('no-default-browser-check');
  app.commandLine.appendSwitch('disable-extensions');
  app.commandLine.appendSwitch('disable-plugins-discovery');
  app.commandLine.appendSwitch('disable-preconnect');
  app.commandLine.appendSwitch('disable-translate');
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
  app.commandLine.appendSwitch('enable-gpu-memory-buffer-compositor-resources');
  app.commandLine.appendSwitch('enable-gpu-memory-buffer-video-frames');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('enable-hardware-overlays');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('enable-webgl');
  app.commandLine.appendSwitch('enable-webgl2');
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,UseSkiaRenderer,NetworkService,NetworkServiceInProcess,ThrottleForegroundTimers');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('max-active-webgl-contexts', '16');
  
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('high-dpi-support', '1');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
  }
  
  if (app.isPackaged) {
    const userDataPath = app.getPath('userData');
    const cacheDir = path.join(userDataPath, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  } else {
    const userDataDir = path.join(__dirname, '.user-data');
    const cacheDir = path.join(userDataDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    app.setPath('userData', userDataDir);
    app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  }
} catch (e) {
  dlog('user-data-dir-setup-error', { error: String(e) });
}

let syncTimer = null;
function startSyncTimer() {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    if (isDragging) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      syncDragWindowToMain();
    }
  }, 200);
}

function stopSyncTimer() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

app.whenReady().then(() => {
  disableDefaultAppMenu();
  appConfig = getAppConfig();
  
  if (process.platform === 'win32') {
    try {
      const { exec } = require('child_process');
      const pid = process.pid;
      exec(`wmic process where processid=${pid} call setpriority "high priority"`, () => {});
      setTimeout(() => {
        exec(`powershell -Command "$p = Get-Process -Id ${pid}; $p.PriorityClass = 'High'"`, () => {});
        exec(`powershell -Command "Get-Process -Id ${pid} | ForEach-Object { $_.ProcessorAffinity = [System.IntPtr]::new([Math]::Pow(2, $env:NUMBER_OF_PROCESSORS) - 1) }"`, () => {});
      }, 100);
    } catch (e) {}
  }
  
  createMainWindow();
  const trayInstance = createTray({
    getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    createWindow: () => createMainWindow(),
    getLockState: () => {
      const config = getAppConfig();
      return config.isLocked || false;
    },
    toggleLock: () => {
      toggleLock();
    },
  });
  
  // 将 trayInstance 保存到全局，供 toggleLock 使用
  global.trayInstance = trayInstance;

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  startCursorBroadcast(
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    screen,
  );
  
  // 启动定期同步
  startSyncTimer();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopSyncTimer();
  destroyTray();
  stopCursorBroadcast();
});
