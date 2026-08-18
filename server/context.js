/* =========================================================================
   OrangeSea · 服务端共享状态上下文（context）
   -------------------------------------------------------------------------
   从原 server.js 拆出的「共享可变状态」单例：
   - cookie 四件套（netease/qq/kugou/qishui）与其持久化
   - 各音源缓存 Map（歌单索引、VIP、源匹配、解密缓存等）
   - 更新任务表、听歌同步日志
   - 运行时常量（路径、UA 等）

   设计：所有状态与变异函数收敛于此，路由/处理器模块通过 require('./context')
   获取引用，避免模块间循环依赖。clearAllRuntimeLoginCredentials 导出供
   http.Server 实例挂载（desktop/main.js 调用）。
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { TrackDecryptor } = require('../qishui-audio-decryptor/track-decryptor');
const {
  normalizeQishuiCookieInput,
  clearQishuiAccessToken,
} = require('../qishui-api');
const {
  clearSpotifyToken,
} = require('../spotify-api');
const {
  encryptCookieText,
  decryptCookieText,
} = require('./cookie-cipher');

/* ---------- 服务配置 ---------- */
const PORT = process.env.PORT || 3000;
// 默认绑定回环地址：本机播放器无需暴露到局域网，避免凭据/接口被同网段访问。
// 通过 Electron 启动时 desktop/main.js 会再次显式设为 127.0.0.1（纵深防御）。
const HOST = process.env.HOST || '127.0.0.1';
// 本地前端源的 Origin，用于收紧数据接口的 CORS（音频/封面等媒体代理端点除外）。
const ALLOWED_ORIGIN = `http://${HOST}:${PORT}`;
// 静态资源根目录（白名单基点），防止路径穿越逃逸出 public/。
const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public');

/* ---------- 路径常量（相对仓库根） ---------- */
const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_COOKIE_FILE = path.join(APP_ROOT, '.cookie');
const DEFAULT_QQ_COOKIE_FILE = path.join(APP_ROOT, '.qq-cookie');
const DEFAULT_KUGOU_COOKIE_FILE = path.join(APP_ROOT, '.kugou-cookie');
const DEFAULT_QISHUI_COOKIE_FILE = path.join(APP_ROOT, '.qishui-cookie');
const UPDATE_WORK_DIR = process.env.MINERADIO_UPDATE_DIR || path.join(APP_ROOT, 'updates');
const UPDATE_DOWNLOAD_DIR = process.env.MINERADIO_UPDATE_DOWNLOAD_DIR || path.join(UPDATE_WORK_DIR, 'downloads');
const UPDATE_PATCH_BACKUP_DIR = process.env.MINERADIO_PATCH_BACKUP_DIR || path.join(UPDATE_WORK_DIR, 'backups', 'patches');
const BEATMAP_CACHE_DIR = process.env.MINERADIO_BEAT_CACHE_DIR || 'D:\\MineradioCache\\beatmaps';
// 歌曲下载目录：默认 D:\OrangeSeaCache\downloads，D 盘不可用时回退仓库 downloads/
const SONG_DOWNLOAD_DIR = process.env.MINERADIO_SONG_DOWNLOAD_DIR
  || (fs.existsSync('D:\\') ? 'D:\\OrangeSeaCache\\downloads' : path.join(APP_ROOT, 'downloads'));
const CUEFIELD_FEEDBACK_FILE = process.env.CUEFIELD_FEEDBACK_FILE || path.join(APP_ROOT, 'data', 'cuefield-feedback.jsonl');
const LISTEN_SYNC_JOURNAL_FILE = process.env.MINERADIO_LISTEN_SYNC_FILE || path.join(APP_ROOT, 'data', 'listen-sync-journal.json');
const LISTEN_SYNC_JOURNAL_LIMIT = 600;
const UPDATE_FALLBACK_NOTES = [
  '电影镜头节奏更松',
  '音源失败自动换源',
  '右上角更新提示',
];
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'dj-analyzer.js', 'package.json', 'package-lock.json']);
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'http://ip-api.com/json/';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

