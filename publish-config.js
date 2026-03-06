/**
 * 多平台发布配置（统一底层）
 * 原则：从哪安装则从哪检查更新，各平台发行版独立。
 * 环境变量：GH_TOKEN / GITEE_TOKEN / GITCODE_TOKEN
 */
const path = require('path');
const { readFileSync } = require('fs');

const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const { version } = pkg;

function parseRepoFromPackageJson() {
  const repo = pkg?.repository;
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (!raw || typeof raw !== 'string') return null;
  const s = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .trim();
  const m = s.match(/github\.com\/([^\/]+)\/([^\/]+)$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

// 支持 fork / 多仓库复用：优先读环境变量，其次尝试从 package.json repository 解析
const inferred = parseRepoFromPackageJson();
const REPO = process.env.PUBLISH_REPO || inferred?.repo || 'XRK-desktop-pet';
const OWNER_GH = process.env.PUBLISH_GH_OWNER || inferred?.owner || 'sunflowermm';
const OWNER_GITEE = process.env.PUBLISH_GITEE_OWNER || 'xrkseek';
const OWNER_GITCODE = process.env.PUBLISH_GITCODE_OWNER || 'Xrkseek';

const PLATFORMS = {
  github: {
    key: 'github',
    name: 'GitHub',
    envToken: 'GH_TOKEN',
    apiType: 'github',
    owner: OWNER_GH,
    repo: REPO,
    publishConfig: {
      provider: 'github',
      owner: OWNER_GH,
      repo: REPO,
      releaseType: 'release',
      publishAutoUpdate: true
    },
    releaseTag: `v${version}`,
    releaseRef: 'main',
    releasesUrl: `https://github.com/${OWNER_GH}/${REPO}/releases`
  },
  gitee: {
    key: 'gitee',
    name: 'Gitee',
    envToken: 'GITEE_TOKEN',
    apiType: 'gitee',
    apiBase: 'https://gitee.com/api/v5',
    owner: OWNER_GITEE,
    repo: REPO,
    publishConfig: {
      provider: 'generic',
      url: process.env.PUBLISH_GITEE_URL || `https://gitee.com/${OWNER_GITEE}/${REPO}/releases/download/latest/`,
      publishAutoUpdate: true
    },
    releaseTag: `v${version}`,
    releaseRef: 'master',
    releasesUrl: `https://gitee.com/${OWNER_GITEE}/${REPO}/releases`
  },
  gitcode: {
    key: 'gitcode',
    name: 'GitCode',
    envToken: 'GITCODE_TOKEN',
    apiType: 'gitcode',
    apiBase: 'https://api.gitcode.com/api/v5',
    owner: OWNER_GITCODE,
    repo: REPO,
    publishConfig: {
      provider: 'generic',
      url:
        process.env.PUBLISH_GITCODE_URL ||
        `https://gitcode.com/${OWNER_GITCODE}/${REPO}/-/releases/permalink/latest/downloads/`,
      publishAutoUpdate: true
    },
    releaseTag: `v${version}`,
    releaseRef: 'main',
    releasesUrl: `https://gitcode.com/${OWNER_GITCODE}/${REPO}/-/releases`
  }
};

function getPlatformsWithToken(env = process.env) {
  return Object.values(PLATFORMS).filter((platform) => env[platform.envToken]);
}

function getPublishConfig(platformKey) {
  return PLATFORMS[platformKey]?.publishConfig || null;
}

module.exports = {
  version,
  PLATFORMS,
  getPlatformsWithToken,
  getPublishConfig
};

