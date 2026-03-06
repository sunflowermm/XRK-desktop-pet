/**
 * 动作工具方法（供 live2d-core 使用）
 *
 * - 不依赖 DOM，只提供纯数据与工具函数，方便后续单元测试或独立调试。
 * - 如果后续新增模型或动作，只需要在这里扩展映射表即可。
 */

/**
 * 简单的随机工具函数
 * @template T
 * @param {T[]} list
 * @returns {T | null}
 */
function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

// 点击动作（优先用于用户点击时的反馈）
const TAP_MOTIONS_BY_MODEL = {
  kuromi: [
    'tap_body_01',
    'tap_body_02',
    'tap_face_01',
    's-common-joy01',
    's-common-surprise01',
  ],
  mark: ['Tap', 'Tap2'],
  kaguya: ['tap_body_01', 'tap_body_02'],
  cinamoroll: ['tap_body_01', 'tap_body_02'],
  robot: ['tap_body_01'],
};

// 空闲动作（用于长时间无交互时的微动作/待机效果）
const IDLE_MOTIONS_BY_MODEL = {
  kuromi: [
    'idle_01',
    'idle_02',
    'idle_03',
    's-common-tilthead01',
    's-common-lookdown01',
  ],
  mark: ['Idle', 'Idle2'],
  kaguya: ['idle_01', 'idle_02'],
  cinamoroll: ['idle_01', 'idle_02'],
  robot: ['idle_01', 'idle_02'],
};

/**
 * 获取指定模型的点击动作列表
 * @param {string} modelKey
 * @returns {string[]}
 */
function getTapMotionsForModel(modelKey) {
  const list = TAP_MOTIONS_BY_MODEL[modelKey];
  if (Array.isArray(list) && list.length > 0) return list.slice();
  // 默认回退到 kuromi 的配置，保证一定有动作可播
  return TAP_MOTIONS_BY_MODEL.kuromi.slice();
}

/**
 * 获取指定模型的空闲动作列表
 * @param {string} modelKey
 * @returns {string[]}
 */
function getIdleMotionsForModel(modelKey) {
  const list = IDLE_MOTIONS_BY_MODEL[modelKey];
  if (Array.isArray(list) && list.length > 0) return list.slice();
  return IDLE_MOTIONS_BY_MODEL.kuromi.slice();
}

module.exports = {
  pickRandom,
  getTapMotionsForModel,
  getIdleMotionsForModel,
};

