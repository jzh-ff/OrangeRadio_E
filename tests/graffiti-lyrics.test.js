'use strict';
/* 涂鸦墙：多语言分词 + 揭示时间表 + 动画抽签（纯函数）
   被测模块是无模块的全局脚本，用 vm 沙箱加载（同 film-radio-play-state.test.js 风格）。
   文件末尾有启动绑定 scheduleUiWarmTask(initGraffiti)，沙箱里吞掉不执行。
   注意：沙箱产出的数组/对象带沙箱 realm 原型，deepStrictEqual 会因原型不同而失败，
   所以跨 realm 比较一律用 join 成字符串或逐项断言原始值。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 'public', 'js', 'modules', '10-shell', '08-graffiti-lyrics.js');
const sandbox = {
  console,
  readBooleanPreference() { return false; },
  scheduleUiWarmTask() { return 0; },   /* 吞掉启动绑定，避免 DOM 依赖 */
  setTimeout() { return 0; },
  document: { getElementById() { return null; }, body: { classList: { toggle() { } } } },
  window: { addEventListener() { }, innerHeight: 800, innerWidth: 1280 },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

const {
  tokenizeGraffitiText, computeGraffitiReveals, pickGraffitiAnim,
  graffitiCharSeed, escapeGraffitiHtml, GRAFFITI_ANIMS, GRAFFITI_ANIM_BASE_DUR,
} = sandbox;

const types = (tokens) => tokens.map(t => t.type).join(' ');
const charIndexes = (tokens) => tokens.map(t => t.chars[0].i).join(' ');

/* ---------- tokenizeGraffitiText ---------- */

// 纯英文：词聚合 + 词距占位，字符全局码点索引连续
{
  const tokens = tokenizeGraffitiText('Hello world again');
  assert.equal(types(tokens), 'word space word space word');
  assert.equal(tokens[0].chars.length, 5);
  assert.equal(tokens[0].chars[0].c, 'H');
  assert.equal(tokens[0].chars[0].i, 0);
  assert.equal(tokens[0].chars[4].c, 'o');
  assert.equal(tokens[0].chars[4].i, 4);
  assert.equal(tokens[2].chars[0].c, 'w');
  assert.equal(tokens[2].chars[0].i, 6);                    // 空格不占字符索引
  assert.equal(tokens[4].chars[4].i, 16);
}

// 纯中文：逐字 char，无 space
{
  const tokens = tokenizeGraffitiText('你好世界');
  assert.equal(types(tokens), 'char char char char');
  assert.equal(charIndexes(tokens), '0 1 2 3');
}

// 中英混排：中文逐字 + 拉丁词 + 词距
{
  const tokens = tokenizeGraffitiText('爱你 forever 哟');
  assert.equal(types(tokens), 'char char space word space char');
  assert.equal(tokens[0].chars[0].c, '爱');
  assert.equal(tokens[3].chars.length, 7);                  // forever
  assert.equal(tokens[3].chars[0].i, 3);
  assert.equal(tokens[5].chars[0].c, '哟');
  assert.equal(tokens[5].chars[0].i, 11);
}

// 日文：假名+汉字逐字（桜=U+685A 在 CJK 区，が/く=平假名）
{
  const tokens = tokenizeGraffitiText('桜が咲く');
  assert.equal(types(tokens), 'char char char char');
}

// 韩文：谚文音节逐字，空格成词距占位（韩语按空格分词）
{
  const tokens = tokenizeGraffitiText('안녕 하세요');
  assert.equal(types(tokens), 'char char space char char char');
  assert.equal(tokens[3].chars[0].i, 3);
}

// 标点：全/半角都归 punct，缩小不旋转由渲染层负责
{
  const tokens = tokenizeGraffitiText('你好，world!');
  assert.equal(types(tokens), 'char char punct word punct');
  assert.equal(tokens[2].chars[0].c, '，');
  assert.equal(tokens[4].chars[0].c, '!');
}

