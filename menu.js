const { ipcRenderer } = require('electron');

let menuData = null;
let activeSubmenu = null;

try {
  const dataParam = new URLSearchParams(window.location.search).get('data');
  if (dataParam) menuData = JSON.parse(decodeURIComponent(dataParam));
} catch (e) {
  console.error('[MENU] parse data:', e);
}

ipcRenderer.on('menu-set-data', (_, data) => {
  menuData = data;
  renderMenu();
});

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

let windowScreenPos = { x: 0, y: 0 };
let screenBounds = { width: window.screen.width, height: window.screen.height, x: 0, y: 0 };
ipcRenderer.on('menu-window-position', (_, pos) => {
  windowScreenPos = { x: pos.x, y: pos.y };
  if (pos.bounds) screenBounds = pos.bounds;
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
      if (e) { e.preventDefault(); e.stopPropagation(); }
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
    const { x: wx, y: wy } = windowScreenPos;
    const containerScreenLeft = wx + containerRect.left;
    const containerScreenRight = containerScreenLeft + containerRect.width;
    const containerScreenTop = wy + containerRect.top;

    let left = containerWidth + 4;
    if (containerScreenRight + 4 + submenuRect.width > screenBounds.width) {
      const leftEdge = containerScreenLeft - 4 - submenuRect.width;
      left = leftEdge >= screenBounds.x ? -submenuRect.width - 4 : screenBounds.width - containerScreenLeft - submenuRect.width - 4;
    }

    let top = 0;
    const submenuBottom = containerScreenTop + submenuRect.height;
    if (submenuBottom > screenBounds.height) top = Math.max(-containerRect.top, screenBounds.height - containerScreenTop - submenuRect.height);
    if (containerScreenTop + top < screenBounds.y) top = screenBounds.y - containerScreenTop;
    
    return { left, top, submenuRect };
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
    const { left, top, submenuRect } = calculatePosition();
    const containerRect = container.getBoundingClientRect();

    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
    submenu.classList.add('show');

    const submenuWindowLeft = containerRect.left + left;
    const submenuWindowRight = submenuWindowLeft + submenuRect.width;
    const submenuWindowBottom = containerRect.top + top + submenuRect.height;
    let neededWidth = window.innerWidth;
    let neededHeight = window.innerHeight;

    if (submenuWindowLeft < 0) {
      const overflowLeft = Math.abs(submenuWindowLeft);
      neededWidth = window.innerWidth + overflowLeft + 10;
      submenu.style.left = `${left + overflowLeft + 10}px`;
    }
    if (submenuWindowRight > neededWidth) neededWidth = Math.ceil(submenuWindowRight + 10);
    if (submenuWindowBottom > window.innerHeight) neededHeight = Math.ceil(submenuWindowBottom + 10);

    if (neededWidth > window.innerWidth || neededHeight > window.innerHeight) {
      const maxW = screenBounds.width - windowScreenPos.x;
      const maxH = screenBounds.height - windowScreenPos.y;
      ipcRenderer.send('resize-menu-window', Math.min(neededWidth, maxW), Math.min(neededHeight, maxH));
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

  const checkLabel = (label, checked) => (checked ? `✓ ${label}` : label);
  const close = () => ipcRenderer.send('close-menu-window');

  items.push(createMenuItem(
    checkLabel('窗口置顶', menuData.isAlwaysOnTop),
    () => {
      ipcRenderer.send('context-menu-action', 'toggle-always-on-top', { checked: !menuData.isAlwaysOnTop });
      close();
    }
  ));
  items.push(createMenuItem(
    checkLabel('锁定窗口', menuData.isLocked),
    () => {
      ipcRenderer.send('context-menu-action', 'toggle-lock');
      close();
    }
  ));
  items.push(createMenuItem(
    checkLabel('显示桌宠', menuData.isVisible),
    () => {
      ipcRenderer.send('context-menu-action', 'toggle-visibility');
      close();
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

  items.push(createMenuItem('设置', () => {
    ipcRenderer.send('context-menu-action', 'open-settings');
    close();
  }));
  items.push(createMenuItem('调试模型窗口大小', () => {
    ipcRenderer.send('context-menu-action', 'open-stage-debug-panel');
    close();
  }));
  items.push(createSeparator());
  items.push(createMenuItem('退出', () => {
    ipcRenderer.send('context-menu-action', 'quit');
    close();
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { if (menuData) renderMenu(); });
} else if (menuData) {
  renderMenu();
}
