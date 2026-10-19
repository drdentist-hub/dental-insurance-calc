/**
 * 口腔门诊税务核算与报税底稿引擎
 *
 * 设计原则：
 *  1. 免税与应税严格分开算 —— 医疗服务免税收入不参与增值税计算，也不计入起征点基数。
 *  2. 从「申报表栏次」倒推计算，而不是先算税再拼表；这样界面给出的数字可直接抄进电子税务局。
 *  3. 所有税率为参数，来源见 taxPolicy.js，不在本文件硬编码。
 */
import {
  TAX_POLICY,
  entityById,
  vatThreshold
} from '../data/taxPolicy.js';

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 含税 → 不含税 */
function toNet(gross, rate) {
  return r2(gross / (1 + rate));
}

/* ============================================================
   一、增值税
   ============================================================ */

/**
 * 小规模纳税人增值税计算（按申报表栏次口径）
 *
 * 关键位置：适用 3% 征收率减按 1% 时，
 *   第 15 栏「本期应纳税额」按 3% 计算，
 *   第 16 栏「本期应纳税额减征额」填 2% 的差额，
 *   第 20 栏「应纳税额合计」= 15 - 16 = 销售额 × 1%。
 * 这是电子税务局的实际逻辑，直接按 1% 算会与申报表对不上。
 */
function computeSmallScaleVat({ taxableGross, periodType, isEntity, cityType }) {
  const levy = TAX_POLICY.vat.smallScale.levyRate;      // 3%
  const reduced = TAX_POLICY.vat.smallScale.reducedRate; // 1%
  const threshold = vatThreshold(periodType);

  // 减按 1% 时按 1% 换算不含税销售额（总局口径）
  const taxableNet = taxableGross > 0 ? toNet(taxableGross, reduced) : 0;

  const belowThreshold = taxableNet <= threshold;
  // 未达起征点：免征，应税销售额不产生税额
  const vatPayableBase = belowThreshold ? 0 : taxableNet;

  const line15 = r2(vatPayableBase * levy);            // 本期应纳税额（按 3%）
  const line16 = r2(vatPayableBase * (levy - reduced)); // 本期应纳税额减征额（2%）
  const line20 = r2(line15 - line16);                  // 应纳税额合计

  return {
    taxableNet,
    threshold,
    belowThreshold,
    thresholdGap: r2(threshold - taxableNet),
    levyRate: levy,
    reducedRate: reduced,
    line15,
    line16,
    line20,
    /** 未达起征点时应税销售额的免税额（按 3% 计算，仅作展示） */
    exemptAmountOnThreshold: belowThreshold ? r2(taxableNet * levy) : 0
  };
}

/**
 * 一般纳税人增值税计算（销项 - 进项）
 * 医疗服务免税 → 无销项，且对应进项须转出。
 */
function computeGeneralVat({ goodsGross, serviceGross, inputVat, inputTransfer }) {
  const goodsRate = TAX_POLICY.vat.general.goodsRate;     // 13%
  const serviceRate = TAX_POLICY.vat.general.serviceRate; // 6%

  const goodsNet = toNet(goodsGross, goodsRate);
  const serviceNet = toNet(serviceGross, serviceRate);
  const outputVat = r2(goodsNet * goodsRate + serviceNet * serviceRate);

  const deductibleInput = r2(Math.max(0, (Number(inputVat) || 0) - (Number(inputTransfer) || 0)));
  const payable = r2(Math.max(0, outputVat - deductibleInput));
  const creditCarry = r2(Math.max(0, deductibleInput - outputVat));

  return {
    goodsNet,
    serviceNet,
    goodsRate,
    serviceRate,
    outputVat,
    inputVat: r2(inputVat || 0),
    inputTransfer: r2(inputTransfer || 0),
    deductibleInput,
    payable,
    creditCarry
  };
}

/* ============================================================
   二、附加税费
   ============================================================ */

