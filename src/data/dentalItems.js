/**
 * 全国统一口腔医疗服务医保收费项目及集采耗材标准库
 * 包含国家医保服务代码、医保属性（甲/乙/自费）、指导限价、适应症与飞行检查红线约束
 */

export const DENTAL_CATEGORIES = [
  { id: 'all', name: '全部项目' },
  { id: 'exam', name: '检查与影像' },
  { id: 'endo', name: '牙体牙髓' },
  { id: 'perio', name: '牙周治疗' },
  { id: 'surgery', name: '拔牙与外科' },
  { id: 'implant', name: '集采种植牙' },
  { id: 'prostho', name: '修复与正畸(美容)' },
  { id: 'consumables', name: '医保耗材与麻醉' }
];

export const DENTAL_ITEMS = [
  // 1. 检查与影像
  {
    code: '310401001',
    name: '口腔全景片 (曲面断层摄影)',
    category: 'exam',
    insuranceType: '乙类',
    defaultPrice: 120,
    unit: '次',
    copayRate: 0.10, // 乙类自付10%
    description: '曲面体层摄影数字化采集，全口牙槽骨及颌骨病变筛查',
    restrictions: '同一病程治疗周期内原则上不超过2次（术前、术后），不得同一天重复收费',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['EXAM_SAME_DAY_REPEAT']
  },
  {
    code: '310401002',
    name: '口腔根尖片 (数字X线单牙摄影)',
    category: 'exam',
    insuranceType: '甲类',
    defaultPrice: 25,
    unit: '牙位',
    copayRate: 0.0,
    description: '牙位单颗根尖骨质吸收及根管充填质量检查',
    restrictions: '单颗牙根管治疗术中通常限拍术前、主尖、充填后共不超过3张',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['XRAY_MAX_LIMIT_PER_TOOTH']
  },
  {
    code: '310401005',
    name: '口腔颌面锥形束CT (CBCT三维重建)',
    category: 'exam',
    insuranceType: '乙类',
    defaultPrice: 380,
    unit: '部位',
    copayRate: 0.20,
    description: '高精度三维骨质密度、下颌神经管定位及上颌窦底测量',
    restrictions: '必须具备阻生齿接近神经管、复杂囊肿或骨缺损指征，单纯正畸或常规洗牙不得报销',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['CBCT_INDICATION_CHECK']
  },
  {
    code: '110200001',
    name: '普通口腔专科门诊诊查费',
    category: 'exam',
    insuranceType: '甲类',
    defaultPrice: 15,
    unit: '次',
    copayRate: 0.0,
    description: '口腔专科问诊、视诊、探诊、叩诊及制定治疗方案',
    restrictions: '一次就诊限收1次，不得与急诊诊查费并收',
    bundleWith: [],
    conflictCodes: ['110200002'],
    exclusiveRules: ['CONSULTATION_ONCE_PER_VISIT']
  },

  // 2. 牙体牙髓
  {
    code: '330501001',
    name: '前牙根管治疗术 (单根管)',
    category: 'endo',
    insuranceType: '甲类',
    defaultPrice: 260,
    unit: '牙/根管',
    copayRate: 0.0,
    description: '包含开髓、拔髓、根管预备、消毒冲洗与冷牙胶根充',
    restrictions: '已内涵包含开髓引流术、拔髓术，严禁拆套重复加收开髓引流',
    bundleWith: ['310401002'],
    conflictCodes: ['330501007', '330501008'], // 冲突：开髓引流术、牙髓失活术已含
    exclusiveRules: ['UNBUNDLING_ENDO_OPENING']
  },
  {
    code: '330501002',
    name: '前磨牙/双尖牙根管治疗术 (双根管)',
    category: 'endo',
    insuranceType: '甲类',
    defaultPrice: 420,
    unit: '牙',
    copayRate: 0.0,
    description: '前磨牙双根管系统机用镍钛预备、超声冲洗与热牙胶充填',
    restrictions: '已含拔髓、封药、预备工序，不得拆套申报',
    bundleWith: [],
    conflictCodes: ['330501007', '330501008'],
    exclusiveRules: ['UNBUNDLING_ENDO_OPENING']
  },
  {
    code: '330501003',
    name: '磨牙根管治疗术 (3~4根管)',
    category: 'endo',
    insuranceType: '乙类',
    defaultPrice: 680,
    unit: '牙',
    copayRate: 0.10,
    description: '复杂磨牙弯曲变异根管显微预备、超声震荡与三维严密封闭',
    restrictions: '已内涵包含开髓引流与髓腔清理，不得拆套分解收费',
    bundleWith: [],
    conflictCodes: ['330501007', '330501008'],
    exclusiveRules: ['UNBUNDLING_ENDO_OPENING']
  },
  {
    code: '330501007',
    name: '开髓引流术 (急性牙髓炎急症应急处置)',
    category: 'endo',
    insuranceType: '甲类',
    defaultPrice: 60,
    unit: '牙',
    copayRate: 0.0,
    description: '仅限急性牙髓炎或急性尖周炎无条件一次性完成根管治疗时的首诊急症引流',
    restrictions: '🔴 红线严重警示：若当日已开具根管治疗术，严禁加收开髓引流术（属典型分解拆套骗保）',
    bundleWith: [],
    conflictCodes: ['330501001', '330501002', '330501003'],
    exclusiveRules: ['UNBUNDLING_ENDO_OPENING']
  },
  {
    code: '330501008',
    name: '牙髓失活术 (封失活剂)',
    category: 'endo',
    insuranceType: '甲类',
    defaultPrice: 50,
    unit: '牙',
    copayRate: 0.0,
    description: '仅限局麻浸润禁忌症等特殊情况下放置无砷失活剂',
    restrictions: '若实施现代麻醉下一阶段性根管治疗，不可另立项目重复收费',
    bundleWith: [],
    conflictCodes: ['330501001', '330501002', '330501003'],
    exclusiveRules: ['UNBUNDLING_ENDO_PULP_DEV']
  },
  {
    code: '330502001',
    name: '复合树脂充填术 (前牙美学充填/浅中龋)',
    category: 'endo',
    insuranceType: '乙类',
    defaultPrice: 180,
    unit: '牙面',
    copayRate: 0.10,
    description: '去净腐质、酸蚀粘接、纳米树脂分层固化成形充填',
    restrictions: '单颗牙同一牙面限收1次；深度龋坏若含垫底不得重复收取垫底材料费',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['SURFACE_OVERCHARGE']
  },
  {
    code: '330502002',
    name: '玻璃离子水门汀充填术',
    category: 'endo',
    insuranceType: '甲类',
    defaultPrice: 90,
    unit: '牙面',
    copayRate: 0.0,
    description: '生物相容性氟释放充填，常用于老年根面龋及儿童乳牙',
    restrictions: '医保全额甲类报销项目，不得擅自加收材料操作费',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: []
  },

  // 3. 牙周治疗
  {
    code: '330503001',
    name: '全口牙周龈上洁治术 (超声波洁牙)',
    category: 'perio',
    insuranceType: '乙类',
    defaultPrice: 160,
    unit: '全口',
    copayRate: 0.15,
    description: '去除龈上牙石及菌斑，冲洗牙周袋（限治疗性牙周炎患者）',
    restrictions: '🔴 飞行检查重点：医保仅限牙龈炎/牙周炎临床诊断！纯健康美容性洗牙不可纳统；一人一年限1次',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['PERIO_CLEANING_FREQUENCY_LIMIT', 'PERIO_DIAGNOSIS_REQUIRED']
  },
  {
    code: '330503002',
    name: '龈下刮治术及根面平整术',
    category: 'perio',
    insuranceType: '乙类',
    defaultPrice: 80,
    unit: '牙位',
    copayRate: 0.15,
    description: '针对深牙周袋（PD≥4mm）的机械刮除龈下牙石及平整病理性牙骨质',
    restrictions: '必须具备牙周袋探诊记录与全景片/牙片证实牙槽骨吸收指征',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['PERIO_DEEP_RECORD_REQUIRED']
  },

  // 4. 口腔外科 (拔牙)
  {
    code: '330504001',
    name: '简单牙拔除术 (前牙/乳牙/松动牙)',
    category: 'surgery',
    insuranceType: '甲类',
    defaultPrice: 70,
    unit: '颗',
    copayRate: 0.0,
    description: '牙挺与拔牙钳轻柔脱位，清理牙槽窝，压迫止血',
    restrictions: '甲类全额统筹；严禁将前牙或松动牙虚构上浮为复杂阻生齿',
    bundleWith: [],
    conflictCodes: ['330504003', '330504004'],
    exclusiveRules: ['SURGERY_UPCODING_RISK']
  },
  {
    code: '330504002',
    name: '常规后牙拔除术 (上/下颌磨牙)',
    category: 'surgery',
    insuranceType: '甲类',
    defaultPrice: 180,
    unit: '颗',
    copayRate: 0.0,
    description: '分根挺出，刮除根尖肉芽肿，牙槽窝复位',
    restrictions: '已包含常规局部止血及清理，无特殊大出血指征不得多计止血材料',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: []
  },
  {
    code: '330504003',
    name: '复杂阻生下颌第三磨牙拔除术 (骨埋伏/近中水平阻生)',
    category: 'surgery',
    insuranceType: '乙类',
    defaultPrice: 750,
    unit: '颗',
    copayRate: 0.10,
    description: '翻瓣、超声骨刀去骨、微创分冠分根分批拔除、牙槽骨修整及缝合',
    restrictions: '必须留存术前曲面断层片或CBCT证明深部骨阻生；内涵包含翻瓣与缝合，不得重复收取小清创缝合费',
    bundleWith: [],
    conflictCodes: ['330504005'], // 冲突：不得重复加收牙槽骨切开缝合术
    exclusiveRules: ['UNBUNDLING_WISDOM_SUTURE']
  },
  {
    code: '330504005',
    name: '牙龈切开及牙槽外科创口缝合术',
    category: 'surgery',
    insuranceType: '甲类',
    defaultPrice: 65,
    unit: '次',
    copayRate: 0.0,
    description: '软组织微创缝合复位',
    restrictions: '🔴 红线预警：在阻生齿拔除术中已内涵该步骤，并列加收属于严重分解项目违规！',
    bundleWith: [],
    conflictCodes: ['330504003'],
    exclusiveRules: ['UNBUNDLING_WISDOM_SUTURE']
  },

  // 5. 口腔种植 (集采调控项目)
  {
    code: '330505001',
    name: '单颗常规种植全流程医疗服务调控总包',
    category: 'implant',
    insuranceType: '自费', // 种植医疗服务大多为医保自费/个账支付，受国家公立三级4300-4400限价调控
    defaultPrice: 4200,
    unit: '颗',
    copayRate: 1.0,
    description: '含生化检验、影像检查、种植手术、牙冠置入等全流程医疗服务（不含耗材）',
    restrictions: '🔴 种植集采硬红线：医疗服务总价不得超越当地调控门槛（成都4400/广深4320/沪渝4300），不得拆解收费',
    bundleWith: ['HC_IMPLANT_COLLECTIVE'],
    conflictCodes: [],
    exclusiveRules: ['IMPLANT_PRICE_CEILING']
  },
  {
    code: 'HC_IMPLANT_COLLECTIVE',
    name: '口腔种植体系统国家集采耗材包 (四级纯钛/钛锆中选)',
    category: 'implant',
    insuranceType: '自费', // 可刷个账
    defaultPrice: 850,
    unit: '套',
    copayRate: 1.0,
    description: '含种植体、基台、中央螺栓、转移帽等国家集采中选中位价格产品（如登腾/奥齿泰等）',
    restrictions: '🔴 集采零差率红线：耗材必须严格按中选进价“零差率”销售，绝对禁止在集采价基础上加价销售',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['IMPLANT_ZERO_MARKUP']
  },
  {
    code: 'HC_CROWN_COLLECTIVE',
    name: '全瓷种植牙冠国家集采竞价单颗挂网包',
    category: 'implant',
    insuranceType: '自费',
    defaultPrice: 320,
    unit: '颗',
    copayRate: 1.0,
    description: '数字化二氧化锆全瓷冠中选挂网价格',
    restrictions: '公立与民营响应集采承诺单位，不得高于300-350元挂网限价收取耗材费',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['CROWN_COLLECTIVE_LIMIT']
  },

  // 6. 修复与正畸 (纯美容自费 - 医保绝对红线)
  {
    code: 'ZF_ORTHODONTICS',
    name: '成人隐形正畸矫治方案全流程',
    category: 'prostho',
    insuranceType: '自费',
    defaultPrice: 18000,
    unit: '例',
    copayRate: 1.0,
    description: '数字化三维排牙设计、矫治器序列佩戴，纯牙齿排列美容美化',
    restrictions: '🔴 高压红线：正畸纯属美容范畴，严禁串换为牙周治疗、颌骨囊肿刮治等报销！',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['BEAUTY_INSURANCE_FORBIDDEN']
  },
  {
    code: 'ZF_WHITENING',
    name: '冷光美白与美学树脂贴面',
    category: 'prostho',
    insuranceType: '自费',
    defaultPrice: 1500,
    unit: '次',
    copayRate: 1.0,
    description: '过氧化氢凝胶高能蓝光照射美白，改善牙齿氟斑牙、四环素牙外染色',
    restrictions: '🔴 绝对自费红线：严禁任何形式的统筹基金报销或串换名目套现',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['BEAUTY_INSURANCE_FORBIDDEN']
  },

  // 7. 医保耗材与麻醉
  {
    code: 'HC_ANESTHESIA_ART',
    name: '复方盐酸阿替卡因肾上腺素注射液 (碧蓝麻)',
    category: 'consumables',
    insuranceType: '乙类',
    defaultPrice: 18.5,
    unit: '支',
    copayRate: 0.10,
    description: '口腔局部浸润与阻滞麻醉专用强效局麻药',
    restrictions: '单次牙科手术限合理用量（通常1-2支），超量开具属于过度使用',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: ['ANESTHESIA_DOSAGE_LIMIT']
  },
  {
    code: 'HC_COLLAGEN_SPONGE',
    name: '医用胶原蛋白止血海绵 (拔牙创填塞)',
    category: 'consumables',
    insuranceType: '乙类',
    defaultPrice: 120,
    unit: '块',
    copayRate: 0.15,
    description: '引导血凝块机化，预防干槽症与止血',
    restrictions: '限大创面阻生齿拔除或有出血倾向者，普通松动牙不得常规开具',
    bundleWith: [],
    conflictCodes: [],
    exclusiveRules: []
  }
];

