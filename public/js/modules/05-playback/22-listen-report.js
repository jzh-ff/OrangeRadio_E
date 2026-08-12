// ============================================================
//  听歌月度/年度报告（22-listen-report）
//  ------------------------------------------------------------
//  基于 listenStatsState（history 逐条记录 + songs/artists 聚合）
//  生成报告：周期总时长/播放次数、Top 歌曲与歌手、近 30 天热力图、
//  时段分布、平台分布。buildListenReport 为纯函数（可测试），
//  openListenReport 负责渲染弹窗。
// ============================================================

/* HTML 转义（此前仅测试沙箱定义，应用内缺失导致点击报告弹窗报错） */
function escapeHtmlSafe(s) {
  return String(s == null ? '' : s).replace(/[<>"'&]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
  });
}

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

// 日历热力图：把 dayHeatmap（'YYYY-MM-DD' → plays）铺成连续日期方格网格。
// month 显示最近 5 周（35 天），year/all 显示最近 12 周（84 天），
// 按 plays 占比分 4 档（0/1/2/3）映射到 CSS data-level。
function listenReportHeatmapHtml(dayHeatmap, period) {
  var days = period === 'month' ? 35 : 84;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  dayHeatmap = dayHeatmap || {};
  var maxPlays = 1;
  Object.keys(dayHeatmap).forEach(function (k) {
    var v = Number(dayHeatmap[k]) || 0;
    if (v > maxPlays) maxPlays = v;
  });
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var cells = [];
  for (var i = days - 1; i >= 0; i--) {
    var d = new Date(today.getTime() - i * 86400000);
    var dk = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    var plays = Number(dayHeatmap[dk]) || 0;
    var ratio = plays / maxPlays;
    var level = plays === 0 ? 0 : (ratio <= 0.34 ? 1 : (ratio <= 0.67 ? 2 : 3));
    var label = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    cells.push('<div class="lr-heat-cell" data-level="' + level + '" data-date="' + label + '" data-plays="' + plays + '" title="' + label + '：' + plays + ' 次"></div>');
  }
  return '<div class="lr-section"><div class="lr-section-title">播放日历<em>近 ' + days + ' 天，悬停查看日期</em></div>' +
    '<div class="lr-heatmap">' + cells.join('') + '</div></div>';
}

/* ---------- 总结句（年度报告式：一句话画像） ---------- */
function listenReportDominantPeriod(hourBuckets) {
  var groups = [
    { key: '深夜', hours: [0, 1, 2, 3, 4, 5] },
    { key: '清晨', hours: [6, 7, 8] },
    { key: '上午', hours: [9, 10, 11] },
    { key: '午间', hours: [12, 13, 14] },
    { key: '下午', hours: [15, 16, 17] },
    { key: '夜晚', hours: [18, 19, 20, 21, 22, 23] },
  ];
  var best = '', bestVal = 0;
  groups.forEach(function (g) {
    var v = g.hours.reduce(function (s, h) { return s + (hourBuckets[h] || 0); }, 0);
    if (v > bestVal) { bestVal = v; best = g.key; }
  });
  return bestVal > 0 ? best : '';
}

var LR_PERIOD_LINES = {
  '深夜': '夜深了还在听——你把安静留给了音乐',
  '清晨': '听歌从清晨开始，音乐是你的第一杯咖啡',
  '上午': '阳光正好的时候，你也有歌作伴',
  '午间': '午间的时光，总有一首歌陪着你',
  '下午': '下午的倦意，被一首首歌接住了',
  '夜晚': '夜晚是你的专属电台时间'
};

function listenReportSummaryText(report) {
  var lines = [];
  var period = listenReportDominantPeriod(report.hourBuckets);
  if (period && LR_PERIOD_LINES[period]) lines.push(LR_PERIOD_LINES[period]);
  var topArtist = report.topArtists && report.topArtists[0];
  if (topArtist && topArtist.name) lines.push('「' + topArtist.name + '」是你的常听歌手');
  if (!lines.length) return '这段时间，音乐陪了你 ' + report.plays + ' 次';
  return lines.join('，') + '。';
}

/* 音乐画像标签（查看偏好用） */
function listenPersonaTag(hourBuckets) {
  return {
    '深夜': '深夜电台 DJ',
    '清晨': '清晨追光者',
    '上午': '白昼旋律收集家',
    '午间': '午间慢煮时光',
    '下午': '午后咖啡伴侣',
    '夜晚': '夜风聆听者'
  }[listenReportDominantPeriod(hourBuckets)] || '音乐旅人';
}

