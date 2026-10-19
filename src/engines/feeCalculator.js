/**
 * 医保费用与门诊税费双轨精准核算引擎
 */

/**
 * 计算处方/选单的医保报销拆解与门诊税费
 * @param {Object} params
 * @param {Object} params.cityPolicy 城市医保政策对象 (来自 citiesPolicy.js)
 * @param {string} params.patientTypeId 参保人员类别 (如 employee_active)
 * @param {string} params.institutionLevel 医疗机构等级 ('primary' | 'secondary' | 'tertiary')
 * @param {number} params.accumulatedDeductible 年度已累计自负/起付线满足金额
 * @param {number} params.accumulatedReimbursement 年度已报销统筹金额
 * @param {Array} params.selectedItems 选中的项目明细列表 [{ item: {...}, quantity: number, customPrice?: number }]
 * @param {Object} params.taxSettings 税务设置参数 { vatRate, surchargeRate, incomeTaxRate, costRate }
 * @returns {Object} 完整计算结果
 */
export function calculateDentalFees({
  cityPolicy,
  patientTypeId,
  institutionLevel = 'primary',
  accumulatedDeductible = 0,
  accumulatedReimbursement = 0,
  selectedItems = [],
  taxSettings
}) {
  const patientType = cityPolicy.patientTypes.find(p => p.id === patientTypeId) || cityPolicy.patientTypes[0];

  // 1. 获取对应机构级别的起付线与报销比例
  const deductibleLine = patientType.deductibleLevels 
    ? (patientType.deductibleLevels[institutionLevel] ?? patientType.deductible)
    : patientType.deductible;

  const reimbursementRate = patientType.ratesByLevel 
    ? (patientType.ratesByLevel[institutionLevel] ?? patientType.reimbursementRate)
    : patientType.reimbursementRate;

  const maxAnnualLimit = patientType.maxAnnualLimit || 999999;
  const remainingAnnualLimit = Math.max(0, maxAnnualLimit - accumulatedReimbursement);

  // 2. 统计各费用属性项目金额
  let totalGrossAmount = 0;       // 项目原价总额
  let classATotal = 0;             // 甲类项目总额
  let classBTotal = 0;             // 乙类项目总额
  let classBCopayTotal = 0;        // 乙类先行自付总额
  let classBEligibleTotal = 0;     // 乙类纳统部分总额
  let classCTotal = 0;             // 丙类/自费总额

  const itemBreakdown = selectedItems.map(entry => {
    const item = entry.item;
    const qty = entry.quantity || 1;
    // ⚠️ 114 版项目没有 defaultPrice，只有 priceLevel1/2/3 三档价。
    //    调用方（app.js 的 buildSelectedItems）会按门诊级别解析好 customPrice 传进来；
    //    若直接调用引擎而漏传，此处按 defaultPrice → 三级价 → 0 兜底，避免整条链路算出 NaN。
    const rawPrice = entry.customPrice !== undefined
      ? entry.customPrice
      : (item.defaultPrice != null ? item.defaultPrice : (item.priceLevel3 != null ? item.priceLevel3 : 0));
    const unitPrice = Number(rawPrice) || 0;
    const subtotal = Math.round(unitPrice * qty * 100) / 100;

    totalGrossAmount += subtotal;

    let classType = item.insuranceType; // '甲类' | '乙类' | '自费'
    let itemCopay = 0;
    let itemEligible = 0;
    let itemSelfPaid = 0;

    if (classType === '甲类') {
      classATotal += subtotal;
      itemEligible = subtotal;
    } else if (classType === '乙类') {
      // 用 ?? 而非 ||：copayRate 为 0（乙类但先行自付 0%）时不能被默认成 10%
      const copayRate = item.copayRate ?? 0.10;
      itemCopay = Math.round(subtotal * copayRate * 100) / 100;
      itemEligible = Math.round((subtotal - itemCopay) * 100) / 100;
      classBTotal += subtotal;
      classBCopayTotal += itemCopay;
      classBEligibleTotal += itemEligible;
    } else {
      classCTotal += subtotal;
      itemSelfPaid = subtotal;
    }

    return {
      code: item.code,
      name: item.name,
      category: item.category,
      unitPrice,
      quantity: qty,
      subtotal,
      insuranceType: classType,
      itemCopay,
      itemEligible,
      itemSelfPaid
    };
  });

  // 纳统筹总基数（甲类 + 乙类纳统部分）
  const totalEligibleFundBase = Math.round((classATotal + classBEligibleTotal) * 100) / 100;

  // 3. 计算起付线扣减
  // 尚需满足的起付线缺口
  const deductibleDeficit = Math.max(0, deductibleLine - accumulatedDeductible);
  // 本次就诊承担的起付线自付
  const currentDeductiblePaid = Math.min(deductibleDeficit, totalEligibleFundBase);
  // 扣除起付线后实际进入统筹报销计算的金额
  const effectiveReimbursableBase = Math.max(0, totalEligibleFundBase - currentDeductiblePaid);

  // 4. 计算统筹基金支付与患者自负
  // 理论统筹应支付金额
  const theoreticalFundPay = Math.round(effectiveReimbursableBase * reimbursementRate * 100) / 100;
  // 受年度封顶线限制后的统筹基金实际支付
  const fundPayAmount = Math.min(theoreticalFundPay, remainingAnnualLimit);

  // 政策内个人自负比例金额 (未被统筹基金报销的部分)
  const policySelfPay = Math.round((effectiveReimbursableBase - fundPayAmount) * 100) / 100;

  // 个人自付总金额 = 乙类先行自付 + 本次承担起付线 + 政策内个人自负
  const patientCopayTotal = Math.round((classBCopayTotal + currentDeductiblePaid + policySelfPay) * 100) / 100;

  // 个人现金/个账支付总额 = 个人自付总金额 + 丙类完全自费金额
  const patientTotalPay = Math.round((patientCopayTotal + classCTotal) * 100) / 100;

  // 门诊实际总收入 (基金结算款 + 患者实付款)
  const clinicTotalRevenue = Math.round((fundPayAmount + patientTotalPay) * 100) / 100;

  // 综合报销率
  const effectiveReimbursementRatio = totalGrossAmount > 0 
    ? Math.round((fundPayAmount / totalGrossAmount) * 1000) / 10
    : 0;

  // 5. 门诊税费多模式核算
  // ⚠️ 关键口径：医疗服务收入免征增值税，只有应税部分（耗材/商品/非医疗美容）才计税。
  //    把全部收入按一个税率计税是错的，会导致多缴税；反之未分别核算则不得免税。
  const vatRate = taxSettings ? Number(taxSettings.vatRate) : 0;
  const surchargeRate = taxSettings ? Number(taxSettings.surchargeRate) : 0;
  const incomeTaxRate = taxSettings ? Number(taxSettings.incomeTaxRate) : 0.05;
  const costRate = taxSettings ? Number(taxSettings.costRate) : 0.65;
  const rawShare = taxSettings ? Number(taxSettings.taxableShare) : 0;
  // 应税收入占比：0 = 全部医疗服务免税，1 = 全部应税；缺省按免税处理
  const taxableShare = Number.isFinite(rawShare) ? Math.min(1, Math.max(0, rawShare)) : 0;

  // 拆分免税收入与应税收入
  const taxableRevenue = Math.round(clinicTotalRevenue * taxableShare * 100) / 100;
  const exemptRevenue = Math.round((clinicTotalRevenue - taxableRevenue) * 100) / 100;

  // 不含税销售额 = 免税收入全额 + 应税收入还原
  const taxableNetRevenue = vatRate > 0
    ? Math.round((taxableRevenue / (1 + vatRate)) * 100) / 100
    : taxableRevenue;
  const revenueWithoutTax = Math.round((exemptRevenue + taxableNetRevenue) * 100) / 100;
  // 应交增值税（只对应税部分）
  const vatAmount = Math.round((taxableRevenue - taxableNetRevenue) * 100) / 100;
  // 城建税及附加
  const surchargeAmount = Math.round((vatAmount * surchargeRate) * 100) / 100;
  // 门诊营运综合成本 (耗材、人力、器械折旧、场地)
  const clinicCost = Math.round((revenueWithoutTax * costRate) * 100) / 100;
  // 利润总额 (税前)
  const grossProfit = Math.max(0, Math.round((revenueWithoutTax - surchargeAmount - clinicCost) * 100) / 100);
  // 所得税
  const incomeTaxAmount = Math.round((grossProfit * incomeTaxRate) * 100) / 100;
  // 税后纯净利润
  const netProfit = Math.round((grossProfit - incomeTaxAmount) * 100) / 100;
  // 综合纳税总额
  const totalTaxAmount = Math.round((vatAmount + surchargeAmount + incomeTaxAmount) * 100) / 100;
  // 综合综合税负率 (%)
  const totalTaxBurdenRate = clinicTotalRevenue > 0
    ? Math.round((totalTaxAmount / clinicTotalRevenue) * 1000) / 10
    : 0;

  return {
    summary: {
      totalGrossAmount,          // 原价总计
      clinicTotalRevenue,        // 门诊实收总计
      fundPayAmount,             // 医保统筹基金支付款
      patientTotalPay,           // 患者实付总额 (现金或个账)
      effectiveReimbursementRatio, // 实际统筹报销比例 %
      remainingAnnualLimit: Math.max(0, Math.round((remainingAnnualLimit - fundPayAmount) * 100) / 100)
    },
    insuranceBreakdown: {
      classATotal,               // 甲类全额
      classBTotal,               // 乙类总额
      classBCopayTotal,          // 乙类先行自付
      classBEligibleTotal,       // 乙类纳入统筹
      classCTotal,               // 丙类完全自费
      totalEligibleFundBase,     // 纳统筹总基数
      deductibleLine,            // 政策起付线
      deductibleDeficit,         // 当前起付线缺口
      currentDeductiblePaid,     // 本次扣减起付线
      effectiveReimbursableBase, // 扣除起付线后计统筹基数
      reimbursementRate,         // 统筹报销比例
      policySelfPay,             // 政策内个人自负
      patientCopayTotal          // 个人自付小计 (不含丙类)
    },
    taxBreakdown: {
      vatRate,
      vatAmount,
      surchargeRate,
      surchargeAmount,
      clinicCost,
      grossProfit,
      incomeTaxRate,
      incomeTaxAmount,
      netProfit,
      totalTaxAmount,
      totalTaxBurdenRate,
      /* 免税/应税拆分（第 13 轮新增，界面据此说明「为什么这单的税只有这么多」） */
      taxableShare,
      exemptRevenue,        // 免税医疗服务收入
      taxableRevenue,       // 应税收入（含税）
      taxableNetRevenue,    // 应税收入（不含税）
      revenueWithoutTax     // 不含税收入合计
    },
    itemBreakdown
  };
}
