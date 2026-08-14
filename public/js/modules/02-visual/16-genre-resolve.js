/* =========================================================================
   OrangeSea · 音乐风格解析（Genre Resolve）
   把任意来源的 genre 文本 / 歌曲信息归一到 12 个「视觉族群」，
   供风格电台（Genre Mode）与曲目详情展示使用。

   数据优先级：
     1. song.genre（本地文件 ID3 标签 / Spotify artist.genres 后补）
     2. 播客 category（网易云 djradio 分类）
     3. 关键词推断（艺人/标题/专辑，含 artists[]、title、singer）
        先走艺人锚点表，再走风格词表（标题/专辑里的 rock、爵士、电音等）
     4. 兜底 default：family 仍为 default，世界按曲目身份在 8 个世界中稳定随机

   纯函数、零依赖；解析结果缓存在运行时 song.visualGenre 上（不持久化）。
   ========================================================================= */

var GENRE_FAMILIES = [
  'electronic', 'hiphop', 'rock', 'metal', 'pop', 'folk',
  'classical', 'jazz', 'soul', 'ambient', 'anime', 'default'
];

var GENRE_PROFILE_VERSION = 'genre-profile-v4';

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

var GENRE_WORLD_IDS = [
  'electronic', 'rock-metal', 'hiphop', 'prism',
  'folk', 'classical', 'jazz-soul', 'ambient'
];

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
   英文以知名艺人为锚，中文以确定性艺人与风格词为主，避免宽泛词误判。
   规则顺序即优先级：更具体的族群在前，pop 殿后兜底流行向曲目。 */
