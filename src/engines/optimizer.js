/**
 * 口腔门诊最优收费标准与筹划算法引擎
 */
import { calculateDentalFees } from './feeCalculator.js';

/**
 * 分析当前选单，输出3种维度的最优收费标准对比方案
 * 1. 医保合规统筹最大化方案 (患者自付最省)
 * 2. 品质疗效与合规平衡方案 (合理利用自费耗材与个账)
 * 3. 医保红线纠偏与合规净化方案 (剔除违规拆套，消除飞检追责风险)
 */
export function generateOptimalPricingPlans({
  cityPolicy,
  patientTypeId,
  institutionLevel = 'primary',
  accumulatedDeductible = 0,
  accumulatedReimbursement = 0,
  selectedItems = [],
  taxSettings,
  redLineViolations = []
}) {
  // 当前基准方案测算
  const baseResult = calculateDentalFees({
    cityPolicy,
    patientTypeId,
    institutionLevel,
    accumulatedDeductible,
    accumulatedReimbursement,
    selectedItems,
    taxSettings
  });

  const plans = [];

  // 1. 方案一：医保统筹利用最大化（自付最省）
  // 核心：若患者医保封顶线剩余充足，建议充分利用医保甲乙类项目合规报销
  const pt = cityPolicy.patientTypes.find(p => p.id === patientTypeId);
  // 缺省封顶线与 feeCalculator 保持一致（999999 视为「无封顶」），不要另起一个 2000
  const annualCap = (pt && Number.isFinite(pt.maxAnnualLimit)) ? pt.maxAnnualLimit : 999999;
  const maxAnnualRemaining = Math.max(0, annualCap - accumulatedReimbursement);
  const fundPayNow = baseResult.summary.fundPayAmount;
  const patientPayNow = baseResult.summary.patientTotalPay;
  // 个人账户（含家庭共济）可支付范围：仅甲/丙类自付与自费部分通常可走个账
  const accountAvailable = !!(pt && pt.personalAccountEligible);
  const familyShare = !!(pt && pt.familySharing);
  // 可用个账结算时，患者当期现金支出可降到 0（前提是个账余额充足）
  const cashPayNow = accountAvailable ? 0 : patientPayNow;

  let plan1Advice = '';
  if (baseResult.insuranceBreakdown.classCTotal > 0 && maxAnnualRemaining > fundPayNow + 200) {
    plan1Advice = `当前方案包含自费项 ¥${baseResult.insuranceBreakdown.classCTotal}。患者年统筹基金尚余 ¥${(maxAnnualRemaining - fundPayNow).toFixed(2)} 空间，若存在功能性治疗需求（如牙周系统刮治或治疗性树脂），建议优先安排医保合规诊疗，患者当期现金压力降低约 ${(baseResult.insuranceBreakdown.reimbursementRate * 100).toFixed(0)}%。`;
  } else {
    plan1Advice = `当前方案统筹已利用 ¥${fundPayNow.toFixed(2)}，患者综合自付率 ${(100 - baseResult.summary.effectiveReimbursementRatio).toFixed(1)}%，符合本地最优政策待遇区间。`;
  }

  plans.push({
    id: 'plan_reimbursement_max',
    name: '方案一：医保统筹最惠方案 (患者自付最低)',
    tag: '患者首选 · 降低决策阻力',
    description: '充分利用患者当年医保门诊统筹剩余额度，以甲类/乙类目录内诊疗项目为主。',
    fundPay: fundPayNow,
    patientPay: patientPayNow,
    patientCash: patientPayNow,
    effectiveRatio: baseResult.summary.effectiveReimbursementRatio,
    netProfit: baseResult.taxBreakdown.netProfit,
    advice: plan1Advice,
    advantages: [
      '极大降低患者自掏腰包的顾虑，提升诊疗方案接受率与依从性',
      '合规使用门诊统筹额度，避免患者“医保卡闲置”抱怨',
      '按本地报销标准自动精准划算，避免结算退单'
    ]
  });

  // 2. 方案二：品质升级与长效疗效平衡方案 (品质与毛利平衡)
  // 与方案一的实质差别：统筹金额相同，但自付与自费部分改由个人账户（可家庭共济）结算，
  // 患者当期「现金」支出下降 —— 这是可计算的真差异，而不是换一段文案。
  const qualityAdvice = familyShare
    ? `支持家庭共济个账划扣：自费材料（如全瓷嵌体/高端生物充填）可使用直系亲属医保个账支付。相同统筹金额下，患者当期现金支出可由 ¥${patientPayNow.toFixed(2)} 降至 ¥${cashPayNow.toFixed(2)}，既规避统筹违规风险，又保障高质量材料的应用与门诊合理毛利。`
    : (accountAvailable
      ? `可用个人账户支付自付与自费部分：相同统筹金额下，患者现金支出可由 ¥${patientPayNow.toFixed(2)} 降至 ¥${cashPayNow.toFixed(2)}（以个账余额充足为前提）。`
      : '自费与医保清晰分账，向患者明确告知医保支付与自费材料清单，签署《自费知情同意书》，建立阳光医疗信誉。');

  plans.push({
    id: 'plan_quality_balance',
    name: '方案二：品质疗效与医保平衡方案 (推荐临床应用)',
    tag: '行业标杆 · 兼顾疗效与利润',
    description: '规范区分医保医疗服务与高阶自费修复材料，医保报基础、自费保长效；自付部分优先走个人账户结算。',
    fundPay: fundPayNow,
    patientPay: patientPayNow,
    patientCash: cashPayNow,
    accountAvailable,
    familyShare,
    effectiveRatio: baseResult.summary.effectiveReimbursementRatio,
    netProfit: baseResult.taxBreakdown.netProfit,
    advice: qualityAdvice,
    advantages: [
      '治疗性操作（如根管、拔牙、拍片）严格走医保，经得起飞检调阅病历',
      accountAvailable
        ? `自付与自费部分改由个人账户结算，患者现金支出下降 ¥${(patientPayNow - cashPayNow).toFixed(2)}`
        : '耗材/冠修复采用高耐磨自费耗材，患者体验好',
      '门诊利润结构健康，不依赖医保违规加收'
    ]
  });

  // 3. 方案三：合规净化安全方案 (若存在红线违规，自动剔除违规拆套项并重新测算)
  if (redLineViolations && redLineViolations.length > 0) {
    // 找出违规代码列表
    const violatingCodes = new Set();
    redLineViolations.forEach(v => {
      if (v.involvedCodes) v.involvedCodes.forEach(c => violatingCodes.add(c));
    });

    // 剔除冲突次要项（例如保留根管治疗，剔除重复加收的开髓引流术 330501007；保留阻生齿拔除，剔除切开缝合 330504005）
    const nm = (e) => (e.item.name || '');
    const ENDO_MAIN_114 = /^(根管预备费|根管冲洗费|根管充填费|牙髓失活费|干髓治疗费)/;
    const ORTHO_MAIN_114 = /(错合矫治费|错合矫形功能治疗费|局部正畸矫治费)/;
    const LEGACY_ENDO_MAIN = ['330501001', '330501002', '330501003'];

    const sanitizedItems = selectedItems.filter(entry => {
      const name = nm(entry), code = entry.item.code;

      // 114 版：牙体开髓引流费在牙髓治疗中已作为价格构成，不得单收
      if (name.startsWith('牙体开髓引流费')
        && selectedItems.some(i => ENDO_MAIN_114.test(nm(i)))) {
        return false;
      }
      // 114 版：错合矫治不得另收设计费
      if (name.startsWith('错合畸形治疗设计费')
        && selectedItems.some(i => ORTHO_MAIN_114.test(nm(i)))) {
        return false;
      }
      // 旧版：根管治疗术已含开髓，剔除开髓引流术
      if (code === '330501007' && selectedItems.some(i => LEGACY_ENDO_MAIN.includes(i.item.code))) {
        return false;
      }
      // 旧版：阻生齿拔除已含缝合，剔除单独缝合
      if (code === '330504005' && selectedItems.some(i => i.item.code === '330504003')) {
        return false;
      }
      return true;
    });

    const sanitizedResult = calculateDentalFees({
      cityPolicy,
      patientTypeId,
      institutionLevel,
      accumulatedDeductible,
      accumulatedReimbursement,
      selectedItems: sanitizedItems,
      taxSettings
    });

    // 罚款估算改按「违规涉及金额 × 1~3 倍」—— 原实现用「项数 × 2000」是拍脑袋数字，
    // 金额与违规项单价无关，容易被医生当成真实风险敞口。
    const involvedAmount = redLineViolations.reduce((sum, v) => {
      const codes = v.involvedCodes || [];
      return sum + selectedItems
        .filter(i => codes.includes(i.item.code))
        .reduce((s, i) => {
          const p = i.customPrice !== undefined ? Number(i.customPrice)
            : Number(i.item.defaultPrice != null ? i.item.defaultPrice : (i.item.priceLevel3 || 0));
          return s + (Number(p) || 0) * (i.quantity || 1);
        }, 0);
    }, 0);
    const penaltyLow = Math.round(involvedAmount * 1 * 100) / 100;
    const penaltyHigh = Math.round(involvedAmount * 3 * 100) / 100;
    const penaltyText = involvedAmount > 0
      ? `涉及违规收费 ¥${involvedAmount.toFixed(2)}，按 1~3 倍罚款计，风险敞口约 ¥${penaltyLow.toFixed(0)}~¥${penaltyHigh.toFixed(0)}`
      : '涉及金额无法自动归集，请人工核算风险敞口';

    plans.push({
      id: 'plan_compliance_sanitized',
      name: '方案三：零风险合规净化方案 (已剔除拆套/违规项)',
      tag: '🔴 飞行检查安全盾',
      description: '已自动剔除检测到的拆套分解项目（如开髓引流术、重复切开缝合术），消除医保违规红线。',
      fundPay: sanitizedResult.summary.fundPayAmount,
      patientPay: sanitizedResult.summary.patientTotalPay,
      patientCash: accountAvailable ? 0 : sanitizedResult.summary.patientTotalPay,
      effectiveRatio: sanitizedResult.summary.effectiveReimbursementRatio,
      netProfit: sanitizedResult.taxBreakdown.netProfit,
      involvedAmount,
      penaltyLow,
      penaltyHigh,
      advice: `建议采纳此净化方案！原方案包含 ${redLineViolations.length} 处违规风险点，${penaltyText}；此外还面临本金全额追回与医保记分扣款。`,
      advantages: [
        '彻底杜绝“分解住院/分解门诊项目”核心红线，病历与医保明细100%合规闭环',
        '门诊财务与主诊医生无后顾之忧，平稳通过国家及省市各级医保巡检',
        '收费清单透明合规，从源头消灭患者投诉隐患'
      ]
    });
  }

  return {
    baseResult,
    plans
  };
}
