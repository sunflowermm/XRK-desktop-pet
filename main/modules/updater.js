const path = require('path');
const fs = require('fs');
const { BrowserWindow, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_TIMEOUT_MS = 30000;

function formatError(err) {
  if (!err) return '未知错误';
  const msg = err.message || String(err);
  const stack = err.stack;
  if (!stack || stack === msg) return msg;
  return `${msg}\n${stack.split('\n').slice(0, 8).join('\n')}`;
}

/** generic 平台（Gitee/GitCode）从 baseUrl 拉取 releaseNotes.md */
async function fetchReleaseNotesFromGeneric(app) {
  try {
    const configPath = path.join(app.getAppPath(), 'update-config.json');
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!config?.baseUrl) return null;
    const res = await fetch(String(config.baseUrl).replace(/\/$/, '') + '/releaseNotes.md');
    if (res?.ok) return await res.text();
  } catch (_) {}
  return null;
}

function createUpdater({
  app,
  ipcMain,
  dlog = () => {},
  silentOnStartup = true,
} = {}) {
  if (!app) throw new Error('createUpdater: missing app');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 将 electron-updater 的日志转到 dlog，便于排查“总是完整包”等（如：differential 失败原因）
  try {
    autoUpdater.log = {
      info: (msg, ...args) => dlog('updater-info', { msg: String(msg), args: args?.length ? args : undefined }),
      warn: (msg, ...args) => dlog('updater-warn', { msg: String(msg), args: args?.length ? args : undefined }),
      error: (msg, ...args) => dlog('updater-error', { msg: String(msg), args: args?.length ? args : undefined }),
    };
  } catch (_) {}

  let updateDialogWindow = null;
  let isChecking = false;

  function closeUpdateDialog() {
    try {
      if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
        updateDialogWindow.close();
      }
    } catch (_) {}
    updateDialogWindow = null;
  }

  function sendToUpdateDialog(channel, ...args) {
    try {
      if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
        updateDialogWindow.webContents.send(channel, ...args);
      }
    } catch (_) {}
  }

  function showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    } catch (_) {}
  }

  function createUpdateDialog(version, releaseNotes) {
    closeUpdateDialog();
    const htmlPath = path.join(__dirname, '..', '..', 'update-dialog.html');
    updateDialogWindow = new BrowserWindow({
      width: 420,
      height: 480,
      minWidth: 380,
      minHeight: 400,
      resizable: true,
      minimizable: true,
      maximizable: true,
      title: '更新 - 向日葵桌面宠物',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    updateDialogWindow.loadFile(htmlPath);
    updateDialogWindow.on('closed', () => {
      updateDialogWindow = null;
    });
    updateDialogWindow.webContents.once('did-finish-load', () => {
      sendToUpdateDialog('update-dialog-init', { version, releaseNotes: releaseNotes || '' });
    });
  }

  function removeCheckListeners() {
    try {
      autoUpdater.removeAllListeners('update-available');
      autoUpdater.removeAllListeners('update-not-available');
      autoUpdater.removeAllListeners('error');
    } catch (_) {}
  }

  function checkForUpdatesWithTimeout() {
    if (isChecking) return Promise.reject(new Error('更新检查正在进行中，请勿重复调用'));
    isChecking = true;

    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        done = true;
        isChecking = false;
      };

      const onAvailable = async (info) => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-available', { version: info?.version });

        let releaseNotes = info?.releaseNotes;
        if (!releaseNotes || (typeof releaseNotes === 'string' && !releaseNotes.trim())) {
          releaseNotes = await fetchReleaseNotesFromGeneric(app);
        }

        createUpdateDialog(info?.version || '新版本', releaseNotes);
        resolve(info);
      };

      const onNotAvailable = () => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-not-available', {});
        showNotification('向日葵桌面宠物', '已是最新版本');
        resolve(null);
      };

      const onError = (err) => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-error', { error: formatError(err) });
        showNotification('检查更新失败', err?.message || '请检查网络');
        reject(err);
      };

      removeCheckListeners();
      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('error', onError);

      timer = setTimeout(() => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        reject(new Error('检查更新超时，请检查网络'));
      }, CHECK_TIMEOUT_MS);

      try {
        autoUpdater.checkForUpdates().catch(onError);
      } catch (e) {
        onError(e);
      }
    });
  }

  function clearUpdateCache() {
    const cleared = [];
    const userData = app.getPath('userData');
    const tryRemove = (dir) => {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          cleared.push(dir);
        }
      } catch (_) {}
    };
    tryRemove(path.join(userData, 'pending'));
    tryRemove(path.join(userData, 'Caches', 'com.github.electron.updater'));
    tryRemove(path.join(userData, 'Caches', 'electron-updater'));
    return { success: true, cleared };
  }

  function wireEvents() {
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.max(0, Math.min(100, progress?.percent || 0));
      sendToUpdateDialog('update-dialog-progress', {
        percent,
        transferred: progress?.transferred || 0,
        total: progress?.total || 0,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      sendToUpdateDialog('update-dialog-downloaded', { version: info?.version });
    });
  }

  function registerIpc() {
    if (!ipcMain) return;

    ipcMain.on('update-dialog-start-download', () => {
      try {
        autoUpdater.downloadUpdate().catch((e) => {
          dlog('download-update-error', { error: formatError(e) });
          showNotification('下载更新失败', e?.message || '请重试');
          closeUpdateDialog();
        });
      } catch (e) {
        showNotification('下载更新失败', e?.message || '请重试');
        closeUpdateDialog();
      }
    });

    ipcMain.on('update-dialog-install', () => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (_) {
        app.relaunch();
        app.exit(0);
      }
    });

    ipcMain.on('update-dialog-close', () => {
      closeUpdateDialog();
    });

    ipcMain.handle('check-for-updates', async () => {
      if (!app.isPackaged) return { success: true, skipped: true, reason: 'unpacked' };
      try {
        await checkForUpdatesWithTimeout();
        return { success: true };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    ipcMain.handle('clear-update-cache', () => clearUpdateCache());
  }

  async function checkNow() {
    if (!app.isPackaged) return { skipped: true, reason: 'unpacked' };
    try {
      await checkForUpdatesWithTimeout();
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  }

  function start() {
    if (!app.isPackaged) return;
    wireEvents();
    registerIpc();

    if (silentOnStartup) {
      setImmediate(() => {
        checkForUpdatesWithTimeout().catch((e) => {
          dlog('auto-update-check-error', { error: formatError(e) });
        });
      });
    }
  }

  return {
    start,
    checkNow,
    clearUpdateCache,
  };
}

module.exports = {
  createUpdater,
};