var GENRE_INFER_RULES = [
  { family: 'electronic', words: ['avicii', 'odesza', 'flume', 'apashe', 'deadmau5', 'skrillex', 'zedd', 'marshmello', 'daft punk', 'kygo', 'alan walker', 'illenium', 'porter robinson', 'madeon', 'martin garrix', 'tiesto', 'armin van buuren', 'above & beyond', 'fisher', 'dom dolla', 'john summit', 'anyma', 'tale of us', 'chemical brothers', 'the prodigy', 'aphex twin', 'boards of canada', 'vicetone', 'tobu', 'thefatrat', 'au5', 'puppet', 'the chainsmokers', 'calvin harris', 'david guetta', 'kavinsky', 'carpenter brut', 'kraftwerk', 'justice', 'm83', 'disclosure', 'jamie xx', 'four tet', 'moby', 'fatboy slim', 'underworld', 'depeche mode', '徐梦圆', 'panta.q', 'dj ', ' remix', '电音', '电子', '舞曲', '混音'] },
  { family: 'hiphop', words: ['drake', 'kanye', 'kendrick', 'kendrick lamar', 'j. cole', 'j cole', 'travis scott', 'lil ', 'lil wayne', '21 savage', 'migos', 'cardi b', 'nicki minaj', 'eminem', 'jay-z', 'jay z', 'snoop', 'tupac', '2pac', 'notorious', 'ice cube', 'playboi carti', 'doja cat', 'post malone', 'tyler, the creator', 'tyler the creator', 'a$ap', 'asap rocky', 'megan thee', 'lil nas', 'juice wrld', 'xxxtentacion', 'mac miller', 'wu-tang', 'wutang', 'future', '2 chainz', '50 cent', 'nas', 'biggie', 'wiz khalifa', 'tyga', 'chance the rapper', 'childish gambino', 'machine gun kelly', 'mgk', 'gai', '艾热', '马思唯', '法老', '杨和苏', '谢帝', '热狗', 'mc hotdog', '欧阳靖', 'jony j', '派克特', 'vava', 'higher brothers', '海尔兄弟', '那吾克热', '艾福杰尼', '说唱', '嘻哈', 'cypher', 'freestyle'] },
  { family: 'rock', words: ['nirvana', 'acdc', 'ac/dc', 'metallica', 'linkin park', 'coldplay', 'radiohead', 'foo fighters', 'green day', 'queen', 'the beatles', 'beatles', 'led zeppelin', 'pink floyd', 'the rolling stones', 'oasis', 'blur', 'muse', 'arctic monkeys', 'the strokes', 'red hot chili', 'imagine dragons', 'twenty one pilots', 'fall out boy', 'my chemical romance', 'paramore', 'the killers', 'fleetwood mac', 'eagles', 'guns n\' roses', 'guns n roses', 'bon jovi', 'u2', 'the 1975', 'tame impala', 'the white stripes', 'pearl jam', 'soundgarden', 'rage against the machine', 'korn', 'limp bizkit', 'offspring', 'blink-182', 'blink 182', 'sum 41', 'evanescence', 'panic at the disco', 'one republic', '五月天', '苏打绿', '万能青年旅店', '草东没有派对', '新裤子', '痛仰', '许巍', '汪峰', '崔健', '郑钧', '谢天笑', '二手玫瑰', '逃跑计划', '旅行团', '反光镜', 'gala', 'beyond乐队', '摇滚', '朋克', '独立'] },
  { family: 'metal', words: ['iron maiden', 'black sabbath', 'slipknot', 'megadeth', 'slayer', 'pantera', 'nightwish', 'rammstein', 'system of a down', 'avenged sevenfold', 'babymetal', 'bring me the horizon', 'architects', 'parkway drive', 'gojira', 'lamb of god', 'opeth', 'meshuggah', 'cannibal corpse', 'children of bodom', 'in flames', 'arch enemy', 'sepultura', 'judas priest', 'motorhead', 'anthrax', 'kreator', 'testament', '窒息', '扭曲的机器', '液氧罐头', '霜冻前夜', '金属', '碾核', '黑金', '死金', '旋死'] },
  { family: 'classical', words: ['beethoven', 'mozart', 'bach', 'chopin', 'tchaikovsky', 'vivaldi', 'debussy', 'liszt', 'schubert', 'brahms', 'handel', 'philip glass', 'yann tiersen', '郎朗', '李云迪', '王羽佳', '吕思清', '马友友', '谭盾', '陈萨', '张昊辰', '贝多芬', '莫扎特', '巴赫', '肖邦', '柴可夫斯基', '交响', '管弦', '钢琴协奏', '奏鸣曲', '圆舞曲', '小提琴', '大提琴', '钢琴曲'] },
  { family: 'jazz', words: ['miles davis', 'john coltrane', 'chet baker', 'billie holiday', 'ella fitzgerald', 'louis armstrong', 'duke ellington', 'thelonious monk', 'norah jones', 'diana krall', 'nat king cole', 'frank sinatra', 'dean martin', 'tony bennett', 'jamie cullum', 'gregory porter', 'kamasi washington', 'bill evans', 'dave brubeck', 'oscar peterson', 'keith jarrett', '小野丽莎', '王若琳', '爵士', 'swing', 'bossa nova'] },
  { family: 'soul', words: ['aretha franklin', 'stevie wonder', 'marvin gaye', 'al green', 'otis redding', 'ray charles', 'james brown', 'amy winehouse', 'bruno mars', 'anderson .paak', 'daniel caesar', 'giveon', 'sza', 'summer walker', 'frank ocean', 'alicia keys', 'john legend', 'erykah badu', 'd\'angelo', 'maxwell', 'usher', 'ne-yo', 'jill scott', 'the weeknd', 'earth wind & fire', 'earth wind and fire', '王力宏', '袁娅维', '丁世光', '方大同', '陶喆', 'r&b', '灵魂', '放克', '蓝调'] },
  { family: 'folk', words: ['bob dylan', 'joni mitchell', 'leonard cohen', 'fleet foxes', 'bon iver', 'mumford', 'lumineers', 'kacey musgraves', 'johnny cash', 'james taylor', 'cat stevens', 'nick drake', 'sufjan stevens', 'iron & wine', 'iron and wine', 'ben howard', 'damien rice', 'passenger', 'vance joy', 'simon & garfunkel', 'simon and garfunkel', '赵雷', '宋冬野', '马頔', '陈粒', '房东的猫', '花粥', '隔壁老樊', '万晓利', '周云蓬', '野孩子', '李健', '朴树', '老狼', '好妹妹', '鹿先森', '毛不易', '李志', '钟立风', '莫西子诗', '五条人', '赵照', '贰佰', '民谣', '古风', '国风', '弹唱', '山歌'] },
  { family: 'ambient', words: ['brian eno', 'sigur ros', 'sigur rós', 'nils frahm', 'max richter', 'ólafur arnalds', 'olafur arnalds', 'ludovico einaudi', 'yiruma', '李闰珉', '坂本龙一', 'ryuichi sakamoto', 'hans zimmer', 'two steps from hell', 'tycho', 'emancipator', 'nujabes', 'ulrich schnauss', 'tangerine dream', 'klaus schulze', 'enya', 'yanni', 'secret garden', 'bandari', 'enigma', 'kitaro', '喜多郎', '久石让', 'joe hisaishi', '林海', '石进', 'pianoboy', '赵海洋', 'lofi', 'lo-fi', '轻音乐', '纯音乐', '助眠', '白噪音', '冥想', '钢琴曲', '瑜伽'] },
  { family: 'anime', words: ['yoasobi', 'aimer', 'ado', 'milet', 'yorushika', 'ヨルシカ', 'hikaru utada', '宇多田光', 'kenshi yonezu', '米津玄師', '米津玄师', 'radwimps', 'official髭男dism', 'vaundy', 'fujii kaze', 'hatsune miku', '初音', '洛天依', '泽野弘之', 'hiroyuki sawano', '梶浦由记', 'yuki kajiura', 'kalafina', 'fripside', '水树奈奈', 'nana mizuki', 'claris', 'supercell', 'lia', '动漫', '动画', '二次元', 'vocaloid', 'v家'] },
  { family: 'pop', words: ['周杰伦', '林俊杰', '邓紫棋', '薛之谦', '李荣浩', '王菲', '陈奕迅', '张学友', '刘德华', '周华健', '张杰', '蔡依林', '孙燕姿', '梁静茹', '徐佳莹', '张靓颖', '华晨宇', '张艺兴', '王源', '王俊凯', '易烊千玺', '鹿晗', '汪苏泷', '许嵩', '周深', 'ariana grande', 'billie eilish', 'justin bieber', 'ed sheeran', 'adele', 'sam smith', 'katy perry', 'lady gaga', 'rihanna', 'beyonce', 'michael jackson', 'madonna', 'mariah carey', 'celine dion', 'elton john', 'maroon 5', 'one direction', 'harry styles', 'dua lipa', 'charlie puth', 'shawn mendes', 'troye sivan', 'blackpink', 'bts', 'twice', 'exo', '少女时代', 'taeyeon', 'iu', '流行'] }
];

