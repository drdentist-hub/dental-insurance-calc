/**
 * 口腔门诊税务政策参数库（唯一数据源）
 *
 * ⚠️ 所有税率、起征点、优惠期限均标注政策依据与有效期。
 * 政策到期或被新文件替代时，只改本文件；引擎与界面不得硬编码税率。
 *
 * 现行主要依据：
 *  - 《中华人民共和国增值税法》(2024-12-25 通过, 2026-01-01 施行) 第二十四条：医疗机构提供的医疗服务免征增值税
 *  - 财政部 税务总局公告 2026 年第 10 号《关于增值税法施行后增值税优惠政策衔接事项的公告》
 *      · 小规模纳税人起征点：月销售额 10 万元 / 季销售额 30 万元（2026-01-01 至 2027-12-31）
 *      · 小规模纳税人 3% 征收率减按 1% 征收（2026-01-01 至 2027-12-31）
 *  - 财税〔2016〕36 号 附件3 第一条(七)：医疗机构提供的医疗服务免征增值税
 *  - 财政部 税务总局公告 2023 年第 12 号：小微企业所得税、六税两费减半、个体户经营所得减半（执行至 2027-12-31）
 *  - 国家税务总局公告 2026 年第 6 号：增值税及附加税费申报表（小规模纳税人适用）栏次口径
 *  - 《个人所得税法》经营所得五级超额累进税率表
 */

