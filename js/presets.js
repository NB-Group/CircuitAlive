/* FieldFlow · presets — 经典初中电路预置
 *
 * 元组格式 [type, x1, y1, x2, y2, props];电池 a 端(第一对坐标)= 负极。
 * 布局原则:矩形回路、电池在左列、电压表探针伸进空白行,避免与汇流线意外相交。 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;

/* 生成一行/一列导线的元组 */
function hRow(y, x0, x1) {
  var out = [], d = x1 > x0 ? 1 : -1;
  for (var x = x0; x !== x1; x += d) out.push([T.WIRE, x, y, x + d, y]);
  return out;
}
function vCol(x, y0, y1) {
  var out = [], d = y1 > y0 ? 1 : -1;
  for (var y = y0; y !== y1; y += d) out.push([T.WIRE, x, y, x, y + d]);
  return out;
}

var PRESETS = [];

/* 1. 串联:两灯串联(开关初始断开,闭合瞬间灯亮) */
PRESETS.push({
  id: 'series',
  name: '串联电路 · 两灯串联',
  tuples: [
    [T.BATTERY, 1, 1, 2, 1, { V: 3 }],
    [T.WIRE, 0, 1, 1, 1], [T.WIRE, 2, 1, 3, 1],
    [T.SWITCH, 3, 1, 4, 1, { closed: false }],
    [T.WIRE, 4, 1, 5, 1], [T.WIRE, 5, 1, 6, 1]
  ].concat(
    vCol(6, 1, 3),
    [
      [T.WIRE, 0, 3, 1, 3], [T.WIRE, 1, 3, 2, 3],
      [T.LAMP, 2, 3, 3, 3, { R: 10 }],
      [T.WIRE, 3, 3, 4, 3],
      [T.LAMP, 4, 3, 5, 3, { R: 20 }],
      [T.WIRE, 5, 3, 6, 3]
    ],
    vCol(0, 1, 3)
  )
});

/* 2. 并联:干路开关 + 两灯并联 */
PRESETS.push({
  id: 'parallel',
  name: '并联电路 · 两灯并联',
  tuples: [
    [T.BATTERY, 0, 3, 0, 2, { V: 3 }],
    [T.WIRE, 0, 2, 1, 2],
    [T.SWITCH, 1, 2, 2, 2, { closed: false }],
    [T.WIRE, 2, 2, 3, 2], [T.WIRE, 3, 2, 4, 2], [T.WIRE, 4, 2, 5, 2],
    [T.LAMP, 3, 2, 3, 3, { R: 10 }],
    [T.WIRE, 3, 3, 3, 4],
    [T.LAMP, 5, 2, 5, 3, { R: 30 }],
    [T.WIRE, 5, 3, 5, 4]
  ].concat(
    hRow(4, 5, 0),
    [[T.WIRE, 0, 4, 0, 3]]
  )
});

/* 3. 伏安法测电阻:电流表串联、电压表并联被测灯泡、滑变调控 */
PRESETS.push({
  id: 'vam',
  name: '伏安法测电阻 (A + V + 滑变)',
  tuples: [
    [T.BATTERY, 0, 3, 0, 2, { V: 3 }],
    [T.WIRE, 0, 2, 1, 2],
    [T.SWITCH, 1, 2, 2, 2, { closed: true }],
    [T.RHEOSTAT, 2, 2, 3, 2, { Rmax: 20, wiper: 0.5 }],
    [T.WIRE, 3, 2, 4, 2],
    [T.AMMETER, 4, 2, 5, 2],
    [T.WIRE, 5, 2, 6, 2],
    [T.LAMP, 6, 2, 7, 2, { R: 10 }],
    [T.WIRE, 6, 2, 6, 1],
    [T.VOLTMETER, 6, 1, 7, 1],
    [T.WIRE, 7, 1, 7, 2]
  ].concat(
    vCol(7, 2, 4),
    hRow(4, 7, 0),
    [[T.WIRE, 0, 4, 0, 3]]
  )
});

/* 4. 滑动变阻器调光:拖动滑片,亮度连续变化 */
PRESETS.push({
  id: 'dimmer',
  name: '滑动变阻器 · 调光',
  tuples: [
    [T.BATTERY, 0, 3, 0, 2, { V: 3 }],
    [T.WIRE, 0, 2, 1, 2],
    [T.SWITCH, 1, 2, 2, 2, { closed: true }],
    [T.RHEOSTAT, 2, 2, 3, 2, { Rmax: 50, wiper: 0.5 }],
    [T.WIRE, 3, 2, 4, 2],
    [T.LAMP, 4, 2, 5, 2, { R: 10 }],
    [T.WIRE, 5, 2, 6, 2]
  ].concat(
    vCol(6, 2, 4),
    hRow(4, 6, 0),
    [[T.WIRE, 0, 4, 0, 3]]
  )
});

/* 5. 短路演示:开关与灯并联。闭合 → 灯灭 + 电源短路(危险!) */
PRESETS.push({
  id: 'shortdemo',
  name: '短路演示 · 开关并联灯泡(危险)',
  tuples: [
    [T.WIRE, 0, 1, 1, 1],
    [T.LAMP, 1, 1, 2, 1, { R: 10 }],
    [T.WIRE, 2, 1, 3, 1], [T.WIRE, 3, 1, 4, 1],
    [T.WIRE, 0, 1, 0, 2],
    [T.SWITCH, 0, 2, 1, 2, { closed: false }],
    [T.WIRE, 1, 2, 2, 2], [T.WIRE, 2, 2, 3, 2], [T.WIRE, 3, 2, 4, 2],
    [T.WIRE, 4, 2, 4, 1],
    [T.WIRE, 0, 1, 0, 0],
    [T.BATTERY, 0, 0, 1, 0, { V: 3 }],
    [T.WIRE, 1, 0, 2, 0], [T.WIRE, 2, 0, 3, 0], [T.WIRE, 3, 0, 4, 0],
    [T.WIRE, 4, 0, 4, 1]
  ]
});

FF.presets = PRESETS;

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
