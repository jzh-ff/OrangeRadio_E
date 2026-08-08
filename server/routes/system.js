/* =========================================================================
   OrangeSea · 系统路由（system）
   -------------------------------------------------------------------------
   /api/app/version、/api/platform/capabilities。
   ========================================================================= */
'use strict';

const { sendJSON } = require('../utils');
const {
  APP_PACKAGE,
  APP_VERSION,
  UPDATE_CONFIG,
  getQishuiCookie,
} = require('../context');
const { qishuiCookieHasLogin } = require('../../qishui-api');
const { handleSpotifyStatus } = require('../../spotify-api');

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/app/version') {
    sendJSON(res, {
      name: APP_PACKAGE.name || 'mineradio',
      productName: APP_PACKAGE.productName || `OrangeSea`,
      version: APP_VERSION,
      update: {
        provider: UPDATE_CONFIG.provider,
        configured: UPDATE_CONFIG.configured,
        owner: UPDATE_CONFIG.owner,
        repo: UPDATE_CONFIG.repo,
        preview: UPDATE_CONFIG.preview,
        manifestOverride: !!UPDATE_CONFIG.manifest,
      },
    });
    return true;
  }

  if (pn === '/api/platform/capabilities') {
    const spotifyStatus = await handleSpotifyStatus().catch(() => ({ loggedIn: false, capabilities: {} }));
    const qishuiCookie = getQishuiCookie();
    sendJSON(res, {
      netease: {
        playlists: true, likeRead: true, likeWrite: true, albumRead: true,
        albumCollect: true, commentsRead: true, commentsWrite: true,
        listenReport: 'experimental-unverified',
      },
      qq: {
        playlists: true, likeRead: true, likeWrite: false, albumRead: true,
        albumCollect: false, commentsRead: true, commentsWrite: false,
        listenReport: false,
      },
      kugou: {
        playlists: true, likeRead: true, likeWrite: true, albumRead: false,
        albumCollect: false, commentsRead: false, commentsWrite: false,
        listenReport: false,
      },
      qishui: {
        playlists: true, likeRead: true, likeWrite: qishuiCookieHasLogin(qishuiCookie),
        albumRead: false, albumCollect: qishuiCookieHasLogin(qishuiCookie),
        commentsRead: qishuiCookieHasLogin(qishuiCookie), commentsWrite: qishuiCookieHasLogin(qishuiCookie),
        recentPlayReport: qishuiCookieHasLogin(qishuiCookie), listenReport: false,
      },
      spotify: {
        playlists: true, likeRead: true,
        likeWrite: !!(spotifyStatus.capabilities && spotifyStatus.capabilities.likeWrite),
        playlistWrite: !!(spotifyStatus.capabilities && spotifyStatus.capabilities.playlistWrite),
        albumRead: true,
        albumCollect: !!(spotifyStatus.capabilities && spotifyStatus.capabilities.likeWrite),
        commentsRead: false, commentsWrite: false, listenReport: false,
        missingWriteScopes: spotifyStatus.missingWriteScopes || [],
      },
      local: {
        search: true,
        scan: true,
        playlists: false, likeRead: false, likeWrite: false,
        albumRead: false, albumCollect: false,
        commentsRead: false, commentsWrite: false, listenReport: false,
      },
    });
    return true;
  }

  return false;
}

module.exports = { handle };
