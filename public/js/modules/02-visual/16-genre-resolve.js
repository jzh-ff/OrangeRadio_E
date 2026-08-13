/* =========================================================================
   OrangeSea · 音乐风格解析（Genre Resolve）
   把任意来源的 genre 文本 / 歌曲信息归一到 12 个「视觉族群」，
   供风格电台（Genre Mode）与曲目详情展示使用。

   数据优先级：
     1. song.genre（本地文件 ID3 标签 / Spotify artist.genres 后补）
     2. 播客 category（网易云 djradio 分类）
     3. 关键词推断（艺术家名 + 标题 + 专辑，中英文规则表）
     4. 兜底 default

   纯函数、零依赖；解析结果缓存在运行时 song.visualGenre 上（不持久化）。
   ========================================================================= */

var GENRE_FAMILIES = [
  'electronic', 'hiphop', 'rock', 'metal', 'pop', 'folk',
  'classical', 'jazz', 'soul', 'ambient', 'anime', 'default'
];

var GENRE_PROFILE_VERSION = 'genre-profile-v1';

var GENRE_FAMILY_WORLDS = {
  electronic: 'electronic',
  rock: 'rock-metal',
  metal: 'rock-metal',
  hiphop: 'hiphop',
  pop: 'prism',
  anime: 'prism',
  default: 'prism',
  folk: 'folk',
  classical: 'classical',
  jazz: 'jazz-soul',
  soul: 'jazz-soul',
  ambient: 'ambient'
};

/* 族群中文显示名（风格徽章 / 曲目详情共用） */
var GENRE_FAMILY_LABELS = {
  electronic: '电子',
  hiphop: '嘻哈',
  rock: '摇滚',
  metal: '金属',
  pop: '流行',
  folk: '民谣',
  classical: '古典',
  jazz: '爵士',
  soul: '灵魂乐',
  ambient: '氛围',
  anime: '动漫',
  default: '综合'
};

/* genre 文本 → 族群 规则表。
   顺序即优先级：更具体的族群在前，避免被宽泛词抢先
   （如 synthpop 含 pop 但归 electronic；baroque pop 的 baroque 归 classical 可接受）。 */
var GENRE_FAMILY_RULES = [
  { family: 'anime', words: ['anime', 'anisong', 'vocaloid', 'acg', 'j-core', 'jcore', 'doujin', '动漫', '动画', '二次元', '同人', '初音'] },
  { family: 'classical', words: ['classical', 'orchestral', 'symphony', 'symphonic', 'chamber', 'opera', 'baroque', 'concerto', 'sonata', '古典', '交响', '管弦', '歌剧', '奏鸣曲'] },
  { family: 'metal', words: ['metal', 'thrash', 'deathcore', 'metalcore', 'grindcore', 'sludge', 'nu-metal', 'numetal', '金属'] },
  { family: 'electronic', words: ['electronic', 'electronica', 'edm', 'house', 'techno', 'trance', 'dubstep', 'drum and bass', 'dnb', 'synthwave', 'synthpop', 'synth-pop', 'synth', 'vaporwave', 'future bass', 'breakbeat', 'hardstyle', 'hardcore', 'electro', 'idm', 'glitch', 'chiptune', '8-bit', 'dance', 'disco', 'rave', 'big room', '电音', '电子', '舞曲', '迪斯科'] },
  { family: 'hiphop', words: ['hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill', 'boom bap', 'crunk', 'grime', 'phonk', '嘻哈', '说唱', '饶舌'] },
  { family: 'jazz', words: ['jazz', 'swing', 'bebop', 'big band', 'bossa', 'fusion', 'ragtime', 'dixieland', '爵士', '波萨'] },
  { family: 'soul', words: ['r&b', 'rnb', 'soul', 'funk', 'motown', 'gospel', 'neo-soul', 'neosoul', 'rhythm and blues', 'blues', '灵魂', '放克', '布鲁斯', '蓝调'] },
  { family: 'ambient', words: ['ambient', 'chillout', 'chill', 'downtempo', 'lofi', 'lo-fi', 'new age', 'meditation', 'sleep', 'spa', 'easy listening', 'lounge', 'white noise', '氛围', '轻音乐', '纯音乐', '放松', '冥想', '助眠', '白噪音'] },
  { family: 'rock', words: ['rock', 'punk', 'grunge', 'alternative', 'indie', 'britpop', 'shoegaze', 'emo', 'post-rock', 'surf rock', '摇滚', '朋克', '独立'] },
  { family: 'folk', words: ['folk', 'country', 'bluegrass', 'americana', 'celtic', 'singer-songwriter', 'ballad', 'acoustic', '民谣', '乡村', '民乐', '民歌', '山歌', '古风', '国风', '戏腔', '弹唱'] },
  { family: 'pop', words: ['pop', 'mandopop', 'cantopop', 'k-pop', 'kpop', 'j-pop', 'jpop', 'electropop', 'city pop', 'c-pop', 'cpop', '流行', '华语', '国语'] }
];