// emoji：单码点 char（代理对占 2 个 UTF-16 code unit，码点索引仍连续）
{
  const text = '好😀好';
  assert.equal(text.length, 4);                             // code unit 长度
  const tokens = tokenizeGraffitiText(text);
  assert.equal(types(tokens), 'char char char');
  assert.equal(charIndexes(tokens), '0 1 2');               // 码点索引 0/1/2
}

// 撇号连字符入词：don't 不断词、'n' 聚合、well-known 不断词
{
  const tokens = tokenizeGraffitiText("don't stop");
  assert.equal(types(tokens), 'word space word');
  assert.equal(tokens[0].chars.length, 5);                  // d o n ' t
  const tokens2 = tokenizeGraffitiText("rock 'n' roll");
  assert.equal(types(tokens2), 'word space word space word');
  assert.equal(tokens2[2].chars.length, 3);                 // ' n '
  const tokens3 = tokenizeGraffitiText('well-known');
  assert.equal(tokens3.length, 1);
  assert.equal(tokens3[0].chars.length, 10);
}

// 拉丁扩展字母入词：Café 不在 é 处断词；西里尔（俄语）聚词
{
  const tokens = tokenizeGraffitiText('Café');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].chars.length, 4);
  const ru = tokenizeGraffitiText('Привет');
  assert.equal(ru.length, 1);
  assert.equal(ru[0].chars.length, 6);
}

// 连续空白折叠为一个词距占位
{
  const tokens = tokenizeGraffitiText('a  b');
  assert.equal(types(tokens), 'word space word');
}

// 前导空白不产生前导 space token（防御路径：上游已 trim）
{
  const tokens = tokenizeGraffitiText(' hello');
  assert.equal(types(tokens), 'word');
}

// 小数点两侧皆数字时入词（3.14 不断词）；句点孤立时仍是标点
{
  const tokens = tokenizeGraffitiText('3.14');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].chars.length, 4);
  const tokens2 = tokenizeGraffitiText('end.');
  assert.equal(types(tokens2), 'word punct');
}

// 破折号族归标点（缩小不旋转）：CJK 歌词常见的 ——
{
  const tokens = tokenizeGraffitiText('前进——后退');
  assert.equal(types(tokens), 'char char punct punct char char');
}

// grapheme 簇：ZWJ emoji 整簇一个单元（不劈成碎片），码点索引仍对齐
{
  const text = '👨‍👩‍👧好';                                  // 码点 6 个（👨 ZWJ 👩 ZWJ 👧 好）
  assert.equal(Array.from(text).length, 6);
  const tokens = tokenizeGraffitiText(text);
  assert.equal(types(tokens), 'char char');
  assert.equal(tokens[0].chars[0].c, '👨‍👩‍👧');               // 整簇文本
  assert.equal(tokens[0].chars[0].i, 0);
  assert.equal(tokens[1].chars[0].i, 5);                    // 好 的码点索引
}

// grapheme 簇：国旗（两个区域指示符）整簇一个单元
{
  const tokens = tokenizeGraffitiText('🇨🇳!');
  assert.equal(types(tokens), 'char punct');
  assert.equal(tokens[0].chars[0].c, '🇨🇳');
  assert.equal(tokens[1].chars[0].i, 2);
}

// grapheme 簇：NFD 组合重音入词（Cafe + ◌́ 不在重音处断词；显式 \u0301 转义防源码 NFC 规范化）
{
  const tokens = tokenizeGraffitiText('Café');   // NFD 分解形式
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].chars.length, 4);
  assert.equal(tokens[0].chars[3].c, 'é');       // 簇文本 e+́
  assert.equal(tokens[0].chars[3].i, 3);
}

/* ---------- computeGraffitiReveals · YRC ---------- */

