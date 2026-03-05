// 针对不同模型，定义“点击（Tap）时可以触发”的动作列表
function getTapMotionsForModel(modelKey) {
  if (modelKey === 'mark') {
    // 对应 mark_free_t04.model3.json 中的 "Motions.*"：点击时在所有主动动作中随机
    return ['Tap', 'FlickDown', 'FlickUp'];
  }
  if (modelKey === 'kuromi') {
    // 对应 Kuromi model3.json 中的全部表情动作（face_* 系列）
    return [
      'face_smile_01',
      'face_smile_04',
      'face_hearteyes_01',
      'face_surprise_01',
      'face_shy_01',
      'face_angry_01',
      'face_angry_01_nokira',
      'face_angry_02',
      'face_angry_02_nokira',
      'face_closeeye_01',
      'face_closeeye_01_nokira',
      'face_closeeye_02',
      'face_closeeye_02_nokira',
      'face_disgust_01',
      'face_disgust_01_nokira',
      'face_hearteyes_01_nokira',
      'face_normal_01',
      'face_normal_01_nokira',
      'face_sad_01',
      'face_sad_01_nokira',
      'face_shy_01_nokira',
      'face_shy_03',
      'face_shy_03_nokira',
      'face_shy_04',
      'face_shy_04_nokira',
      'face_smallmouth_01',
      'face_smallmouth_01_nokira',
      'face_smile_01_nokira',
      'face_smile_04_nokira',
      'face_surprise_01_nokira',
      'face_surprise_02',
      'face_surprise_02_nokira',
      'face_surprise_03',
      'face_surprise_03_nokira',
      'face_surprise_04',
      'face_surprise_04_nokira',
    ];
  }
  if (modelKey === 'kaguya') {
    // Kaguya 模型的 motion3 列表没有显式的分组名称，点击/空闲动作在 renderer 中特殊处理为随机动作
    return [];
  }
  if (modelKey === 'robot') {
    // 对应 sub_mikudayo_robot_t01.model3.json 中的所有动作
    return [
      'w-dayo-attack01',
      'w-dayo-attack02',
      'w-dayo-attack03',
      'w-dayo-attack04',
      'w-dayo-damage01',
      'w-dayo-damage02',
      'w-dayo-joy01',
      'w-dayo-lookdown01',
      'w-dayo-nod01',
      'w-dayo-pose',
      'w-dayo-shakehead01',
      'w-dayo-tilthead01',
      'face_lighton_01',
      'face_lighton_02',
      'face_normal_01',
    ];
  }
  if (modelKey === 'cinamoroll') {
    // 对应 sub_sanrio_cinnamoroll_t18.model3.json 中的全部表情动作（face_* 系列）
    return [
      'face_closeeye_01',
      'face_closeeye_01_nostar',
      'face_closeeye_02',
      'face_closeeye_02_nostar',
      'face_closeeye_03',
      'face_closeeye_03_nostar',
      'face_closeeye_04',
      'face_closeeye_04_nostar',
      'face_closeeye_05',
      'face_closeeye_05_nostar',
      'face_cry_01',
      'face_cry_01_nostar',
      'face_normal_01',
      'face_normal_01_nostar',
      'face_normal_02',
      'face_normal_02_nostar',
      'face_sad_01',
      'face_sad_01_nostar',
      'face_smallmouth_01',
      'face_smallmouth_01_nostar',
      'face_smile_01',
      'face_smile_01_nostar',
      'face_smile_03',
      'face_smile_03_nostar',
      'face_sparkling_01',
      'face_sparkling_01_nostar',
      'face_surprise_01',
      'face_surprise_01_nostar',
      'face_surprise_02',
      'face_surprise_02_nostar',
      'face_wink_01',
      'face_wink_01_nostar',
      'face_wink_02',
      'face_wink_02_nostar',
    ];
  }
  return [];
}

// 针对不同模型，定义“空闲时可以播”的动作列表
function getIdleMotionsForModel(modelKey) {
  if (modelKey === 'mark') {
    // 对应 mark_free_t04.model3.json 中的 "Motions.Idle"
    return ['Idle'];
  }
  if (modelKey === 'kuromi') {
    // Kuromi 的通用动作全部用于 idle / 轻量互动
    return [
      's-common-blushed01',
      's-common-joy01',
      's-common-lookdown01',
      's-common-nod01',
      's-common-pose01',
      's-common-sad01',
      's-common-shakehead01',
      's-common-surprise01',
      's-common-surprise02',
      's-common-tilthead01',
      's-common-tilthead02',
    ];
  }
  if (modelKey === 'kaguya') {
    // 让 renderer 侧通过 motionManager.startRandomMotion('', PRIORITY) 处理空闲动作
    return [];
  }
  if (modelKey === 'robot') {
    // Robot 模型：选择偏“轻量”的动作作为空闲/轻微动作
    return [
      'w-dayo-joy01',
      'w-dayo-lookdown01',
      'w-dayo-nod01',
      'w-dayo-pose',
      'w-dayo-shakehead01',
      'w-dayo-tilthead01',
      'face_lighton_01',
      'face_lighton_02',
      'face_normal_01',
    ];
  }
  if (modelKey === 'cinamoroll') {
    // Cinnamoroll：使用 s-common 系列作为空闲/轻量互动动作
    return [
      's-common-blushed01',
      's-common-joy01',
      's-common-lookdown01',
      's-common-munimuni01',
      's-common-nod01',
      's-common-pose01',
      's-common-sad01',
      's-common-shakehead01',
      's-common-surprise01',
      's-common-surprise02',
      's-common-tilthead01',
      's-common-tilthead02',
      's-common-tilthead03',
      's-common-tilthead04',
      's-common-wandahoi01',
      's-common-wink01',
    ];
  }
  return [];
}

function pickRandom(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

module.exports = {
  getTapMotionsForModel,
  getIdleMotionsForModel,
  pickRandom,
};

