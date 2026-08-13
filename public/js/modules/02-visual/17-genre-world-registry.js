/* =========================================================================
   OrangeSea · 风格世界注册表（Genre World Registry）
   保存 8 个世界的稳定元数据、12 个风格族群映射，以及运行时 World Kit。
   ========================================================================= */

var GENRE_WORLD_DEFINITIONS = [
  { id: 'electronic', designName: '霓虹反应城', englishName: 'Neon Reactive City', palette: ['#07131f', '#00e5ff', '#ff37d1'], accent: '#00e5ff', lyricStyle: 'hologram-signs', families: ['electronic'] },
  { id: 'rock-metal', designName: '裂隙铸造场', englishName: 'Rift Foundry', palette: ['#170b08', '#ff4a24', '#ffc061'], accent: '#ff4a24', lyricStyle: 'fractured-stage', families: ['rock', 'metal'] },
  { id: 'hiphop', designName: '午夜街区', englishName: 'Midnight Block', palette: ['#100c1c', '#bf67ff', '#ffd64a'], accent: '#bf67ff', lyricStyle: 'architectural-type', families: ['hiphop'] },
  { id: 'prism', designName: '棱镜梦乐园', englishName: 'Prism Dreamland', palette: ['#120d25', '#ff79d1', '#72e8ff'], accent: '#ff79d1', lyricStyle: 'dream-ribbons', families: ['pop', 'anime', 'default'] },
  { id: 'folk', designName: '琥珀旷野', englishName: 'Amber Wilds', palette: ['#171109', '#e8aa4c', '#8fcf8a'], accent: '#e8aa4c', lyricStyle: 'constellation-script', families: ['folk'] },
  { id: 'classical', designName: '无尽歌剧院', englishName: 'Infinite Opera House', palette: ['#100d15', '#e9d6ad', '#a98ad8'], accent: '#e9d6ad', lyricStyle: 'spatial-score', families: ['classical'] },
  { id: 'jazz-soul', designName: '蓝烟俱乐部', englishName: 'Blue Smoke Club', palette: ['#07131a', '#58b6d9', '#d99b68'], accent: '#58b6d9', lyricStyle: 'improvised-anchor', families: ['jazz', 'soul'] },
  { id: 'ambient', designName: '潮汐虚境', englishName: 'Tidal Void', palette: ['#06151b', '#70d8cc', '#718bbd'], accent: '#70d8cc', lyricStyle: 'horizon-dissolve', families: ['ambient'] }
];

var GENRE_WORLD_FAMILY_MAP = {
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

var genreWorldRegistry = Object.create(null);

for (var genreWorldDefinitionIndex = 0;
  genreWorldDefinitionIndex < GENRE_WORLD_DEFINITIONS.length;
  genreWorldDefinitionIndex++) {
  var genreWorldDefinition = GENRE_WORLD_DEFINITIONS[genreWorldDefinitionIndex];
  genreWorldRegistry[genreWorldDefinition.id] = {
    id: genreWorldDefinition.id,
    label: genreWorldDefinition.designName,
    designName: genreWorldDefinition.designName,
    englishName: genreWorldDefinition.englishName,
    palette: genreWorldDefinition.palette.slice(),
    accent: genreWorldDefinition.accent,
    lyricStyle: genreWorldDefinition.lyricStyle,
    families: genreWorldDefinition.families.slice(),
    kit: null
  };
}

function isValidGenreWorldKit(kit) {
  return !!kit && typeof kit === 'object' && typeof kit.create === 'function';
}

/* 每个内置世界只接受一次有效注册。失败统一返回 false，不覆盖已有 kit。 */
function registerGenreWorld(id, kit) {
  id = typeof id === 'string' ? id.trim() : '';
  var record = id && genreWorldRegistry[id];
  if (!record || record.kit || !isValidGenreWorldKit(kit)) return false;
  record.kit = kit;
  return true;
}

function getGenreWorld(id) {
  return typeof id === 'string' ? (genreWorldRegistry[id] || null) : null;
}

function genreWorldForFamily(family) {
  var id = GENRE_WORLD_FAMILY_MAP[family] || GENRE_WORLD_FAMILY_MAP.default;
  return getGenreWorld(id);
}

function listGenreWorlds() {
  return GENRE_WORLD_DEFINITIONS.map(function (definition) {
    return genreWorldRegistry[definition.id];
  });
}