/**
 * 医保违规红线规则字典
 */
export const RED_LINE_RULES = {
  UNBUNDLING_ENDO_OPENING: {
    id: 'UNBUNDLING_ENDO_OPENING',
    level: 'HIGH_RISK',
    title: '拆套分解收费红线：根管治疗术并开髓引流',
    desc: '国家医保服务目录明确规定：各类牙根管治疗术的项目内涵中，已包含开髓、髓腔引流清理步骤。严禁在开具根管治疗术同日叠加开具开髓引流术或牙髓失活术，属于医保稽核第一重点违规！',
    penalty: '追回医保基金并处1倍至3倍顶格罚款，严重者暂停医保网签资格'
  },
  UNBUNDLING_WISDOM_SUTURE: {
    id: 'UNBUNDLING_WISDOM_SUTURE',
    level: 'HIGH_RISK',
    title: '分解收费红线：阻生齿拔除并收软组织切开缝合',
    desc: '阻生牙拔除术（尤其骨埋伏阻生）本身收费定价已涵盖翻瓣、切开、修整及创口复位缝合全过程，单列缝合费属于典型的“分解医疗服务项目收费”。',
    penalty: '核减违规费用，记入机构医保信用信用评级扣分'
  },
  PERIO_CLEANING_FREQUENCY_LIMIT: {
    id: 'PERIO_CLEANING_FREQUENCY_LIMIT',
    level: 'MEDIUM_RISK',
    title: '超频次/超适应症红线：龈上洁治（洗牙）限制',
    desc: '超声波洗牙纳入医保统筹的前提是“具备中重度牙龈炎或牙周病临床指征”，且医保规则限定单一参保人在同一年度内原则上限报销1次。纯美容性洗牙严禁报销。',
    penalty: '系统直接拒付，追溯稽核可剔除统筹结算'
  },
  BEAUTY_INSURANCE_FORBIDDEN: {
    id: 'BEAUTY_INSURANCE_FORBIDDEN',
    level: 'FATAL_RISK',
    title: '欺诈骗保红线：正畸/美白/全瓷美容串换医保项目',
    desc: '《医疗保障基金使用监督管理条例》第十五条明确规定，牙齿矫正正畸、冷光美白、美容牙冠等纯生活美容医疗，绝不属于基本医疗保险支付范围。将其伪造为牙周或颌面外科刷医保统筹属于刑事欺诈骗保！',
    penalty: '解除医保服务协议，移送公安机关追究刑事责任'
  },
  IMPLANT_PRICE_CEILING: {
    id: 'IMPLANT_PRICE_CEILING',
    level: 'HIGH_RISK',
    title: '集采调控红线：种植全流程服务费超限',
    desc: '单颗常规种植全流程医疗服务总费用不得突破当地最高调控目标（成都4400元、广州深圳4320元、上海重庆4300元）。',
    penalty: '约谈通报批评，取消集采绿标公示资格，勒令退还多收差额'
  },
  IMPLANT_ZERO_MARKUP: {
    id: 'IMPLANT_ZERO_MARKUP',
    level: 'HIGH_RISK',
    title: '零差率加价红线：集采中选种植耗材加成',
    desc: '国家及各省口腔种植集采耗材系统实行“零差率”销售政策，诊所购进价即患者结算价，严禁以任何“包装费、消毒费、选型费”变相加价。',
    penalty: '立案稽查并处价格欺诈处罚'
  },
  ANESTHESIA_DOSAGE_LIMIT: {
    id: 'ANESTHESIA_DOSAGE_LIMIT',
    level: 'MEDIUM_RISK',
    title: '超量开药红线：麻醉药物单次用量异常',
    desc: '门诊单次常规处置局麻碧蓝麻注射用量通常为1~2支。一次处方单开具3支以上若无多牙位多象限同期大型手术记录，触发过度诊疗稽核。',
    penalty: '重点病历抽查抽样审核'
  }
};