/* 无 genre 时的关键词推断表（艺术家名/标题/专辑）。
   英文以知名艺人为锚（复用 cuefield 思路并扩充），中文只用风格词，避免艺人名误判。 */
var GENRE_INFER_RULES = [
  { family: 'electronic', words: ['avicii', 'odesza', 'flume', 'apashe', 'deadmau5', 'skrillex', 'zedd', 'marshmello', 'daft punk', 'kygo', 'alan walker', 'illenium', 'porter robinson', 'madeon', 'martin garrix', 'tiesto', 'armin van buuren', 'above & beyond', 'fisher', 'dom dolla', 'john summit', 'anyma', 'tale of us', 'chemical brothers', 'the prodigy', 'aphex twin', 'boards of canada', 'vicetone', 'tobu', 'thefatrat', 'au5', 'puppet', 'dj ', ' remix', '电音', '电子', '舞曲'] },
  { family: 'hiphop', words: ['drake', 'kanye', 'kendrick', 'j. cole', 'j cole', 'travis scott', 'lil ', '21 savage', 'migos', 'cardi b', 'nicki minaj', 'eminem', 'jay-z', 'jay z', 'snoop', 'tupac', '2pac', 'notorious', 'ice cube', 'playboi carti', 'doja cat', 'post malone', 'tyler, the creator', 'tyler the creator', 'a$ap', 'asap rocky', 'megan thee', 'lil nas', 'juice wrld', 'xxxtentacion', 'mac miller', 'wu-tang', 'wutang', 'kendrick lamar', '说唱', '嘻哈', 'cypher'] },
  { family: 'rock', words: ['nirvana', 'acdc', 'ac/dc', 'metallica', 'linkin park', 'coldplay', 'radiohead', 'foo fighters', 'green day', 'queen', 'the beatles', 'beatles', 'led zeppelin', 'pink floyd', 'the rolling stones', 'oasis', 'blur', 'muse', 'arctic monkeys', 'the strokes', 'red hot chili', 'imagine dragons', 'twenty one pilots', 'fall out boy', 'my chemical romance', 'paramore', 'the killers', 'fleetwood mac', 'eagles', 'guns n\' roses', 'guns n roses', 'bon jovi', 'u2', 'beyond乐队', '摇滚'] },
  { family: 'metal', words: ['iron maiden', 'black sabbath', 'slipknot', 'megadeth', 'slayer', 'pantera', 'nightwish', 'rammstein', 'system of a down', 'avenged sevenfold', 'babymetal', 'bring me the horizon', 'architects', 'parkway drive', '金属'] },
  { family: 'classical', words: ['beethoven', 'mozart', 'bach', 'chopin', 'tchaikovsky', 'vivaldi', 'debussy', 'liszt', 'schubert', 'brahms', 'handel', '贝多芬', '莫扎特', '巴赫', '肖邦', '柴可夫斯基', '交响', '管弦', '钢琴协奏'] },
  { family: 'jazz', words: ['miles davis', 'john coltrane', 'chet baker', 'billie holiday', 'ella fitzgerald', 'louis armstrong', 'duke ellington', 'thelonious monk', 'norah jones', 'diana krall', '爵士'] },
  { family: 'soul', words: ['aretha franklin', 'stevie wonder', 'marvin gaye', 'al green', 'otis redding', 'ray charles', 'james brown', 'amy winehouse', 'bruno mars', 'anderson .paak', 'daniel caesar', 'giveon', 'sza', 'summer walker', '方大同', '陶喆', 'r&b'] },
  { family: 'folk', words: ['bob dylan', 'joni mitchell', 'leonard cohen', 'fleet foxes', 'bon iver', 'mumford', 'lumineers', 'kacey musgraves', 'johnny cash', '赵雷', '宋冬野', '马頔', '陈粒', '房东的猫', '花粥', '隔壁老樊', '万晓利', '周云蓬', '野孩子', '民谣', '古风', '国风', '弹唱'] },
  { family: 'ambient', words: ['brian eno', 'sigur ros', 'sigur rós', 'nils frahm', 'max richter', 'ólafur arnalds', 'olafur arnalds', 'ludovico einaudi', 'yiruma', '李闰珉', '坂本龙一', 'ryuichi sakamoto', 'hans zimmer', 'two steps from hell', 'lofi', 'lo-fi', '轻音乐', '纯音乐', '助眠', '白噪音', '冥想'] },
  { family: 'anime', words: ['yoasobi', 'lisa', 'aimer', 'ado', 'milet', 'yorushika', 'ヨルシカ', 'hikaru utada', '宇多田光', 'kenshi yonezu', '米津玄師', '米津玄师', 'radwimps', 'official髭男dism', 'eve', 'vaundy', 'fujii kaze', 'hatsune miku', '初音', '洛天依', '动漫', '动画', '二次元', 'vocaloid', 'v家'] }
];

