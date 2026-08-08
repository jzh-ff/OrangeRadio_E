// ============================================================
//  听歌月度/年度报告（22-listen-report）
//  ------------------------------------------------------------
//  基于 listenStatsState（history 逐条记录 + songs/artists 聚合）
//  生成报告：周期总时长/播放次数、Top 歌曲与歌手、近 30 天热力图、
//  时段分布、平台分布。buildListenReport 为纯函数（可测试），
//  openListenReport 负责渲染弹窗。
// ============================================================

function listenReportPeriodWindow(period) {
  if (period === 'month') return 30 * 24 * 3600 * 1000;
  if (period === 'year') return 365 * 24 * 3600 * 1000;
  return Infinity; // 'all'
}

function buildListenReport(stats, period) {
  stats = stats || {};
  var windowMs = listenReportPeriodWindow(period);
  var cutoff = windowMs === Infinity ? 0 : Date.now() - windowMs;
  var history = Array.isArray(stats.history) ? stats.history : [];

  var inWindow = history.filter(function (r) {
    return r && (!cutoff || Number(r.playedAt || 0) >= cutoff);
  });

  // 周期内聚合
  var songAgg = {};   // key → {name, artist, plays, listenMs}
  var artistAgg = {}; // name → {plays, listenMs}
  var dayMap = {};    // 'YYYY-MM-DD' → plays
  var hourBuckets = new Array(24).fill(0);
  var platformMap = {};
  var totalListenMs = 0;
  var completedCount = 0;
  var uniqueSongs = 0;

  inWindow.forEach(function (r) {
    totalListenMs += Number(r.listenMs) || 0;
    if (r.completed) completedCount += 1;
    var key = String(r.key || (r.provider || '') + ':' + (r.id || ''));
    if (!songAgg[key]) {
      songAgg[key] = { name: String(r.name || '未知歌曲'), artist: String(r.artist || ''), plays: 0, listenMs: 0 };
      uniqueSongs += 1;
    }
    songAgg[key].plays += 1;
    songAgg[key].listenMs += Number(r.listenMs) || 0;

    String(r.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function (name) {
      name = String(name || '').trim();
      if (!name) return;
      if (!artistAgg[name]) artistAgg[name] = { name: name, plays: 0, listenMs: 0 };
      artistAgg[name].plays += 1;
      artistAgg[name].listenMs += Number(r.listenMs) || 0;
    });

    var at = Number(r.playedAt) || 0;
    if (at) {
      var d = new Date(at);
      var dayKey = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
      dayMap[dayKey] = (dayMap[dayKey] || 0) + 1;
      hourBuckets[d.getHours()] = (hourBuckets[d.getHours()] || 0) + 1;
    }

    var source = String(r.source || r.provider || 'unknown');
    platformMap[source] = (platformMap[source] || 0) + 1;
  });

  var topSongs = Object.keys(songAgg).map(function (k) { return songAgg[k]; })
    .sort(function (a, b) { return (b.plays - a.plays) || (b.listenMs - a.listenMs); })
    .slice(0, 10);
  var topArtists = Object.keys(artistAgg).map(function (k) { return artistAgg[k]; })
    .sort(function (a, b) { return (b.plays - a.plays) || (b.listenMs - a.listenMs); })
    .slice(0, 10);

  return {
    period: period,
    windowMs: windowMs,
    totalListenMs: totalListenMs,
    plays: inWindow.length,
    completed: completedCount,
    uniqueSongs: uniqueSongs,
    topSongs: topSongs,
    topArtists: topArtists,
    dayHeatmap: dayMap,
    hourBuckets: hourBuckets,
    platformMap: platformMap,
  };
}

function listenReportDurationText(ms) {
  ms = Math.max(0, Number(ms) || 0);
  var hours = Math.floor(ms / 3600000);
  var minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return hours + ' 小时 ' + minutes + ' 分钟';
  return minutes + ' 分钟';
}