/* ---------- 时段分布：固定像素高度（嵌套 flex 里 % 高度不可靠，曾导致全等高） ---------- */
function listenReportHoursHtml(hourBuckets) {
  var maxHour = Math.max.apply(null, hourBuckets.concat([1]));
  var TRACK_PX = 72;
  var hourBars = hourBuckets.map(function (v, h) {
    var px = v > 0 ? Math.max(5, Math.round((v / maxHour) * TRACK_PX)) : 2;
    var label = (h % 6 === 0) ? String(h) : '';
    return '<div class="lr-hour" title="' + h + ':00 · ' + v + ' 次">' +
      '<div class="lr-hour-track"><div class="lr-hour-bar" style="height:' + px + 'px"></div></div>' +
      '<span>' + label + '</span></div>';
  }).join('');
  return '<div class="lr-section"><div class="lr-section-title">播放时段分布<em>24 小时</em></div>' +
    '<div class="lr-hours">' + hourBars + '</div></div>';
}

function listenReportModalHtml(report) {
  var title = report.period === 'month' ? '月度听歌报告' : (report.period === 'year' ? '年度听歌报告' : '听歌总报告');
  var periodLabel = report.period === 'month' ? '近 30 天' : (report.period === 'year' ? '近一年' : '全部时间');
  var songsHtml = report.topSongs.length
    ? report.topSongs.map(function (s, i) {
        return '<div class="lr-row"><span class="lr-rank">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="lr-name">' + escapeHtmlSafe(s.name) + '</span>' +
          '<span class="lr-artist">' + escapeHtmlSafe(s.artist) + '</span>' +
          '<span class="lr-count">' + s.plays + ' 次</span></div>';
      }).join('')
    : '<div class="lr-empty">还没有足够的播放记录</div>';
  var artistsHtml = report.topArtists.length
    ? report.topArtists.map(function (a, i) {
        return '<div class="lr-row"><span class="lr-rank">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="lr-name">' + escapeHtmlSafe(a.name) + '</span>' +
          '<span class="lr-count">' + a.plays + ' 次</span></div>';
      }).join('')
    : '<div class="lr-empty">暂无歌手数据</div>';
  var platformHtml = Object.keys(report.platformMap).map(function (p) {
    return '<span class="lr-platform-chip">' + escapeHtmlSafe(p) + ' ' + report.platformMap[p] + '</span>';
  }).join('');

  return '<div class="lr-head">' +
    '<div class="lr-eyebrow">ORANGESEA · LISTENING REPORT</div>' +
    '<div class="lr-title">' + title + '</div>' +
    '<div class="lr-period">' + periodLabel + '</div>' +
    '<div class="lr-summary">' + escapeHtmlSafe(listenReportSummaryText(report)) + '</div>' +
    '<div class="lr-hero"><div class="lr-hero-num">' + escapeHtmlSafe(listenReportDurationText(report.totalListenMs)) + '</div>' +
    '<div class="lr-hero-sub">' + report.plays + ' 次播放 · ' + report.uniqueSongs + ' 首不同歌曲</div></div>' +
    '<div class="lr-section"><div class="lr-section-title">常听歌曲<em>TOP ' + Math.min(10, report.topSongs.length) + '</em></div><div class="lr-list">' + songsHtml + '</div></div>' +
    '<div class="lr-section"><div class="lr-section-title">常听歌手<em>TOP ' + Math.min(10, report.topArtists.length) + '</em></div><div class="lr-list">' + artistsHtml + '</div></div>' +
    listenReportHeatmapHtml(report.dayHeatmap, report.period) +
    listenReportHoursHtml(report.hourBuckets) +
    (platformHtml ? '<div class="lr-section"><div class="lr-section-title">音乐足迹</div><div class="lr-platforms">' + platformHtml + '</div></div>' : '') +
    '</div>';
}

