/* FieldFlow · copy · 界面上的全部中文文案
 *
 * 写作约定:
 * - 不用破折号和连接号,句子该断就断。
 * - 不先立一个没人主张的靶子再反驳,有话直接说。
 * - 不凑三连排比,不写一句话收尾。
 * - 公式写成 LaTeX,由 KaTeX 渲染。
 *
 * 这里只放文案,不放逻辑。需要插值的地方写成函数。
 */

export const copy = {
  app: {
    title: 'FieldFlow 电学实验台',
    shortTitle: 'FieldFlow',
    tagline: '画一个电路,看电流怎么流。',
    description: '在方格纸上搭直流电路,实时看到电流、电势和每个元件的读数。'
  },

  home: {
    heroTitle: '把电路题画出来,看它跑起来',
    heroLead:
      '从左边选一个元件,放到方格纸上,用导线连成回路。电流粒子沿导线移动,电势用颜色铺在导线上,每个元件的电压、电流、电阻和功率同时算好。改一个数字,整张图马上重算。',
    primaryCta: '开始画电路',
    secondaryCta: '打开示例',
    libraryCta: '我的电路',
    featureTitle: '能做什么',
    features: [
      {
        title: '按格点搭电路',
        text: '元件吸附在方格纸的格点上,导线沿水平或竖直方向连接。按住一条边拖动,可以连续铺出整段导线。'
      },
      {
        title: '实时求解',
        text: '用节点电压法解直流电路。电池内阻、导线电阻、滑动变阻器的滑片位置都参与计算。'
      },
      {
        title: '看见电势',
        text: '导线按电势高低着色,可以打开数值标签。单回路电路还会画出绕行一周的电势曲线。'
      },
      {
        title: '定义式就在手边',
        text: '每个元件的检查器里写着它的定义式。$R = U/I$ 标成量度式,电压写成两点电势差 $U = \\varphi_A - \\varphi_B$。'
      }
    ],
    startTitle: '从一道题开始',
    startText:
      '内置几个常见电路:两灯串联、两灯并联、伏安法测电阻、滑动变阻器调光、短路演示。打开一个,改改参数,看看读数怎么变。',
    startCta: '打开串联电路示例',
    footerNote:
      'FieldFlow 把电路存在你的浏览器里,不用注册。分享链接把整个电路编进地址栏,发给同学就能打开同一张图。'
  },

  about: {
    title: '这是什么',
    lead: 'FieldFlow 是一个画直流电路的工具,给初中电学用。',
    body: [
      '你在方格纸上放电池、开关、电阻、灯泡这些元件,用导线把它们连成回路。程序用节点电压法算出每个节点的电势和每条支路的电流,再把结果画出来:粒子沿导线移动,导线按电势着色,右栏列出每个元件的电压、电流、电阻和功率。',
      '每个元件的检查器里都写着它的定义式。电阻旁边写 $R = U/I$,并注明这是量度式。电压表旁边写 $U = \\varphi_+ - \\varphi_-$,读数就是两个接线柱的电势差。'
    ],
    notTitle: '它不能做什么',
    notBody: [
      '它只处理直流电路。磁场和电磁感应不在范围内,电容器充放电也没有做。',
      '元件按理想模型计算。导线默认没有电阻,电压表内阻视为无穷大,灯泡的电阻按定值处理。真实灯泡的灯丝电阻会随温度升高,实验室里的读数和这里的数字会有出入。',
      '它不会替你解题。电路要自己搭,参数也要自己调。'
    ],
    compareTitle: '和 PhET、Falstad 的区别',
    compareBody: [
      'PhET 的电路模拟覆盖从小学到大学的很多主题,配套的引导活动和教学材料很完整。Falstad 的 Circuit Simulator 擅长模拟电路,能看示波器波形和频率响应。',
      'FieldFlow 只做初中直流电路,重点放在定义和读数上。每个元件旁边有定义式,右栏的电压和电流直接对应 $I = q/t$ 与 $U = \\varphi_A - \\varphi_B$。',
      '需要覆盖更多主题时,PhET 的范围更广;分析复杂的模拟电路时,Falstad 的功能更全。要把初中电学的概念理顺,这个工具的元件说明写得更细。'
    ],
    links: [
      { label: 'PhET 电路模拟', href: 'https://phet.colorado.edu/zh_CN/' },
      { label: 'Falstad Circuit Simulator', href: 'https://www.falstad.com/circuit/' }
    ]
  },

  editor: {
    backHome: '主页',
    title: 'FieldFlow',
    layers: {
      current: '电流',
      electrons: '电子流向',
      potential: '电势',
      phiLabels: '电势数值',
      efield: '电场'
    },
    actions: {
      undo: '撤销',
      redo: '重做',
      clear: '清空',
      save: '保存',
      share: '分享',
      download: '下载文件',
      importFile: '导入文件',
      fit: '适配视图',
      close: '关闭',
      delete: '删除',
      rename: '重命名'
    },
    theme: { toDark: '深色', toLight: '浅色' },
    palette: {
      title: '元件',
      eraser: '橡皮',
      wire: '导线',
      battery: '电池',
      switch: '开关',
      resistor: '电阻',
      lamp: '灯泡',
      rheostat: '滑变',
      ammeter: '电流表',
      voltmeter: '电压表',
      motor: '电动机',
      bell: '电铃'
    },
    inspector: {
      title: '元件检查',
      empty: '点画布上的元件,查看它的定义和读数。',
      flip: '翻转两端 (R)',
      delete: '删除 (Del)',
      params: {
        emf: '电动势 E',
        internalR: '内阻 r',
        resistance: '电阻 R',
        maxR: '最大阻值',
        wiper: '滑片位置',
        state: '状态',
        closed: '闭合',
        open: '断开',
        closeSwitch: '闭合开关',
        openSwitch: '断开开关'
      },
      wireTitle: '导线(全部统一)',
      wireR: '电阻 r (0 为理想)',
      wireSegments: '段数',
      wirePerSegment: '每段 r',
      wireMaxDrop: '最大单段压降',
      wireState: '状态',
      wireIdeal: '理想',
      wireResistive: '有电阻',
      values: {
        terminalU: '端电压 U',
        emf: '电动势 E',
        internalR: '内阻 r',
        current: '电流 I',
        outputP: '输出功率',
        voltage: '电压 U',
        resistance: '电阻 R',
        power: '功率 P',
        phiPlus: 'φ(正接线柱)',
        phiMinus: 'φ(负接线柱)',
        reading: '读数 U',
        wireU: '两端 U',
        segments: '段数'
      }
    },
    meters: {
      title: '仪表读数',
      empty: '还没有仪表。电流表串联接入,电压表并联在被测部分两端。',
      reverseCurrent: '电流从另一端流入。',
      reversePolarity: '正接线柱接在低电势一侧。'
    },
    table: {
      title: '元件明细',
      empty: '画布上还没有元件。',
      headers: { element: '元件', voltage: 'U/V', current: 'I/A', resistance: 'R/Ω', power: 'P/W' },
      wires: (n) => '导线(全部 ' + n + ' 段)',
      ideal: '理想'
    },
    potential: {
      title: '电势分布',
      empty: '没有电源,电势没有定义。',
      zeroReference: '零参考',
      batteryNegative: '电池负极',
      customNode: '自定义节点',
      legendNote: '颜色越红电势越高。理想导线两端电势相等,颜色几乎不变。',
      profileTitle: '绕回路一周的电势变化',
      profileOnlyLoop: '电势曲线只在单回路电路里显示。'
    },
    probe: {
      title: '截面探针',
      crossSection: '截面',
      powered: '通电',
      charge: '通过截面电荷量',
      electrons: '每秒穿过截面的元电荷数',
      noCurrent: '这条导线现在没有电流,粒子静止。',
      note: '点只作示意。真实比例下,1 C 电荷约等于 6.2×10¹⁸ 个元电荷。'
    },
    hints: {
      place: '从左边选一个元件,再点方格纸上的边。',
      wireDrag: '按住一条边拖动,可以连续铺导线。',
      switch: '点开关中间,闭合或断开。',
      flip: '选中元件后按 R 翻转两端。',
      remove: '选中元件后按 Delete 删除。',
      pan: '按住空格拖动可以平移画布。',
      zoom: '滚轮缩放,按 F 回到全图。',
      probe: '双击导线,打开截面探针。',
      reference: '在电势模式下双击节点,把它设为 0 V 参考点。',
      empty: '先放一个电池,再用导线连成回路。'
    },
    status: {
      normal: '正常',
      open: '断路',
      short: '短路',
      noSource: '无电源',
      empty: '空画布',
      normalDetail: '回路闭合。正电荷从电池正极流出,经过外电路回到负极。',
      openDetail: '回路没有闭合,各支路电流为 0。断开处两端仍可能有电压。',
      shortDetail: '电源被导线直接连通,电流只受内阻限制。端电压接近 0,用电器不工作。',
      noSourceDetail: '画布上没有电池,没有电动势就没有持续电流。',
      emptyDetail: '画布是空的。放一个电池开始。'
    }
  },

  library: {
    title: '我的电路',
    empty: '还没有保存的电路。画一个,然后点保存。',
    saveTitle: '保存电路',
    nameLabel: '名称',
    namePlaceholder: '例如:两灯串联',
    save: '保存',
    cancel: '取消',
    open: '打开',
    rename: '重命名',
    renameTitle: '重命名电路',
    delete: '删除',
    deleteConfirm: '删除后无法恢复,确定吗?',
    draftLabel: '自动保存',
    savedAt: '最近修改',
    saved: '已保存。',
    deleted: '已删除。',
    renamed: '名称已更新。',
    quota: '浏览器本地存储已满,请先删掉一些电路。',
    unavailable: '当前浏览器不允许本地存储,保存功能不可用。',
    maxReached: '保存的电路数量已达上限,请先删掉一些。',
    invalidName: '名称不能为空。',
    invalidData: '这份电路数据不完整,无法保存。'
  },

  share: {
    title: '分享电路',
    linkLabel: '分享链接',
    copy: '复制链接',
    copied: '链接已复制。',
    copyFailed: '复制失败,请手动选中链接。',
    download: '下载 .ff.json',
    import: '导入 .ff.json',
    imported: '电路已导入。',
    invalid: '这个分享链接读不出来,可能被截断了。',
    longWarning: '电路较大,链接可能超过部分浏览器或聊天工具的长度限制。'
  },

  errors: {
    share: {
      notString: '分享码必须是文本。',
      empty: '分享码是空的。',
      badPrefix: '这不是一个 FieldFlow 分享码。',
      badChars: '分享码里有无法识别的字符。',
      badBody: '分享码的内容不完整。',
      badData: '电路数据不完整。',
      badLabel: (i) => '第 ' + (i + 1) + ' 条边的名称不是有效的 UTF-8 文本。',
      tooLong: '分享码太长,无法读取。',
      badVersion: (v, cur) => '分享码的版本是 ' + v + ',当前程序支持版本 ' + cur + '。',
      badWireR: '分享码里的导线电阻不是有效数字。',
      badEdgeCount: '电路里的边太多,无法读取。',
      badEdge: (i) => '第 ' + (i + 1) + ' 条边读不出来。',
      badCoord: (i) => '第 ' + (i + 1) + ' 条边的坐标不是整数。',
      coordRange: (i) => '第 ' + (i + 1) + ' 条边的坐标超出范围。',
      diagonal: (i, x1, y1, x2, y2) =>
        '第 ' + (i + 1) + ' 条边连接 (' + x1 + ', ' + y1 + ') 和 (' + x2 + ', ' + y2 + '),两端不在相邻格点上。',
      unknownType: (i, c) => '第 ' + (i + 1) + ' 条边的元件类型 ' + c + ' 不认识。',
      badProps: (i) => '第 ' + (i + 1) + ' 条边的参数格式不对。',
      badPropKey: (i, k) => '第 ' + (i + 1) + ' 条边有未知参数 ' + k + '。',
      badPropValue: (i, k) => '第 ' + (i + 1) + ' 条边的参数 ' + k + ' 不是有效值。',
      duplicate: (i) => '第 ' + (i + 1) + ' 条边和前面的边重复。',
      noBase: '当前环境没有页面地址,生成链接需要传入 base。',
      noDom: '当前环境没有浏览器页面,无法触发下载。',
      fileMissing: '没有选择文件。',
      fileUnreadable: '这个文件读不出来。',
      fileJson: '文件不是有效的 JSON。',
      fileShape: '文件里没有电路数据。',
      fileVersion: (v, cur) => '文件版本是 ' + v + ',当前程序支持版本 ' + cur + '。',
      fileEdges: '文件里的边数据不完整。'
    }
  }
}

export const TAGLINE = copy.app.tagline

export default copy
