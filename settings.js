const { ipcRenderer } = require('electron');

// 调试日志（简化版，不依赖配置）
function log(...args) {
  console.log('[SETTINGS]', ...args);
}

function logError(...args) {
  console.error('[SETTINGS ERROR]', ...args);
}

// DOM 元素
const defaultModelSelect = document.getElementById('defaultModel');
const defaultStageSizeSelect = document.getElementById('defaultStageSize');
const isAlwaysOnTopCheckbox = document.getElementById('isAlwaysOnTop');
const skipTaskbarCheckbox = document.getElementById('skipTaskbar');
const isLockedCheckbox = document.getElementById('isLocked');
const debugModeCheckbox = document.getElementById('debugMode');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');

// 加载配置
async function loadConfig() {
  try {
    const config = await ipcRenderer.invoke('settings-get-config');
    log('Config loaded:', config);
    
    // 填充表单
    if (config.defaultModel) {
      defaultModelSelect.value = config.defaultModel;
    }
    if (config.defaultStageSize) {
      defaultStageSizeSelect.value = config.defaultStageSize;
    }
    if (config.isAlwaysOnTop !== undefined) {
      isAlwaysOnTopCheckbox.checked = config.isAlwaysOnTop;
    }
    if (config.skipTaskbar !== undefined) {
      skipTaskbarCheckbox.checked = config.skipTaskbar;
    }
    if (config.isLocked !== undefined) {
      isLockedCheckbox.checked = config.isLocked;
    }
    if (config.debugMode !== undefined) {
      debugModeCheckbox.checked = config.debugMode;
    }
  } catch (e) {
    logError('Failed to load config:', e);
  }
}

// 保存配置
async function saveConfig() {
  try {
    const newConfig = {
      defaultModel: defaultModelSelect.value,
      defaultStageSize: defaultStageSizeSelect.value,
      isAlwaysOnTop: isAlwaysOnTopCheckbox.checked,
      skipTaskbar: skipTaskbarCheckbox.checked,
      isLocked: isLockedCheckbox.checked,
      debugMode: debugModeCheckbox.checked,
    };
    
    log('Saving config:', newConfig);
    
    const result = await ipcRenderer.invoke('settings-save-config', newConfig);
    
    if (result.success) {
      log('Config saved successfully');
      // 通过 IPC 关闭窗口
      ipcRenderer.send('settings-window-close');
    } else {
      logError('Failed to save config:', result.error);
      alert('保存配置失败：' + (result.error || '未知错误'));
    }
  } catch (e) {
    logError('Error saving config:', e);
    alert('保存配置时发生错误：' + e.message);
  }
}

// 取消
function cancel() {
  ipcRenderer.send('settings-window-close');
}

// 事件监听
saveBtn.addEventListener('click', saveConfig);
cancelBtn.addEventListener('click', cancel);

// 页面加载完成后初始化配置（避免重复绑定）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadConfig);
} else {
  loadConfig();
}
