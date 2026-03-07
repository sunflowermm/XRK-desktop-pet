/**
 * 多平台发布：按平台分别构建并发布到 GitHub / Gitee / GitCode
 * 从哪安装则从哪更新：每个平台的安装包内嵌该平台的更新源。
 * 需至少设置一个环境变量：GH_TOKEN / GITEE_TOKEN / GITCODE_TOKEN
 */
require('dotenv').config();
const { spawn } = require('child_process');
const {
  readFileSync,
  existsSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmSync,
  mkdirSync
} = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const {
  version,
  getPlatformsWithToken,
  getPublishConfig,
  PLATFORMS
} = require('./publish-config.js');

const rootDir = __dirname;
const historyDir = path.join(rootDir, 'history');
const distDir = path.join(rootDir, 'dist');
const tempBuilderConfigPath = path.join(rootDir, '.electron-builder.publish.json');

function debug(...args) {
  console.log('[publish:debug]', ...args);
}

function registerProcessCleanup() {
  const cleanup = () => removeTempBuilderConfig();
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('❌ uncaughtException:', err?.stack || err?.message || String(err));
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    cleanup();
    console.error('❌ unhandledRejection:', err?.stack || err?.message || String(err));
    process.exit(1);
  });
}

function getBaseBuildConfig() {
  const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  if (!pkg || typeof pkg !== 'object' || !pkg.build) {
    throw new Error('未找到 package.json 的 build 配置');
  }
  return pkg.build;
}

function getReleaseNotes() {
  try {
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
  } catch (_) {}
  const p = path.join(historyDir, `v${version}.md`);
  if (existsSync(p)) return readFileSync(p, 'utf-8');

  // 自动生成版本文档（避免发布时忘记补 history）
  const stub = [
    `## v${version}`,
    '',
    '### 亮点',
    '- （必填）本版本最重要的 1-3 个变化',
    '',
    '### 更新',
    '- （可选）新增/优化内容',
    '',
    '### 修复',
    '- （可选）修复内容',
    '',
    '### 已知问题',
    '- （可选）已知问题与规避方案',
    ''
  ].join('\n');
  try {
    writeFileSync(p, stub, 'utf-8');
    console.warn(`⚠️ 未找到更新日志，已自动生成：history/v${version}.md（请补充后重新发布）`);
  } catch (e) {
    console.warn('⚠️ 自动生成更新日志失败:', e.message);
  }
  return stub;
}

function getDistArtifacts() {
  if (!existsSync(distDir)) return [];
  const files = readdirSync(distDir);
  const artifacts = [];

  // 优先上传 updater 元数据（支持多架构：latest.yml / latest-ia32.yml 等）
  const ymlFiles = files.filter((name) => /^latest.*\.yml$/i.test(name));
  for (const name of ymlFiles) {
    artifacts.push({ name, filePath: path.join(distDir, name) });
  }

  // 上传安装包（可能同时存在 x64/ia32）
  const exeFiles = files.filter(
    (name) => name.toLowerCase().endsWith('.exe') && name.includes(version)
  );
  for (const name of exeFiles) {
    artifacts.push({ name, filePath: path.join(distDir, name) });
  }

  // 上传 blockmap：electron-updater 会优先尝试差分更新（只下变更块），失败则回退为完整包；服务器需支持 HTTP Range
  const blockmapFiles = files.filter(
    (name) => name.toLowerCase().endsWith('.blockmap') && name.includes(version)
  );
  for (const name of blockmapFiles) {
    artifacts.push({ name, filePath: path.join(distDir, name) });
  }

  return artifacts;
}

/** generic 平台需额外上传 releaseNotes.md，供应用检查更新时拉取显示 */
function getReleaseNotesArtifact() {
  const p = path.join(historyDir, `v${version}.md`);
  if (!existsSync(p)) return null;
  return { name: 'releaseNotes.md', filePath: p };
}

const UPDATE_CONFIG_PATH = path.join(rootDir, 'update-config.json');

/** 构建前写入 update-config.json，供 generic 平台（Gitee/GitCode）运行时拉取 releaseNotes */
function writeUpdateConfig(platformKey) {
  const publishConfig = getPublishConfig(platformKey);
  const baseUrl =
    publishConfig?.provider === 'generic' && publishConfig?.url
      ? publishConfig.url.endsWith('/')
        ? publishConfig.url
        : publishConfig.url + '/'
      : null;
  writeFileSync(UPDATE_CONFIG_PATH, JSON.stringify({ baseUrl }), 'utf-8');
}