/** 通用取整：保留 2 位小数，规避浮点误差 */
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export const TAX_POLICY = {
  /** 政策版本标识，界面与导出件都要带上，避免用户拿旧口径报税 */
  version: '2026.10',
  effectiveNote: '依据《增值税法》（2026-01-01 施行）及财政部 税务总局 2026 年第 10 号公告',

  /* ---------------- 增值税 ---------------- */
  vat: {
    /** 医疗服务免税：依据增值税法第二十四条(二) */
    medicalExempt: {
      enabled: true,
      basis: '《增值税法》第二十四条：医疗机构提供的医疗服务免征增值税',
      /** 享受免税必须同时满足的三个条件，缺一即不可免 */
      conditions: [
        '持有《医疗机构执业许可证》',
        '服务项目属于《全国医疗服务价格项目规范》所列范围',
        '收费不高于当地政府指导价（口腔种植受集采调控上限约束）'
      ],
      /** 免税的前置硬性要求：未分别核算则不得免税 */
      separationRule: '免税收入必须与应税收入分别核算；未分别核算的，不得享受免税（增值税法第二十六条）'
    },
    /** 小规模纳税人：3% 征收率，2026—2027 减按 1% */
    smallScale: {
      levyRate: 0.03,
      reducedRate: 0.01,
      reducedUntil: '2027-12-31',
      basis: '财政部 税务总局公告 2026 年第 10 号 第三条(三)第 6 项'
    },
    /** 一般纳税人：应税货物 / 应税服务 */
    general: {
      goodsRate: 0.13,
      serviceRate: 0.06,
      /** 免税项目对应的进项税额不得抵扣，已抵扣的须转出 */
      inputTransferNote: '用于免税项目的进项税额不得抵扣，已抵扣的应作进项税额转出'
    },
    /** 起征点（仅小规模纳税人适用） */
    threshold: {
      monthly: 100000,
      quarterly: 300000,
      perTime: 1000,
      until: '2027-12-31',
      basis: '财政部 税务总局公告 2026 年第 10 号 第一条',
      note: '起征点判断用「不含税销售额」；兼营免税项目的，免税销售额不计入起征点判断基数'
    }
  },

  /* ---------------- 附加税费 ---------------- */
  surcharge: {
    /** 城市维护建设税：按纳税人所在地分档 */
    urbanConstruction: {
      urban: 0.07,      // 市区
      county: 0.05,     // 县城、建制镇
      other: 0.01       // 其他地区
    },
    education: 0.03,        // 教育费附加
    localEducation: 0.02,   // 地方教育附加
    /** 六税两费减半（小规模纳税人、小型微利企业、个体工商户） */
    halve: {
      enabled: true,
      until: '2027-12-31',
      basis: '财政部 税务总局公告 2023 年第 12 号 第二条',
      /** 可减半的税种范围（与本工具相关的部分） */
      scope: ['城市维护建设税', '教育费附加', '地方教育附加', '房产税', '城镇土地使用税', '印花税']
    },
    /** 附加税费的计税依据是「实际缴纳的增值税」，增值税为 0 则附加也为 0 */
    baseNote: '附加税费以实际缴纳的增值税为计税依据；增值税为零时附加税费为零'
  },

  /* ---------------- 企业所得税 ---------------- */
  cit: {
    statutoryRate: 0.25,
    /** 小型微利企业：应纳税所得额 ≤300 万，减按 25% 计入 × 20% = 实际 5% */
    smallProfit: {
      enabled: true,
      until: '2027-12-31',
      basis: '财政部 税务总局公告 2023 年第 12 号 第三条',
      taxableIncomeCap: 3000000,
      employeeCap: 300,
      assetCap: 50000000,
      /** 应纳税所得额折扣比例与适用税率 */
      incomeDiscount: 0.25,
      rate: 0.20,
      /** 临界点提示：一旦超过 300 万即整体丧失小微资格，税负跳跃式上升 */
      cliffNote: '应纳税所得额超过 300 万元即不再是小型微利企业，全额按 25% 计税，存在明显税负跳跃'
    }
  },

  /* ---------------- 个人所得税：经营所得 ---------------- */
  iitBusiness: {
    basis: '《个人所得税法》第三条：经营所得适用 5%~35% 五级超额累进税率',
    /** 五级超额累进：[上限, 税率, 速算扣除数]，上限为 null 表示最高档 */
    brackets: [
      { upTo: 15000, rate: 0.05, deduct: 0 },
      { upTo: 30000, rate: 0.10, deduct: 750 },
      { upTo: 60000, rate: 0.20, deduct: 3750 },
      { upTo: 100000, rate: 0.30, deduct: 9750 },
      { upTo: null, rate: 0.35, deduct: 14750 }
    ],
    /** 个体工商户年应纳税所得额不超过 200 万元部分减半征收 */
    halve: {
      enabled: true,
      until: '2027-12-31',
      cap: 2000000,
      basis: '财政部 税务总局公告 2023 年第 12 号 第一条'
    },
    /** 核定征收（应税所得率）参考区间，个体诊所常见 */
    deemedProfitRate: { min: 0.05, max: 0.15, note: '各地核定应税所得率不同，以主管税务机关核定通知书为准' }
  },

  /* ---------------- 纳税人身份 ---------------- */
  entityTypes: [
    {
      id: 'small_company',
      name: '小规模纳税人企业',
      short: '小规模·企业',
      vatType: 'smallScale',
      incomeTaxType: 'cit',
      canHalveSixTax: true,
      description: '有限公司/门诊部，年应征增值税销售额 500 万元以下，按征收率简易计税。'
    },
    {
      id: 'general_company',
      name: '一般纳税人企业',
      short: '一般纳税人',
      vatType: 'general',
      incomeTaxType: 'cit',
      canHalveSixTax: false,
      halveSixTaxNote: '一般纳税人不能享受六税两费减半；但若同时符合小型微利企业条件，仍可享受（公告 2023 年第 12 号 第五条）',
      description: '大型连锁或二级专科医院，医疗服务免税，应税货物按 13%、应税服务按 6%，进项可抵扣。'
    },
    {
      id: 'individual_business',
      name: '个体工商户',
      short: '个体户',
      vatType: 'smallScale',
      incomeTaxType: 'iitBusiness',
      canHalveSixTax: true,
      description: '私人牙科诊所，缴个人所得税「经营所得」，不缴企业所得税，可享 200 万以内减半。'
    },
    {
      id: 'sole_proprietorship',
      name: '个人独资企业',
      short: '个人独资',
      vatType: 'smallScale',
      incomeTaxType: 'iitBusiness',
      canHalveSixTax: true,
      description: '不缴企业所得税，投资人按「经营所得」缴纳个人所得税。'
    }
  ],

  /* ---------------- 收入分类：免税 / 应税 ---------------- */
  revenueCategories: [
    {
      id: 'medical',
      name: '医疗服务收入（免税）',
      hint: '挂号、检查、治疗、手术、修复等诊疗服务，走医保结算的部分也在此列',
      taxable: false,
      vatKind: null
    },
    {
      id: 'consumable',
      name: '耗材与商品销售（应税货物）',
      hint: '种植体、牙冠、骨粉、义齿、冲牙器等单独计价销售的部分',
      taxable: true,
      vatKind: 'goods'
    },
    {
      id: 'cosmetic',
      name: '非医疗美容/保健服务（应税服务）',
      hint: '牙齿美白、贴面美容等不属于治疗必需、按生活服务征税的部分',
      taxable: true,
      vatKind: 'service'
    }
  ],

  /* ---------------- 申报与缴款期限 ---------------- */
  filing: {
    vat: {
      name: '增值税及附加税费',
      form: '《增值税及附加税费申报表（小规模纳税人适用）》',
      deadline: '月（季）度终了后 15 日内',
      dayOfPeriodEnd: 15
    },
    citPrepay: {
      name: '企业所得税季度预缴',
      form: '《企业所得税月（季）度预缴纳税申报表（A 类）》',
      deadline: '季度终了后 15 日内',
      dayOfPeriodEnd: 15
    },
    citAnnual: {
      name: '企业所得税年度汇算清缴',
      form: '《企业所得税年度纳税申报表（A 类）》',
      deadline: '次年 5 月 31 日前',
      month: 5,
      day: 31
    },
    iitPrepay: {
      name: '经营所得个人所得税预缴',
      form: '《个人所得税经营所得纳税申报表（A 表）》',
      deadline: '月（季）度终了后 15 日内',
      dayOfPeriodEnd: 15
    },
    iitAnnual: {
      name: '经营所得个人所得税汇算清缴',
      form: '《个人所得税经营所得纳税申报表（B 表）》',
      deadline: '次年 3 月 31 日前',
      month: 3,
      day: 31
    },
    financeReport: {
      name: '财务报表报送',
      form: '资产负债表 / 利润表',
      deadline: '季度终了后 15 日内',
      dayOfPeriodEnd: 15
    }
  },

  /* ---------------- 风险自检（税务侧） ---------------- */
  riskRules: [
    {
      id: 'no_separation',
      level: 'FATAL',
      title: '医疗服务与耗材未分别核算',
      detail: '免税收入与应税收入混在一张收费单里、未分开入账开票的，增值税法第二十六条规定不得享受免税，须全额补税并按日加收滞纳金。',
      fix: '按「技耗分离」拆分收费：医疗服务按项目规范计价开票，耗材单独计价单独开票。'
    },
    {
      id: 'bundle_implant',
      level: 'FATAL',
      title: '种植/修复打包收费未拆分耗材',
      detail: '「补牙/种植 6000 元全包」这类打包价，其中种植体、牙冠等耗材不属于免税医疗服务，需按销售货物缴税；打包不拆可能被全额追缴增值税。',
      fix: '在收费清单中把医疗服务费与耗材费分列，病历与发票口径保持一致。'
    },
    {
      id: 'over_guide_price',
      level: 'WARN',
      title: '收费高于政府指导价',
      detail: '医疗服务免税的前提之一是收费不高于当地医疗服务指导价。超标部分不适用免税。',
      fix: '核对本地立项指南落地价格；种植项目还需遵守集采调控上限。'
    },
    {
      id: 'special_invoice_on_exempt',
      level: 'WARN',
      title: '免税项目开具了增值税专用发票',
      detail: '免税项目不得开具增值税专用发票。开了专票即视为放弃免税，须就该项目计算缴纳增值税。',
      fix: '免税医疗服务只开增值税普通发票（或医疗收费票据）。'
    },
    {
      id: 'input_not_transferred',
      level: 'WARN',
      title: '免税项目对应进项税额未转出',
      detail: '用于免税医疗服务的购进货物、劳务，其进项税额不得抵扣，已抵扣的须作进项税额转出。',
      fix: '按销售额比例分摊无法划分的进项税额，作转出处理。'
    },
    {
      id: 'small_profit_cliff',
      level: 'INFO',
      title: '小型微利企业 300 万临界点',
      detail: '应纳税所得额超过 300 万元即整体丧失小微资格，全额按 25% 计税，可能出现「多赚 1 万、多缴 60 万」的跳跃。',
      fix: '年度结束前测算应纳税所得额，合理安排合规支出与固定资产一次性扣除。'
    },
    {
      id: 'threshold_mix',
      level: 'INFO',
      title: '起征点判断不含免税销售额',
      detail: '小规模纳税人判断月 10 万 / 季 30 万起征点时，只看应税销售额；免税的医疗服务收入不计入。别把医保结算额算进起征点基数。',
      fix: '本工具的申报底稿已按此口径拆分，直接对照填报即可。'
    }
  ]
};

/** 按身份取配置 */
export function entityById(id) {
  return TAX_POLICY.entityTypes.find((e) => e.id === id) || TAX_POLICY.entityTypes[0];
}

/** 按期类型取起征点 */
export function vatThreshold(periodType) {
  return periodType === 'quarterly' ? TAX_POLICY.vat.threshold.quarterly : TAX_POLICY.vat.threshold.monthly;
}
