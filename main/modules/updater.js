const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const CHECK_TIMEOUT_MS = 30000;

function formatError(err) {
  if (!err) return '未知错误';
  const msg = err.message || String(err);
  const stack = err.stack;
  if (!stack || stack === msg) return msg;
  return `${msg}\n${stack.split('\n').slice(0, 8).join('\n')}`;
}

function createUpdater({
  app,
  ipcMain,
  dialog,
  getMainWindow,
  dlog = () => {},
  silentOnStartup = true,
} = {}) {
  if (!app) throw new Error('createUpdater: missing app');

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let updateDialogShown = false;
  let isChecking = false;

  function sendToRenderers(channel, ...args) {
    try {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    } catch (_) {}
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
    sendToRenderers('update-log', { message: '更新: 检查中', level: 'info' });

    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        done = true;
        isChecking = false;
      };

      const onAvailable = (info) => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-available', { version: info?.version });
        sendToRenderers('update-status', 'available', {
          version: info?.version,
          releaseNotes: info?.releaseNotes,
        });
        resolve(info);
      };

      const onNotAvailable = () => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-not-available', {});
        sendToRenderers('update-status', 'not-available', {});
        resolve(null);
      };

      const onError = (err) => {
        if (done) return;
        cleanup();
        removeCheckListeners();
        dlog('auto-update-error', { error: formatError(err) });
        sendToRenderers('update-status', 'error', { message: err?.message || '检查更新失败' });
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
      sendToRenderers('update-progress', {
        percent: Math.round(percent),
        transferred: progress?.transferred || 0,
        total: progress?.total || 0,
      });
    });

    autoUpdater.on('update-downloaded', async (info) => {
      sendToRenderers('update-status', 'downloaded', { version: info?.version });
      if (updateDialogShown) return;
      updateDialogShown = true;

      if (!dialog) return;
      try {
        const v = info?.version ? `v${info.version}` : '新版本';
        const res = await dialog.showMessageBox({
          type: 'info',
          title: '更新完成',
          message: `已在后台更新到 ${v}，现在重启以完成安装？`,
          buttons: ['立即重启', '稍后'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (res.response === 0) {
          setTimeout(() => {
            try {
              autoUpdater.quitAndInstall(false, true);
            } catch (_) {
              app.relaunch();
              app.exit(0);
            }
          }, 150);
        }
      } catch (e) {
        dlog('auto-update-dialog-error', { error: String(e) });
      }
    });
  }

  function registerIpc() {
    if (!ipcMain) return;

    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.handle('get-update-source', () => {
      try {
        // 打包后会被写入 extraMetadata（由 publish.js 注入）
        // 开发环境可能不存在该字段
        // eslint-disable-next-line global-require
        const pkg = require('../../package.json');
        return pkg?.xrkUpdateSource || null;
      } catch (_) {
        return null;
      }
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

    ipcMain.handle('install-update', async () => {
      try {
        autoUpdater.quitAndInstall(false, true);
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

  async function clearCacheWithFeedback() {
    return clearUpdateCache();
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
    checkForUpdatesWithTimeout,
    checkNow,
    clearUpdateCache,
    clearCacheWithFeedback,
  };
}

module.exports = {
  createUpdater,
};

