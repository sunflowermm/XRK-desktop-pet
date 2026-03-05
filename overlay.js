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

let pointerId = null;
let isDragging = false;

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

function beginDrag(e) {
  if (e.button !== 0 || isDragging || isLocked) return;
  e.preventDefault();
  e.stopPropagation();

  pointerId = e.pointerId;
  isDragging = true;
  try { (e.target || handle).setPointerCapture(pointerId); } catch (err) {}
  dlog('pointerdown', { pointerId, clientX: e.clientX, clientY: e.clientY });
  dragChannel.start(e.clientX, e.clientY);
}

handle.addEventListener('pointerdown', beginDrag);
box.addEventListener('pointerdown', (e) => {
  if (e.target === handle) return;
  beginDrag(e);
});

function onPointerMove(e) {
  if (!isDragging || (pointerId !== null && e.pointerId !== pointerId)) return;
  if (e.buttons === 0) {
    endDrag(e);
    return;
  }
  dragChannel.step();
}

handle.addEventListener('pointermove', onPointerMove);
box.addEventListener('pointermove', onPointerMove);

function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  if (pointerId !== null) {
    try { (e?.target || handle).releasePointerCapture(pointerId); } catch (err) {}
    pointerId = null;
  }
  dlog('pointerup', {});
  dragChannel.end();
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

function handleClick(e) {
  if (e.button !== 0 || isDragging || isLocked) return;
  setTimeout(() => sendTap(), 50);
}

handle.addEventListener('click', handleClick);
box.addEventListener('click', (e) => {
  if (e.target === handle) return;
  handleClick(e);
});