function computeSurcharges({ vatPayable, cityType = 'urban', halve }) {
  const uc = TAX_POLICY.surcharge.urbanConstruction;
  const ucRate = uc[cityType] !== undefined ? uc[cityType] : uc.urban;

  const factor = halve ? 0.5 : 1;
  const base = Math.max(0, Number(vatPayable) || 0);

  const urban = r2(base * ucRate * factor);
  const edu = r2(base * TAX_POLICY.surcharge.education * factor);
  const localEdu = r2(base * TAX_POLICY.surcharge.localEducation * factor);

  return {
    ucRate,
    halved: !!halve,
    urban,
    education: edu,
    localEducation: localEdu,
    total: r2(urban + edu + localEdu)
  };
}

/* ============================================================
   三、所得税
   ============================================================ */

/** 企业所得税（含小型微利企业临界点） */
function computeCit({ taxableIncome }) {
  const ti = Math.max(0, Number(taxableIncome) || 0);
  const sp = TAX_POLICY.cit.smallProfit;

  if (sp.enabled && ti <= sp.taxableIncomeCap) {
    const tax = r2(ti * sp.incomeDiscount * sp.rate); // ×25%×20% = 5%
    return {
      type: 'cit',
      isSmallProfit: true,
      taxableIncome: ti,
      effectiveRate: sp.incomeDiscount * sp.rate,
      tax,
      cliffGap: r2(sp.taxableIncomeCap - ti),
      note: '符合小型微利企业条件，实际税负 5%'
    };
  }

  const tax = r2(ti * TAX_POLICY.cit.statutoryRate);
  return {
    type: 'cit',
    isSmallProfit: false,
    taxableIncome: ti,
    effectiveRate: TAX_POLICY.cit.statutoryRate,
    tax,
    cliffGap: 0,
    note: ti > sp.taxableIncomeCap
      ? '应纳税所得额已超过 300 万元，不再是小型微利企业，全额按 25% 计税'
      : '未适用小型微利企业优惠'
  };
}

/** 个体户经营所得个税（五级超额累进 + 200 万以内减半） */
function computeIitBusiness({ taxableIncome }) {
  const ti = Math.max(0, Number(taxableIncome) || 0);

  /** 按五级累进算某档金额的税额 */
  function bracketTax(amount) {
    if (amount <= 0) return 0;
    const br = TAX_POLICY.iitBusiness.brackets;
    let lastUp = 0;
    let tax = 0;
    for (const b of br) {
      const up = b.upTo === null ? Infinity : b.upTo;
      if (amount <= lastUp) break;
      const part = Math.min(amount, up) - lastUp;
      if (part > 0) tax += part * b.rate;
      lastUp = up;
      if (amount <= lastUp) break;
    }
    return r2(tax);
  }

  const grossTax = bracketTax(ti);

  // 200 万以内部分减半
  const hv = TAX_POLICY.iitBusiness.halve;
  let reliefAmount = 0;
  let reliefBase = 0;
  if (hv.enabled && ti > 0) {
    reliefBase = Math.min(ti, hv.cap);
    reliefAmount = r2(bracketTax(reliefBase) * 0.5);
  }
  const tax = r2(Math.max(0, grossTax - reliefAmount));

  // 反推适用边际税率与速算扣除数（用于说明）
  let marginalRate = TAX_POLICY.iitBusiness.brackets[0].rate;
  let quickDeduct = 0;
  let lastUp = 0;
  for (const b of TAX_POLICY.iitBusiness.brackets) {
    const up = b.upTo === null ? Infinity : b.upTo;
    if (ti > lastUp) { marginalRate = b.rate; quickDeduct = b.deduct; }
    lastUp = up;
    if (ti <= lastUp) break;
  }

  return {
    type: 'iit',
    taxableIncome: ti,
    grossTax,
    reliefBase,
    reliefAmount,
    tax,
    marginalRate,
    quickDeduct,
    effectiveRate: ti > 0 ? r2((tax / ti) * 10000) / 10000 : 0,
    note: hv.enabled
      ? `经营所得适用五级超额累进；年应纳税所得额不超过 200 万元的部分减半征收（减征 ¥${reliefAmount}）`
      : '经营所得适用五级超额累进税率'
  };
}

/* ============================================================
   四、主计算入口：按申报期汇总
   ============================================================ */

