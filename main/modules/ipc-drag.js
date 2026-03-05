function registerDragIpc({
  ipcMain,
  screen,
  getMainWindow,
  getDragWindow,
  syncDragWindowToMain,
  enforceFixedSizes,
  dlog,
  onDraggingChange = () => {},
  getWindowSize,
  setAllowProgrammaticResize,
}) {
  let isDragging = false;
  let dragDiff = null;
  let lockedWindowSize = null;
  let lastPosition = { x: null, y: null };
  let lastCursorPoint = { x: null, y: null };
  let velocity = { x: 0, y: 0 };
  let acceleration = { x: 0, y: 0 };
  let lastUpdateTime = 0;
  let lastDragLogAt = 0;
  let cachedWorkArea = null;
  let positionHistory = [];
  const MAX_HISTORY = 3;
  
  function updateVelocity(newPoint, deltaTime) {
    if (deltaTime <= 0 || !lastCursorPoint.x) {
      velocity.x = 0;
      velocity.y = 0;
      acceleration.x = 0;
      acceleration.y = 0;
      return;
    }
    const dx = newPoint.x - lastCursorPoint.x;
    const dy = newPoint.y - lastCursorPoint.y;
    const dt = deltaTime || 1;
    const newVx = dx / dt;
    const newVy = dy / dt;
    const newAx = (newVx - velocity.x) / dt;
    const newAy = (newVy - velocity.y) / dt;
    const alpha = 0.8;
    velocity.x = velocity.x * (1 - alpha) + newVx * alpha;
    velocity.y = velocity.y * (1 - alpha) + newVy * alpha;
    acceleration.x = acceleration.x * 0.5 + newAx * 0.5;
    acceleration.y = acceleration.y * 0.5 + newAy * 0.5;
  }
  
  function predictNextPosition(currentPoint, deltaTime) {
    if (deltaTime <= 0 || (!velocity.x && !velocity.y && !acceleration.x && !acceleration.y)) return currentPoint;
    const dt = Math.min(deltaTime * 0.001, 0.05);
    const vx = velocity.x + acceleration.x * dt;
    const vy = velocity.y + acceleration.y * dt;
    return {
      x: currentPoint.x + vx * deltaTime,
      y: currentPoint.y + vy * deltaTime
    };
  }

  function applyDragStepFromCursor() {
    if (!isDragging || !dragDiff || !lockedWindowSize) return;
    const mainWindow = getMainWindow();
    const dragWindow = getDragWindow();
    if (!dragWindow?.isDestroyed() && !mainWindow?.isDestroyed()) {
      try {
        const now = Date.now();
        const deltaTime = lastUpdateTime ? now - lastUpdateTime : 16;
        const point = screen.getCursorScreenPoint();
        
        updateVelocity(point, deltaTime);
        
        if (!cachedWorkArea) {
          const display = screen.getDisplayNearestPoint(point);
          cachedWorkArea = display?.workArea || screen.getPrimaryDisplay().workArea;
        }
        const wa = cachedWorkArea;
        
        const mw = lockedWindowSize.width;
        const mh = lockedWindowSize.height;
        const maxX = wa.x + wa.width - mw;
        const maxY = wa.y + wa.height - mh;
        
        let targetX = point.x - dragDiff.x;
        let targetY = point.y - dragDiff.y;
        
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        if (deltaTime < 25 && speed > 0.5) {
          const predictedPoint = predictNextPosition(point, deltaTime);
          const predictedX = predictedPoint.x - dragDiff.x;
          const predictedY = predictedPoint.y - dragDiff.y;
          const blend = Math.min(deltaTime * 0.04, 0.25);
          targetX = targetX * (1 - blend) + predictedX * blend;
          targetY = targetY * (1 - blend) + predictedY * blend;
        }
        
        const newX = Math.round(targetX < wa.x ? wa.x : (targetX > maxX ? maxX : targetX));
        const newY = Math.round(targetY < wa.y ? wa.y : (targetY > maxY ? maxY : targetY));
        
        if (lastPosition.x !== newX || lastPosition.y !== newY) {
          dragWindow.setPosition(newX, newY, false);
          mainWindow.setPosition(newX, newY, false);
        }
        
        lastPosition.x = newX;
        lastPosition.y = newY;
        lastCursorPoint.x = point.x;
        lastCursorPoint.y = point.y;
        lastUpdateTime = now;
        
        if (now - lastDragLogAt > 500) {
          lastDragLogAt = now;
          dlog('drag-step', { point, velocity, acceleration, target: { x: newX, y: newY } });
        }
      } catch (e) {}
    }
  }

  ipcMain.on('dragbox-drag', () => {
    applyDragStepFromCursor();
  });

  ipcMain.on('dragbox-state', (event, dragging, clickInfo) => {
    const mainWindow = getMainWindow();
    if (!mainWindow?.isDestroyed()) {
      const wasDragging = isDragging;
      isDragging = !!dragging;
      onDraggingChange(isDragging);
      
      if (isDragging && !wasDragging) {
        try {
          mainWindow.setAlwaysOnTop(true, 'screen-saver');
          const point = screen.getCursorScreenPoint();
          const [mx, my] = mainWindow.getPosition();
          const [cw, ch] = mainWindow.getContentSize();
          const dragWindow = getDragWindow();
          
          lockedWindowSize = getWindowSize?.() || { width: cw, height: ch };
          cachedWorkArea = null;
          
          if (dragWindow && !dragWindow.isDestroyed()) {
            const [dwW, dwH] = dragWindow.getContentSize();
            if (dwW !== lockedWindowSize.width || dwH !== lockedWindowSize.height) {
              dragWindow.setContentSize(lockedWindowSize.width, lockedWindowSize.height);
            }
            
            if (clickInfo?.clientX != null && clickInfo?.clientY != null) {
              const [dwX, dwY] = dragWindow.getPosition();
              dragDiff = { x: dwX + clickInfo.clientX - mx, y: dwY + clickInfo.clientY - my };
            } else {
              dragDiff = { x: point.x - (mx + cw * 0.5), y: point.y - (my + ch * 0.5) };
            }
          } else {
            dragDiff = { x: point.x - (mx + cw * 0.5), y: point.y - (my + ch * 0.5) };
          }
          
          lastPosition.x = mx;
          lastPosition.y = my;
          lastCursorPoint.x = point.x;
          lastCursorPoint.y = point.y;
          lastUpdateTime = Date.now();
          velocity.x = 0;
          velocity.y = 0;
          acceleration.x = 0;
          acceleration.y = 0;
          positionHistory = [];
          
          applyDragStepFromCursor();
        } catch (e) {
          dragDiff = null;
          lockedWindowSize = null;
        }
      } else if (!isDragging && wasDragging) {
        dragDiff = null;
        lockedWindowSize = null;
        cachedWorkArea = null;
        lastPosition.x = null;
        lastPosition.y = null;
        lastCursorPoint.x = null;
        lastCursorPoint.y = null;
        velocity.x = 0;
        velocity.y = 0;
        acceleration.x = 0;
        acceleration.y = 0;
        positionHistory = [];
        
        const expectedSize = getWindowSize?.();
        if (expectedSize?.width > 0 && expectedSize?.height > 0) {
          const [cw, ch] = mainWindow.getContentSize();
          if ((cw !== expectedSize.width || ch !== expectedSize.height) && setAllowProgrammaticResize) {
            setAllowProgrammaticResize(true);
            const b = mainWindow.getBounds();
            mainWindow.setContentSize(expectedSize.width, expectedSize.height);
            const dragWindow = getDragWindow();
            if (dragWindow && !dragWindow.isDestroyed()) {
              dragWindow.setContentSize(expectedSize.width, expectedSize.height);
              dragWindow.setPosition(b.x, b.y);
            }
            setTimeout(() => setAllowProgrammaticResize(false), 0);
          }
        }
        syncDragWindowToMain();
      }
      
      try {
        mainWindow.webContents.send('drag-state', isDragging);
      } catch (e) {}
    }
  });

  return {
    applyDragStepFromCursor,
  };
}

module.exports = {
  registerDragIpc,
};

