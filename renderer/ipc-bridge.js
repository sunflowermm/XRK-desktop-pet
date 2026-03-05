const { ipcRenderer } = require('electron');

// 确保事件监听器只注册一次
let ipcBridgeInitialized = false;

function setupIpcBridge(live2DApp) {
  if (!live2DApp) return;
  
  // 如果已经初始化过，只更新 live2DApp 引用，不重复注册监听器
  if (ipcBridgeInitialized) {
    // 可以在这里更新引用，但通常不需要
    return;
  }

  ipcRenderer.on('cursor-point', (event, payload) => {
    try {
      live2DApp.onCursorPoint(payload);
    } catch (_) {}
  });

  ipcRenderer.on('switch-model', (event, key) => {
    try {
      live2DApp.switchModel(String(key));
    } catch (_) {}
  });

  // 主进程切换大小档位（右键菜单调用）
  ipcRenderer.on('set-stage-size-key', (event, key) => {
    try {
      if (typeof live2DApp.setStageSizeKey === 'function') {
        live2DApp.setStageSizeKey(String(key));
      }
    } catch (_) {}
  });

  // 调试面板：请求当前舞台参数
  ipcRenderer.on('debug-request-stage-config', () => {
    try {
      if (typeof live2DApp.getCurrentStageDebugConfig === 'function') {
        const cfg = live2DApp.getCurrentStageDebugConfig();
        ipcRenderer.send('debug-current-stage-config', cfg);
      }
    } catch (_) {}
  });

  // 调试面板：实时推送的舞台参数补丁
  ipcRenderer.on('debug-update-stage-config', (event, patch) => {
    try {
      if (typeof live2DApp.updateStageDebugConfig === 'function') {
        live2DApp.updateStageDebugConfig(patch);
      }
    } catch (e) {
      console.error('debug-update-stage-config error:', e);
    }
  });

  // 右键菜单触发的"特殊互动"动作
  ipcRenderer.on('play-special-motion', (event, kind) => {
    try {
      live2DApp.playSpecialMotion(String(kind || 'special1'));
    } catch (_) {}
  });

  // 来自拖拽层（overlay）的"点击宠物"事件，转为一次 Tap 动作
  ipcRenderer.on('overlay-tap', () => {
    try {
      live2DApp.playTapMotion();
    } catch (_) {}
  });

  ipcBridgeInitialized = true;
}

module.exports = {
  setupIpcBridge,
};