/* ---------- 通用请求头 / 媒体常量 ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ---------- 应用信息 / 更新配置（运行时常量） ---------- */
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function parseGitHubRepository(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') };
  const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i);
  if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') };
  return null;
}
function parseUpdateMirrorList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[\n,;]/);
}
function readUpdateMirrors(local) {
  const envMirrors = process.env.MINERADIO_UPDATE_MIRRORS || process.env.MINERADIO_UPDATE_MIRROR || '';
  const raw = envMirrors
    ? parseUpdateMirrorList(envMirrors)
    : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || []);
  const seen = new Set();
  const mirrors = [];
  raw.forEach(item => {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mirrors.push(url);
  });
  return mirrors.slice(0, 6);
}
function readUpdateConfig(pkg) {
  const local = (pkg && pkg.mineradio && pkg.mineradio.update) || {};
  const disabled = local.disabled === true || local.provider === 'none';
  if (disabled) {
    return {
      provider: local.provider || 'none',
      owner: '',
      repo: '',
      configured: false,
      disabled: true,
      preview: false,
      preferMirrors: false,
      mirrors: [],
      manifest: '',
    };
  }
  const repoHint = process.env.MINERADIO_UPDATE_REPOSITORY
    || process.env.GITHUB_REPOSITORY
    || local.repository
    || local.github
    || (pkg && pkg.repository && (pkg.repository.url || pkg.repository))
    || '';
  const parsed = parseGitHubRepository(repoHint) || {};
  const owner = process.env.MINERADIO_UPDATE_OWNER || local.owner || parsed.owner || '';
  const repo = process.env.MINERADIO_UPDATE_REPO || local.repo || parsed.repo || '';
  return {
    provider: local.provider || 'github',
    owner,
    repo,
    configured: !!(owner && repo),
    disabled: false,
    preview: local.preview !== false,
    preferMirrors: local.preferMirrors !== false,
    mirrors: readUpdateMirrors(local),
    manifest: process.env.MINERADIO_UPDATE_MANIFEST
      || process.env.MINERADIO_UPDATE_MANIFEST_URL
      || process.env.MINERADIO_UPDATE_MANIFEST_FILE
      || '',
  };
}
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '1.0.1';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);

/* ---------- 汽水解密缓存 ---------- */
const qishuiAudioDecryptor = new TrackDecryptor();
const qishuiAudioDecryptCache = new Map();
const QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES = 96 * 1024 * 1024;
// 对象包装以保持引用稳定（导出后仍可原地修改 .value）
const qishuiAudioDecryptCacheBytes = { value: 0 };

/* ---------- 更新任务表 ---------- */
const updateDownloadJobs = new Map();

/* ---------- 听歌同步日志 ---------- */
function loadListenSyncJournal() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LISTEN_SYNC_JOURNAL_FILE, 'utf8'));
    const entries = parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    return { version: 1, entries };
  } catch (_) {
    return { version: 1, entries: {} };
  }
}
let listenSyncJournal = loadListenSyncJournal();
// 防抖批量写：200ms 内多次上报只落盘一次，避免高频听歌上报时反复全量序列化
let listenSyncJournalFlushTimer = 0;
let listenSyncJournalDirty = false;

function listenSyncAccountKey(provider, credential) {
  return String(provider || '') + ':' + crypto.createHash('sha256').update(String(credential || '')).digest('hex').slice(0, 16);
}
function listenSyncJournalKey(provider, credential, sessionId) {
  return listenSyncAccountKey(provider, credential) + ':' + String(sessionId || '');
}
function persistListenSyncJournalNow() {
  const entries = Object.entries(listenSyncJournal.entries || {})
    .sort((a, b) => Number(b[1] && b[1].submittedAt || 0) - Number(a[1] && a[1].submittedAt || 0))
    .slice(0, LISTEN_SYNC_JOURNAL_LIMIT);
  listenSyncJournal.entries = Object.fromEntries(entries);
  const dir = path.dirname(LISTEN_SYNC_JOURNAL_FILE);
  const temp = LISTEN_SYNC_JOURNAL_FILE + '.tmp-' + process.pid;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(listenSyncJournal, null, 2), 'utf8');
  fs.renameSync(temp, LISTEN_SYNC_JOURNAL_FILE);
}
function flushListenSyncJournalSoon() {
  listenSyncJournalDirty = true;
  if (listenSyncJournalFlushTimer) return;
  listenSyncJournalFlushTimer = setTimeout(() => {
    listenSyncJournalFlushTimer = 0;
    if (!listenSyncJournalDirty) return;
    listenSyncJournalDirty = false;
    try {
      persistListenSyncJournalNow();
    } catch (err) {
      console.warn('[ListenSyncJournal]', err.message);
    }
  }, 200);
}
function rememberListenSyncSubmission(key, result) {
  listenSyncJournal.entries[key] = {
    provider: result.provider,
    songId: String(result.songId || ''),
    submittedAt: Date.now(),
    accountDurationSync: result.accountDurationSync || 'unsupported',
    historySynced: !!result.historySynced,
  };
  flushListenSyncJournalSoon();
}

