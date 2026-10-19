/**
 * 国家医保局《放射检查类医疗服务价格项目立项指南（试行）》
 * 依据：医保价采函〔2024〕233号（2024-11-25 发布，现行放射检查类价格项目整合为 26 项）
 *
 * 为什么单独一个文件：
 *   口腔类立项指南（医保价采函〔2025〕18号）编码段为 0124 / 0131 / 0133；
 *   而口腔门诊高频使用的「X 线摄影成像」「口腔曲面体层成像（全景片）」「牙片」「CBCT」
 *   属于**放射检查类**立项指南，编码段为 0123 / 0123 0102（CT），
 *   两者是两份独立文件，必须分别录入，否则搜不到。
 *
 * 数据来源：上海市医疗保障局《放射检查类医疗服务价格项目》官方价格表（PDF），
 *          项目编码 / 服务产出 / 价格构成 / 计价说明均与立项指南一致。
 * ⚠️ 价格为政府指导价（最高限价），三级 / 二级 / 一级医疗机构三档，不得上浮、下浮不限。
 * ⚠️ 各地落地价差异较大（四川成都按三甲/三乙/二甲/二乙/二乙以下**五档**），
 *    本文件在 regionalPrices 字段给出可比参考，实际执行请以当地医保局最新文件为准。
 * ⚠️ 医保支付类别存在地区差异：口腔颌面锥形束 CT（CBCT）与 CT 平扫在**上海为甲类**，
 *    多数省份（重庆 / 江苏 / 湖南 / 西藏等）为**乙类**。本文件按多数省份口径标注为乙类，
 *    避免低估患者先行自付比例。
 * ⚠️ 本文件为手工维护（无官方 xlsx 底表），修改后请重跑 node build.js 与全部验证脚本。
 */

export const IMAGING_META = {
  id: 'radiology',
  name: '放射检查类（口腔相关）',
  docNo: '医保价采函〔2024〕233号',
  docName: '国家医保局《放射检查类医疗服务价格项目立项指南（试行）》',
  totalCount: 26,
  note: '国家立项指南将放射检查类整合为 26 项，其中口腔门诊常用的是 X 线摄影成像（含牙片、口腔曲面体层成像）与计算机体层成像（CT）平扫（含口腔颌面锥形束 CT）。'
};

/** 四个城市参考价（用于「各地差异」提示，非本系统计费依据） */
const REGION = {
  xray: [
    { city: '广州', levels: '三级/二级/一级', value: '50 / 45 / 40' },
    { city: '上海', levels: '三级/二级/一级', value: '50 / 43 / 35' },
    { city: '重庆', levels: '三级/二级/一级/其他', value: '41.8 / 38 / 36.1 / 34.2' },
    { city: '成都', levels: '三甲/三乙/二甲/二乙/二乙以下', value: '55 / 50 / 46 / 44 / 41' }
  ],
  film: [
    { city: '广州', levels: '三级/二级/一级', value: '10 / 9 / 8' },
    { city: '上海', levels: '三级/二级/一级', value: '18 / 18 / 18' },
    { city: '重庆', levels: '三级/二级/一级/其他', value: '11 / 10 / 9.5 / 9' },
    { city: '成都', levels: '区县公立', value: '12 ~ 16' }
  ],
  cbct: [
    { city: '广州', levels: '三级', value: '184.8' },
    { city: '上海', levels: '三级/二级/一级', value: '189 / 177 / 165' },
    { city: '重庆', levels: '三级/二级/一级/其他', value: '253 / 230 / 218.5 / 207' },
    { city: '成都', levels: '区县公立', value: '187 ~ 199' }
  ]
};