// YRC code unit → 码点换算：emoji 不错位（核心 bug 修复）
{
  const text = 'ab😀cd';                                    // code unit: a0 b1 😀23 c4 d5
  const line = {
    t: 10, text,
    words: [
      { t: 10.0, d: 0.4, c0: 0, c1: 2 },                    // "ab"（code unit）
      { t: 10.4, d: 0.3, c0: 2, c1: 4 },                    // "😀"
      { t: 10.7, d: 0.5, c0: 4, c1: 6 },                    // "cd"
    ],
  };
  const reveals = computeGraffitiReveals(line, text, { lineIdx: 0 });
  assert.equal(reveals.length, 5);                          // 码点数 5（非 code unit 6）
  assert.equal(reveals[0], 0);                              // a
  assert.ok(Math.abs(reveals[1] - 0.2) < 1e-9);             // b：字内均分 0.5*0.4
  assert.ok(Math.abs(reveals[2] - 0.4) < 1e-9);             // 😀 ← 第二个 word（不错位）
  assert.ok(Math.abs(reveals[3] - 0.7) < 1e-9);             // c
  assert.ok(Math.abs(reveals[4] - 0.95) < 1e-9);            // d：0.7 + 0.5*0.5
}

// YRC 词粒度：词内所有字共享词首 reveal
{
  const text = 'ab cd';
  const line = {
    t: 10, text,
    words: [
      { t: 10.2, d: 0.6, c0: 0, c1: 2 },
      { t: 11.0, d: 0.6, c0: 3, c1: 5 },
    ],
  };
  const reveals = computeGraffitiReveals(line, text, { lineIdx: 0, groupByWord: true });
  assert.ok(Math.abs(reveals[0] - 0.2) < 1e-9);
  assert.equal(reveals[0], reveals[1]);                     // 词内同刻
  assert.ok(Math.abs(reveals[3] - 1.0) < 1e-9);
  assert.equal(reveals[3], reveals[4]);
  assert.ok(reveals[2] >= 0);                               // 空格无 span 但也分到兜底值
}

// YRC 未覆盖字符兜底：reveal 不为 -1
{
  const line = { t: 0, text: 'xyz', words: [{ t: 0, d: 0.3, c0: 0, c1: 1 }] };
  const reveals = computeGraffitiReveals(line, 'xyz', { lineIdx: 0 });
  assert.equal(reveals.length, 3);
  assert.ok(reveals.every(r => r >= 0));
  assert.ok(reveals[2] > reveals[1]);                       // 兜底累计推进
}

/* ---------- computeGraffitiReveals · LRC ---------- */

// LRC 字粒度：均分 + 抖动，单调不减，范围在行 duration 前 70% 附近
{
  const line = { t: 0, duration: 4, text: '你好世界' };
  const reveals = computeGraffitiReveals(line, '你好世界', { lineIdx: 3 });
  assert.equal(reveals.length, 4);
  for (let i = 1; i < reveals.length; i++) {
    assert.ok(reveals[i] >= reveals[i - 1], '单调不减');
  }
  assert.ok(reveals[0] >= 0);
  assert.ok(reveals[3] <= 4 * 0.7 + 0.041, '末字不超出 span+抖动上限');
  assert.ok(reveals[3] > 2.0, '末字接近 span（非全部挤在开头）');
}

// LRC 词粒度：词内同刻、词间单调、punct 跟随前一词
{
  const text = 'hi, brave yo';
  const line = { t: 0, duration: 4, text };
  const tokens = tokenizeGraffitiText(text);
  const reveals = computeGraffitiReveals(line, text, { lineIdx: 5, tokens, groupByWord: true });
  assert.equal(reveals.length, 12);
  assert.equal(reveals[0], reveals[1]);                     // hi 同刻
  assert.equal(reveals[0], reveals[2]);                     // , 跟随 hi
  assert.equal(reveals[4], reveals[8]);                     // brave 同刻（b=4 … e=8）
  assert.ok(reveals[4] > reveals[0], '词间推进');
  assert.ok(reveals[10] >= reveals[4], 'yo 不早于 brave');
  assert.equal(reveals[10], reveals[11]);
}

