/* FieldFlow · 预置电路(元组格式 [type,x1,y1,x2,y2,props]) */

function hRow(y, x0, x1) {
  const out = [], d = x1 > x0 ? 1 : -1;
  for (let x = x0; x !== x1; x += d) out.push(['wire', x, y, x + d, y]);
  return out;
}
function vCol(x, y0, y1) {
  const out = [], d = y1 > y0 ? 1 : -1;
  for (let y = y0; y !== y1; y += d) out.push(['wire', x, y, x, y + d]);
  return out;
}

const PRESETS = [];


/* 1. 串联:两灯串联(开关初始断开,闭合瞬间灯亮) */
PRESETS.push({
  id: 'series',
  name: '串联电路 · 两灯串联',
  tuples: [
    ['battery', 1, 1, 2, 1, { V: 3 }],
    ['wire', 0, 1, 1, 1], ['wire', 2, 1, 3, 1],
    ['switch', 3, 1, 4, 1, { closed: false }],
    ['wire', 4, 1, 5, 1], ['wire', 5, 1, 6, 1]
  ].concat(
    vCol(6, 1, 3),
    [
      ['wire', 0, 3, 1, 3], ['wire', 1, 3, 2, 3],
      ['lamp', 2, 3, 3, 3, { R: 10 }],
      ['wire', 3, 3, 4, 3],
      ['lamp', 4, 3, 5, 3, { R: 20 }],
      ['wire', 5, 3, 6, 3]
    ],
    vCol(0, 1, 3)
  )
});

/* 2. 并联:干路开关 + 两灯并联 */
PRESETS.push({
  id: 'parallel',
  name: '并联电路 · 两灯并联',
  tuples: [
    ['battery', 0, 3, 0, 2, { V: 3 }],
    ['wire', 0, 2, 1, 2],
    ['switch', 1, 2, 2, 2, { closed: false }],
    ['wire', 2, 2, 3, 2], ['wire', 3, 2, 4, 2], ['wire', 4, 2, 5, 2],
    ['lamp', 3, 2, 3, 3, { R: 10 }],
    ['wire', 3, 3, 3, 4],
    ['lamp', 5, 2, 5, 3, { R: 30 }],
    ['wire', 5, 3, 5, 4]
  ].concat(
    hRow(4, 5, 0),
    [['wire', 0, 4, 0, 3]]
  )
});

/* 3. 伏安法测电阻:电流表串联、电压表并联被测灯泡、滑变调控 */
PRESETS.push({
  id: 'vam',
  name: '伏安法测电阻 (A + V + 滑变)',
  tuples: [
    ['battery', 0, 3, 0, 2, { V: 3 }],
    ['wire', 0, 2, 1, 2],
    ['switch', 1, 2, 2, 2, { closed: true }],
    ['rheostat', 2, 2, 3, 2, { Rmax: 20, wiper: 0.5 }],
    ['wire', 3, 2, 4, 2],
    ['ammeter', 4, 2, 5, 2],
    ['wire', 5, 2, 6, 2],
    ['lamp', 6, 2, 7, 2, { R: 10 }],
    ['wire', 6, 2, 6, 1],
    ['voltmeter', 6, 1, 7, 1],
    ['wire', 7, 1, 7, 2]
  ].concat(
    vCol(7, 2, 4),
    hRow(4, 7, 0),
    [['wire', 0, 4, 0, 3]]
  )
});

/* 4. 滑动变阻器调光:拖动滑片,亮度连续变化 */
PRESETS.push({
  id: 'dimmer',
  name: '滑动变阻器 · 调光',
  tuples: [
    ['battery', 0, 3, 0, 2, { V: 3 }],
    ['wire', 0, 2, 1, 2],
    ['switch', 1, 2, 2, 2, { closed: true }],
    ['rheostat', 2, 2, 3, 2, { Rmax: 50, wiper: 0.5 }],
    ['wire', 3, 2, 4, 2],
    ['lamp', 4, 2, 5, 2, { R: 10 }],
    ['wire', 5, 2, 6, 2]
  ].concat(
    vCol(6, 2, 4),
    hRow(4, 6, 0),
    [['wire', 0, 4, 0, 3]]
  )
});

/* 5. 短路演示:开关与灯并联。闭合 → 灯灭 + 电源短路(危险!) */
PRESETS.push({
  id: 'shortdemo',
  name: '短路演示 · 开关并联灯泡(危险)',
  tuples: [
    ['wire', 0, 1, 1, 1],
    ['lamp', 1, 1, 2, 1, { R: 10 }],
    ['wire', 2, 1, 3, 1], ['wire', 3, 1, 4, 1],
    ['wire', 0, 1, 0, 2],
    ['switch', 0, 2, 1, 2, { closed: false }],
    ['wire', 1, 2, 2, 2], ['wire', 2, 2, 3, 2], ['wire', 3, 2, 4, 2],
    ['wire', 4, 2, 4, 1],
    ['wire', 0, 1, 0, 0],
    ['battery', 0, 0, 1, 0, { V: 3 }],
    ['wire', 1, 0, 2, 0], ['wire', 2, 0, 3, 0], ['wire', 3, 0, 4, 0],
    ['wire', 4, 0, 4, 1]
  ]
});


export const presets = PRESETS;