/* ---------- Cookie 持久化 ---------- */
const COOKIE_ATTRIBUTE_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly']);

function collectCookiePair(picked, key, value) {
  key = String(key || '').trim();
  if (!key || COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
  if (value === null || value === undefined) return;
  picked.set(key, String(value).trim());
}
function collectCookieInput(input, picked) {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    input.forEach(item => collectCookieInput(item, picked));
    return;
  }
  if (typeof input === 'object') {
    if (input.name && Object.prototype.hasOwnProperty.call(input, 'value')) {
      collectCookiePair(picked, input.name, input.value);
      return;
    }
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, value.value);
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
    });
  });
}
function normalizeCookieHeader(input) {
  const picked = new Map();
  collectCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}
function rawCookieFallback(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input) && input.every(item => typeof item === 'string')) return input.join('; ').trim();
  return '';
}
function getCookieFile() {
  return process.env.COOKIE_FILE || DEFAULT_COOKIE_FILE;
}
function getQQCookieFile() {
  return process.env.QQ_COOKIE_FILE || DEFAULT_QQ_COOKIE_FILE;
}
function getKugouCookieFile() {
  return process.env.KUGOU_COOKIE_FILE || DEFAULT_KUGOU_COOKIE_FILE;
}
function getQishuiCookieFile() {
  return process.env.QISHUI_COOKIE_FILE || DEFAULT_QISHUI_COOKIE_FILE;
}
function readConfiguredCookieFile(file) {
  try {
    if (file && fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) return '';
      // 新格式密文解密；解密失败（历史明文文件/密钥不匹配）回退原文
      return decryptCookieText(raw) || raw;
    }
  } catch (_) {}
  return '';
}
function writeConfiguredCookieFile(file, value) {
  try {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 落盘加密：防止明文凭据被随意读取（AES-256-GCM，机器特征密钥）
    fs.writeFileSync(file, encryptCookieText(String(value || '')), 'utf8');
  } catch (_) {}
}
const configuredCookieStores = {
  netease: { file: '', value: '', getFile: getCookieFile },
  qq: { file: '', value: '', getFile: getQQCookieFile },
  kugou: { file: '', value: '', getFile: getKugouCookieFile },
  qishui: { file: '', value: '', getFile: getQishuiCookieFile },
};
function refreshConfiguredCookieStore(store, force) {
  const file = store.getFile();
  if (force || store.file !== file) {
    store.file = file;
    store.value = readConfiguredCookieFile(file);
  }
  return store.value;
}
function saveConfiguredCookieStore(store, value) {
  const file = store.getFile();
  store.file = file;
  store.value = String(value || '');
  writeConfiguredCookieFile(file, store.value);
  return store.value;
}

let userCookie = '';
let qqCookie = '';
let kugouCookie = '';
let qishuiCookie = '';

