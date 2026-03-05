function computeDragTarget({ cursorPoint, dragDiff, workArea, windowSize }) {
  const mw = windowSize.width;
  const mh = windowSize.height;

  let targetX = cursorPoint.x - dragDiff.x;
  let targetY = cursorPoint.y - dragDiff.y;

  // clamp into workArea
  targetX = Math.min(Math.max(targetX, workArea.x), workArea.x + workArea.width - mw);
  targetY = Math.min(Math.max(targetY, workArea.y), workArea.y + workArea.height - mh);

  return { x: Math.round(targetX), y: Math.round(targetY) };
}

function clampBoundsToWorkArea({ x, y, windowSize, workArea }) {
  const mw = windowSize.width;
  const mh = windowSize.height;

  let nx = x;
  let ny = y;

  if (nx < workArea.x) nx = workArea.x;
  if (ny < workArea.y) ny = workArea.y;
  if (nx + mw > workArea.x + workArea.width) nx = workArea.x + workArea.width - mw;
  if (ny + mh > workArea.y + workArea.height) ny = workArea.y + workArea.height - mh;

  return { x: nx, y: ny };
}

module.exports = {
  computeDragTarget,
  clampBoundsToWorkArea,
};