// LRC 空行防御
{
  const reveals = computeGraffitiReveals({ t: 0, duration: 2 }, '', {});
  assert.equal(reveals.length, 0);
}

/* ---------- pickGraffitiAnim / 种子稳定性 ---------- */

// 同一行抽签结果稳定（重渲染不换动画），且值在动画池内
{
  const a = pickGraffitiAnim(7);
  assert.equal(a, pickGraffitiAnim(7));
  assert.ok(GRAFFITI_ANIMS.includes(a));
  for (let i = 0; i < 200; i++) {
    assert.ok(GRAFFITI_ANIMS.includes(pickGraffitiAnim(i)), `lineIdx=${i} 动画在池内`);
    assert.ok(GRAFFITI_ANIM_BASE_DUR[pickGraffitiAnim(i)] > 0, '基准时长表覆盖所有动画');
  }
  // 动画池应有多种结果（不同行不同动画，随机分布）
  const set = new Set();
  for (let i = 0; i < 200; i++) set.add(pickGraffitiAnim(i));
  assert.ok(set.size >= 4, `200 行至少出现 4 种动画，实际 ${set.size}`);
}

// graffitiCharSeed：稳定且值域 [0,1)
{
  assert.equal(graffitiCharSeed(3, 5, 7), graffitiCharSeed(3, 5, 7));
  for (let i = 0; i < 500; i++) {
    const v = graffitiCharSeed(i, i * 3, i % 13);
    assert.ok(v >= 0 && v < 1);
  }
}

// escapeGraffitiHtml：防注入
{
  assert.equal(escapeGraffitiHtml('<a&>"\''), '&lt;a&amp;&gt;&quot;&#39;');
}

/* ---------- fitGraffitiFontSize · is-measuring 回归防护 ----------
   字号二分期间必须挂上 is-measuring（中和入场独立属性，否则 rise/zoom 的
   初始位移/缩放计入 scrollable overflow 会撑大读数、测出偏小字号），结束后移除。 */
{
  const makeBox = (hThreshold, wThreshold) => {
    const box = {
      style: {},
      clientWidth: 800,
      sawMeasuring: false,
      _classes: new Set(),
    };
    box.classList = {
      add(c) { if (c === 'is-measuring') box.sawMeasuring = true; box._classes.add(c); },
      remove(c) { box._classes.delete(c); },
      contains(c) { return box._classes.has(c); },
    };
    // 字号超过阈值视为超限（maxH = (800-124)*0.74 ≈ 500；maxW = clientWidth 800）
    Object.defineProperty(box, 'scrollHeight', {
      get() { return parseInt(box.style.fontSize, 10) > hThreshold ? 1000 : 100; },
    });
    Object.defineProperty(box, 'scrollWidth', {
      get() { return parseInt(box.style.fontSize, 10) > (wThreshold || 1e9) ? 2000 : 100; },
    });
    return box;
  };
  const box = makeBox(100);
  const lo = sandbox.fitGraffitiFontSize(box);
  assert.ok(box.sawMeasuring, '测量期间应添加 is-measuring');
  assert.ok(!box._classes.has('is-measuring'), '测量结束后应移除 is-measuring');
  assert.ok(lo >= 97 && lo <= 103, `二分应收敛到 ~100，实际 ${lo}`);
  assert.equal(box.style.fontSize, lo + 'px');

  // 宽度约束：scrollWidth 超宽时字号被压小
  const wide = makeBox(10000, 120);       // 高度永不超限，宽度 >120 超限
  const lo2 = sandbox.fitGraffitiFontSize(wide);
  assert.ok(lo2 >= 117 && lo2 <= 123, `宽度约束应收敛到 ~120，实际 ${lo2}`);
}

console.log('OK graffiti-lyrics');
