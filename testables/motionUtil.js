/**
 * 动作工具方法（供 live2d-core 使用）
 * 所有动作名称与各模型 model3.json 中 FileReferences.Motions 键或分组名一致。
 */
const noopList = Object.freeze([]);

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * 每个模型的动作配置：
 * - tapGroups / idleGroups：优先尝试的 motionManager 分组名（用于 startRandomMotion）
 * - tapMotions / idleMotions：显式命名的动作键（用于 model.motion）
 *
 * 约定：
 * - kuromi / cinamoroll / robot：以命名动作为主，分组为辅（如果存在）
 * - mark / kaguya：完全依赖分组（model3.json 仅提供分组，不提供单独命名键）
 */
const MOTION_CONFIG_BY_MODEL = {
  kuromi: {
    tapGroups: ['Tap', 'TapBody', '', 'Idle', 'idle'],
    idleGroups: ['Idle', 'idle', '', 'Tap', 'TapBody'],
    tapMotions: [
      's-common-joy01',
      's-common-surprise01',
      's-common-surprise02',
      's-common-pose01',
      's-common-nod01',
      'face_hearteyes_01',
      'face_shy_03',
      'face_surprise_03',
      'face_smile_01',
      'face_surprise_01',
      'face_surprise_02',
    ],
    idleMotions: [
      's-common-tilthead01',
      's-common-tilthead02',
      's-common-lookdown01',
      's-common-nod01',
      'face_normal_01',
    ],
  },
  cinamoroll: {
    tapGroups: ['Tap', 'TapBody', '', 'Idle', 'idle'],
    idleGroups: ['Idle', 'idle', '', 'Tap', 'TapBody'],
    tapMotions: [
      's-common-joy01',
      's-common-munimuni01',
      's-common-pose01',
      's-common-wandahoi01',
      's-common-surprise01',
      's-common-surprise02',
      's-common-tilthead01',
      's-common-tilthead02',
      'face_smile_01',
      'face_smile_03',
      'face_sparkling_01',
      'face_surprise_01',
      'face_surprise_02',
      'face_wink_01',
      'face_wink_02',
    ],
    idleMotions: [
      's-common-tilthead01',
      's-common-tilthead02',
      's-common-tilthead03',
      's-common-tilthead04',
      's-common-lookdown01',
      's-common-blushed01',
      's-common-nod01',
      'face_normal_01',
      'face_normal_02',
      'face_smile_01',
      'face_smile_03',
      'face_wink_01',
      'face_wink_02',
    ],
  },
  robot: {
    tapGroups: ['Tap', 'TapBody', '', 'Idle', 'idle'],
    idleGroups: ['Idle', 'idle', '', 'Tap', 'TapBody'],
    tapMotions: [
      'w-dayo-joy01',
      'w-dayo-nod01',
      'w-dayo-pose',
      'w-dayo-tilthead01',
      'face_lighton_01',
      'face_lighton_02',
    ],
    idleMotions: [
      'w-dayo-lookdown01',
      'w-dayo-tilthead01',
      'w-dayo-nod01',
      'face_normal_01',
    ],
  },
  // mark：Cubism 官方示例，使用 Idle / Tap / FlickDown / FlickUp 分组
  mark: {
    tapGroups: ['Tap', 'FlickDown', 'FlickUp'],
    idleGroups: ['Idle'],
    tapMotions: noopList,
    idleMotions: noopList,
  },
  // kaguya：所有动作挂在默认分组 ""
  kaguya: {
    tapGroups: [''],
    idleGroups: [''],
    tapMotions: noopList,
    idleMotions: noopList,
  },
};

function getMotionConfig(modelKey) {
  const cfg = MOTION_CONFIG_BY_MODEL[modelKey] || MOTION_CONFIG_BY_MODEL.kuromi;
  return {
    tapGroups: Array.isArray(cfg.tapGroups) ? cfg.tapGroups.slice() : [],
    idleGroups: Array.isArray(cfg.idleGroups) ? cfg.idleGroups.slice() : [],
    tapMotions: Array.isArray(cfg.tapMotions) ? cfg.tapMotions.slice() : [],
    idleMotions: Array.isArray(cfg.idleMotions) ? cfg.idleMotions.slice() : [],
  };
}

module.exports = {
  pickRandom,
  getMotionConfig,
};
