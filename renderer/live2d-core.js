/**
 * 桌面宠物核心渲染模块
 * 
 * 功能：
 * - 模型加载与切换
 * - 舞台尺寸与模型缩放计算
 * - 鼠标跟随（眼球/头部）
 * - 动作播放（点击/空闲/特殊互动）
 * - 调试面板参数调整
 * 
 * @module renderer/live2d-core
 */

const path = require('path');
const { ipcRenderer } = require('electron');
const { getTapMotionsForModel, getIdleMotionsForModel, pickRandom } = require('../testables/motionUtil');
const { MODEL_STAGE_DEBUG_CONFIG } = require('../stageConfig');

/** motionManager 点击类动作候选分组（用于 tap / 点击切换动作） */
const TAP_GROUP_CANDIDATES = ['Tap', 'TapBody', '', 'Idle', 'idle'];
/** motionManager 空闲类动作候选分组 */
const IDLE_GROUP_CANDIDATES = ['Idle', 'idle', '', 'Tap', 'TapBody'];

/**
 * 创建应用实例
 * @param {Object} options - 配置选项
 * @param {string} options.canvasId - Canvas 元素 ID
 * @param {string} options.loadingId - Loading 元素 ID
 * @param {string} options.initialModelKey - 初始模型键名
 * @param {string} options.initialStageSizeKey - 初始舞台尺寸键名（small/medium/large）
 * @returns {Object} 应用实例，包含 init、switchModel、onCursorPoint 等方法
 */