/**
 * @param {Object} p
 * @param {string} p.entityId      纳税人身份 id（见 TAX_POLICY.entityTypes）
 * @param {string} p.periodType    'monthly' | 'quarterly'
 * @param {string} p.cityType      'urban' | 'county' | 'other' 城建税地区档
 * @param {Object} p.revenue       { medical, consumable, cosmetic } 含税金额
 * @param {number} p.costTotal     成本费用合计（不含增值税进项税，含人工/房租/耗材成本等）
 * @param {number} p.inputVat      一般纳税人可抵扣进项税额
 * @param {number} p.inputTransfer 进项税额转出（免税项目对应部分）
 * @param {boolean} p.separated    是否已分别核算免税与应税收入
 * @param {boolean} p.specialInvoiceOnExempt 免税项目是否开了专票
 * @param {boolean} p.overGuidePrice 是否存在高于政府指导价的收费
 */
export function computePeriodTax({
  entityId = 'small_company',
  periodType = 'monthly',
  cityType = 'urban',
  revenue = {},
  costTotal = 0,
  inputVat = 0,
  inputTransfer = 0,
  extraDeduct = 0,
  lossCarryForward = 0,
  separated = true,
  specialInvoiceOnExempt = false,
  overGuidePrice = false
} = {}) {
  const entity = entityById(entityId);

  const medicalGross = Math.max(0, Number(revenue.medical) || 0);
  const goodsGross = Math.max(0, Number(revenue.consumable) || 0);
  const serviceGross = Math.max(0, Number(revenue.cosmetic) || 0);

  const totalGross = r2(medicalGross + goodsGross + serviceGross);

  /* --- 增值税 --- */
  let vat;
  if (entity.vatType === 'general') {
    vat = computeGeneralVat({ goodsGross, serviceGross, inputVat, inputTransfer });
    vat.kind = 'general';
    vat.taxableNet = r2(vat.goodsNet + vat.serviceNet);
    vat.belowThreshold = false;
    vat.threshold = null;
    vat.payable = vat.payable;
  } else {
    const taxableGross = r2(goodsGross + serviceGross);
    const s = computeSmallScaleVat({
      taxableGross,
      periodType,
      isEntity: entity.id !== 'individual_business',
      cityType
    });
    vat = {
      kind: 'smallScale',
      taxableGross,
      taxableNet: s.taxableNet,
      threshold: s.threshold,
      belowThreshold: s.belowThreshold,
      thresholdGap: s.thresholdGap,
      levyRate: s.levyRate,
      reducedRate: s.reducedRate,
      line15: s.line15,
      line16: s.line16,
      payable: s.line20,
      exemptAmountOnThreshold: s.exemptAmountOnThreshold
    };
  }

  /* --- 附加税费 --- */
  const halve = !!entity.canHalveSixTax;
  const surcharge = computeSurcharges({ vatPayable: vat.payable, cityType, halve });

  /* --- 所得税 ---
     注意：医疗服务免的是增值税，不是企业所得税。
     营利性医疗机构的医疗收入仍计入应纳税所得额。 */
  const netRevenue = r2(vat.kind === 'general'
    ? medicalGross + vat.goodsNet + vat.serviceNet   // 一般纳税人：应税部分已是不含税
    : medicalGross + vat.taxableNet);                // 小规模：应税部分按征收率还原

  const deductibleCost = r2((Number(costTotal) || 0) + surcharge.total + (Number(extraDeduct) || 0));
  let taxableIncome = r2(netRevenue - deductibleCost - (Number(lossCarryForward) || 0));
  if (taxableIncome < 0) taxableIncome = 0;

  const income = entity.incomeTaxType === 'iitBusiness'
    ? computeIitBusiness({ taxableIncome })
    : computeCit({ taxableIncome });

  /* --- 合计 --- */
  const totalTax = r2(vat.payable + surcharge.total + income.tax);
  const accountingRevenue = r2(medicalGross + goodsGross + serviceGross);
  const burdenRate = accountingRevenue > 0 ? Math.round((totalTax / accountingRevenue) * 1000) / 10 : 0;

  return {
    entity,
    periodType,
    revenue: {
      medical: medicalGross,
      consumable: goodsGross,
      cosmetic: serviceGross,
      total: totalGross,
      /** 免税占比 —— 技耗分离合规度的直观指标（保留 1 位小数） */
      exemptShare: totalGross > 0 ? Math.round((medicalGross / totalGross) * 1000) / 10 : 0
    },
    vat,
    surcharge,
    income,
    totals: {
      totalTax,
      burdenRate,
      netRevenue,
      deductibleCost,
      taxableIncome,
      afterTaxProfit: r2(taxableIncome - income.tax),
      accountingRevenue
    },
    flags: { separated, specialInvoiceOnExempt, overGuidePrice }
  };
}