function saveCookie(c) {
  userCookie = saveConfiguredCookieStore(configuredCookieStores.netease, normalizeCookieHeader(c) || rawCookieFallback(c));
  clearNeteaseLoginInfoCache();
}
function saveQQCookie(c) {
  qqCookie = saveConfiguredCookieStore(configuredCookieStores.qq, normalizeCookieHeader(c) || rawCookieFallback(c));
  qqVipInfoCache.clear();
  clearQQLikedPlaylistCoverCache();
}
function saveKugouCookie(c) {
  kugouCookie = saveConfiguredCookieStore(configuredCookieStores.kugou, normalizeCookieHeader(c) || rawCookieFallback(c));
}
function saveQishuiCookie(c) {
  qishuiCookie = saveConfiguredCookieStore(configuredCookieStores.qishui, normalizeQishuiCookieInput(c) || normalizeCookieHeader(c) || rawCookieFallback(c));
}
function refreshConfiguredCookieStores(force) {
  userCookie = refreshConfiguredCookieStore(configuredCookieStores.netease, force);
  qqCookie = refreshConfiguredCookieStore(configuredCookieStores.qq, force);
  kugouCookie = refreshConfiguredCookieStore(configuredCookieStores.kugou, force);
  qishuiCookie = refreshConfiguredCookieStore(configuredCookieStores.qishui, force);
}
function refreshQQConfiguredCookieStore(force) {
  qqCookie = refreshConfiguredCookieStore(configuredCookieStores.qq, force);
  return qqCookie;
}

/* ---------- 音源缓存 Map ---------- */
const qqLikedPlaylistCoverByUser = new Map();
const neteaseSourceMatchCache = new Map();
const qqVipInfoCache = new Map();
const neteasePlaylistTrackIndexCache = new Map();
const neteasePlaylistTrackIndexInflight = new Map();
const neteaseVipInfoCache = new Map();
// 注意：neteaseLoginInfoCache 必须保持引用稳定（原地清空而非重新赋值），
// 因为该引用被直接导出，路由/处理器模块持有同一对象。
const neteaseLoginInfoCache = { cookie: '', at: 0, value: null, promise: null };

/* ---------- 播放 URL 缓存 ----------
   网易云 handleSongUrl 的最终可播放地址（含同录音匹配结果）：
   同歌 + 同音质 + 同凭证指纹在 TTL 内直接复用，跳过「多品质探测 + 字节验证」
   全链（该链单次可能数百 ms ~ 数秒）。登录态变化时随 clearNeteaseLoginInfoCache 清空。 */
const neteasePlaybackUrlCache = new Map();
const NETEASE_PLAYBACK_URL_CACHE_TTL_MS = 30 * 60 * 1000;

function neteasePlaybackUrlCacheKey(id, qualityPreference, credentialFingerprint, hints) {
  const hintFingerprint = String(hints && (hints.name || hints.title) || '') + '|' + String(hints && hints.artist || '');
  return String(id) + '|' + String(qualityPreference || '') + '|' + String(credentialFingerprint || '') + '|' + hintFingerprint;
}
function readNeteasePlaybackUrlCache(key) {
  const hit = neteasePlaybackUrlCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > NETEASE_PLAYBACK_URL_CACHE_TTL_MS) {
    neteasePlaybackUrlCache.delete(key);
    return null;
  }
  return hit.value;
}
function writeNeteasePlaybackUrlCache(key, value) {
  if (!key || !value) return;
  neteasePlaybackUrlCache.set(key, { at: Date.now(), value });
}

function clearQQLikedPlaylistCoverCache() {
  qqLikedPlaylistCoverByUser.clear();
}
function clearNeteaseLoginInfoCache() {
  neteaseLoginInfoCache.cookie = '';
  neteaseLoginInfoCache.at = 0;
  neteaseLoginInfoCache.value = null;
  neteaseLoginInfoCache.promise = null;
  neteasePlaybackUrlCache.clear();
}
function invalidateNeteasePlaylistTrackIndex(playlistId) {
  neteasePlaylistTrackIndexCache.delete(playlistId);
  neteasePlaylistTrackIndexInflight.delete(playlistId);
}

/* ---------- 全局登录凭据清理 ---------- */
function clearAllRuntimeLoginCredentials(reason) {
  userCookie = '';
  qqCookie = '';
  kugouCookie = '';
  qishuiCookie = '';
  Object.keys(configuredCookieStores).forEach((key) => {
    configuredCookieStores[key].value = '';
  });
  clearNeteaseLoginInfoCache();
  qqVipInfoCache.clear();
  clearQQLikedPlaylistCoverCache();
  const qishui = clearQishuiAccessToken();
  const spotify = clearSpotifyToken();
  return {
    ok: true,
    reason: String(reason || 'login-reset'),
    qishui: !qishui || qishui.ok !== false,
    spotify: !spotify || spotify.ok !== false,
  };
}

