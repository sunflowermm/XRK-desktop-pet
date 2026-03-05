// 在 Electron 中，通过 <script src="renderer/index.js"> 加载时，require 的基准路径是 index.html，
// 因此这里需要从 HTML 所在目录出发引用子目录下的模块。
const { createLive2DApp } = require('./renderer/live2d-core');
const { setupIpcBridge } = require('./renderer/ipc-bridge');

window.addEventListener('DOMContentLoaded', () => {
  const { ipcRenderer } = require('electron');
  
  // 从主进程获取配置
  let initialModelKey = 'kuromi';
  let initialStageSizeKey = 'small';
  
  // 启动初始化：优先通过 invoke 同步拿到配置，避免“先初始化后到配置”导致默认配置不生效
  (async () => {
    try {
      const config = await ipcRenderer.invoke('app-get-config');
      if (config) {
        initialModelKey = config.defaultModel || initialModelKey;
        initialStageSizeKey = config.defaultStageSize || initialStageSizeKey;
      }
    } catch (_) {
      // ignore: fallback to defaults
    }

    const live2DApp = createLive2DApp({
      canvasId: 'canvas',
      loadingId: 'loading',
      initialModelKey: initialModelKey,
      initialStageSizeKey: initialStageSizeKey,
    });

    live2DApp
      .init()
      .then(() => {
        setupIpcBridge(live2DApp);
        window.addEventListener('resize', () => {
          live2DApp.onWindowResize();
        });
        // 监听主进程触发的窗口resize事件
        ipcRenderer.on('trigger-window-resize', () => {
          live2DApp.onWindowResize();
        });
      })
      .catch((err) => {
        // 简单降级显示错误
        const loading = document.getElementById('loading');
        if (loading) {
          loading.style.display = 'block';
          loading.style.color = '#ff4444';
          loading.textContent = `初始化失败: ${err.message}`;
        }
        // 控制台仍打印完整错误便于调试
        // eslint-disable-next-line no-console
        console.error(err);
      });
  })();
});