/* ============================================================
   五、申报表填报底稿（小规模纳税人逐栏）
   ============================================================ */

/**
 * 把小规模纳税人的计算结果映射到《增值税及附加税费申报表（小规模纳税人适用）》栏次。
 * 栏次定义依据国家税务总局公告 2026 年第 6 号。
 * ⚠️ 个体户与企业的免税栏位不同：企业填第 10 栏，个体户/自然人填第 11 栏。
 */
export function buildVatFilingSheet(result) {
  const isIndividual = result.entity.id === 'individual_business';
  const v = result.vat;
  const s = result.surcharge;

  if (v.kind === 'general') {
    return {
      formName: '《增值税及附加税费申报表（一般纳税人适用）》',
      mode: 'summary',
      rows: [
        { no: '—', name: '按适用税率计税销售额（应税货物 13%）', value: v.goodsNet, note: '货物销售额（不含税）' },
        { no: '—', name: '按适用税率计税销售额（应税服务 6%）', value: v.serviceNet, note: '美容/保健等服务（不含税）' },
        { no: '—', name: '免税销售额（医疗服务）', value: result.revenue.medical, note: '医疗服务免税，无销项税额' },
        { no: '11', name: '销项税额', value: v.outputVat },
        { no: '12', name: '进项税额', value: v.inputVat },
        { no: '—', name: '进项税额转出', value: v.inputTransfer, note: '免税项目对应部分须转出' },
        { no: '19', name: '应纳税额', value: v.payable },
        { no: '—', name: '期末留抵税额', value: v.creditCarry },
        { no: '23', name: '城市维护建设税本期应补（退）税额', value: s.urban },
        { no: '24', name: '教育费附加本期应补（退）费额', value: s.education },
        { no: '25', name: '地方教育附加本期应补（退）费额', value: s.localEducation }
      ],
      warning: '一般纳税人申报表结构较复杂（含附列资料一至四），本表仅为关键项目摘要，实际填报请以电子税务局表样为准。'
    };
  }

  // 小规模：免税销售额分两块
  const exemptMedical = result.revenue.medical;      // 医疗服务免税 → 第 12 栏
  const belowThresholdSales = v.belowThreshold ? v.taxableNet : 0; // 未达起征点 → 第 10/11 栏

  const line10 = (!isIndividual && v.belowThreshold) ? belowThresholdSales : 0;
  const line11 = (isIndividual && v.belowThreshold) ? belowThresholdSales : 0;
  const line12 = r2(exemptMedical);
  const line9 = r2(line10 + line11 + line12);
  const line17 = r2((line10 + line11) * (v.levyRate || 0.03) + line12 * (v.levyRate || 0.03));

  return {
    formName: '《增值税及附加税费申报表（小规模纳税人适用）》',
    mode: 'line',
    rows: [
      { no: '1', name: '应征增值税不含税销售额（3% 征收率）', value: v.belowThreshold ? 0 : v.taxableNet, note: v.belowThreshold ? '未达起征点，本栏填 0' : '' },
      { no: '9', name: '免税销售额（9=10+11+12）', value: line9 },
      { no: '10', name: isIndividual ? '小微企业免税销售额（个体户不填）' : '其中：小微企业免税销售额', value: line10, dim: isIndividual },
      { no: '11', name: isIndividual ? '未达起征点销售额' : '未达起征点销售额（个体户填）', value: line11, dim: !isIndividual },
      { no: '12', name: '其他免税销售额（医疗服务免税）', value: line12, note: '医疗服务免税填本栏，不是第 10/11 栏' },
      { no: '15', name: '本期应纳税额（按 3% 计算）', value: v.line15 || 0 },
      { no: '16', name: '本期应纳税额减征额（减按 1% 的 2% 差额）', value: v.line16 || 0 },
      { no: '17', name: '本期免税额', value: line17 },
      { no: '18', name: '其中：小微企业免税额', value: r2(line10 * (v.levyRate || 0.03)) },
      { no: '19', name: '未达起征点免税额', value: r2(line11 * (v.levyRate || 0.03)) },
      { no: '20', name: '应纳税额合计（20=15-16）', value: v.payable, strong: true },
      { no: '21', name: '本期预缴税额', value: 0 },
      { no: '22', name: '本期应补（退）税额（22=20-21）', value: v.payable, strong: true },
      { no: '23', name: '城市维护建设税本期应补（退）税额', value: s.urban, note: s.halved ? '已享六税两费减半' : '' },
      { no: '24', name: '教育费附加本期应补（退）费额', value: s.education },
      { no: '25', name: '地方教育附加本期应补（退）费额', value: s.localEducation }
    ],
    warning: s.halved ? '已按「六税两费减半」计算附加税费；若电子税务局未自动带出，请在减免性质代码栏选择对应减免。' : ''
  };
}

