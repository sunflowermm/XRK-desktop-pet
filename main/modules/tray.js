const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;

function pickFirstExistingPath(candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function createTrayImage() {
  const iconCandidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'assets', 'icon.ico')]
    : [path.join(__dirname, '..', '..', 'assets', 'icon.ico')];

  const iconPath = pickFirstExistingPath(iconCandidates);
  if (!iconPath) return nativeImage.createEmpty();

  const img = nativeImage.createFromPath(iconPath);
  return img && !img.isEmpty() ? img : nativeImage.createEmpty();
}

function createTray({ getMainWindow, createWindow, getLockState, toggleLock } = {}) {
  if (tray) return tray;

  try {
    tray = new Tray(createTrayImage());
  } catch (error) {
    console.log('系统托盘创建失败，将跳过:', error.message);
    return null;
  }

  const resolveWindow = ({ createIfMissing } = { createIfMissing: false }) => {
    try {
      let win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if ((!win || win.isDestroyed()) && createIfMissing && typeof createWindow === 'function') {
        win = createWindow();
      }
      if (!win || win.isDestroyed()) return null;
      return win;
    } catch (_) {
      return null;
    }
  };

  const toggleVisibility = () => {
    const win = resolveWindow({ createIfMissing: true });
    if (!win) return;
    try {
      if (win.isVisible()) win.hide();
      else win.show();
    } catch (_) {}
  };

  const updateContextMenu = () => {
    const win = resolveWindow();
    const visible = !!(win && win.isVisible && win.isVisible());
    const locked = typeof getLockState === 'function' ? !!getLockState() : false;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: visible ? '隐藏桌宠' : '显示桌宠',
        click: () => {
          toggleVisibility();
        },
      },
      { type: 'separator' },
      {
        label: '锁定窗口',
        type: 'checkbox',
        checked: locked,
        click: () => {
          if (typeof toggleLock === 'function') toggleLock();
          setTimeout(updateContextMenu, 50);
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ]);

    tray.setContextMenu(contextMenu);
  };

  tray.updateMenu = updateContextMenu;
  tray.setToolTip('向日葵桌面宠物');

  tray.on('click', () => {
    toggleVisibility();
    setTimeout(updateContextMenu, 50);
  });

  tray.on('right-click', () => {
    updateContextMenu();
    tray.popUpContextMenu();
  });

  updateContextMenu();
  return tray;
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch (_) {}
  tray = null;
}

module.exports = { createTray, destroyTray };

