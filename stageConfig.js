/**
 * 舞台尺寸配置模块
 * 
 * 统一维护所有模型的舞台/窗口预设参数（小/中/大）
 * - main.js: 用于右键菜单"窗口大小"以及窗口实际宽高
 * - renderer/live2d-core.js: 用于模型缩放与偏移计算
 * 
 * 参数说明：
 * - stageWidth/stageHeight: 舞台（窗口）尺寸（像素）
 * - scale: 模型缩放倍数（在基础适配缩放的基础上）
 * - offsetX/offsetY: 模型位置偏移（相对于舞台中心）
 * 
 * @module stageConfig
 */

const STAGE_SIZE_PRESETS = {
  kuromi: [
    { key: 'small', label: '小', stageWidth: 150, stageHeight: 160, scale: 1.89, offsetX: 9, offsetY: 184 },
    { key: 'medium', label: '中', stageWidth: 170, stageHeight: 186, scale: 2.35, offsetX: 10, offsetY: 232 },
    { key: 'large', label: '大', stageWidth: 240, stageHeight: 245, scale: 3.12, offsetX: 15, offsetY: 309 },
  ],
  mark: [
    { key: 'small', label: '小', stageWidth: 122, stageHeight: 190, scale: 1.05, offsetX: 2, offsetY: 10 },
    { key: 'medium', label: '中', stageWidth: 167, stageHeight: 257, scale: 1.45, offsetX: 0, offsetY: 3 },
    { key: 'large', label: '大', stageWidth: 200, stageHeight: 310, scale: 1.8, offsetX: 0, offsetY: 10 },
  ],
  kaguya: [
    { key: 'small', label: '小', stageWidth: 187, stageHeight: 216, scale: 1, offsetX: 6, offsetY: -29 },
    { key: 'medium', label: '中', stageWidth: 227, stageHeight: 306, scale: 1.4, offsetX: 9, offsetY: -38 },
    { key: 'large', label: '大', stageWidth: 329, stageHeight: 443, scale: 2.0, offsetX: 12, offsetY: -53 },
  ],
  cinamoroll: [
    { key: 'small', label: '小', stageWidth: 152, stageHeight: 140, scale: 1.9, offsetX: 0, offsetY: 195 },
    { key: 'medium', label: '中', stageWidth: 170, stageHeight: 186, scale: 2.3, offsetX: 0, offsetY: 230 },
    { key: 'large', label: '大', stageWidth: 240, stageHeight: 245, scale: 3.1, offsetX: 0, offsetY: 334 },
  ],
  robot: [
    { key: 'small', label: '小', stageWidth: 140, stageHeight: 170, scale: 0.7, offsetX: 0, offsetY: 17 },
    { key: 'medium', label: '中', stageWidth: 185, stageHeight: 239, scale: 0.9, offsetX: 0, offsetY: 29 },
    { key: 'large', label: '大', stageWidth: 214, stageHeight: 283, scale: 1.08, offsetX: 0, offsetY: 29 },
  ],
};

// 从 STAGE_SIZE_PRESETS 推导出 renderer 使用的 MODEL_STAGE_DEBUG_CONFIG 结构
const MODEL_STAGE_DEBUG_CONFIG = Object.fromEntries(
  Object.entries(STAGE_SIZE_PRESETS).map(([modelKey, list]) => {
    const bySize = {};
    list.forEach((item) => {
      bySize[item.key] = {
        stageWidth: item.stageWidth,
        stageHeight: item.stageHeight,
        scale: item.scale,
        offsetX: item.offsetX,
        offsetY: item.offsetY,
      };
    });
    return [modelKey, bySize];
  }),
);

module.exports = {
  STAGE_SIZE_PRESETS,
  MODEL_STAGE_DEBUG_CONFIG,
};