/* 播放日历自定义悬停提示（原生 title 太慢太丑） */
function bindListenReportHeatTooltip(mask) {
  var tip = document.createElement('div');
  tip.className = 'lr-heat-tip';
  tip.style.display = 'none';
  mask.appendChild(tip);
  mask.addEventListener('mousemove', function (e) {
    var cell = (e.target && e.target.closest) ? e.target.closest('.lr-heat-cell') : null;
    if (!cell) { tip.style.display = 'none'; return; }
    var maskRect = mask.getBoundingClientRect();
    tip.textContent = (cell.getAttribute('data-date') || '') + ' · ' + (cell.getAttribute('data-plays') || '0') + ' 次';
    tip.style.display = 'block';
    tip.style.left = (e.clientX - maskRect.left + 14) + 'px';
    tip.style.top = (e.clientY - maskRect.top - 34) + 'px';
  });
  mask.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
}

function openListenReport(period) {
  var report = buildListenReport(listenStatsState, period);
  if (!report.plays) {
    showToast('还没有播放记录，先听几首歌吧');
    return;
  }
  try {
    // 复用现有 modal-mask 机制：动态创建并挂载
    // 注意必须加 .show：.modal-mask 默认 display:none，不加则弹窗不可见（表现为"无反应"）
    var mask = document.createElement('div');
    mask.className = 'modal-mask listen-report-mask show';
    mask.style.zIndex = '120';
    mask.innerHTML = '<div class="modal listen-report-modal" onclick="event.stopPropagation()">' +
      '<button class="modal-close" onclick="this.closest(\'.listen-report-mask\').remove()" title="关闭">×</button>' +
      listenReportModalHtml(report) +
      '</div>';
    mask.addEventListener('click', function () { mask.remove(); });
    bindListenReportHeatTooltip(mask);
    document.body.appendChild(mask);
  } catch (e) {
    showToast('报告渲染失败：' + (e && e.message || '未知错误'));
  }
}

/* ---------- 音乐画像（查看偏好 · 独立设计） ---------- */
function musicPortraitHtml(report) {
  var persona = listenPersonaTag(report.hourBuckets);
  var topArtist = report.topArtists && report.topArtists[0];
  var topSong = report.topSongs && report.topSongs[0];
  var period = listenReportDominantPeriod(report.hourBuckets);
  var platforms = Object.keys(report.platformMap).map(function (p) {
    return '<span class="lr-platform-chip">' + escapeHtmlSafe(p) + ' ' + report.platformMap[p] + '</span>';
  }).join('');
  return '<div class="lr-head mp-head">' +
    '<div class="lr-eyebrow">YOUR MUSIC PORTRAIT</div>' +
    '<div class="mp-persona">' + escapeHtmlSafe(persona) + '</div>' +
    '<div class="lr-summary">' + escapeHtmlSafe(listenReportSummaryText(report)) + '</div>' +
    '<div class="mp-rows">' +
    '<div class="mp-row"><span class="mp-key">本命歌手</span><span class="mp-val">' + (topArtist ? escapeHtmlSafe(topArtist.name) + '<em>' + topArtist.plays + ' 次</em>' : '—') + '</span></div>' +
    '<div class="mp-row"><span class="mp-key">常听曲目</span><span class="mp-val">' + (topSong ? escapeHtmlSafe(topSong.name) + '<em>' + topSong.plays + ' 次</em>' : '—') + '</span></div>' +
    '<div class="mp-row"><span class="mp-key">聆听总量</span><span class="mp-val">' + escapeHtmlSafe(listenReportDurationText(report.totalListenMs)) + '<em>' + report.plays + ' 次</em></span></div>' +
    '<div class="mp-row"><span class="mp-key">常听时段</span><span class="mp-val">' + (period || '—') + '</span></div>' +
    '</div>' +
    (platforms ? '<div class="lr-platforms mp-platforms">' + platforms + '</div>' : '') +
    '</div>';
}

function openMusicPortrait() {
  var report = buildListenReport(listenStatsState, 'all');
  if (!report.plays) {
    showToast('播放几首歌后会生成听歌画像');
    return;
  }
  try {
    var mask = document.createElement('div');
    mask.className = 'modal-mask listen-report-mask music-portrait-mask show';
    mask.style.zIndex = '120';
    mask.innerHTML = '<div class="modal listen-report-modal music-portrait-modal" onclick="event.stopPropagation()">' +
      '<button class="modal-close" onclick="this.closest(\'.music-portrait-mask\').remove()" title="关闭">×</button>' +
      musicPortraitHtml(report) +
      '</div>';
    mask.addEventListener('click', function () { mask.remove(); });
    document.body.appendChild(mask);
  } catch (e) {
    showToast('画像生成失败：' + (e && e.message || '未知错误'));
  }
}
