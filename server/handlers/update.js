/* =========================================================================
   OrangeSea · 更新 / 补丁（update）
   -------------------------------------------------------------------------
   从原 server.js 拆出：GitHub 更新检测（latest.yml / manifest）、安装包
   镜像下载、快速补丁（patch）下载与应用。依赖 context 常量与任务表。
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const {
  APP_VERSION,
  APP_PACKAGE,
  UPDATE_CONFIG,
  UPDATE_WORK_DIR,
  UPDATE_DOWNLOAD_DIR,
  UPDATE_PATCH_BACKUP_DIR,
  UPDATE_FALLBACK_NOTES,
  PATCH_MAX_BYTES,
  PATCH_ALLOWED_ROOTS,
  PATCH_ALLOWED_FILES,
  updateDownloadJobs,
} = require('../context');

function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}
function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}
function buildMirrorUrl(originalUrl, mirror) {
  const source = String(originalUrl || '').trim();
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
  return base.replace(/\/+$/, '/') + source;
}
function uniqueDownloadCandidates(urls, opts) {
  opts = opts || {};
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//i.test(url));
  const directSet = new Set(directUrls.map(url => url.toLowerCase()));
  const mirrors = opts.useMirrors === false ? [] : (UPDATE_CONFIG.mirrors || []);
  const mirrored = [];
  directUrls.forEach(source => {
    mirrors.forEach((mirror, index) => {
      const url = buildMirrorUrl(source, mirror);
      if (url) mirrored.push({
        url,
        label: '国内加速线路 ' + (index + 1),
        mirrored: true,
      });
    });
  });
  const direct = directUrls.map(url => ({
    url,
    label: directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路',
    mirrored: false,
  }));
  const ordered = UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct);
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function publicDownloadUrls(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(item => item && item.url)
    .filter(Boolean);
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}
function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
function cleanReleaseLine(line) {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}
function extractReleaseNotes(body) {
  const notes = [];
  String(body || '').split(/\r?\n/).forEach(line => {
    const text = cleanReleaseLine(line);
    if (!text) return;
    if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
    if (/^https?:\/\//i.test(text)) return;
    if (text.length > 72) return;
    notes.push(text);
  });
  return notes.slice(0, 4);
}
function pickReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}
function pickPatchAsset(assets, currentVersion, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function updateAssetNameFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const base = path.basename(decodeURIComponent(u.pathname || ''));
    if (base) return base;
  } catch (_) {}
  return path.basename(String(value || '').split('?')[0]) || '';
}
function normalizeManifestUpdateInfo(data) {
  data = data || {};
  const release = data.release || {};
  const asset = release.asset || data.asset || {};
  const latestVersion = normalizeVersion(
    data.latestVersion
    || data.version
    || release.version
    || release.tagName
    || release.tag_name
    || release.name
    || APP_VERSION
  ) || APP_VERSION;
  const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
  const patch = release.patch || data.patch || null;
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
  const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
  const patchInfo = patch && patch.downloadUrl ? {
    name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `OrangeSea-${APP_VERSION}→${latestVersion}.patch.json`,
    size: Number(patch.size || 0) || 0,
    contentType: patch.contentType || patch.content_type || 'application/json',
    downloadUrl: patch.downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
    from: normalizeVersion(patch.from || APP_VERSION),
    to: normalizeVersion(patch.to || latestVersion),
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
  } : null;
  const notes = Array.isArray(release.notes) && release.notes.length
    ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
    : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : UPDATE_FALLBACK_NOTES);
  const assetInfo = downloadUrl ? {
    name: asset.name || updateAssetNameFromUrl(downloadUrl) || `OrangeSea-${latestVersion}-Setup.exe`,
    size: Number(asset.size || 0) || 0,
    contentType: asset.contentType || asset.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
    sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
  } : null;
  return {
    configured: true,
    preview: false,
    updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
      name: release.name || data.name || ('OrangeSea v' + latestVersion),
      version: latestVersion,
      publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
      htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
      notes,
    },
    source: 'manifest',
  };
}
async function readUpdateManifest(ref) {
  const value = String(ref || '').trim();
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, {
      headers: { 'User-Agent': `OrangeSea/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Update manifest ' + resp.status);
    return resp.json();
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function fetchManifestUpdateInfo(ref) {
  try {
    const data = await readUpdateManifest(ref);
    return normalizeManifestUpdateInfo(data);
  } catch (err) {
    return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
  }
}
function localUpdateFallback(reason, opts) {
  opts = opts || {};
  const configured = !!(opts.configured != null ? opts.configured : false);
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'OrangeSea v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  };
}
function updateError(code, message, cause) {
  const err = new Error(message || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
function classifyUpdateError(err) {
  const code = String(err && err.code || '').trim();
  const message = String(err && err.message || err || '').trim();
  const detail = message || code || '未知错误';
  if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
  }
  if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
  if (http) {
    const status = Number(http[1]);
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
    if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
    return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
}
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
function promiseWithTimeout(promise, timeoutMs, code) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(code || 'PROVIDER_REQUEST_TIMEOUT');
        err.code = code || 'PROVIDER_REQUEST_TIMEOUT';
        reject(err);
      }, Math.max(250, Number(timeoutMs) || 5000));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
async function readStreamChunkWithTimeout(reader, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('UPSTREAM_STREAM_IDLE_TIMEOUT');
          err.code = 'UPSTREAM_STREAM_IDLE_TIMEOUT';
          reject(err);
        }, timeoutMs || 12000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function fetchTextFromCandidates(candidates, timeoutMs) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : [];
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    try {
      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `OrangeSea/${APP_VERSION}` },
      }, timeoutMs || 6500);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
      return { text: await resp.text(), candidate };
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push(candidate.label + ': ' + info.reason);
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
}
function yamlScalar(text, key) {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}
function githubReleaseDownloadUrl(version, fileName) {
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner);
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function parseLatestYmlUpdateInfo(text, reason) {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION;
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `OrangeSea-${latestVersion}-Setup.exe`;
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
  const size = Number(yamlScalar(text, 'size') || 0) || 0;
  const releaseDate = yamlScalar(text, 'releaseDate');
  const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath);
  const candidates = uniqueDownloadCandidates(downloadUrl);
  const asset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  };
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: 'v' + latestVersion,
      name: 'OrangeSea v' + latestVersion,
      version: latestVersion,
      publishedAt: releaseDate,
      htmlUrl: `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
      downloadUrl,
      asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  };
}
async function fetchLatestYmlUpdateInfo(reason) {
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
  const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
  const candidates = uniqueDownloadCandidates(latestYmlUrl);
  const result = await fetchTextFromCandidates(candidates, 6500);
  return parseLatestYmlUpdateInfo(result.text, reason);
}
async function fetchLatestUpdateInfo() {
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `OrangeSea/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
    const asset = pickReleaseAsset(data.assets);
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: data.tag_name || ('v' + latestVersion),
        name: data.name || ('OrangeSea v' + latestVersion),
        version: latestVersion,
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || '',
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    };
  } catch (err) {
    const reason = err && err.message || 'Update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}
function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `OrangeSea-${version || APP_VERSION}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `OrangeSea-${version || APP_VERSION}.exe`;
}
function publicUpdateJob(job) {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function activeUpdateJobFor(version) {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
}
function trimUpdateJobs() {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
}
async function downloadUpdateAsset(job) {
  const tmpPath = job.filePath + '.download';
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: {
        'User-Agent': `OrangeSea/${APP_VERSION}`,
      },
    });
    if (!resp.ok) throw new Error('Download failed ' + resp.status);

    const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    job.total = totalHeader || job.total || 0;
    job.received = 0;
    job.progress = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
    job.updatedAt = Date.now();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;

    const writer = fs.createWriteStream(tmpPath);
    const reader = resp.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        speedWindowBytes += buf.length;
        const now = Date.now();
        if (now - speedWindowAt >= 900) {
          job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
          speedWindowAt = now;
          speedWindowBytes = 0;
        }
        if (job.total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
          job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
        } else {
          const kb = Math.max(1, job.received / 1024);
          job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
        }
        job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
        job.updatedAt = Date.now();
        if (!writer.write(buf)) await once(writer, 'drain');
      }
    } finally {
      writer.end();
      await once(writer, 'finish').catch(() => {});
    }

    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
    fs.renameSync(tmpPath, job.filePath);
    job.status = 'ready';
    job.progress = 100;
    job.message = '安装包已下载';
    job.updatedAt = Date.now();
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    job.status = 'error';
    job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  }
}
function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}
function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}
// 单遍流式哈希：同时产出 hex 与 base64，避免安装包（数百 MB）整包读入内存阻塞事件循环
function streamDigest(filePath, algo) {
  return new Promise((resolve, reject) => {
    const hashHex = crypto.createHash(algo);
    const hashB64 = crypto.createHash(algo);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => { hashHex.update(chunk); hashB64.update(chunk); });
    stream.on('end', () => resolve({ hex: hashHex.digest('hex'), base64: hashB64.digest('base64') }));
    stream.on('error', reject);
  });
}
function verifyUpdateBuffer(buffer, job) {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer);
    const actualHex = sha512Hex(buffer).toLowerCase();
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
async function verifyUpdateFile(filePath, job) {
  // 流式校验：安装包可达数百 MB，整包同步读入会阻塞事件循环
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0) {
    const actualSize = fs.statSync(filePath).size;
    if (actualSize !== expectedSize) {
      throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${actualSize}`);
    }
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256) {
    const actual = await streamDigest(filePath, 'sha256');
    if (actual.hex !== expectedSha256) {
      throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
    }
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actual = await streamDigest(filePath, 'sha512');
    if (actual.base64 !== expectedSha512 && actual.hex.toLowerCase() !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
function moveInvalidUpdateFile(filePath, reason) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
    fs.renameSync(filePath, invalidPath);
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
  }
}
async function reuseVerifiedInstallerJob(opts) {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
  const now = Date.now();
  const stat = fs.statSync(opts.filePath);
  const job = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    failedAttempts: [],
    cached: true,
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  try {
    await verifyUpdateFile(opts.filePath, job);
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    return job;
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
    return null;
  }
}
function setUpdateJobError(job, err, fallbackMessage) {
  const info = classifyUpdateError(err);
  job.status = 'error';
  job.error = info.code;
  job.errorReason = info.reason;
  job.errorDetail = info.detail;
  job.message = fallbackMessage || info.reason;
  job.updatedAt = Date.now();
}
function prepareUpdateJobAttempt(job, candidate, index, total) {
  job.status = 'downloading';
  job.sourceLabel = candidate.label || '下载线路';
  job.attempt = index + 1;
  job.attempts = total;
  job.received = 0;
  job.speedBps = 0;
  job.etaSeconds = 0;
  job.error = '';
  job.errorReason = '';
  job.errorDetail = '';
  job.updatedAt = Date.now();
}
function ensureMirrorCanBeVerified(job, candidate) {
  if (!candidate || !candidate.mirrored) return;
  if (job.sha256 || job.sha512) return;
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
}
async function downloadUpdateAssetWithMirrors(job) {
  const tmpPath = job.filePath + '.download';
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      ensureMirrorCanBeVerified(job, candidate);
      prepareUpdateJobAttempt(job, candidate, i, candidates.length);
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `OrangeSea/${APP_VERSION}` },
      }, 14000);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.expectedSize || job.total || 0;
      job.progress = 0;
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      await verifyUpdateFile(tmpPath, job);
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.etaSeconds = 0;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
    }
  }
}
async function startUpdateDownloadJob(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

  const version = info.latestVersion || release.version || '';
  const existing = activeUpdateJobFor(version);
  if (existing) return publicUpdateJob(existing);

  const fileName = safeUpdateFileName(asset.name || '', version);
  const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
  const expectedSize = asset.size || 0;
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
  const cached = await reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  });
  if (cached) return publicUpdateJob(cached);

  const now = Date.now();
  const job = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    mode: 'installer',
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadUpdateAssetWithMirrors(job);
  return publicUpdateJob(job);
}
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (PATCH_ALLOWED_FILES.has(rel)) return rel;
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
  return parts.join('/');
}
function patchTargetPath(rel) {
  const safeRel = safePatchRelativePath(rel);
  if (!safeRel) return null;
  const target = path.resolve(__dirname, safeRel);
  const root = path.resolve(__dirname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
function decodePatchFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}
function backupPatchTarget(job, rel, target) {
  if (!fs.existsSync(target)) return;
  const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
}
function writePatchFile(job, file) {
  const rel = safePatchRelativePath(file.path || file.name);
  const target = rel ? patchTargetPath(rel) : null;
  const content = decodePatchFile(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = String(file.sha256 || '').trim().toLowerCase();
  const actual = sha256Hex(content);
  if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  backupPatchTarget(job, rel, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.mineradio-patch';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
  return rel;
}
function normalizePatchPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired !== false };
}
async function downloadAndApplyPatch(job) {
  const chunks = [];
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.mode = 'patch';
    job.message = '正在下载快速补丁';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: { 'User-Agent': `OrangeSea/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Patch download failed ' + resp.status);

    job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.total || 0;
    job.received = 0;
    const reader = resp.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const buf = Buffer.from(chunk.value);
      job.received += buf.length;
      if (job.received > PATCH_MAX_BYTES) throw new Error('PATCH_TOO_LARGE');
      chunks.push(buf);
      job.progress = job.total > 0
        ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
        : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
      job.updatedAt = Date.now();
    }

    const raw = Buffer.concat(chunks);
    const expectedPatchHash = String(job.sha256 || '').trim().toLowerCase();
    if (expectedPatchHash && sha256Hex(raw) !== expectedPatchHash) throw new Error('PATCH_PACKAGE_HASH_MISMATCH');
    const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    job.version = patch.to;
    job.message = '正在应用快速补丁';
    job.progress = 88;
    job.updatedAt = Date.now();
    const changed = [];
    patch.files.forEach(file => changed.push(writePatchFile(job, file)));
    job.changedFiles = changed;
    job.status = 'ready';
    job.progress = 100;
    job.restartRequired = patch.restartRequired;
    job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
    job.updatedAt = Date.now();
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'PATCH_APPLY_FAILED';
    job.message = '快速补丁失败，可改用完整安装包';
    job.updatedAt = Date.now();
  }
}
async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
  ensureMirrorCanBeVerified(job, candidate);
  prepareUpdateJobAttempt(job, candidate, index, total);
  job.mode = 'patch';
  job.message = '正在下载快速补丁';
  job.progress = 0;
  job.updatedAt = Date.now();

  const resp = await fetchWithTimeout(candidate.url, {
    headers: { 'User-Agent': `OrangeSea/${APP_VERSION}` },
  }, 12000);
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
  job.received = 0;
  const chunks = [];
  const reader = resp.body.getReader();
  let speedWindowAt = Date.now();
  let speedWindowBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buf = Buffer.from(chunk.value);
    job.received += buf.length;
    speedWindowBytes += buf.length;
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
    chunks.push(buf);
    const now = Date.now();
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
      speedWindowAt = now;
      speedWindowBytes = 0;
    }
    job.progress = job.total > 0
      ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
      : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
    job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
    job.updatedAt = Date.now();
  }
  const raw = Buffer.concat(chunks);
  verifyUpdateBuffer(raw, job);
  return raw;
}
async function downloadAndApplyPatchWithMirrors(job) {
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
      const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.etaSeconds = 0;
      job.updatedAt = Date.now();
      const changed = [];
      patch.files.forEach(file => changed.push(writePatchFile(job, file)));
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
    }
  }
}
function startUpdatePatchJob(info) {
  const release = info && info.release ? info.release : {};
  const patch = release.patch || {};
  const downloadUrl = patch.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

  const version = info.latestVersion || release.version || patch.to || '';
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  if (existing) return publicUpdateJob(existing);

  const now = Date.now();
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
  const job = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    mode: 'patch',
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    releaseUrl: release.htmlUrl || '',
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    restartRequired: true,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    message: '等待下载快速补丁',
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadAndApplyPatchWithMirrors(job);
  return publicUpdateJob(job);
}

module.exports = {
  normalizeDigest,
  assetDigestInfo,
  buildMirrorUrl,
  uniqueDownloadCandidates,
  publicDownloadUrls,
  normalizeVersion,
  compareVersions,
  cleanReleaseLine,
  extractReleaseNotes,
  pickReleaseAsset,
  patchAssetVersions,
  pickPatchAsset,
  updateAssetNameFromUrl,
  normalizeManifestUpdateInfo,
  readUpdateManifest,
  fetchManifestUpdateInfo,
  localUpdateFallback,
  updateError,
  classifyUpdateError,
  fetchWithTimeout,
  promiseWithTimeout,
  readStreamChunkWithTimeout,
  fetchTextFromCandidates,
  yamlScalar,
  githubReleaseDownloadUrl,
  parseLatestYmlUpdateInfo,
  fetchLatestYmlUpdateInfo,
  fetchLatestUpdateInfo,
  safeUpdateFileName,
  publicUpdateJob,
  activeUpdateJobFor,
  trimUpdateJobs,
  downloadUpdateAsset,
  sha512Base64,
  sha512Hex,
  sha256Hex,
  verifyUpdateBuffer,
  verifyUpdateFile,
  moveInvalidUpdateFile,
  reuseVerifiedInstallerJob,
  setUpdateJobError,
  prepareUpdateJobAttempt,
  ensureMirrorCanBeVerified,
  downloadUpdateAssetWithMirrors,
  startUpdateDownloadJob,
  safePatchRelativePath,
  patchTargetPath,
  decodePatchFile,
  backupPatchTarget,
  writePatchFile,
  normalizePatchPayload,
  downloadAndApplyPatch,
  downloadPatchBufferFromCandidate,
  downloadAndApplyPatchWithMirrors,
  startUpdatePatchJob,
};