function createLive2DApp({
  canvasId = 'canvas',
  loadingId = 'loading',
  initialModelKey = 'kuromi',
  initialStageSizeKey = 'small',
}) {
  const initialCfg = MODEL_STAGE_DEBUG_CONFIG[initialModelKey]?.[initialStageSizeKey] || MODEL_STAGE_DEBUG_CONFIG.kuromi.small;
  let stageWidth = initialCfg.stageWidth || 150;
  let stageHeight = initialCfg.stageHeight || 160;

  // 眼球/头部跟随相关的预计算常量，避免在 ticker 中重复做开方和乘除运算
  let eyeFollowDiagonal = Math.sqrt(stageWidth * stageWidth + stageHeight * stageHeight) || 1;
  let eyeFollowMaxDistance = eyeFollowDiagonal * 0.22;
  let eyeFollowDeadZone = eyeFollowMaxDistance * 0.06;
  let eyeFollowInvDiagForHead = 1 / (eyeFollowDiagonal * 0.08 || 1);

  function recalcEyeFollowConstants() {
    eyeFollowDiagonal = Math.sqrt(stageWidth * stageWidth + stageHeight * stageHeight) || 1;
    eyeFollowMaxDistance = eyeFollowDiagonal * 0.22;
    eyeFollowDeadZone = eyeFollowMaxDistance * 0.06;
    eyeFollowInvDiagForHead = 1 / (eyeFollowDiagonal * 0.08 || 1);
  }

  const MODEL_PRESETS = {
    kuromi: 'models/kuromi/sub_sanrio_kuromi_t10.model3.json',
    mark: 'models/mark_free_zh/runtime/mark_free_t04.model3.json',
    kaguya: 'models/kaguya/object_live2d_030_101.asset.model3.json',
    robot: 'models/robot/sub_mikudayo_robot_t01.model3.json',
    cinamoroll: 'models/cinamoroll/sub_sanrio_cinnamoroll_t18.model3.json',
  };

  /**
   * 调试日志输出
   * @param {string} tag - 日志标签
   * @param {Object} payload - 日志数据
   */
  function dlog(tag, payload) {
    const isDev = process.env.npm_lifecycle_event === 'start';
    const alwaysLog = ['model-loading', 'model-loaded', 'model-load-error', 'stage-debug-patch-applied'];
    if (isDev || alwaysLog.includes(tag)) {
      const ts = new Date().toISOString();
      const safe = payload ? JSON.stringify(payload).slice(0, 2000) : '';
      console.log(`[desktop-pet][renderer][${ts}][${tag}] ${safe}`);
    }
  }
  
  /**
   * 安全的 IPC 发送（统一封装，避免重复检查）
   * @param {string} channel - IPC 通道名
   * @param {*} data - 发送的数据
   */
  function safeIpcSend(channel, data) {
    ipcRenderer?.send(channel, data);
  }
  
  function canPlayMotion(modelInstance) {
    return modelInstance?.motion && typeof modelInstance.motion === 'function';
  }

  // 软限幅函数，放在外层避免在 ticker 中重复创建闭包
  const clampSoft = (v) => Math.max(-1, Math.min(1, Math.atan(v * 1.2) * (2 / Math.PI)));

  function playMotionSafely(motionName, priority, tag) {
    if (!motionName || !canPlayMotion(model)) return false;
    try {
      model.motion(motionName, 0, priority);
      dlog(tag, { model: currentModelKey, motion: motionName });
      return true;
    } catch (e) {
      dlog(`${tag}-error`, { model: currentModelKey, motion: motionName, error: String(e) });
      return false;
    }
  }

  /**
   * 从 motionManager 中随机播放一个动作（优先按分组，失败则尝试全局）
   * @param {string[]} groupCandidates - 候选分组名，例如 ['Tap', 'TapBody', 'Idle', '']
   * @param {number} priority - MotionPriority
   * @param {string} tag - 调试日志标签
   */
  function playRandomManagerMotion(groupCandidates, priority, tag) {
    const mm = model?.internalModel?.motionManager;
    if (!mm || !Array.isArray(groupCandidates) || !groupCandidates.length) return false;
    for (const group of groupCandidates) {
      try {
        mm.startRandomMotion(group, priority);
        dlog(tag, { model: currentModelKey, group });
        return true;
      } catch (_) {}
    }
    return false;
  }

  /**
   * 先按分组尝试 motionManager，失败则用 fallback 列表随机播一条（用于 tap/idle 等统一逻辑）
   */
  function playWithManagerOrFallback(groupCandidates, fallbackList, fallbackPriority, tag) {
    if (playRandomManagerMotion(groupCandidates, fallbackPriority, tag)) return true;
    if (fallbackList?.length) {
      return playMotionSafely(pickRandom(fallbackList), fallbackPriority, tag);
    }
    return false;
  }

  let currentModelKey = initialModelKey;
  let currentStageSizeKey = initialStageSizeKey;
  let app;
  let model;
  let mouseX = 0;
  let mouseY = 0;
  let tickerBound = false;
  let blinkTimer = null;
  let modelBaseSize = null; // { width, height } at scale=1
  let modelBaseScale = 1; // 基于基准窗口尺寸的基础缩放（固定值，不随档位变化）
  let eyeXParamIds = [];
  let eyeYParamIds = [];
  let headXParamIds = [];
  let headYParamIds = [];
  let tapMotions = getTapMotionsForModel(currentModelKey);
  let idleMotions = getIdleMotionsForModel(currentModelKey);
  let lastInteractionAt = Date.now();
  let idleTimer = null;
  let smoothEyeX = 0;
  let smoothEyeY = 0;
  let smoothHeadX = 0;
  let smoothHeadY = 0;
  let lastMicroMotionAt = 0;
  let lastStageLogAt = 0;
  
  /**
   * 运行时调试覆盖（仅内存，不污染共享配置）
   * 用于调试面板的临时修改，重启后恢复原始配置
   * @type {Object} { [modelKey]: { [sizeKey]: { stageWidth, stageHeight, scale, offsetX, offsetY } } }
   */
  let runtimeDebugOverrides = {};

  /**
   * 应用调试面板的参数补丁（仅影响运行时，不修改共享配置）
   * @param {Object} patch - 参数补丁 { stageWidth?, stageHeight?, scale?, offsetX?, offsetY? }
   */
  function applyStageDebugPatch(patch) {
    if (!patch || typeof patch !== 'object') return;
    requestAnimationFrame(() => {
      const modelKey = currentModelKey;
      const sizeKey = currentStageSizeKey;
      const prevCfg = getStageDebugConfig(modelKey, sizeKey);
      const merged = {
        stageWidth: (typeof patch.stageWidth === 'number' && patch.stageWidth > 0) ? patch.stageWidth : prevCfg.stageWidth,
        stageHeight: (typeof patch.stageHeight === 'number' && patch.stageHeight > 0) ? patch.stageHeight : prevCfg.stageHeight,
        scale: (typeof patch.scale === 'number' && patch.scale > 0) ? patch.scale : prevCfg.scale,
        offsetX: (typeof patch.offsetX === 'number') ? patch.offsetX : prevCfg.offsetX,
        offsetY: (typeof patch.offsetY === 'number') ? patch.offsetY : prevCfg.offsetY,
      };

      if (!runtimeDebugOverrides[modelKey]) runtimeDebugOverrides[modelKey] = {};
      runtimeDebugOverrides[modelKey][sizeKey] = merged;

      applyStageSize();
      fitModelToWindow();
      positionModel();
      safeIpcSend('renderer-init-stage-size', { width: merged.stageWidth, height: merged.stageHeight });
    });
  }

  /**
   * 获取舞台调试配置（优先运行时覆盖，否则使用共享配置）
   * @param {string} modelKey - 模型键名
   * @param {string} sizeKey - 尺寸键名（small/medium/large）
   * @returns {Object} { stageWidth, stageHeight, scale, offsetX, offsetY }
   */
  function getStageDebugConfig(modelKey = currentModelKey, sizeKey = currentStageSizeKey) {
    const runtimeOverride = runtimeDebugOverrides[modelKey]?.[sizeKey];
    if (runtimeOverride) return { ...runtimeOverride };
    
    const byModel = MODEL_STAGE_DEBUG_CONFIG[modelKey] || MODEL_STAGE_DEBUG_CONFIG.kuromi;
    const bySize = byModel[sizeKey] || byModel.small || MODEL_STAGE_DEBUG_CONFIG.kuromi.small;
    
    return {
      stageWidth: bySize.stageWidth || 150,
      stageHeight: bySize.stageHeight || 160,
      scale: bySize.scale || 1,
      offsetX: bySize.offsetX || 0,
      offsetY: bySize.offsetY || 0,
    };
  }
  
  /**
   * 计算基础缩放系数（基于模型基础尺寸和基准窗口尺寸）
   * 使用固定的基准尺寸（small档位）确保不同档位模型大小一致
   * @param {number} modelWidth - 模型基础宽度
   * @param {number} modelHeight - 模型基础高度
   * @param {string} modelKey - 模型键名
   * @returns {number} 基础缩放系数
   */
  function calculateBaseScale(modelWidth, modelHeight, modelKey) {
    if (!modelWidth || !modelHeight || !modelKey) return 1;
    const baseCfg = MODEL_STAGE_DEBUG_CONFIG[modelKey]?.small || MODEL_STAGE_DEBUG_CONFIG.kuromi.small;
    if (!baseCfg) return 1;
    return Math.max(0.1, Math.min(baseCfg.stageWidth / modelWidth, baseCfg.stageHeight / modelHeight));
  }

  /**
   * 应用舞台尺寸配置并调整 PIXI 渲染器大小
   */
  function applyStageSize() {
    const cfg = getStageDebugConfig();
    stageWidth = cfg.stageWidth;
    stageHeight = cfg.stageHeight;
    recalcEyeFollowConstants();
    app?.renderer?.resize(stageWidth, stageHeight);
    
    const now = Date.now();
    if (now - lastStageLogAt > 1000) {
      lastStageLogAt = now;
      dlog('stage-layout', {
        model: currentModelKey,
        sizeKey: currentStageSizeKey,
        stage: { width: stageWidth, height: stageHeight },
        cfg,
        baseScale: modelBaseScale,
      });
    }
  }

  /**
   * 等待库加载完成
   * @param {Function} checkFn - 检查函数，返回 true 表示已加载
   * @param {number} timeout - 超时时间（毫秒）
   */
  function waitForLibrary(checkFn, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        if (checkFn()) resolve();
        else if (Date.now() - startTime > timeout) reject(new Error('库加载超时'));
        else setTimeout(check, 100);
      };
      check();
    });
  }

  /**
   * 初始化应用
   * 1. 等待 PIXI 和模型库加载
   * 2. 创建 PIXI Application
   * 3. 加载初始模型
   * 4. 绑定事件监听器
   */
  async function init() {
    const loadingEl = document.getElementById(loadingId);
    const canvas = document.getElementById(canvasId);
    if (!loadingEl || !canvas) {
      throw new Error('缺少 canvas 或 loading 元素');
    }

    try {
      loadingEl.textContent = '正在加载库...';
      await waitForLibrary(() => window.PIXI);
      await waitForLibrary(() => window.PIXI?.live2d);

      const PIXI = window.PIXI;
      const Live2DModel = PIXI?.live2d?.Live2DModel;

      if (!Live2DModel) {
        throw new Error('PIXI.live2d 未正确加载，请检查 libs/index.min.js 与 live2d.js');
      }

      loadingEl.textContent = '正在初始化...';

      const stageCfg = getStageDebugConfig();
      stageWidth = stageCfg.stageWidth;
      stageHeight = stageCfg.stageHeight;
      recalcEyeFollowConstants();
      app = new PIXI.Application({
        view: canvas,
        width: stageWidth,
        height: stageHeight,
        backgroundColor: 0x000000,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        autoStart: true,
        powerPreference: 'high-performance',
        sharedTicker: false,
        sharedLoader: false,
        preserveDrawingBuffer: false,
        clearBeforeRender: true,
        forceCanvas: false,
        roundPixels: true,
      });

      safeIpcSend('renderer-init-stage-size', {
        width: Math.round(stageWidth),
        height: Math.round(stageHeight),
      });

      loadingEl.textContent = '正在加载模型...';
      await loadLive2DModel(Live2DModel);
      loadingEl.style.display = 'none';
      dlog('pixi-ready', { screen: app?.screen, dpr: window.devicePixelRatio });

      bindTickerOnce();
      armIdleTimer();
      // 单击由 overlay 的 overlay-tap → ipc-bridge → playTapMotion 触发，主窗口 setIgnoreMouseEvents 后 canvas 收不到点击，此处不重复绑定
    } catch (err) {
      dlog('init-error', { message: err?.message, stack: err?.stack });
      showError(`初始化失败：${err?.message || '未知错误'}`);
      throw err;
    }
  }

  /**
   * 加载模型
   * @param {Function} Live2DModel - 模型构造函数
   */
  async function loadLive2DModel(Live2DModel) {
    const resolvedPath = path.resolve(__dirname, '..', MODEL_PRESETS[currentModelKey]);
    let modelUrl = resolvedPath.replace(/\\/g, '/');
    if (!modelUrl.startsWith('file://')) {
      modelUrl = process.platform === 'win32' ? `file:///${modelUrl}` : `file://${modelUrl}`;
    }

    try {
      model = await Live2DModel.from(modelUrl);
    } catch (e) {
      showError(`模型加载失败：${currentModelKey}\n${e?.message || e}`);
      throw e;
    }
    model.visible = true;
    model.alpha = 1;
    app.stage.addChild(model);
    model.interactive = false;
    
    requestAnimationFrame(() => {
      setModelPivotToCenter();
      cacheModelBaseSize();
      fitModelToWindow();
      positionModel();
    });

    mouseX = app.screen.width / 2;
    mouseY = app.screen.height / 2;

    startEyeBlink();
    detectAvailableParams();
  }

  /**
   * 绑定 PIXI ticker 用于眼球/头部跟随（仅绑定一次）
   * 优化：使用独立ticker，设置更高的优先级
   */
  function bindTickerOnce() {
    if (tickerBound || !app) return;
    tickerBound = true;
    // 对桌面宠物而言 60FPS 已足够，适当降低上限减少 CPU / GPU 占用
    app.ticker.maxFPS = 60;
    app.ticker.minFPS = 30;
    app.ticker.speed = 1.0;
    app.ticker.add(() => updateEyeFollow());
  }

  /**
   * 切换模型
   * @param {string} nextKey - 目标模型键名
   */
  async function switchModel(nextKey) {
    if (!MODEL_PRESETS[nextKey] || nextKey === currentModelKey || !app) return;

    const Live2DModel = window.PIXI?.live2d?.Live2DModel;
    if (!Live2DModel) return;

    // 先清理旧模型
    if (model) {
      app.stage.removeChild(model);
      model.destroy({ children: true, texture: true, baseTexture: true });
      model = null;
    }

    // 完全重置所有状态，避免旧模型参数影响新模型
    modelBaseSize = null;
    modelBaseScale = 1;
    eyeXParamIds = [];
    eyeYParamIds = [];
    headXParamIds = [];
    headYParamIds = [];
    smoothEyeX = 0;
    smoothEyeY = 0;
    smoothHeadX = 0;
    smoothHeadY = 0;

    // 更新模型相关配置
    currentModelKey = nextKey;
    tapMotions = getTapMotionsForModel(currentModelKey);
    idleMotions = getIdleMotionsForModel(currentModelKey);

    // 使用新模型的配置
    const cfg = getStageDebugConfig(currentModelKey, currentStageSizeKey);
    applyStageSize();
    safeIpcSend('renderer-init-stage-size', {
      width: Math.round(cfg.stageWidth),
      height: Math.round(cfg.stageHeight),
    });
    
    await loadLive2DModel(Live2DModel);
    
    safeIpcSend('model-switched', {
      modelKey: currentModelKey,
      width: Math.round(cfg.stageWidth),
      height: Math.round(cfg.stageHeight),
    });
    
    safeIpcSend('debug-request-stage-config');
  }

  /**
   * 设置模型枢轴点到中心（用于旋转和缩放）
   */
  function setModelPivotToCenter() {
    if (!model) return;
    const b = model.getLocalBounds();
    model.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
  }

  /**
   * 缓存模型基础尺寸（scale=1 时的原始尺寸）并计算基础缩放系数
   * 基础缩放基于 small 档位，确保不同档位模型大小一致
   */
  function cacheModelBaseSize() {
    if (!model) return;
    const originalScale = model.scale.x;
    model.scale.set(1, 1);
    const b = model.getLocalBounds();
    modelBaseSize = { 
      width: Math.max(1, b.width || 100), 
      height: Math.max(1, b.height || 100) 
    };
    model.scale.set(originalScale, originalScale);
    
    // 使用 small 档位作为基准计算基础缩放，确保不同档位模型大小一致
    modelBaseScale = calculateBaseScale(
      modelBaseSize.width,
      modelBaseSize.height,
      currentModelKey
    );
  }

  /**
   * 根据舞台配置调整模型缩放
   * 计算公式：最终缩放 = 基础缩放（基于small档位） × 配置缩放（档位调整）
   */
  function fitModelToWindow() {
    if (!model || !app) return;
    if (!modelBaseSize || !modelBaseScale || modelBaseScale <= 0.1) {
      cacheModelBaseSize();
    }
    const cfg = getStageDebugConfig(currentModelKey, currentStageSizeKey);
    model.scale.set(modelBaseScale * cfg.scale, modelBaseScale * cfg.scale);
  }

  /**
   * 根据配置的偏移量定位模型到舞台中心
   */
  function positionModel() {
    if (!model || !app) return;
    // 明确使用当前模型和大小档位的配置
    const cfg = getStageDebugConfig(currentModelKey, currentStageSizeKey);
    model.position.set(stageWidth / 2 + cfg.offsetX, stageHeight / 2 + cfg.offsetY);
  }

  /**
   * 检测模型可用的参数 ID（眼球/头部跟随）
   */
  function detectAvailableParams() {
    if (!model?.internalModel?.coreModel) return;
    const core = model.internalModel.coreModel;

    const pick = (candidates, value) =>
      candidates.filter((id) => {
        try {
          core.setParameterValueById(id, value);
          return true;
        } catch (e) {
          return false;
        }
      });

    eyeXParamIds = pick(['ParamEyeBallX', 'EyeBallX'], 0);
    eyeYParamIds = pick(['ParamEyeBallY', 'EyeBallY'], 0);
    headXParamIds = pick(['ParamAngleX', 'AngleX'], 0);
    headYParamIds = pick(['ParamAngleY', 'AngleY'], 0);
  }

  /**
   * 启动眨眼动画（定时器循环）
   * 优先使用模型特定的眨眼动作，失败则降级到参数闭眼
   */
  const BLINK_MOTIONS_BY_MODEL = {
    kuromi: ['face_closeeye_01', 'face_closeeye_02'],
    cinamoroll: ['face_closeeye_01', 'face_closeeye_02', 'face_closeeye_03', 'face_closeeye_04', 'face_closeeye_05'],
  };

  function startEyeBlink() {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = null;
    const blink = () => {
      if (!model?.internalModel) return;
      const blinkList = BLINK_MOTIONS_BY_MODEL[currentModelKey];
      const randomBlink = blinkList?.length ? pickRandom(blinkList) : null;

      if (randomBlink && canPlayMotion(model)) {
        try {
          model.motion(randomBlink, 0, window.PIXI.live2d.MotionPriority.IDLE);
        } catch (_) {
          setBlinkParams(0);
          setTimeout(() => setBlinkParams(1), 150);
        }
      } else {
        setBlinkParams(0);
        setTimeout(() => setBlinkParams(1), 150);
      }
      blinkTimer = setTimeout(blink, 2000 + Math.random() * 3000);
    };
    function setBlinkParams(value) {
      if (!model?.internalModel) return;
      const core = model.internalModel.coreModel;
      try {
        core.setParameterValueById('ParamEyeLOpen', value);
        core.setParameterValueById('ParamEyeROpen', value);
      } catch (_) {}
    }
    blink();
  }

  /**
   * 更新眼球/头部跟随（由 PIXI ticker 每帧调用）
   * 鼠标坐标映射到舞台空间，用归一化距离 + atan 软限幅，帧率无关平滑
   */
  function updateEyeFollow() {
    if (!model?.internalModel || !app?.view) return;

    const modelX = model.x;
    const modelY = model.y;
    let dx = mouseX - modelX;
    let dy = mouseY - modelY;

    const maxDistance = eyeFollowMaxDistance;
    const deadZone = eyeFollowDeadZone;
    if (Math.abs(dx) < deadZone) dx = 0;
    if (Math.abs(dy) < deadZone) dy = 0;

    const rawX = dx / maxDistance;
    const rawY = -dy / maxDistance;
    const targetEyeX = clampSoft(rawX);
    const targetEyeY = clampSoft(rawY);

    const core = model.internalModel.coreModel;
    const motionManager = model.internalModel.motionManager;
    const isMotionPlaying = motionManager && !motionManager.isFinished();

    const dt = app.ticker?.deltaTime ?? 1;
    const eyeSpeed = (isMotionPlaying ? 4 : 8) * (dt / 60);
    const headSpeed = (isMotionPlaying ? 2.5 : 5) * (dt / 60);
    const eyeLerp = 1 - Math.exp(-eyeSpeed);
    const headLerp = 1 - Math.exp(-headSpeed);

    smoothEyeX += (targetEyeX - smoothEyeX) * eyeLerp;
    smoothEyeY += (targetEyeY - smoothEyeY) * eyeLerp;

    const headScale = 0.12;
    const headRange = 18;
    const baseHeadX = Math.max(-headRange, Math.min(headRange, dx * eyeFollowInvDiagForHead)) * headScale;
    const baseHeadY = Math.max(-headRange, Math.min(headRange, -dy * eyeFollowInvDiagForHead)) * headScale;
    smoothHeadX += (baseHeadX - smoothHeadX) * headLerp;
    smoothHeadY += (baseHeadY - smoothHeadY) * headLerp;

    eyeXParamIds.forEach((id) => core.setParameterValueById(id, smoothEyeX));
    eyeYParamIds.forEach((id) => core.setParameterValueById(id, smoothEyeY));
    headXParamIds.forEach((id) => core.setParameterValueById(id, smoothHeadX));
    headYParamIds.forEach((id) => core.setParameterValueById(id, smoothHeadY));
  }

  /**
   * 处理鼠标位置更新（由主进程通过 IPC 发送）
   * @param {Object} payload - { point: {x, y}, bounds: {x, y, width, height} }
   */
  function onCursorPoint(payload) {
    if (!payload?.point || !payload?.bounds || !app?.view) return;
    const { point, bounds } = payload;

    const kx = stageWidth / (bounds.width || 1);
    const ky = stageHeight / (bounds.height || 1);
    let targetX = (point.x - bounds.x) * kx;
    let targetY = (point.y - bounds.y) * ky;
    targetX = Math.max(0, Math.min(stageWidth, targetX));
    targetY = Math.max(0, Math.min(stageHeight, targetY));

    const lerp = 0.2;
    mouseX += (targetX - mouseX) * lerp;
    mouseY += (targetY - mouseY) * lerp;

    lastInteractionAt = Date.now();
    if (lastInteractionAt - lastMicroMotionAt > 9000) {
      lastMicroMotionAt = lastInteractionAt;
      tryPlayMicroMotion();
    }
  }

  function onWindowResize() {
    if (!app || !model) return;
    positionModel();
  }

  /**
   * 播放特殊动作（名称均来自 motionUtil，与 model3.json 一致）
   */
  function playSpecialMotion(kind = 'special1') {
    if (!model) return;
    const priorityForce = window.PIXI.live2d.MotionPriority.FORCE;
    const groups = kind === 'micro' ? IDLE_GROUP_CANDIDATES : TAP_GROUP_CANDIDATES;
    if (playRandomManagerMotion(groups, priorityForce, 'play-special-manager')) return;
    if (kind === 'micro' && idleMotions?.length) {
      playMotionSafely(pickRandom(idleMotions), window.PIXI.live2d.MotionPriority.IDLE, 'play-special-idle');
      return;
    }
    if (tapMotions?.length) {
      playMotionSafely(pickRandom(tapMotions), priorityForce, 'play-special-tap');
    }
  }

  /**
   * 尝试播放微动作（鼠标悬停时触发，使用 idleMotions）
   */
  function tryPlayMicroMotion() {
    if (!model) return;
    const priorityIdle = window.PIXI.live2d.MotionPriority.IDLE;
    if (playRandomManagerMotion(IDLE_GROUP_CANDIDATES, priorityIdle, 'play-micro-manager')) return;
    if (idleMotions?.length) {
      playMotionSafely(pickRandom(idleMotions), priorityIdle, 'play-micro');
    }
  }

  /**
   * 尝试播放点击动作（用户点击模型时触发，由 overlay-tap 驱动）
   * 优先从 tapMotions 列表随机播一条，保证每次点击能切换到不同动作；失败再走 motionManager 分组
   */
  function tryPlayTapMotion() {
    if (!model) return;
    const priorityForce = window.PIXI.live2d.MotionPriority.FORCE;
    let played = false;
    if (tapMotions?.length) {
      played = playMotionSafely(pickRandom(tapMotions), priorityForce, 'play-tap');
    }
    if (!played) {
      played = playRandomManagerMotion(TAP_GROUP_CANDIDATES, priorityForce, 'play-tap-manager');
    }
    if (played) {
      lastInteractionAt = Date.now();
      armIdleTimer();
    }
  }

  /**
   * 显示错误信息
   * @param {string} message - 错误消息
   */
  function showError(message) {
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.style.display = 'block';
      loadingEl.style.color = '#ff4444';
      loadingEl.textContent = `错误：${message}`;
    }
  }

  /**
   * 启动空闲动作定时器（4-8 秒随机间隔）
   */
  function armIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const delay = 4000 + Math.random() * 4000;
    idleTimer = setTimeout(() => {
      const now = Date.now();
      if (now - lastInteractionAt >= delay * 0.8) {
        tryPlayIdleMotion();
      }
      armIdleTimer();
    }, delay);
  }

  /**
   * 尝试播放空闲动作（定时器触发）
   */
  function tryPlayIdleMotion() {
    if (!model) return;
    playWithManagerOrFallback(
      IDLE_GROUP_CANDIDATES,
      idleMotions,
      window.PIXI.live2d.MotionPriority.IDLE,
      'play-idle',
    );
  }

  return {
    init,
    switchModel,
    onCursorPoint,
    onWindowResize,
    playTapMotion: tryPlayTapMotion,
    playSpecialMotion,
    getCurrentStageDebugConfig: () => {
      const cfg = getStageDebugConfig();
      return {
        ...cfg,
        modelKey: currentModelKey,
        sizeKey: currentStageSizeKey,
      };
    },
    setStageSizeKey(nextKey) {
      if (!nextKey || nextKey === currentStageSizeKey) return;
      
      // 切换大小档位时，重置模型尺寸缓存，使用新档位的配置重新计算
      currentStageSizeKey = String(nextKey);
      modelBaseSize = null;
      
      const cfg = getStageDebugConfig(currentModelKey, currentStageSizeKey);
      applyStageSize();
      
      // 确保模型存在后再调整
      if (model && app) {
        cacheModelBaseSize();
        fitModelToWindow();
        positionModel();
      }
      
      const sizeData = { width: Math.round(cfg.stageWidth), height: Math.round(cfg.stageHeight) };
      safeIpcSend('renderer-init-stage-size', sizeData);
      safeIpcSend('stage-size-switched', { stageSizeKey: nextKey, ...sizeData });
      safeIpcSend('debug-request-stage-config');
    },
    updateStageDebugConfig: (patch) => applyStageDebugPatch(patch),
  };
}

module.exports = {
  createLive2DApp,
};