/* ============================================================
   六、税务风险自检
   ============================================================ */

export function taxRiskChecks(result) {
  const hits = [];
  const rules = TAX_POLICY.riskRules;
  const byId = (id) => rules.find((r) => r.id === id);

  const hasTaxable = (result.vat.taxableNet || 0) > 0 || (Number(result.revenue.consumable) + Number(result.revenue.cosmetic)) > 0;

  if (hasTaxable && !result.flags.separated) hits.push(byId('no_separation'));
  if (Number(result.revenue.consumable) > 0) hits.push(byId('bundle_implant'));
  if (result.flags.overGuidePrice) hits.push(byId('over_guide_price'));
  if (result.flags.specialInvoiceOnExempt) hits.push(byId('special_invoice_on_exempt'));
  if (result.entity.vatType === 'general' && result.vat.inputTransfer === 0 && Number(result.revenue.medical) > 0) {
    hits.push(byId('input_not_transferred'));
  }
  if (result.income.type === 'cit' && result.income.isSmallProfit && result.income.cliffGap <= 300000) {
    hits.push(byId('small_profit_cliff'));
  }
  // 小规模纳税人才有起征点概念
  if (result.vat.kind === 'smallScale' && Number(result.revenue.medical) > 0) hits.push(byId('threshold_mix'));

  return hits.filter(Boolean);
}

/* ============================================================
   七、申报与缴税日历
   ============================================================ */

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 遇周末顺延到下一个工作日（法定节假日请以税局公告为准） */
function shiftToWorkday(d) {
  const x = new Date(d.getTime());
  while (x.getDay() === 0 || x.getDay() === 6) {
    x.setDate(x.getDate() + 1);
  }
  return x;
}

/**
 * 单期申报截止日（申报期形如 'YYYY-MM' 或 'YYYY-Qn'）
 * 月/季终了后 15 日内 → 期后次月 15 日，遇周末顺延。
 * 结论卡与结算提示都要用「本期自己的截止日」，而不是「最近一个未来截止日」。
 */
export function periodDueDate(periodKey, periodType = 'monthly') {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(periodKey || ''));
  if (m && periodType !== 'quarterly') {
    const y = Number(m[1]);
    const mo = Number(m[2]);                                  // 1-12
    if (mo < 1 || mo > 12) return '';
    return fmtDate(shiftToWorkday(new Date(y, mo, 15)));       // 月份 0 基 → mo 即次月
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(String(periodKey || ''));
  if (q) {
    const y = Number(q[1]);
    const n = Number(q[2]);
    return fmtDate(shiftToWorkday(new Date(y, n * 3, 15)));    // Q4 → 次年 1 月
  }
  return '';
}

/**
 * 生成年度申报日历
 * @param {number} year
 * @param {string} periodType 'monthly' | 'quarterly'
 * @param {string} incomeTaxType 'cit' | 'iitBusiness'
 */