/** 口腔门诊常用的放射检查类项目（9 项：4 主项目 + 5 加收/扩展） */
export const IMAGING_ITEMS = [
  {
    code: '012301010010000',
    name: 'X线摄影成像',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 50,
    priceLevel2: 43,
    priceLevel1: 35,
    unit: '部位·体位',
    copayRate: 0.0,
    output: '通过X线摄影（含数字化），实现对患者投照部位的定位、X线成像及分析。',
    composition: '所定价格涵盖摆位、摄影、成像、分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '每部位涉及多体位曝光的最高计费不超过一倍。',
    restrictions: '每部位涉及多体位曝光的最高计费不超过一倍。',
    aliases: 'X光 平片 头影测量 头颅侧位 头颅正位 颌骨片 放射 拍片 X线',
    regionalPrices: REGION.xray,
    isAddon: false
  },
  {
    code: '012301010010011',
    name: 'X线摄影成像-动态X线摄影（加收）',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 45,
    priceLevel2: 45,
    priceLevel1: 45,
    unit: '次',
    copayRate: 0.0,
    output: '在X线摄影成像基础上动态记录关节或腔道运动过程，用于颞下颌关节动态观察等。',
    composition: '所定价格涵盖动态摄影、成像、分析、出具报告、数字影像处理与上传存储等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '加收项，须挂靠「X线摄影成像」主项目收取。',
    restrictions: '加收项，须挂靠「X线摄影成像」主项目收取。各地对动态X线摄影的医保支付类别不一致（部分省份列为丙类/自费）。',
    aliases: '',
    isAddon: true
  },
  {
    code: '012301010010100',
    name: 'X线摄影成像-人工智能辅助诊断（扩展）',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 50,
    priceLevel2: 43,
    priceLevel1: 35,
    unit: '部位·体位',
    copayRate: 0.0,
    output: '应用人工智能辅助诊断技术，对X线摄影成像结果进行辅助判读与分析。',
    composition: '所定价格涵盖摆位、摄影、成像、人工智能辅助分析、出具报告、数字影像处理与上传存储等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '扩展项，指在原项目基础上应用人工智能辅助诊断技术；各地对是否单列收费及支付类别规定不一。',
    restrictions: '扩展项。医保支付类别各地差异大（部分省份列为丙类/自费），收费前请核对当地政策。',
    aliases: 'AI 智能 辅助诊断',
    isAddon: false
  },
  {
    code: '012301010011100',
    name: 'X线摄影成像-口腔曲面体层成像（扩展）',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 50,
    priceLevel2: 43,
    priceLevel1: 35,
    unit: '部位·体位',
    copayRate: 0.0,
    output: '通过X线摄影（含数字化），实现口腔曲面体层成像（全口全景片）。',
    composition: '所定价格涵盖摆位、摄影、成像、分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '',
    restrictions: '',
    aliases: '全景片 曲面断层 颌全景 口腔全景 大片 OP 曲面体层',
    regionalPrices: REGION.xray,
    isAddon: false
  },
  {
    code: '012301010020000',
    name: 'X线摄影成像（牙片）',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 18,
    priceLevel2: 18,
    priceLevel1: 18,
    unit: '部位',
    copayRate: 0.0,
    output: '通过X线摄影（含数字化），实现对范围牙齿的X线成像及分析。',
    composition: '所定价格涵盖摆位、摄影、成像、分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '部位的定义为：切牙、前磨牙和磨牙，以两个牙位为一个部位；尖牙，以单牙位为一个部位。',
    restrictions: '部位的定义为：切牙、前磨牙和磨牙，以两个牙位为一个部位；尖牙，以单牙位为一个部位。',
    aliases: '根尖片 小片 咬合片 牙片 RVG 牙科片',
    regionalPrices: REGION.film,
    isAddon: false
  },
  {
    code: '012301010020100',
    name: 'X线摄影成像（牙片）-人工智能辅助诊断（扩展）',
    category: 'imaging',
    insuranceType: '甲类',
    priceLevel3: 18,
    priceLevel2: 18,
    priceLevel1: 18,
    unit: '部位',
    copayRate: 0.0,
    output: '应用人工智能辅助诊断技术，对牙片成像结果进行辅助判读与分析。',
    composition: '所定价格涵盖摆位、摄影、成像、人工智能辅助分析、出具报告、数字影像处理与上传存储等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '扩展项，指在原项目基础上应用人工智能辅助诊断技术。',
    restrictions: '扩展项。医保支付类别各地差异大（部分省份列为丙类/自费），收费前请核对当地政策。',
    aliases: 'AI 智能 辅助诊断 牙片',
    isAddon: false
  },
  {
    code: '012301020010000',
    name: '计算机体层成像（CT）平扫',
    category: 'imaging',
    insuranceType: '乙类',
    priceLevel3: 189,
    priceLevel2: 177,
    priceLevel1: 165,
    unit: '部位',
    copayRate: 0.10,
    output: '通过计算机体层成像（CT）平扫，实现患者检查部位的成像及分析。',
    composition: '所定价格涵盖摆位、扫描成像、分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '一次检查多部位的，第2部位按50%计收，第3部位按25%计收，第4部位及以上不再计费。',
    restrictions: '一次检查多部位的，第2部位按50%计收，第3部位按25%计收，第4部位及以上不再计费。口腔颌面部以外部位应按本项收费，不得按CBCT扩展项收费。',
    aliases: 'CT 平扫 螺旋CT 断层 三维重建',
    isAddon: false
  },
  {
    code: '012301020010100',
    name: '计算机体层成像（CT）平扫-人工智能辅助诊断（扩展）',
    category: 'imaging',
    insuranceType: '乙类',
    priceLevel3: 189,
    priceLevel2: 177,
    priceLevel1: 165,
    unit: '部位',
    copayRate: 0.10,
    output: '应用人工智能辅助诊断技术，对CT平扫结果进行辅助判读与分析。',
    composition: '所定价格涵盖摆位、扫描成像、人工智能辅助分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '扩展项，指在原项目基础上应用人工智能辅助诊断技术。',
    restrictions: '扩展项。医保支付类别各地差异大，收费前请核对当地政策。',
    aliases: 'AI 智能 辅助诊断 CT',
    isAddon: false
  },
  {
    code: '012301020011100',
    name: '计算机体层成像（CT）平扫-口腔颌面锥形束CT（CBCT）（扩展）',
    category: 'imaging',
    insuranceType: '乙类',
    priceLevel3: 189,
    priceLevel2: 177,
    priceLevel1: 165,
    unit: '次',
    copayRate: 0.10,
    output: '通过口腔颌面锥形束CT，实现患者检查部位的成像及分析。',
    composition: '所定价格涵盖摆位、扫描成像、分析、出具报告、数字影像处理与上传存储（含数字方式）等步骤所需的人力资源、设备运转成本消耗与基本物质资源消耗。',
    exclusions: '',
    billingNote: '指全口腔，不区分上下颌，一次检查只能计价一次。仅限口腔颌面使用收费，其他部位不得按此收费，应按「计算机体层成像（CT）平扫」收费。',
    restrictions: '仅限口腔颌面使用收费；利用CBCT检查骨骼、耳乳突、鼻咽部等口腔以外部位的，应按「计算机体层成像（CT）平扫」收费。一次检查只能计价一次。',
    aliases: 'CBCT 锥形束CT 锥形束 三维 大视野 种植术前 口腔CT 齿科CT',
    regionalPrices: REGION.cbct,
    isAddon: false
  }
];

/** 主项目（不含加收/扩展以外的主项）——用于「全部主项目」与分类浏览 */
export const IMAGING_MAIN = IMAGING_ITEMS.filter((i) => !i.isAddon);

/** 全量（含加收/扩展），供关键词检索使用 */
export const IMAGING_ALL = IMAGING_ITEMS;
