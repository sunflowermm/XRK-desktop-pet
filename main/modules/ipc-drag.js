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
  let lastDragLogAt = 0;
  let cachedWorkArea = null;

  function applyDragStepFromCursor() {
    if (!isDragging || !dragDiff || !lockedWindowSize) return;
    const mainWindow = getMainWindow();
    const dragWindow = getDragWindow();
    if (!dragWindow?.isDestroyed() && !mainWindow?.isDestroyed()) {
      try {
        const point = screen.getCursorScreenPoint();

        if (!cachedWorkArea) {
          const display = screen.getDisplayNearestPoint(point);
          cachedWorkArea = display?.workArea || screen.getPrimaryDisplay().workArea;
        }
        const wa = cachedWorkArea;
        
        const mw = lockedWindowSize.width;
        const mh = lockedWindowSize.height;
        const maxX = wa.x + wa.width - mw;
        const maxY = wa.y + wa.height - mh;
        
        // 纯几何：窗口左上角 = 鼠标点 - 拖拽起点偏移
        const targetX = point.x - dragDiff.x;
        const targetY = point.y - dragDiff.y;
        
        const newX = Math.round(targetX < wa.x ? wa.x : (targetX > maxX ? maxX : targetX));
        const newY = Math.round(targetY < wa.y ? wa.y : (targetY > maxY ? maxY : targetY));
        
        // 统一用固定的 bounds（位置 + 尺寸），强行压住一切系统层面的尺寸抖动
        if (lastPosition.x !== newX || lastPosition.y !== newY) {
          dragWindow.setBounds({ x: newX, y: newY, width: mw, height: mh }, false);
          mainWindow.setBounds({ x: newX, y: newY, width: mw, height: mh }, false);
        }
        
        lastPosition.x = newX;
        lastPosition.y = newY;
        
        // 拖拽过程不再输出调试日志，避免刷屏
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
          
          // 在拖拽开始时锁定主窗口和 overlay 的内容尺寸，只做一次
          try {
            const [curMwW, curMwH] = mainWindow.getContentSize();
            if (curMwW !== lockedWindowSize.width || curMwH !== lockedWindowSize.height) {
              mainWindow.setContentSize(lockedWindowSize.width, lockedWindowSize.height);
            }
            if (dragWindow && !dragWindow.isDestroyed()) {
              const [dwW, dwH] = dragWindow.getContentSize();
              if (dwW !== lockedWindowSize.width || dwH !== lockedWindowSize.height) {
                dragWindow.setContentSize(lockedWindowSize.width, lockedWindowSize.height);
              }
            }
          } catch (_) {}
          
          if (dragWindow && !dragWindow.isDestroyed()) {
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