/* 标题/专辑第二轮：复用族群风格词，但去掉「华语/国语」这类会把整库推进 pop 的宽泛词。 */
var GENRE_METADATA_FAMILY_RULES = GENRE_FAMILY_RULES.map(function (rule) {
  if (rule.family !== 'pop') return rule;
  return {
    family: 'pop',
    words: rule.words.filter(function (word) {
      return word !== '华语' && word !== '国语';
    })
  };
});

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

function pushGenreTextPart(parts, value) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) pushGenreTextPart(parts, value[i]);
    return;
  }
  if (typeof value === 'object') {
    pushGenreTextPart(parts, value.name);
    pushGenreTextPart(parts, value.title);
    return;
  }
  parts.push(String(value));
}

/* 推断文本：兼容网易 artists[]、QQ singer、本地 title/alia，避免只读 artist+name 漏判。 */
function genreSongText(song) {
  if (!song || typeof song !== 'object') return '';
  var parts = [];
  pushGenreTextPart(parts, song.artist);
  pushGenreTextPart(parts, song.artists);
  pushGenreTextPart(parts, song.ar);
  pushGenreTextPart(parts, song.singer);
  pushGenreTextPart(parts, song.author);
  pushGenreTextPart(parts, song.name);
  pushGenreTextPart(parts, song.title);
  pushGenreTextPart(parts, song.album);
  pushGenreTextPart(parts, song.alia);
  pushGenreTextPart(parts, song.alias);
  return parts.join(' ').toLowerCase();
}

/* 关键词推断：先艺人锚点，再标题/专辑风格词（如 Jazz Night、金属翻唱）。 */
function inferGenreFromKeywords(song) {
  var text = genreSongText(song);
  var family = matchGenreRules(text, GENRE_INFER_RULES);
  if (family !== 'default') return family;
  return matchGenreRules(text, GENRE_METADATA_FAMILY_RULES);
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
    song.singer,
    genreSongText(song),
    song.name,
    song.title,
    song.album,
    song.type,
    song.radioName
  ]);
}

/* 未识别曲目：按身份哈希稳定抽世界，同一首歌不跳世界，不同歌会散开。 */
function genreIdentityHash(song) {
  var key = '';
  if (song && typeof song === 'object') {
    key = genreSongIdentity(song).join('\0') + '\0' + genreSongText(song);
  }
  var hash = 5381;
  for (var i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function worldForFamily(family, song) {
  if (family !== 'default') {
    return GENRE_FAMILY_WORLDS[family] || 'prism';
  }
  return GENRE_WORLD_IDS[genreIdentityHash(song) % GENRE_WORLD_IDS.length];
}

function buildGenreProfile(family, confidence, source, song) {
  return {
    family: family,
    world: worldForFamily(family, song),
    confidence: confidence,
    source: source,
    version: GENRE_PROFILE_VERSION
  };
}

/* 主入口：解析完整风格画像，并按曲目身份、解析输入与规则版本缓存。 */
function resolveGenreProfile(song) {
  if (!song || typeof song !== 'object') {
    return buildGenreProfile('default', 0.15, 'default', song);
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

  var profile = buildGenreProfile(family, confidence, source, song);
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