function createElectronBuilderConfig(platformKey) {
  const publishConfig = getPublishConfig(platformKey);
  if (!publishConfig) throw new Error(`未知平台: ${platformKey}`);
  const baseBuild = getBaseBuildConfig();

  const platform = PLATFORMS[platformKey];
  const embeddedUpdateSource = {
    platform: platformKey,
    provider: publishConfig.provider,
    url: publishConfig.url || null,
    owner: platform?.owner || null,
    repo: platform?.repo || null,
    releasesUrl: platform?.releasesUrl || null,
    embeddedAt: new Date().toISOString(),
  };

  writeFileSync(
    tempBuilderConfigPath,
    JSON.stringify(
      {
        ...baseBuild,
        // 关键：每个平台注入不同的 publish 配置，让“从哪安装就从哪更新”生效
        publish: publishConfig,
        extraMetadata: {
          ...(baseBuild.extraMetadata || {}),
          // 运行时可读取：用于核对“当前安装包的更新源”
          xrkUpdateSource: embeddedUpdateSource,
        },
      },
      null,
      2
    ),
    'utf-8'
  );
}

function removeTempBuilderConfig() {
  try {
    if (existsSync(tempBuilderConfigPath)) unlinkSync(tempBuilderConfigPath);
  } catch (e) {
    // ignore
  }
}

