const { ipcRenderer } = require('electron');

const box = document.getElementById('box');
const handle = document.getElementById('handle');

let isLocked = false;
ipcRenderer.on('lock-state-changed', (event, locked) => {
  isLocked = locked;
  updateLockState();
});

function updateLockState() {
  const value = isLocked ? 'none' : 'auto';
  box.style.pointerEvents = value;
  handle.style.pointerEvents = value;
}

ipcRenderer.invoke('get-lock-state').then((locked) => {
  isLocked = locked || false;
  updateLockState();
}).catch(updateLockState);

const DRAG_THRESHOLD_PX = 5;

let pointerId = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
/** 本次手势是否发生过拖拽（用于区分点击与拖拽，避免拖拽松开后误触发 tap） */
let didDragThisGesture = false;
/** pointerdown 时的按键，用于 pointerup 时仅对左键发送 tap */
let pointerDownButton = -1;

const DEBUG_RUN = process.env.npm_lifecycle_event === 'start';
function dlog(tag, payload) {
  if (!DEBUG_RUN) return;
  try {
    const ts = new Date().toISOString();
    const safe = payload ? JSON.stringify(payload).slice(0, 1200) : '';
    console.log(`[desktop-pet][overlay][${ts}][${tag}] ${safe}`);
  } catch (_) {}
}

const dragChannel = {
  start(clientX, clientY) {
    ipcRenderer.send('dragbox-state', true, { clientX, clientY });
    ipcRenderer.send('dragbox-drag');
  },
  step() {
    ipcRenderer.send('dragbox-drag');
  },
  end() {
    ipcRenderer.send('dragbox-state', false);
  },
};

function onPointerDown(e) {
  if (isLocked) return;
  pointerId = e.pointerId;
  pointerDownButton = e.button;
  isDragging = false;
  didDragThisGesture = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  try { (e.target || handle).setPointerCapture(pointerId); } catch (err) {}
  dlog('pointerdown', { pointerId, button: e.button, clientX: e.clientX, clientY: e.clientY });
}

handle.addEventListener('pointerdown', onPointerDown);
box.addEventListener('pointerdown', (e) => {
  if (e.target === handle) return;
  onPointerDown(e);
});

function onPointerMove(e) {
  if (pointerId !== null && e.pointerId !== pointerId) return;
  if (e.buttons === 0) {
    endDrag(e);
    return;
  }
  if (!isDragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      isDragging = true;
      didDragThisGesture = true;
      dragChannel.start(dragStartX, dragStartY);
    }
  }
  if (isDragging) dragChannel.step();
}

handle.addEventListener('pointermove', onPointerMove);
box.addEventListener('pointermove', onPointerMove);

function endDrag(e) {
  if (pointerId === null) return;
  const wasLeftClick = pointerDownButton === 0;
  if (isDragging) {
    dragChannel.end();
    dlog('pointerup', {});
  } else if (wasLeftClick && !didDragThisGesture) {
    sendTap();
  }
  isDragging = false;
  pointerDownButton = -1;
  try { (e?.target || handle).releasePointerCapture(pointerId); } catch (err) {}
  pointerId = null;
}

handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);
box.addEventListener('pointerup', endDrag);
box.addEventListener('pointercancel', endDrag);

box.addEventListener('contextmenu', (e) => {
  if (isLocked) return;
  e.preventDefault();
  e.stopPropagation();
  ipcRenderer.invoke('get-window-position').then((windowPos) => {
    ipcRenderer.send('show-menu-window', windowPos.x + e.clientX, windowPos.y + e.clientY);
  }).catch(() => {
    ipcRenderer.send('show-menu-window', e.clientX, e.clientY);
  });
});

document.addEventListener('pointerdown', (e) => {
  if (isLocked || isDragging || e.button !== 0) return;
  try {
    ipcRenderer.send('close-menu-window');
  } catch (_) {}
}, true);

function sendTap() {
  dlog('tap-click', { from: 'overlay' });
  ipcRenderer.send('overlay-tap');
}