/**
 * 口腔门诊多税务模式体系
 *
 * ⚠️ 这里定义的是「单笔处方的税负估算参数」，用于医生开单时直观感受税负与毛利。
 *    它**不是**申报依据 —— 增值税按申报期、所得税按年度计算。
 *    正式申报请用「报税」页（src/engines/taxEngine.js），那里按申报表真实口径计算。
 *
 * 2026 年口径要点（第 13 轮修订）：
 *  - 医疗服务免征增值税（《增值税法》第二十四条），只有应税部分（耗材/商品/非医疗美容）计税。
 *    因此每个模式都带 `taxableShare`：应税收入占实收总额的比例。原实现把全部收入计税，会多缴。
 *  - 小规模纳税人 2026—2027 年 3% 征收率减按 1%，附加税费享「六税两费」减半（合计 12%×50%=6%）。
 *  - 小型微利企业所得税实际税负 5%（应纳税所得额 ≤300 万）。
 *  - 个体工商户缴「经营所得」个税，五级超额累进 5%~35%，非固定比例税率。
 */
export const TAX_MODES = [
  {
    id: 'exempt_medical',
    entityId: 'small_company',
    name: '模式1：纯医疗服务免税（法定免税）',
    category: '医疗免税',
    description: '依据《增值税法》第二十四条及财税〔2016〕36 号附件3，符合规定的医疗机构提供的医疗服务免征增值税，无附加税。全额收入均为免税医疗收入，应纳税所得额按小型微利企业 5% 实际税负估算。',
    settings: {
      vatRate: 0.0,
      surchargeRate: 0.0,
      incomeTaxRate: 0.05,
      costRate: 0.65,
      taxableShare: 0,
      description: '增值税 0%（免税）| 附加税 0% | 所得税 5%（小微）'
    },
    note: '前提：持《医疗机构执业许可证》、项目在价格规范内、收费不高于政府指导价，且与应税收入分别核算。'
  },
  {
    id: 'small_scale_retail',
    entityId: 'small_company',
    name: '模式2：小规模纳税人混营（含耗材商品外售）',
    category: '小规模纳税人',
    description: '门诊兼营种植体、牙冠、冲牙器等耗材与商品销售。医疗服务部分仍免税，仅应税部分按 1% 征收率计税（2026—2027 年 3% 减按 1%），附加税费享六税两费减半。',
    settings: {
      vatRate: 0.01,
      surchargeRate: 0.06,
      incomeTaxRate: 0.05,
      costRate: 0.60,
      taxableShare: 0.2,
      description: '应税部分增值税 1% | 附加税 6%（减半）| 所得税 5%'
    },
    note: '应税收入占比默认 20%，请按贵院实际耗材/商品销售比例调整，否则税负估算会失真。'
  },
  {
    id: 'general_taxpayer',
    entityId: 'general_company',
    name: '模式3：一般纳税人（大型连锁口腔机构）',
    category: '一般纳税人',
    description: '二级专科医院或大型连锁，医疗服务免税，应税货物按 13%、应税服务按 6% 计销项，进项可抵扣（免税项目对应进项须转出）。此模式按应税以耗材货物为主（13%）估算。',
    settings: {
      vatRate: 0.13,
      surchargeRate: 0.12,
      incomeTaxRate: 0.25,
      costRate: 0.70,
      taxableShare: 0.25,
      description: '应税货物增值税 13% | 附加税 12%（不减半）| 所得税 25%'
    },
    note: '一般纳税人不适用六税两费减半，附加税按 12% 全额计；若混有美容服务（6%），请在「报税」页按明细核算。'
  },
  {
    id: 'individual_business',
    entityId: 'individual_business',
    name: '模式4：个体工商户／个人独资（经营所得）',
    category: '个体工商户',
    description: '私人牙科诊所，不缴企业所得税，按个人所得税「经营所得」五级超额累进（5%~35%）缴纳，年应纳税所得额 200 万元以内部分减半征收。',
    settings: {
      vatRate: 0.01,
      surchargeRate: 0.06,
      incomeTaxRate: 0.10,
      costRate: 0.50,
      taxableShare: 0.1,
      description: '应税部分增值税 1% | 附加税 6%（减半）| 经营所得个税（估算按 10% 边际档）'
    },
    note: '⚠️ 单笔只能按「边际税率」估算。正式税额须按全年应纳税所得额查五级累进表，请在「报税」页计算。'
  },
  {
    id: 'custom_tax',
    entityId: 'small_company',
    name: '模式5：自定义税务模式（财务自主调整）',
    category: '自定义',
    description: '由门诊财务按主管税务机关要求及实际核算情况，自行填报增值税率、附加税率、所得税率、成本率与应税收入占比。',
    settings: {
      vatRate: 0.0,
      surchargeRate: 0.0,
      incomeTaxRate: 0.05,
      costRate: 0.65,
      taxableShare: 0,
      description: '全部参数由用户手动配置'
    },
    note: '改任意参数会自动切到本模式，不会影响其他模式的预设值。'
  }
];

/** 按 id 取模式 */
export function taxModeById(id) {
  return TAX_MODES.find((m) => m.id === id) || TAX_MODES[0];
}