function listenReportModalHtml(report) {
  var title = report.period === 'month' ? '月度听歌报告' : (report.period === 'year' ? '年度听歌报告' : '听歌总报告');
  var songsHtml = report.topSongs.length
    ? report.topSongs.map(function (s, i) {
        return '<div class="lr-row"><span class="lr-rank">' + (i + 1) + '</span>' +
          '<span class="lr-name">' + escapeHtmlSafe(s.name) + '</span>' +
          '<span class="lr-artist">' + escapeHtmlSafe(s.artist) + '</span>' +
          '<span class="lr-count">' + s.plays + ' 次</span></div>';
      }).join('')
    : '<div class="lr-empty">还没有足够的播放记录</div>';
  var artistsHtml = report.topArtists.length
    ? report.topArtists.map(function (a, i) {
        return '<div class="lr-row"><span class="lr-rank">' + (i + 1) + '</span>' +
          '<span class="lr-name">' + escapeHtmlSafe(a.name) + '</span>' +
          '<span class="lr-count">' + a.plays + ' 次</span></div>';
      }).join('')
    : '<div class="lr-empty">暂无歌手数据</div>';

  var maxHour = Math.max.apply(null, report.hourBuckets.concat([1]));
  var hourBars = report.hourBuckets.map(function (v, h) {
    var pct = Math.max(4, Math.round((v / maxHour) * 100));
    return '<div class="lr-hour" title="' + h + ' 时：' + v + ' 次"><div class="lr-hour-bar" style="height:' + pct + '%"></div><span>' + h + '</span></div>';
  }).join('');

  var platformHtml = Object.keys(report.platformMap).map(function (p) {
    return '<span class="lr-platform-chip">' + escapeHtmlSafe(p) + ' ' + report.platformMap[p] + '</span>';
  }).join('');

  return '<div class="lr-head">' +
    '<div class="lr-title">' + title + '</div>' +
    '<div class="lr-metrics">' +
      '<div class="lr-metric"><strong>' + listenReportDurationText(report.totalListenMs) + '</strong><span>聆听时长</span></div>' +
      '<div class="lr-metric"><strong>' + report.plays + '</strong><span>播放次数</span></div>' +
      '<div class="lr-metric"><strong>' + report.uniqueSongs + '</strong><span>不同歌曲</span></div>' +
    '</div>' +
    '<div class="lr-section-title">常听歌曲 TOP ' + Math.min(10, report.topSongs.length) + '</div>' +
    '<div class="lr-list">' + songsHtml + '</div>' +
    '<div class="lr-section-title">常听歌手 TOP ' + Math.min(10, report.topArtists.length) + '</div>' +
    '<div class="lr-list">' + artistsHtml + '</div>' +
    '<div class="lr-section-title">近 30 天播放时段分布</div>' +
    '<div class="lr-hours">' + hourBars + '</div>' +
    (platformHtml ? '<div class="lr-platforms">' + platformHtml + '</div>' : '') +
    '</div>';
}

function openListenReport(period) {
  var report = buildListenReport(listenStatsState, period);
  if (!report.plays) {
    showToast('还没有播放记录，先听几首歌吧');
    return;
  }
  try {
    // 复用现有 modal-mask 机制：动态创建并挂载
    var mask = document.createElement('div');
    mask.className = 'modal-mask listen-report-mask';
    mask.style.zIndex = '120';
    mask.innerHTML = '<div class="modal listen-report-modal" onclick="event.stopPropagation()">' +
      '<button class="modal-close" onclick="this.closest(\'.listen-report-mask\').remove()" title="关闭">×</button>' +
      listenReportModalHtml(report) +
      '</div>';
    mask.addEventListener('click', function () { mask.remove(); });
    document.body.appendChild(mask);
  } catch (e) {
    showToast('报告渲染失败：' + (e && e.message || '未知错误'));
  }
}