function clearDistDir() {
  debug('清空 dist 目录');
  try {
    rmSync(distDir, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
  try {
    mkdirSync(distDir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

function runElectronBuilder(platformKey, doPublish) {
  writeUpdateConfig(platformKey);
  clearDistDir();
  createElectronBuilderConfig(platformKey);

  return new Promise((resolve, reject) => {
    const args = [
      'electron-builder',
      '--win',
      '--config',
      tempBuilderConfigPath,
      '--publish',
      doPublish ? 'always' : 'never'
    ];

    debug('开始执行 electron-builder', { platformKey, doPublish, args: args.join(' ') });

    const env = { ...process.env };
    const tokenKey = PLATFORMS[platformKey].envToken;
    if (tokenKey && process.env[tokenKey]) env[tokenKey] = process.env[tokenKey];

    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd.exe', ['/d', '/s', '/c', 'npx', ...args], { stdio: 'inherit', env });
    } else {
      child = spawn('npx', args, { stdio: 'inherit', env });
    }
    child.on('close', (code) => {
      removeTempBuilderConfig();
      debug('electron-builder 执行结束', { platformKey, doPublish, code });
      if (code === 0) {
        resolve();
      } else reject(new Error(`electron-builder 退出码: ${code}`));
    });
    child.on('error', (err) => {
      removeTempBuilderConfig();
      reject(err);
    });
  });
}

async function uploadByFormData(url, tokenField, token, file, headers = {}) {
  const content = readFileSync(file.filePath);
  const form = new FormData();
  if (tokenField && token) form.append(tokenField, token);
  form.append('file', new Blob([content]), file.name);
  form.append('file_name', file.name);

  const res = await fetch(url, {
    method: 'POST',
    headers: Object.keys(headers).reduce((acc, key) => {
      if (key.toLowerCase() !== 'content-type') {
        acc[key] = headers[key];
      }
      return acc;
    }, {}),
    body: form
  });

  return res;
}

async function publishGitHub(platform, releaseNotes) {
  debug('开始发布 GitHub');
  await runElectronBuilder(platform.key, true);

  const token = process.env[platform.envToken];
  if (!token || !releaseNotes) return;

  try {
    const octokit = new Octokit({ auth: token });
    const { data: releases } = await octokit.repos.listReleases({
      owner: platform.publishConfig.owner,
      repo: platform.publishConfig.repo,
      per_page: 20
    });

    const release = releases.find((r) => r.tag_name === platform.releaseTag);
    if (!release) return;

    await octokit.repos.updateRelease({
      owner: platform.publishConfig.owner,
      repo: platform.publishConfig.repo,
      release_id: release.id,
      name: `v${version}`,
      body: releaseNotes
    });
    console.log('✅ GitHub Release 说明已更新');
  } catch (e) {
    console.warn('⚠️ 更新 GitHub Release 说明失败:', e.message);
  }
}

async function ensureGiteeRelease(platform, token, releaseNotes) {
  const base = `${platform.apiBase}/repos/${platform.owner}/${platform.repo}`;
  const auth = `access_token=${encodeURIComponent(token)}`;
  // Gitee 固定使用 master 作为发布分支
  const releaseRef = 'master';
  debug('Gitee release 参数', {
    repo: `${platform.owner}/${platform.repo}`,
    tag: platform.releaseTag,
    ref: releaseRef
  });

  const listRes = await fetch(`${base}/releases?${auth}&per_page=20`);
  if (!listRes.ok) {
    throw new Error(`获取 Gitee Release 列表失败: ${await listRes.text()}`);
  }
  const list = await listRes.json();
  const existing = Array.isArray(list)
    ? list.find((r) => r.tag_name === platform.releaseTag)
    : null;
  debug('Gitee release 查询结果', {
    releaseCount: Array.isArray(list) ? list.length : 0,
    existing: !!existing
  });

  if (existing) {
    const updateRes = await fetch(`${base}/releases/${existing.id}?${auth}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: platform.releaseTag,
        body: releaseNotes,
        name: `v${version}`
      })
    });
    if (!updateRes.ok) {
      console.warn('⚠️ 更新 Gitee Release 说明失败:', await updateRes.text());
    }
    return existing.id;
  }

  const createPayload = {
    tag_name: platform.releaseTag,
    name: `v${version}`,
    body: releaseNotes,
    target_commitish: releaseRef
  };

  let createRes = await fetch(`${base}/releases?${auth}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload)
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    debug('Gitee release 创建失败', { errText });

    // Gitee 要求 target_commitish 必填，失败时直接抛错，避免无效重试
    throw new Error(`Gitee 创建 Release 失败: ${errText}`);
  }

  const created = await createRes.json();
  return created.id;
}

async function deleteExistingGiteeAttachments(platform, token, releaseId, fileName) {
  const base = `${platform.apiBase}/repos/${platform.owner}/${platform.repo}`;
  const auth = `access_token=${encodeURIComponent(token)}`;

  // 获取当前release的附件列表
  const listRes = await fetch(`${base}/releases/${releaseId}/attach_files?${auth}`);
  if (!listRes.ok) {
    console.warn('⚠️ 获取 Gitee 附件列表失败:', await listRes.text());
    return;
  }

  const attachments = await listRes.json();
  if (!Array.isArray(attachments)) return;

  // 查找并删除同名附件
  for (const attachment of attachments) {
    if (attachment.name === fileName) {
      const deleteRes = await fetch(
        `${base}/releases/${releaseId}/attach_files/${attachment.id}?${auth}`,
        {
          method: 'DELETE'
        }
      );
      if (deleteRes.ok) {
        debug('已删除 Gitee 旧附件:', fileName);
      } else {
        console.warn(
          '⚠️ 删除 Gitee 旧附件失败:',
          fileName,
          await deleteRes.text()
        );
      }
    }
  }
}

async function uploadGiteeArtifacts(platform, token, releaseId) {
  const base = `${platform.apiBase}/repos/${platform.owner}/${platform.repo}`;
  const attachUrl = `${base}/releases/${releaseId}/attach_files`;

  const artifacts = [...getDistArtifacts()];
  const releaseNotesArt = getReleaseNotesArtifact();
  if (releaseNotesArt) artifacts.push(releaseNotesArt);

  for (const file of artifacts) {
    await deleteExistingGiteeAttachments(platform, token, releaseId, file.name);
    const res = await uploadByFormData(`${attachUrl}`, 'access_token', token, file);

    if (res.ok) console.log('✅ Gitee 已上传:', file.name);
    else console.warn('⚠️ Gitee 上传失败:', file.name, await res.text());
  }
}

async function publishGitee(platform, releaseNotes) {
  debug('开始发布 Gitee');
  await runElectronBuilder(platform.key, false);

  const token = process.env[platform.envToken];
  if (!token) {
    throw new Error('缺少 GITEE_TOKEN');
  }

  // 版本 Release（便于查看版本历史）
  const versionReleaseId = await ensureGiteeRelease(
    platform,
    token,
    releaseNotes || `v${version}`
  );
  await uploadGiteeArtifacts(platform, token, versionReleaseId);

  // latest Release（用于 generic 更新源的稳定下载路径：/releases/download/latest/）
  const latestPlatform = { ...platform, releaseTag: 'latest' };
  const latestReleaseId = await ensureGiteeRelease(
    latestPlatform,
    token,
    releaseNotes || `v${version}`
  );
  await uploadGiteeArtifacts(latestPlatform, token, latestReleaseId);
}

async function ensureGitCodeRelease(platform, token, releaseNotes) {
  const base = `${platform.apiBase}/repos/${platform.owner}/${platform.repo}`;
  const headers = {
    'Content-Type': 'application/json',
    'PRIVATE-TOKEN': token
  };
  const releaseRef = platform.releaseRef;
  debug('GitCode release 参数', {
    repo: `${platform.owner}/${platform.repo}`,
    tag: platform.releaseTag,
    ref: releaseRef
  });

  const listRes = await fetch(`${base}/releases?per_page=20`, { headers });
  if (!listRes.ok) {
    throw new Error(`获取 GitCode Release 列表失败: ${await listRes.text()}`);
  }

  const list = await listRes.json();
  const existing = Array.isArray(list)
    ? list.find((r) => r.tag_name === platform.releaseTag)
    : null;
  debug('GitCode release 查询结果', {
    releaseCount: Array.isArray(list) ? list.length : 0,
    existing: !!existing
  });

  if (existing) {
    const updateRes = await fetch(
      `${base}/releases/${encodeURIComponent(platform.releaseTag)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: `v${version}`,
          body: releaseNotes
        })
      }
    );
    if (!updateRes.ok) {
      console.warn('⚠️ 更新 GitCode Release 说明失败:', await updateRes.text());
    }
    return;
  }

  const createRes = await fetch(`${base}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag_name: platform.releaseTag,
      name: `v${version}`,
      body: releaseNotes,
      ref: releaseRef
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    debug('GitCode release 创建失败', { errText, ref: releaseRef });
    throw new Error(`GitCode 创建 Release 失败: ${errText}`);
  }
}

async function publishGitCode(platform, releaseNotes) {
  debug('开始发布 GitCode');
  await runElectronBuilder(platform.key, false);

  const token = process.env[platform.envToken];
  if (!token) {
    throw new Error('缺少 GITCODE_TOKEN');
  }

  await ensureGitCodeRelease(platform, token, releaseNotes || `v${version}`);

  const base = `${platform.apiBase}/repos/${platform.owner}/${platform.repo}`;
  const headers = { 'PRIVATE-TOKEN': token };

  const artifacts = [...getDistArtifacts()];
  const releaseNotesArt = getReleaseNotesArtifact();
  if (releaseNotesArt) artifacts.push(releaseNotesArt);

  try {
    for (const file of artifacts) {
      try {
        const uploadUrlRes = await fetch(
          `${base}/releases/${encodeURIComponent(
            platform.releaseTag
          )}/upload_url?file_name=${encodeURIComponent(file.name)}`,
          { headers }
        );

        if (!uploadUrlRes.ok) {
          throw new Error(
            `GitCode 获取上传地址失败: ${await uploadUrlRes.text()}`
          );
        }

        const response = await uploadUrlRes.json();
        debug('GitCode upload_url response', response);
        const uploadUrl = response.url;
        if (!uploadUrl) {
          throw new Error(
            `GitCode 未返回 url，响应: ${JSON.stringify(response)}`
          );
        }

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: response.headers,
          body: readFileSync(file.filePath)
        });

        if (res.ok) console.log('✅ GitCode 已上传:', file.name);
        else
          console.warn(
            '⚠️ GitCode 上传失败:',
            file.name,
            await res.text()
          );
      } catch (error) {
        console.warn('⚠️ GitCode 上传失败:', file.name, error.message);
      }
    }
  } catch (error) {
    console.warn('⚠️ GitCode 发布失败:', error.message);
  }
}

async function publishOnePlatform(platform, releaseNotes) {
  if (platform.key === 'github') return publishGitHub(platform, releaseNotes);
  if (platform.key === 'gitee') return publishGitee(platform, releaseNotes);
  if (platform.key === 'gitcode') return publishGitCode(platform, releaseNotes);
  throw new Error(`暂未实现的平台: ${platform.key}`);
}

async function main() {
  registerProcessCleanup();
  const enabledPlatforms = getPlatformsWithToken();
  if (enabledPlatforms.length === 0) {
    console.error(
      '❌ 未设置任何发布 Token。请设置 GH_TOKEN / GITEE_TOKEN / GITCODE_TOKEN 之一或多项。'
    );
    process.exit(1);
  }

  const releaseNotes = getReleaseNotes();
  if (releaseNotes) console.log(`📝 更新日志: history/v${version}.md\n`);
  else console.warn('⚠️ 未找到更新日志\n');

  console.log('📡 本次构建将内嵌的更新源：');
  for (const p of enabledPlatforms) {
    const pub = getPublishConfig(p.key);
    if (pub?.provider === 'github') {
      console.log(`   ${p.name}: github://${pub.owner}/${pub.repo}`);
    } else if (pub?.provider) {
      console.log(`   ${p.name}: ${pub.provider} ${pub.url || ''}`.trim());
    } else {
      console.log(`   ${p.name}: (未知 publish 配置)`);
    }
  }

  console.log(
    `📦 开始构建并发布 v${version}，目标平台: ${enabledPlatforms
      .map((p) => p.name)
      .join(', ')}\n`
  );

  for (const platform of enabledPlatforms) {
    console.log(`\n--- ${platform.name} ---`);
    try {
      await publishOnePlatform(platform, releaseNotes);
    } catch (err) {
      console.error(`${platform.name} 发布失败:`, err.message);
      process.exitCode = 1;
    }
  }

  removeTempBuilderConfig();

  console.log('\n✅ 发布流程结束');
  console.log('📦 发行版链接:');
  for (const p of enabledPlatforms) {
    if (p.releasesUrl) console.log(`   ${p.name}: ${p.releasesUrl}`);
  }
}

main().catch((err) => {
  removeTempBuilderConfig();
  console.error(err);
  process.exit(1);
});