function escapeGenreTerm(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* 中文风格词允许连续文本命中；英文/数字风格词必须满足 token 边界。 */
function genreTermMatches(text, term) {
  text = String(text == null ? '' : text).toLowerCase();
  term = String(term == null ? '' : term).toLowerCase().trim();
  if (!term) return false;
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(term)) {
    return text.indexOf(term) !== -1;
  }
  return new RegExp('(^|[^a-z0-9])' + escapeGenreTerm(term) + '(?=$|[^a-z0-9])').test(text);
}

function matchGenreRules(text, rules) {
  text = String(text == null ? '' : text).toLowerCase().trim();
  if (!text) return 'default';
  for (var i = 0; i < rules.length; i++) {
    var words = rules[i].words;
    for (var j = 0; j < words.length; j++) {
      if (genreTermMatches(text, words[j])) return rules[i].family;
    }
  }
  return 'default';
}

/* 把一段 genre 文本（可含 / 分隔多标签）归一到族群 */
function normalizeGenre(text) {
  return matchGenreRules(text, GENRE_FAMILY_RULES);
}

/* 关键词推断：艺术家 + 标题 + 专辑拼接后过规则表 */
function inferGenreFromKeywords(song) {
  var text = [
    song && song.artist,
    song && song.name,
    song && song.album
  ].filter(Boolean).join(' ').toLowerCase();
  return matchGenreRules(text, GENRE_INFER_RULES);
}

function genreSongIdentity(song) {
  return [
    song.provider, song.platform, song.source,
    song.id, song.songId, song.trackId, song.rid, song.mid, song.hash,
    song.localPath, song.path, song.url
  ].map(function (value) {
    return value == null ? '' : String(value);
  });
}

function genreProfileSignature(song) {
  return JSON.stringify([
    GENRE_PROFILE_VERSION,
    genreSongIdentity(song),
    song.genre,
    song.category,
    song.radioCategory,
    song.artist,
    song.name,
    song.album,
    song.type,
    song.radioName
  ]);
}

function buildGenreProfile(family, confidence, source) {
  return {
    family: family,
    world: GENRE_FAMILY_WORLDS[family] || GENRE_FAMILY_WORLDS.default,
    confidence: confidence,
    source: source,
    version: GENRE_PROFILE_VERSION
  };
}

/* 主入口：解析完整风格画像，并按曲目身份、解析输入与规则版本缓存。 */
function resolveGenreProfile(song) {
  if (!song || typeof song !== 'object') {
    return buildGenreProfile('default', 0.15, 'default');
  }
  var signature = genreProfileSignature(song);
  if (song.visualGenreProfile && song._visualGenreProfileSignature === signature) {
    return song.visualGenreProfile;
  }

  /* 仅在首次升级旧对象时接纳 visualGenre；本模块写入的新值由 profile 标记，
     后续输入变化时不会反过来锁死重新解析。 */
  var legacyFamily = !song.visualGenreProfile &&
    GENRE_FAMILIES.indexOf(song.visualGenre) !== -1
    ? song.visualGenre
    : '';
  var family = 'default';
  var confidence = 0.15;
  var source = 'default';
  var resolved = false;

  // 1. 显式 genre 标签（本地文件 ID3 / Spotify artist.genres）
  if (song.genre) {
    family = normalizeGenre(song.genre);
    if (family !== 'default') {
      confidence = 1;
      source = 'genre';
      resolved = true;
    }
  }
  // 2. 播客电台分类（网易云 djradio：category 被映射进 album）
  if (!resolved && (song.type === 'podcast' || song.radioName)) {
    var categoryCandidates = [song.radioCategory, song.category, song.album];
    for (var i = 0; i < categoryCandidates.length; i++) {
      var categoryFamily = normalizeGenre(categoryCandidates[i]);
      if (categoryFamily !== 'default') {
        family = categoryFamily;
        confidence = 0.85;
        source = 'category';
        resolved = true;
        break;
      }
    }
  }
  // 3. 迁移旧版已缓存的合法 visualGenre
  if (!resolved && legacyFamily) {
    family = legacyFamily;
    confidence = legacyFamily === 'default' ? 0.15 : 0.7;
    source = 'legacy';
    resolved = true;
  }
  // 4. 关键词推断
  if (!resolved) {
    family = inferGenreFromKeywords(song);
    if (family !== 'default') {
      confidence = 0.65;
      source = 'keyword';
    }
  }

  var profile = buildGenreProfile(family, confidence, source);
  song.visualGenreProfile = profile;
  song._visualGenreProfileSignature = signature;
  song.visualGenre = family;
  return profile;
}

/* 兼容旧入口：继续只返回 12 族群 family。 */
function inferGenreFamily(song) {
  return resolveGenreProfile(song).family;
}

/* 族群中文名（UI 展示） */
function genreFamilyLabel(family) {
  return GENRE_FAMILY_LABELS[family] || GENRE_FAMILY_LABELS.default;
}

/* 展示用：原始 genre 文本优先，其次族群中文名 */
function songGenreDisplayText(song) {
  if (!song || typeof song !== 'object') return '';
  if (song.genre) return String(song.genre);
  var family = inferGenreFamily(song);
  return family === 'default' ? '' : genreFamilyLabel(family);
}
