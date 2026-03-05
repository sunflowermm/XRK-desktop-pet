const { ipcRenderer } = require('electron');

// 解析菜单数据
let menuData = null;
const urlParams = new URLSearchParams(window.location.search);
const dataParam = urlParams.get('data');
if (dataParam) {
  try {
    menuData = JSON.parse(decodeURIComponent(dataParam));
  } catch (e) {
    console.error('[MENU] Failed to parse menu data:', e);
  }
}

let activeSubmenu = null;

// 创建菜单项
function createMenuItem(label, onClick) {
  const item = document.createElement('div');
  item.className = 'menu-item';
  item.textContent = label;
  item.onclick = onClick;
  return item;
}

// 创建分隔符
function createSeparator() {
  const sep = document.createElement('div');
  sep.className = 'menu-separator';
  return sep;
}

// 获取屏幕边界
let screenBounds = null;
function getScreenBounds() {
  if (!screenBounds) {
      screenBounds = { 
        width: window.screen.width, 
        height: window.screen.height, 
        x: 0, 
        y: 0 
      };
      ipcRenderer.invoke('get-screen-bounds').then(bounds => {
        screenBounds = bounds;
      }).catch(() => {});
  }
  return screenBounds;
}

// 获取窗口在屏幕上的位置
let windowScreenPos = { x: 0, y: 0 };
ipcRenderer.on('menu-window-position', (event, pos) => {
  windowScreenPos = pos;
});

// 创建子菜单
function createSubmenu(label, items) {
  const container = document.createElement('div');
  container.className = 'menu-item submenu-container';
  container.innerHTML = `<span>${label}</span><span class="submenu-arrow">▶</span>`;

  const submenu = document.createElement('div');
  submenu.className = 'submenu';

  items.forEach(item => {
    const menuItem = createMenuItem(item.label, (e) => {
      if (e) {
      e.stopPropagation();
        e.preventDefault();
      }
      ipcRenderer.send('context-menu-action', item.action, item.payload);
      ipcRenderer.send('close-menu-window');
    });
    submenu.appendChild(menuItem);
  });

  container.appendChild(submenu);

  let hideTimer = null;
  
  const calculatePosition = () => {
    const containerWidth = container.offsetWidth || container.clientWidth;
    
    const containerRect = container.getBoundingClientRect();
    const wasHidden = submenu.style.display === 'none' || !submenu.classList.contains('show');
    let submenuRect;
    if (wasHidden) {
      const original = {
        display: submenu.style.display,
        visibility: submenu.style.visibility,
        left: submenu.style.left,
        top: submenu.style.top
      };
      Object.assign(submenu.style, {
        display: 'block',
        visibility: 'hidden',
        left: '-9999px',
        top: '0'
      });
      submenuRect = submenu.getBoundingClientRect();
      Object.assign(submenu.style, original);
    } else {
      submenuRect = submenu.getBoundingClientRect();
    }
    const bounds = getScreenBounds();
    const windowPos = windowScreenPos;
    
    // 计算容器在屏幕上的绝对位置
    const containerScreenLeft = windowPos.x + containerRect.left;
    const containerScreenRight = containerScreenLeft + containerRect.width;
    const containerScreenTop = windowPos.y + containerRect.top;
    
    // 默认显示在右侧
    let left = containerWidth + 4;
    
    // 计算右侧显示时，子菜单在屏幕上的右边界
    const rightSideScreenRight = containerScreenRight + 4 + submenuRect.width;
    
    // 判断应该显示在哪一侧
    if (rightSideScreenRight > bounds.width) {
      // 右侧会超出，检查左侧是否有足够空间
      const leftSideScreenLeft = containerScreenLeft - 4 - submenuRect.width;
      if (leftSideScreenLeft >= bounds.x) {
        // 左侧空间足够，显示在左侧
        left = -submenuRect.width - 4;
      } else {
        // 左侧也不够，调整到屏幕内
        left = bounds.width - containerScreenLeft - submenuRect.width - 4;
      }
    }
    
    // 计算垂直位置
    let top = 0;
    const submenuScreenBottom = containerScreenTop + submenuRect.height;
    
    if (submenuScreenBottom > bounds.height) {
      top = Math.max(-containerRect.top, bounds.height - containerScreenTop - submenuRect.height);
    }
    
    if (containerScreenTop + top < bounds.y) {
      top = bounds.y - containerScreenTop;
    }
    
    return { left, top, submenuRect, screenBounds: bounds };
  };
  
  const show = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (activeSubmenu === submenu && submenu.classList.contains('show')) {
      return;
    }

    if (activeSubmenu && activeSubmenu !== submenu) {
      activeSubmenu.style.cssText = 'display: none; visibility: hidden; opacity: 0;';
      activeSubmenu.classList.remove('show');
    }
    
    activeSubmenu = submenu;
    const { left, top, submenuRect, screenBounds: bounds } = calculatePosition();
    const containerRect = container.getBoundingClientRect();
    
    Object.assign(submenu.style, {
      left: `${left}px`,
      top: `${top}px`,
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      background: 'rgba(30, 30, 30, 0.95)',
      zIndex: '9999',
      pointerEvents: 'auto',
      transform: 'translateX(0) translateZ(0)'
    });
    submenu.classList.add('show');
    
      const submenuWindowLeft = containerRect.left + left;
      const submenuWindowRight = submenuWindowLeft + submenuRect.width;
      const submenuWindowBottom = containerRect.top + top + submenuRect.height;
      
      let neededWidth = window.innerWidth;
      let neededHeight = window.innerHeight;
    let finalLeft = left;
      
      if (submenuWindowLeft < 0) {
        const overflowLeft = Math.abs(submenuWindowLeft);
        neededWidth = window.innerWidth + overflowLeft + 10;
      finalLeft = left + overflowLeft + 10;
      submenu.style.left = `${finalLeft}px`;
      }
      
      if (submenuWindowRight > neededWidth) {
        neededWidth = Math.ceil(submenuWindowRight + 10);
      }
      if (submenuWindowBottom > window.innerHeight) {
        neededHeight = Math.ceil(submenuWindowBottom + 10);
      }
      
      if (neededWidth > window.innerWidth || neededHeight > window.innerHeight) {
        const maxWidth = bounds.width - windowScreenPos.x;
        const maxHeight = bounds.height - windowScreenPos.y;
      ipcRenderer.send('resize-menu-window', 
        Math.min(neededWidth, maxWidth), 
        Math.min(neededHeight, maxHeight)
      );
      }
  };

  const hide = () => {
    hideTimer = setTimeout(() => {
      if (activeSubmenu === submenu) {
        submenu.style.cssText = 'display: none; opacity: 0; visibility: hidden;';
        submenu.classList.remove('show');
        activeSubmenu = null;
      }
    }, 100);
  };

  const cancelHide = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  container.addEventListener('mouseenter', show, { passive: true });
  container.addEventListener('mouseleave', hide, { passive: true });
  submenu.addEventListener('mouseenter', cancelHide, { passive: true });
  submenu.addEventListener('mouseleave', hide, { passive: true });

  return container;
}