/* ---------- 模块加载副作用：加载系统 CA + 初始化 cookie ---------- */
try {
  if (typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (system.length) {
      const seen = new Set();
      const merged = [];
      bundled.concat(system).forEach(cert => {
        if (!cert || seen.has(cert)) return;
        seen.add(cert);
        merged.push(cert);
      });
      if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
    }
  }
} catch (e) {
  console.warn('[TLS] system CA merge skipped:', e.message);
}
refreshConfiguredCookieStores(true);

module.exports = {
  // 服务配置
  PORT,
  HOST,
  ALLOWED_ORIGIN,
  PUBLIC_ROOT,
  APP_ROOT,
  UA,
  // 路径常量
  DEFAULT_COOKIE_FILE,
  DEFAULT_QQ_COOKIE_FILE,
  DEFAULT_KUGOU_COOKIE_FILE,
  DEFAULT_QISHUI_COOKIE_FILE,
  UPDATE_WORK_DIR,
  UPDATE_DOWNLOAD_DIR,
  UPDATE_PATCH_BACKUP_DIR,
  BEATMAP_CACHE_DIR,
  SONG_DOWNLOAD_DIR,
  CUEFIELD_FEEDBACK_FILE,
  LISTEN_SYNC_JOURNAL_FILE,
  LISTEN_SYNC_JOURNAL_LIMIT,
  UPDATE_FALLBACK_NOTES,
  PATCH_MAX_BYTES,
  PATCH_ALLOWED_ROOTS,
  PATCH_ALLOWED_FILES,
  OPEN_METEO_FORECAST_URL,
  OPEN_METEO_GEOCODE_URL,
  WEATHER_IP_LOCATION_URL,
  WEATHER_DEFAULT_LOCATION,
  // 汽水解密缓存
  qishuiAudioDecryptor,
  qishuiAudioDecryptCache,
  QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES,
  qishuiAudioDecryptCacheBytes,
  // 应用信息 / 更新配置
  APP_PACKAGE,
  APP_VERSION,
  UPDATE_CONFIG,
  // 更新任务表
  updateDownloadJobs,
  // 听歌同步日志
  listenSyncJournal,
  listenSyncAccountKey,
  listenSyncJournalKey,
  rememberListenSyncSubmission,
  flushListenSyncJournalSoon,
  // cookie 访问
  getUserCookie: () => userCookie,
  getQQCookie: () => qqCookie,
  getKugouCookie: () => kugouCookie,
  getQishuiCookie: () => qishuiCookie,
  setUserCookie: (v) => { userCookie = String(v || ''); },
  setQQCookie: (v) => { qqCookie = String(v || ''); },
  setKugouCookie: (v) => { kugouCookie = String(v || ''); },
  setQishuiCookie: (v) => { qishuiCookie = String(v || ''); },
  // cookie 工具
  normalizeCookieHeader,
  rawCookieFallback,
  saveCookie,
  saveQQCookie,
  saveKugouCookie,
  saveQishuiCookie,
  refreshConfiguredCookieStores,
  refreshQQConfiguredCookieStore,
  // 缓存 Map
  qqLikedPlaylistCoverByUser,
  neteaseSourceMatchCache,
  qqVipInfoCache,
  neteasePlaylistTrackIndexCache,
  neteasePlaylistTrackIndexInflight,
  neteaseVipInfoCache,
  neteaseLoginInfoCache,
  // 播放 URL 缓存
  neteasePlaybackUrlCache,
  NETEASE_PLAYBACK_URL_CACHE_TTL_MS,
  neteasePlaybackUrlCacheKey,
  readNeteasePlaybackUrlCache,
  writeNeteasePlaybackUrlCache,
  clearQQLikedPlaylistCoverCache,
  clearNeteaseLoginInfoCache,
  invalidateNeteasePlaylistTrackIndex,
  // 全局清理
  clearAllRuntimeLoginCredentials,
};
