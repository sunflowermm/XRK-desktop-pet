let cursorBroadcastTimer = null;
let lastCursorBroadcastAt = 0;

/**
 * 启动全局鼠标位置广播。
 * 通过传入 getMainWindow 函数，避免主窗口被关闭/重建后仍然持有旧引用。
 */
function startCursorBroadcast(getMainWindow, screen) {
  if (cursorBroadcastTimer) return;
  cursorBroadcastTimer = setInterval(() => {
    const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) return;
    const now = Date.now();
    if (now - lastCursorBroadcastAt < 33) return;
    lastCursorBroadcastAt = now;
    try {
      const point = screen.getCursorScreenPoint();
      const bounds = mainWindow.getBounds();
      mainWindow.webContents.send('cursor-point', { point, bounds });
    } catch (_) {}
  }, 16);
}

function stopCursorBroadcast() {
  if (!cursorBroadcastTimer) return;
  clearInterval(cursorBroadcastTimer);
  cursorBroadcastTimer = null;
}

module.exports = {
  startCursorBroadcast,
  stopCursorBroadcast,
};