// 构建菜单
function buildMenu() {
  if (!menuData) return [];

  const items = [];

  // 窗口置顶
  items.push(createMenuItem(
    menuData.isAlwaysOnTop ? '✓ 窗口置顶' : '窗口置顶',
    () => {
      ipcRenderer.send('context-menu-action', 'toggle-always-on-top', {
        checked: !menuData.isAlwaysOnTop
      });
      ipcRenderer.send('close-menu-window');
    }
  ));

  // 锁定窗口
  items.push(createMenuItem(
    menuData.isLocked ? '✓ 锁定窗口' : '锁定窗口',
    () => {
      ipcRenderer.send('context-menu-action', 'toggle-lock');
      ipcRenderer.send('close-menu-window');
    }
  ));

  items.push(createSeparator());

  // 窗口大小
  if (menuData.sizePresets?.length > 0) {
    items.push(createSubmenu('窗口大小', menuData.sizePresets.map(p => ({
      label: `${p.label} (${p.stageWidth}×${p.stageHeight})`,
      action: 'set-stage-size',
      payload: { key: p.key }
    }))));
    items.push(createSeparator());
  }

  // 切换模型
  items.push(createSubmenu('切换模型', [
    { label: 'Kuromi', action: 'switch-model', payload: { key: 'kuromi' } },
    { label: 'Mark', action: 'switch-model', payload: { key: 'mark' } },
    { label: 'Kaguya', action: 'switch-model', payload: { key: 'kaguya' } },
    { label: 'Cinnamoroll', action: 'switch-model', payload: { key: 'cinamoroll' } },
    { label: 'Robot', action: 'switch-model', payload: { key: 'robot' } },
  ]));

  // 动作互动
  items.push(createSubmenu('动作互动', [
    { label: '随机表情/动作', action: 'play-motion', payload: { kind: 'special1' } },
    { label: '轻松动一动', action: 'play-motion', payload: { kind: 'micro' } },
  ]));

  // 显示/隐藏
  items.push(createMenuItem('显示/隐藏', () => {
    ipcRenderer.send('context-menu-action', 'toggle-visibility');
    ipcRenderer.send('close-menu-window');
  }));

  // 设置
  items.push(createMenuItem('设置', () => {
    ipcRenderer.send('context-menu-action', 'open-settings');
    ipcRenderer.send('close-menu-window');
  }));

  // 模型窗口调试
  items.push(createMenuItem('调试模型窗口大小', () => {
    ipcRenderer.send('context-menu-action', 'open-stage-debug-panel');
    ipcRenderer.send('close-menu-window');
  }));

  items.push(createSeparator());

  // 退出
  items.push(createMenuItem('退出', () => {
    ipcRenderer.send('context-menu-action', 'quit');
    ipcRenderer.send('close-menu-window');
  }));

  return items;
}

// 渲染菜单
function renderMenu() {
  const menu = document.getElementById('menu');
  if (!menu) return;
  
  menu.innerHTML = '';
  const items = buildMenu();
  if (items.length === 0) return;
  
  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.appendChild(item));
  menu.appendChild(fragment);

    const rect = menu.getBoundingClientRect();
  ipcRenderer.send('resize-menu-window', Math.ceil(rect.width), Math.ceil(rect.height));
}

// 点击外部关闭
document.addEventListener('click', (e) => {
  const menu = document.getElementById('menu');
  if (!menu || menu.contains(e.target)) return;
  
  const submenus = document.querySelectorAll('.submenu');
  const inSubmenu = Array.from(submenus).some(submenu => submenu.contains(e.target));
  
  if (!inSubmenu) {
    ipcRenderer.send('close-menu-window');
  }
}, true);

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderMenu);
} else {
  renderMenu();
}
