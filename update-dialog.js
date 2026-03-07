/**
 * 更新弹窗：独立窗口，不干扰桌宠
 * 阶段：发现新版本 → 下载中 → 更新已就绪
 */
const { ipcRenderer } = require('electron');

const contentEl = document.getElementById('update-content');
const btnGroupEl = document.getElementById('btn-group');

function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).split('\n');
  const out = [];
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^# (.+)$/) || line.match(/^## (.+)$/) || line.match(/^### (.+)$/);
    if (m) {
      if (inList) { out.push('</ul>'); inList = false; }
      const tag = line.startsWith('###') ? 'h5' : line.startsWith('##') ? 'h4' : 'h3';
      out.push(`<${tag}>${m[1]}</${tag}>`);
      continue;
    }
    const li = line.match(/^[-*] (.+)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const t = line.trim();
    if (t) out.push(`<p>${t}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  const v = n / Math.pow(k, i);
  return (i === 0 ? Math.round(v) : Math.round(v * 100) / 100) + ' ' + sizes[i];
}

function setContent(html) {
  contentEl.innerHTML = html;
}

function setButtons(buttons) {
  btnGroupEl.innerHTML = '';
  buttons.forEach((b) => {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.className = b.primary ? 'primary' : 'secondary';
    btn.onclick = b.onClick;
    btnGroupEl.appendChild(btn);
  });
}

// 阶段 1：发现新版本
function showAvailable(version, releaseNotes) {
  const notesHtml = releaseNotes
    ? `<div class="update-notes-wrap"><div class="update-notes">${renderMarkdown(releaseNotes)}</div></div>`
    : '';
  setContent(`
    <div class="update-banner">
      <span class="update-banner__icon">🎉</span>
      <p class="update-banner__text">发现新版本 <strong class="update-banner__version">v${version}</strong></p>
    </div>
    ${notesHtml}
    <p class="update-dialog-desc">点击「更新」下载，可最小化窗口到后台继续使用桌宠，下载完成后点击「立即重启」即可。</p>
  `);
  setButtons([
    { label: '更新', primary: true, onClick: onUpdateClick },
    { label: '取消', primary: false, onClick: () => ipcRenderer.send('update-dialog-close') }
  ]);
}

function onUpdateClick() {
  ipcRenderer.send('update-dialog-start-download');
  showProgress();
}

// 阶段 2：下载中
function showProgress() {
  setContent(`
    <p style="margin-bottom:8px;font-size:14px;">正在下载更新...</p>
    <div class="update-progress-track">
      <div id="progress-bar" class="update-progress-bar"></div>
    </div>
    <p id="progress-text" class="update-progress-text">准备中...</p>
  `);
  setButtons([]);
}

function updateProgress(percent, transferred, total) {
  const bar = document.getElementById('progress-bar');
  const text = document.getElementById('progress-text');
  if (!bar || !text) return;
  bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (total > 0) {
    text.textContent = `${Math.round(percent)}% (${formatBytes(transferred)}/${formatBytes(total)})`;
  } else {
    text.textContent = `${Math.round(percent)}%`;
  }
}

// 阶段 3：更新已就绪
function showDownloaded(version) {
  setContent(`
    <div class="update-banner update-banner--success">
      <span class="update-banner__icon">✅</span>
      <p class="update-banner__text">更新 <strong class="update-banner__version">v${version}</strong> 已下载完成</p>
    </div>
    <p class="update-dialog-desc">点击「立即重启」应用更新，或选「稍后」在关闭/下次启动时自动安装。</p>
  `);
  setButtons([
    { label: '立即重启', primary: true, onClick: () => ipcRenderer.send('update-dialog-install') },
    { label: '稍后', primary: false, onClick: () => ipcRenderer.send('update-dialog-close') }
  ]);
}

// 监听主进程消息
ipcRenderer.on('update-dialog-init', (_, data) => {
  if (data?.version) {
    showAvailable(data.version, data.releaseNotes || '');
  }
});

ipcRenderer.on('update-dialog-progress', (_, progress) => {
  const pct = progress?.percent ?? 0;
  const transferred = progress?.transferred ?? 0;
  const total = progress?.total ?? 0;
  updateProgress(pct, transferred, total);
});

ipcRenderer.on('update-dialog-downloaded', (_, data) => {
  if (data?.version) {
    showDownloaded(data.version);
  }
});