export function filingCalendar(year, periodType = 'monthly', incomeTaxType = 'cit') {
  const items = [];
  const F = TAX_POLICY.filing;

  if (periodType === 'quarterly') {
    // 截止月 = 季度结束后一个月：Q1→4 月、Q2→7 月、Q3→10 月、Q4→次年 1 月
    // （月份用 0 基，new Date 会自动跨年，Q4 传 12 即次年 1 月）
    const qEnds = [
      { q: 1, dueMonthIdx: 3, label: `${year} 年第 1 季度（1—3 月）` },
      { q: 2, dueMonthIdx: 6, label: `${year} 年第 2 季度（4—6 月）` },
      { q: 3, dueMonthIdx: 9, label: `${year} 年第 3 季度（7—9 月）` },
      { q: 4, dueMonthIdx: 12, label: `${year} 年第 4 季度（10—12 月）` }
    ];
    for (const q of qEnds) {
      const due = shiftToWorkday(new Date(year, q.dueMonthIdx, 15));
      const list = [F.vat.name, F.financeReport.name];
      list.push(incomeTaxType === 'cit' ? F.citPrepay.name : F.iitPrepay.name);
      items.push({
        periodLabel: q.label,
        dueDate: fmtDate(due),
        dueMonth: due.getMonth() + 1,
        items: list
      });
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const due = shiftToWorkday(new Date(year, m + 1, 15));
      const list = [F.vat.name];
      list.push(incomeTaxType === 'cit' ? F.citPrepay.name : F.iitPrepay.name);
      items.push({
        periodLabel: `${year} 年 ${m + 1} 月`,
        dueDate: fmtDate(due),
        dueMonth: due.getMonth() + 1,
        items: list
      });
    }
  }

  // 年度事项
  const annual = incomeTaxType === 'cit' ? F.citAnnual : F.iitAnnual;
  items.push({
    periodLabel: `${year} 年度汇算清缴`,
    dueDate: fmtDate(new Date(year + 1, annual.month - 1, annual.day)),
    dueMonth: annual.month,
    items: [annual.name, F.financeReport.name],
    annual: true
  });

  return items;
}

/* ============================================================
   八、台账汇总
   ============================================================ */

/**
 * 判断某个 日期字符串 属于哪个申报期
 * ⚠️ 不能用 new Date('2026-01-01')：那按 UTC 解析，在西半球时区会退到上一个月。
 *    这里直接按字面拆年月，与本地时区无关。
 */
export function periodKeyOf(dateStr, periodType) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return '';
  if (periodType === 'quarterly') {
    return `${y}-Q${Math.floor((mo - 1) / 3) + 1}`;
  }
  return `${y}-${pad2(mo)}`;
}

/**
 * 把台账流水按申报期汇总
 * @param {Array} entries [{ id, date, medical, consumable, cosmetic, cost }]
 * @param {string} periodType
 * @returns {Array} 按期间倒序
 */
export function summarizeLedger(entries, periodType = 'monthly') {
  const map = new Map();
  for (const e of entries || []) {
    const key = periodKeyOf(e.date, periodType);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { periodKey: key, medical: 0, consumable: 0, cosmetic: 0, cost: 0, count: 0 });
    }
    const row = map.get(key);
    row.medical += Number(e.medical) || 0;
    row.consumable += Number(e.consumable) || 0;
    row.cosmetic += Number(e.cosmetic) || 0;
    row.cost += Number(e.cost) || 0;
    row.count += 1;
  }
  return Array.from(map.values())
    .map((r) => ({
      ...r,
      medical: r2(r.medical),
      consumable: r2(r.consumable),
      cosmetic: r2(r.cosmetic),
      cost: r2(r.cost),
      total: r2(r.medical + r.consumable + r.cosmetic)
    }))
    .sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1));
}

/** 期间 key → 可读标签 */
export function periodLabel(key, periodType = 'monthly') {
  if (!key) return '—';
  if (periodType === 'quarterly') {
    const [y, q] = key.split('-Q');
    const startM = (Number(q) - 1) * 3 + 1;
    return `${y} 年第 ${q} 季度（${startM}—${startM + 2} 月）`;
  }
  const [y, m] = key.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

