const { ipcRenderer } = require('electron');

const elStageWidth = document.getElementById('stageWidth');
const elStageWidthRange = document.getElementById('stageWidthRange');
const elStageHeight = document.getElementById('stageHeight');
const elStageHeightRange = document.getElementById('stageHeightRange');
const elScale = document.getElementById('scale');
const elScaleRange = document.getElementById('scaleRange');
const elOffsetX = document.getElementById('offsetX');
const elOffsetXRange = document.getElementById('offsetXRange');
const elOffsetY = document.getElementById('offsetY');
const elOffsetYRange = document.getElementById('offsetYRange');
const elBadgeModel = document.getElementById('badge-model');
const elBadgeSize = document.getElementById('badge-size');
const btnReset = document.getElementById('btnReset');
const btnClose = document.getElementById('btnClose');

let latestConfig = null;

function applyForm(cfg) {
  if (!cfg) return;
  latestConfig = cfg;

  elBadgeModel.textContent = `模型：${cfg.modelKey || '-'}`;
  elBadgeSize.textContent = `档位：${cfg.sizeKey || '-'}`;

  const w = cfg.stageWidth ?? '';
  const h = cfg.stageHeight ?? '';
  const s = cfg.scale ?? '';
  const ox = cfg.offsetX ?? '';
  const oy = cfg.offsetY ?? '';

  elStageWidth.value = w;
  elStageWidthRange.value = w;
  elStageHeight.value = h;
  elStageHeightRange.value = h;
  elScale.value = s;
  elScaleRange.value = s;
  elOffsetX.value = ox;
  elOffsetXRange.value = ox;
  elOffsetY.value = oy;
  elOffsetYRange.value = oy;
}

ipcRenderer.on('stage-debug-current-config', (event, cfg) => {
  applyForm(cfg);
});

function readNumber(input, fallback) {
  const v = Number(input.value);
  return Number.isFinite(v) ? v : fallback;
}

let patchTimer = null;

function schedulePatch() {
  if (!latestConfig) return;
  const patch = {
    stageWidth: readNumber(elStageWidth, latestConfig.stageWidth),
    stageHeight: readNumber(elStageHeight, latestConfig.stageHeight),
    scale: readNumber(elScale, latestConfig.scale),
    offsetX: readNumber(elOffsetX, latestConfig.offsetX),
    offsetY: readNumber(elOffsetY, latestConfig.offsetY),
  };
  if (patchTimer) clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    ipcRenderer.send('stage-debug-update-config', patch);
  }, 80);
}

function bindPair(numberEl, rangeEl) {
  const syncFromNumber = () => {
    rangeEl.value = numberEl.value;
    schedulePatch();
  };
  const syncFromRange = () => {
    numberEl.value = rangeEl.value;
    schedulePatch();
  };
  numberEl.addEventListener('input', syncFromNumber);
  numberEl.addEventListener('change', syncFromNumber);
  rangeEl.addEventListener('input', syncFromRange);
  rangeEl.addEventListener('change', syncFromRange);
}

bindPair(elStageWidth, elStageWidthRange);
bindPair(elStageHeight, elStageHeightRange);
bindPair(elScale, elScaleRange);
bindPair(elOffsetX, elOffsetXRange);
bindPair(elOffsetY, elOffsetYRange);

btnReset.addEventListener('click', () => {
  if (!latestConfig) return;
  applyForm(latestConfig);
  schedulePatch();
});

btnClose.addEventListener('click', () => {
  window.close();
});

// 窗口加载完成后，请求一次当前配置
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('stage-debug-request-config');
});

