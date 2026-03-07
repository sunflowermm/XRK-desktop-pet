/**
 * 动作工具方法（供 live2d-core 使用）
 * 所有动作名称与各模型 model3.json 中 FileReferences.Motions 键或分组名一致。
 */

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// 点击动作（名称需与 model3.json Motions 键一致）
const TAP_MOTIONS_BY_MODEL = {
  kuromi: [
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
  mark: [], // 仅用 motionManager 的 Tap 分组
  kaguya: [], // 仅用 motionManager 的 "" 分组
  cinamoroll: [
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
  robot: [
    'w-dayo-joy01',
    'w-dayo-nod01',
    'w-dayo-pose',
    'w-dayo-tilthead01',
    'face_lighton_01',
    'face_lighton_02',
  ],
};

// 空闲动作（名称需与 model3.json Motions 键一致）
const IDLE_MOTIONS_BY_MODEL = {
  kuromi: [
    's-common-tilthead01',
    's-common-tilthead02',
    's-common-lookdown01',
    's-common-nod01',
    'face_normal_01',
  ],
  mark: [],
  kaguya: [],
  cinamoroll: [
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
  robot: [
    'w-dayo-lookdown01',
    'w-dayo-tilthead01',
    'w-dayo-nod01',
    'face_normal_01',
  ],
};

function getTapMotionsForModel(modelKey) {
  const list = TAP_MOTIONS_BY_MODEL[modelKey];
  if (Array.isArray(list) && list.length > 0) return list.slice();
  return TAP_MOTIONS_BY_MODEL.kuromi.slice();
}

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
