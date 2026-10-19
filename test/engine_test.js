/**
 * 引擎自动化测试脚本
 */
import { CITIES_POLICY } from '../src/data/citiesPolicy.js';
import { TAX_MODES } from '../src/data/taxModes.js';
import { DENTAL_ITEMS } from '../src/data/dentalItems.js';
import {
  ITEMS_114_MAIN, ITEMS_114_ADDONS, ITEMS_114_ALL, ITEMS_114_META, CATEGORIES_114
} from '../src/data/items114.js';
import {
  IMAGING_ITEMS, IMAGING_MAIN, IMAGING_ALL, IMAGING_META
} from '../src/data/imagingItems.js';
import { calculateDentalFees } from '../src/engines/feeCalculator.js';
import { checkInsuranceRedLines } from '../src/engines/redLineChecker.js';
import { generateOptimalPricingPlans } from '../src/engines/optimizer.js';
import { CONSENT_TEMPLATES, CONSENT_COMMON, findConsentTemplate } from '../src/data/consents.js';
import {
  matchConsents, buildConsentDoc, consentDocHtml, consentDocText,
  consentPackHtml, searchConsents, CONSENT_DOC_CSS, CONSENT_PATIENT_FIELDS
} from '../src/engines/consentEngine.js';
import {
  RECORD_DOCTOR_FIELDS, RECORD_DEPARTMENTS, recordTemplateOf
} from '../src/data/records.js';
import {
  MUTEX_BOUNDARIES, TREATMENT_COMBOS, MARKETING_SCENARIOS, SELF_CHECK_MODULES,
  TAX_MATRIX, MARKETING_IRON_RULE, FEE_SPLIT_SECTIONS
} from '../src/data/billingRules.js';
import {
  checkBillingBoundaries, boundarySummaryText, feeSplitAdvice, filterCombos,
  relatedCombos, comboAvailability, selfCheckReport, listMarketingScenarios
} from '../src/engines/advisorEngine.js';
import {
  draftRecord, buildMedicalRecord, recordDocHtml, recordDocText,
  recordPackHtml, RECORD_DOC_CSS
} from '../src/engines/recordEngine.js';
import {
  computePeriodTax, buildVatFilingSheet, taxRiskChecks,
  filingCalendar, summarizeLedger, periodKeyOf, periodLabel, periodDueDate
} from '../src/engines/taxEngine.js';
import { TAX_POLICY, entityById } from '../src/data/taxPolicy.js';

console.log('================ 运行自动化单元测试 ================');

// 1. 验证五大城市数据完整性
const cityKeys = Object.keys(CITIES_POLICY);
console.log(`[测试 1] 验证五大城市: ${cityKeys.join(', ')}`);
if (cityKeys.length !== 5 || !CITIES_POLICY.chengdu || !CITIES_POLICY.guangzhou || !CITIES_POLICY.shenzhen || !CITIES_POLICY.shanghai || !CITIES_POLICY.chongqing) {
  throw new Error('城市政策数据不完整！');
}
console.log('✅ 五大城市医保政策数据通过');

// 2. 验证多税务模式
console.log(`[测试 2] 验证税务模式数量: ${TAX_MODES.length}`);
if (TAX_MODES.length < 5) throw new Error('税务模式不足5种！');
console.log('✅ 税务模式验证通过');

// 3. 验证费用计算与医保拆解 (以成都职工在职为例，做一颗磨牙根管治疗 + 拍片)
console.log('[测试 3] 验证成都职工门诊费用计算');
const testItems = [
  { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 }, // 磨牙根管 680 (乙类, 自付10%)
  { item: DENTAL_ITEMS.find(i => i.code === '310401002'), quantity: 2 }, // 根尖片 25*2=50 (甲类)
  { item: DENTAL_ITEMS.find(i => i.code === '110200001'), quantity: 1 }  // 诊查费 15 (甲类)
];

const chengduPolicy = CITIES_POLICY.chengdu;
const calcResult = calculateDentalFees({
  cityPolicy: chengduPolicy,
  patientTypeId: 'employee_active',
  institutionLevel: 'primary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  selectedItems: testItems,
  taxSettings: TAX_MODES[0].settings // 免税医疗
});

console.log('计算结果摘要:', {
  原价: calcResult.summary.totalGrossAmount,
  统筹支付: calcResult.summary.fundPayAmount,
  患者实付: calcResult.summary.patientTotalPay,
  实收总计: calcResult.summary.clinicTotalRevenue,
  净利润: calcResult.taxBreakdown.netProfit
});

if (calcResult.summary.totalGrossAmount !== 745) {
  throw new Error(`原价计算错误，应为 745，实际为 ${calcResult.summary.totalGrossAmount}`);
}
console.log('✅ 费用计算与医保拆解验证通过');

// 4. 验证红线检查引擎 (测试拆套违规：磨牙根管 + 开髓引流)
console.log('[测试 4] 验证红线检查：拆套分解收费检测');
const violationItems = [
  { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 }, // 磨牙根管
  { item: DENTAL_ITEMS.find(i => i.code === '330501007'), quantity: 1 }  // 开髓引流 (拆套违规)
];

const redLineResult = checkInsuranceRedLines({
  selectedItems: violationItems,
  cityPolicy: chengduPolicy
});

console.log('红线拦截结果:', {
  发现违规数: redLineResult.violationCount,
  安全等级: redLineResult.safetyGrade,
  安全分: redLineResult.riskScore,
  违规标题: redLineResult.violations.map(v => v.title)
});

if (!redLineResult.hasViolations || redLineResult.safetyGrade !== 'FATAL') {
  throw new Error('未正确拦截拆套分解收费红线！');
}
console.log('✅ 医保红线检查验证通过');

// 5. 验证最优收费筹划方案
console.log('[测试 5] 验证最优收费筹划方案生成');
const planResult = generateOptimalPricingPlans({
  cityPolicy: chengduPolicy,
  patientTypeId: 'employee_active',
  institutionLevel: 'primary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  selectedItems: violationItems,
  taxSettings: TAX_MODES[0].settings,
  redLineViolations: redLineResult.violations
});

console.log('最优方案数:', planResult.plans.length);
planResult.plans.forEach(p => console.log(`- ${p.name}: ${p.tag}`));
if (planResult.plans.length < 3) throw new Error('最优方案数量不足！');
console.log('✅ 最优收费方案生成验证通过');

console.log('================ 所有引擎单元测试全部通过！ ================');

/* ============================================================
   114 版（《口腔类医疗服务价格项目立项指南》医保价采函〔2025〕18号）
   ============================================================ */
console.log('');
console.log('================ 114 版立项指南专项测试 ================');

const assert = (cond, msg) => { if (!cond) throw new Error('❌ ' + msg); };

// T1 数据完整性
console.log('[114-T1] 数据完整性与官方口径一致性');
assert(ITEMS_114_MAIN.length === 114, `主项目应为 114 项，实际 ${ITEMS_114_MAIN.length}`);
assert(ITEMS_114_ADDONS.length === 81, `加收/分项应为 81 项，实际 ${ITEMS_114_ADDONS.length}`);
assert(ITEMS_114_ALL.length === 195, `合计应为 195 条，实际 ${ITEMS_114_ALL.length}`);
assert(new Set(ITEMS_114_ALL.map(i => i.code)).size === 195, '项目编码存在重复');
assert(ITEMS_114_MAIN.every(i => !i.isAddon), '主项目中混入了加收项');
assert(ITEMS_114_ADDONS.every(i => i.isAddon), '加收集合中存在非加收项');
assert(ITEMS_114_META.docNo === '医保价采函〔2025〕18号', '文号不符');
console.log(`  主项目 ${ITEMS_114_MAIN.length} | 加收 ${ITEMS_114_ADDONS.length} | 合计 ${ITEMS_114_ALL.length} | 编码唯一 ✅`);

// T2 支付类别分布（与官方表一致）
console.log('[114-T2] 医保支付类别分布');
const insCount = ITEMS_114_MAIN.reduce((a, i) => (a[i.insuranceType] = (a[i.insuranceType] || 0) + 1, a), {});
assert(insCount['甲类'] === 17 && insCount['乙类'] === 29 && insCount['自费'] === 68,
  `甲/乙/自费应为 17/29/68，实际 ${JSON.stringify(insCount)}`);
console.log(`  甲类 ${insCount['甲类']} | 乙类 ${insCount['乙类']} | 丙类(自费) ${insCount['自费']} ✅`);

// T3 关键价格与官方表逐项核对
console.log('[114-T3] 关键价格抽查（对比官方原表）');
const expectPrice = [
  ['根管预备费', 80, 72, 65, '乙类'],
  ['根管冲洗费', 25, 23, 21, '乙类'],
  ['根管充填费', 120, 108, 97, '乙类'],
  ['牙体开髓引流费', 34, 31, 28, '乙类'],
  ['阻生牙拔除费', 240, 216, 194, '甲类'],
  ['牙拔除费', 90, 81, 73, '甲类'],
  ['龈上洁治费', 5, 5, 5, '自费'],
  ['根面平整费', 15, 14, 13, '甲类']
];
expectPrice.forEach(([name, t3, t2, t1, ins]) => {
  const it = ITEMS_114_MAIN.find(i => i.name === name);
  assert(it, `未找到项目「${name}」`);
  assert(it.priceLevel3 === t3 && it.priceLevel2 === t2 && it.priceLevel1 === t1,
    `${name} 价格不符：期望 ${t3}/${t2}/${t1}，实际 ${it.priceLevel3}/${it.priceLevel2}/${it.priceLevel1}`);
  assert(it.insuranceType === ins, `${name} 医保属性应为 ${ins}，实际 ${it.insuranceType}`);
});
console.log(`  ${expectPrice.length} 项价格 + 类别全部一致 ✅`);

// T4 项目按服务产出设项：原「根管治疗术」已拆分
console.log('[114-T4] 按服务产出设项（根管治疗已拆分）');
['根管预备费', '根管冲洗费', '根管充填费'].forEach(n => {
  assert(ITEMS_114_MAIN.some(i => i.name === n), `缺少拆分后的项目「${n}」`);
});
assert(!ITEMS_114_MAIN.some(i => i.name === '根管治疗术'), '114 版不应再存在「根管治疗术」整体项目');
console.log('  根管预备费 / 根管冲洗费 / 根管充填费 已独立设项 ✅');

// T5 红线：牙体开髓引流费不得与根管治疗项目并收
console.log('[114-T5] 红线：牙体开髓引流费与根管治疗重复计费');
const g = (code) => ITEMS_114_ALL.find(i => i.code === code);
const endoSet = [
  { item: g('013105010050000'), quantity: 1 }, // 根管预备费
  { item: g('013105010060000'), quantity: 1 }, // 根管冲洗费
  { item: g('013105010070000'), quantity: 1 }, // 根管充填费
  { item: g('013105010020000'), quantity: 1 }  // 牙体开髓引流费 ← 违规
];
const r1 = checkInsuranceRedLines({ selectedItems: endoSet, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(r1.violations.some(v => v.ruleId === 'GG114_OPENING_DRAINAGE_EMERGENCY_ONLY'),
  '未拦截「开髓引流费 + 根管治疗」重复计费');
assert(r1.safetyGrade === 'FATAL', `安全等级应为 FATAL，实际 ${r1.safetyGrade}`);
console.log('  已拦截，等级 FATAL ✅');

// T6 红线：错合矫治不得另收设计费
console.log('[114-T6] 红线：错合矫治另收设计费');
const ortho = [
  { item: g('013105020090000'), quantity: 1 }, // 恒牙期Ⅰ类错合矫治费（常规）
  { item: g('013105020230000'), quantity: 1 }  // 错合畸形治疗设计费 ← 违规
];
const r2 = checkInsuranceRedLines({ selectedItems: ortho, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(r2.violations.some(v => v.ruleId === 'GG114_ORTHO_DESIGN_FEE_FORBIDDEN'), '未拦截矫治另收设计费');
console.log('  已拦截 ✅');

// T7 红线：超过政府指导价（三级价为最高限价）
console.log('[114-T7] 红线：收费超过政府指导价上限');
const over = [
  { item: g('013306020060000'), quantity: 1, customPrice: 500 } // 阻生牙拔除费 上限 240
];
const r3 = checkInsuranceRedLines({ selectedItems: over, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(r3.violations.some(v => v.ruleId === 'GG114_PRICE_CEILING'), '未拦截超政府指导价收费');
console.log('  ¥500 > 上限 ¥240 已拦截 ✅');

// T8 红线：龈上洁治费为丙类自费，提示不得走统筹
console.log('[114-T8] 提示：龈上洁治费为丙类');
const clean = [{ item: g('013105010260000'), quantity: 1 }];
const r4 = checkInsuranceRedLines({ selectedItems: clean, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(r4.violations.some(v => v.ruleId === 'GG114_CLEANING_SELF_PAY'), '未提示龈上洁治费为丙类');
console.log('  已提示 ✅');

// T9 红线：基本物耗不得另收
console.log('[114-T9] 红线：基本物质资源消耗不得另行收费');
const withMaterial = [
  { item: g('013105010050000'), quantity: 1 },
  { item: DENTAL_ITEMS.find(i => i.code === 'HC_COLLAGEN_SPONGE'), quantity: 1 } // 旧版耗材项
];
const r5 = checkInsuranceRedLines({ selectedItems: withMaterial, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(r5.violations.some(v => v.ruleId === 'GG114_MATERIAL_NOT_BILLABLE'), '未拦截另收基本物耗');
console.log('  已拦截 ✅');

// T10 版本隔离：114 版不应触发旧版规则，反之亦然
console.log('[114-T10] 版本规则隔离');
const legacyPair = [
  { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 },
  { item: DENTAL_ITEMS.find(i => i.code === '330501007'), quantity: 1 }
];
const rLegacyOn114 = checkInsuranceRedLines({ selectedItems: legacyPair, cityPolicy: CITIES_POLICY.chengdu, version: 'gg114' });
assert(!rLegacyOn114.violations.some(v => v.ruleId === 'UNBUNDLING_ENDO_OPENING'),
  '114 版不应触发旧版的拆套规则');
const r114On114 = checkInsuranceRedLines({ selectedItems: endoSet, cityPolicy: CITIES_POLICY.chengdu, version: 'legacy' });
assert(!r114On114.violations.some(v => v.ruleId === 'GG114_OPENING_DRAINAGE_EMERGENCY_ONLY'),
  '旧版不应触发 114 版规则');
console.log('  两套规则互不串扰 ✅');

// T11 价格随机构级别联动 + 费用测算
console.log('[114-T11] 政府指导价按机构级别联动计算');
const rxCodes = ['013105010050000', '013105010060000', '013105010070000', '013306020060000'];
const rxAt = (level) => rxCodes.map(c => {
  const it = g(c);
  const map = { tertiary: it.priceLevel3, secondary: it.priceLevel2, primary: it.priceLevel1 };
  return { item: it, quantity: 1, customPrice: map[level] };
});
const calc114 = calculateDentalFees({
  cityPolicy: CITIES_POLICY.chengdu,
  patientTypeId: 'employee_active',
  institutionLevel: 'primary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  selectedItems: rxAt('primary'),
  taxSettings: TAX_MODES[0].settings
});
assert(calc114.summary.totalGrossAmount === 377,
  `一级价合计应为 377，实际 ${calc114.summary.totalGrossAmount}`);
const calc114t = calculateDentalFees({
  cityPolicy: CITIES_POLICY.chengdu,
  patientTypeId: 'employee_active',
  institutionLevel: 'tertiary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  selectedItems: rxAt('tertiary'),
  taxSettings: TAX_MODES[0].settings
});
assert(calc114t.summary.totalGrossAmount === 465,
  `三级价合计应为 465，实际 ${calc114t.summary.totalGrossAmount}`);
console.log(`  一级 ¥${calc114.summary.totalGrossAmount} / 三级 ¥${calc114t.summary.totalGrossAmount} ✅`);

// T12 净化方案能剔除 114 版违规项
console.log('[114-T12] 合规净化方案剔除 114 版违规项');
const opt114 = generateOptimalPricingPlans({
  cityPolicy: CITIES_POLICY.chengdu,
  patientTypeId: 'employee_active',
  institutionLevel: 'tertiary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  selectedItems: rxAt('tertiary').concat([{ item: g('013105010020000'), quantity: 1, customPrice: 34 }]),
  taxSettings: TAX_MODES[0].settings,
  redLineViolations: checkInsuranceRedLines({
    selectedItems: rxAt('tertiary').concat([{ item: g('013105010020000'), quantity: 1, customPrice: 34 }]),
    cityPolicy: CITIES_POLICY.chengdu, version: 'gg114'
  }).violations
});
const sanitized = opt114.plans.find(p => p.id === 'plan_compliance_sanitized');
assert(sanitized, '未生成合规净化方案');
assert(sanitized.fundPay < opt114.baseResult.summary.fundPayAmount || sanitized.patientPay < opt114.baseResult.summary.patientTotalPay,
  '净化方案应剔除开髓引流费，金额低于原方案');
console.log(`  原方案患者自付 ¥${opt114.baseResult.summary.patientTotalPay} → 净化后 ¥${sanitized.patientPay} ✅`);

console.log('');
console.log('================ 114 版专项测试全部通过！ ================');

/* ============================================================
   知情同意书模块测试
   ============================================================ */
console.log('');
console.log('================ 知情同意书模块专项测试 ================');

// C1 模板库完整性
console.log('[CT-T1] 模板库完整性与结构校验');
assert(CONSENT_TEMPLATES.length >= 18, `同意书模板应 ≥18 份，实际 ${CONSENT_TEMPLATES.length}`);
const cIds = CONSENT_TEMPLATES.map(t => t.id);
assert(new Set(cIds).size === cIds.length, '同意书 id 存在重复');
CONSENT_TEMPLATES.forEach(t => {
  assert(t.id && t.title && t.category && t.level, `模板 ${t.id} 缺少必填字段`);
  assert(Number.isFinite(t.order), `模板 ${t.id} 缺少 order`);
  assert(Array.isArray(t.sections) && t.sections.length >= 2, `模板 ${t.id} 告知章节不足`);
  t.sections.forEach(s => {
    assert(s.h && Array.isArray(s.items) && s.items.length >= 2, `模板 ${t.id} 章节「${s.h}」条目不足`);
  });
});
assert(CONSENT_COMMON.declarations.length >= 4, '通用声明条款不足');
assert(CONSENT_COMMON.signBlocks.length >= 3, '签署区不足');
console.log(`  模板 ${CONSENT_TEMPLATES.length} 份，id 唯一，结构完整 ✅`);

// C2 通用告知书不得自动弹出
console.log('[CT-T2] 通用告知书不参与自动匹配');
const autoAll = matchConsents({ selectedItems: ITEMS_114_ALL.map(i => ({ item: i, quantity: 1 })) });
assert(!autoAll.matched.some(m => m.id === 'general'), '通用告知书不应被自动匹配');
console.log(`  全量处方自动匹配 ${autoAll.matched.length} 份，未包含通用告知书 ✅`);

// C3 114 版典型处方匹配
console.log('[CT-T3] 114 版根管治疗 + 阻生牙拔除自动匹配');
const rxConsent114 = [
  { item: g('013105010050000'), quantity: 1 }, // 根管预备费
  { item: g('013105010060000'), quantity: 1 }, // 根管冲洗费
  { item: g('013105010070000'), quantity: 1 }, // 根管充填费
  { item: g('013306020060000'), quantity: 1 }  // 阻生牙拔除费
];
const m3 = matchConsents({ selectedItems: rxConsent114 });
const m3ids = m3.matched.map(m => m.id);
assert(m3ids.includes('endo'), '根管治疗应匹配到根管治疗知情同意书');
assert(m3ids.includes('impacted'), '阻生牙拔除应匹配到阻生牙拔除知情同意书');
assert(m3ids.includes('anesthesia'), '有创操作应附带局部麻醉知情同意书');
assert(m3ids.indexOf('impacted') < m3ids.indexOf('endo'), '高风险文书应排在前面（order 小的优先）');
const endoEntry = m3.matched.find(m => m.id === 'endo');
assert(endoEntry.items.length === 3, `根管治疗同意书应关联 3 个项目，实际 ${endoEntry.items.length}`);
console.log(`  命中 ${m3ids.join(' / ')} ✅`);

// C4 加收分项按主项目名前缀匹配
console.log('[CT-T4] 加收分项按主项目名前缀匹配');
const addonItem = ITEMS_114_ALL.find(i => i.name === '根管预备费-根管异常（加收）');
const m4 = matchConsents({ selectedItems: [{ item: addonItem, quantity: 1 }] });
assert(m4.matched.some(m => m.id === 'endo'), '加收分项应挂靠主项目的根管治疗同意书');
console.log(`  「${addonItem.name}」→ ${m4.matched.map(m => m.id).join(' / ')} ✅`);

// C5 不误伤：洁治不得匹配到根管 / 正畸文书
console.log('[CT-T5] 匹配不得误伤（洁治 → 仅洁治文书）');
const m5 = matchConsents({ selectedItems: [{ item: g('013105010260000'), quantity: 1 }] });
const m5ids = m5.matched.map(m => m.id);
assert(m5ids.includes('cleaning'), '龈上洁治费应匹配洁治知情同意书');
assert(!m5ids.includes('endo'), '洁治不应匹配根管治疗同意书');
assert(!m5ids.includes('ortho'), '洁治不应匹配正畸同意书');
console.log(`  命中 ${m5ids.join(' / ')} ✅`);

// C6 旧版编码匹配
console.log('[CT-T6] 旧版（330xxxxx）编码匹配');
const m6 = matchConsents({
  selectedItems: [
    { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 },
    { item: DENTAL_ITEMS.find(i => i.code === '330504003'), quantity: 1 }
  ]
});
const m6ids = m6.matched.map(m => m.id);
assert(m6ids.includes('endo'), '旧版磨牙根管治疗术应匹配根管治疗同意书');
assert(m6ids.includes('impacted'), '旧版复杂阻生牙拔除术应匹配阻生牙拔除同意书');
assert(m6ids.includes('anesthesia'), '旧版有创操作应附带麻醉同意书');
console.log(`  命中 ${m6ids.join(' / ')} ✅`);

// C7 全量覆盖率（应无遗漏项目）
console.log('[CT-T7] 全量项目自动匹配覆盖率');
const cov114 = matchConsents({ selectedItems: ITEMS_114_ALL.map(i => ({ item: i, quantity: 1 })) });
assert(cov114.unmatched.length === 0,
  `仍有 ${cov114.unmatched.length} 个 114 版项目未匹配到同意书：${cov114.unmatched.map(u => u.name).join(', ')}`);
const covLegacy = matchConsents({ selectedItems: DENTAL_ITEMS.map(i => ({ item: i, quantity: 1 })) });
assert(covLegacy.unmatched.length === 0,
  `仍有 ${covLegacy.unmatched.length} 个旧版项目未匹配到同意书：${covLegacy.unmatched.map(u => u.name).join(', ')}`);
console.log(`  114 版 ${ITEMS_114_ALL.length} 项 + 旧版 ${DENTAL_ITEMS.length} 项，全部有归属 ✅`);

// C8 单项挂靠上限
console.log('[CT-T8] 单个项目挂靠文书数量上限');
let overCap = [];
ITEMS_114_ALL.concat(DENTAL_ITEMS).forEach(i => {
  const r = matchConsents({ selectedItems: [{ item: i, quantity: 1 }] });
  if (r.matched.length > 3) overCap.push(`${i.name}=${r.matched.length}`);
});
assert(overCap.length === 0, `以下项目挂靠超过 3 份文书：${overCap.join(', ')}`);
console.log('  所有项目挂靠文书 ≤3 份 ✅');

// C9 文书库检索
console.log('[CT-T9] 文书库关键词检索');
const s1 = searchConsents('根管');
assert(s1.length > 0 && s1[0].id === 'endo', `搜「根管」首条应为根管治疗同意书，实际 ${s1[0] && s1[0].title}`);
const s2 = searchConsents('种植');
assert(s2.length > 0 && s2[0].id === 'implant', `搜「种植」首条应为种植同意书，实际 ${s2[0] && s2[0].title}`);
const s3 = searchConsents('美白');
assert(s3.some(t => t.id === 'esthetic'), '搜「美白」应命中美白同意书');
const s4 = searchConsents('这个关键词一定搜不到xyz');
assert(s4.length === 0, '无关关键词应返回空');
assert(searchConsents('').length === CONSENT_TEMPLATES.length, '空关键词应返回全部模板');
console.log(`  根管→${s1[0].title}｜种植→${s2[0].title}｜美白命中 ${s3.length} 份｜无效词→0 ✅`);

// C10 文书生成结构
console.log('[CT-T10] 文书生成结构完整性');
const docTpl = CONSENT_TEMPLATES.find(t => t.id === 'endo');
const doc = buildConsentDoc({
  template: docTpl,
  ctx: {
    clinicName: '康泰口腔门诊部', patientName: '张三', gender: '男', age: '32',
    recordNo: '2026-000123', tooth: '36', cityName: '成都市', visitDate: '2026年10月16日',
    items: [{ code: '013105010050000', name: '根管预备费', quantity: 1, unit: '根管' }]
  }
});
assert(doc.title === docTpl.title, '文书标题不一致');
assert(doc.meta.length === 8, `抬头字段应为 8 项，实际 ${doc.meta.length}`);
assert(doc.meta.every(m => m.value && m.value.trim().length > 0), '抬头字段存在空值（应由占位符兜底）');
assert(doc.items.length === 1 && doc.items[0].name === '根管预备费', '项目清单未带入');
assert(doc.sections.length === docTpl.sections.length, '章节数不一致');
assert(doc.declarations.length === CONSENT_COMMON.declarations.length, '声明条款未带入');
assert(doc.signBlocks.length === CONSENT_COMMON.signBlocks.length, '签署区未带入');
assert(/病历管理规定/.test(doc.footer), '页脚归档说明缺失');
console.log(`  ${doc.meta.length} 项抬头 · ${doc.sections.length} 个章节 · ${doc.declarations.length} 条声明 · ${doc.signBlocks.length} 个签署区 ✅`);

// C11 空抬头自动占位
console.log('[CT-T11] 空患者信息自动占位（不出现 undefined）');
const docEmpty = buildConsentDoc({ template: docTpl, ctx: {} });
assert(docEmpty.meta.every(m => !/undefined|null/.test(m.value)), '空上下文出现 undefined/null');
assert(docEmpty.items.length === 0, '空上下文项目清单应为空');
console.log('  空上下文不产生 undefined/null ✅');

// C12 XSS 防护：HTML 输出必须转义
console.log('[CT-T12] 文书 HTML 输出转义（XSS 防护）');
const docXss = buildConsentDoc({
  template: docTpl,
  ctx: { patientName: '<script>alert(1)</script>', clinicName: '" onmouseover="alert(2)', items: [] }
});
const htmlXss = consentDocHtml(docXss);
assert(!htmlXss.includes('<script>'), 'HTML 输出未转义 script 标签');
assert(htmlXss.includes('&lt;script&gt;'), 'script 标签未被实体化');
assert(!/onmouseover="alert/.test(htmlXss), '属性注入未被阻断');
assert(htmlXss.includes('&quot;'), '双引号未被转义');
console.log('  script / 属性注入 / 引号均已被转义 ✅');

// C13 HTML 与纯文本双形态输出
console.log('[CT-T13] HTML 与纯文本双形态输出');
const htmlDoc = consentDocHtml(doc);
const textDoc = consentDocText(doc);
assert(htmlDoc.includes('consent-doc') && htmlDoc.includes(docTpl.title), 'HTML 输出结构异常');
assert(htmlDoc.includes('doc-sign'), 'HTML 输出缺少签署区');
assert(textDoc.includes(docTpl.title) && textDoc.includes('根管预备费'), '文本输出内容缺失');
assert(textDoc.split('\n').length > 40, '文本输出行数过少');
assert(!textDoc.includes('<div'), '文本输出混入 HTML 标签');
console.log(`  HTML ${htmlDoc.length} 字符 · 文本 ${textDoc.split('\n').length} 行 ✅`);

// C14 多份文书打包
console.log('[CT-T14] 多份文书打包输出');
const pack = consentPackHtml([
  buildConsentDoc({ template: docTpl, ctx: {} }),
  buildConsentDoc({ template: CONSENT_TEMPLATES.find(t => t.id === 'anesthesia'), ctx: {} })
]);
const countDoc = (pack.match(/class="consent-doc"/g) || []).length;
assert(countDoc === 2, `打包应含 2 份文书，实际 ${countDoc}`);
assert(consentPackHtml([]) === '', '空数组打包应返回空串');
console.log(`  打包 ${countDoc} 份，空数组安全返回 ✅`);

// C15 样式单一数据源
console.log('[CT-T15] 文书样式与患者字段定义随引擎导出');
assert(typeof CONSENT_DOC_CSS === 'string' && CONSENT_DOC_CSS.includes('.consent-doc'), 'CONSENT_DOC_CSS 缺失');
assert(CONSENT_PATIENT_FIELDS.length >= 6, '患者信息字段定义不足');
assert(CONSENT_PATIENT_FIELDS.every(f => f.key && f.label && f.type), '患者字段定义缺少必填项');
console.log(`  CSS ${CONSENT_DOC_CSS.length} 字符 · 患者字段 ${CONSENT_PATIENT_FIELDS.length} 项 ✅`);

console.log('');
console.log('================ 知情同意书模块测试全部通过！ ================');

/* ============================================================
   项目详情字段（官方原表 7 列必须全部落地）
   ============================================================ */
console.log('');
console.log('================ 项目详情字段专项测试 ================');

// IF-T1 新字段存在性
console.log('[IF-T1] 114 版条目携带价格构成 / 除外内容 / 计价说明');
assert(ITEMS_114_ALL.every(i => typeof i.composition === 'string'), 'composition 字段缺失');
assert(ITEMS_114_ALL.every(i => typeof i.exclusions === 'string'), 'exclusions 字段缺失');
assert(ITEMS_114_ALL.every(i => typeof i.billingNote === 'string'), 'billingNote 字段缺失');
console.log(`  195 条均带 3 个详情字段 ✅`);

// IF-T2 价格构成非空率（官方表 114 条主项目都有价格构成）
const compMain = ITEMS_114_MAIN.filter(i => i.composition.length > 0).length;
assert(compMain === ITEMS_114_MAIN.length, `主项目价格构成缺失 ${ITEMS_114_MAIN.length - compMain} 条`);
console.log(`  主项目价格构成覆盖率 114/114 ✅`);

// IF-T3 除外内容样例正确
console.log('[IF-T3] 除外内容抽样');
const orthoTpl = ITEMS_114_MAIN.find(i => i.name.includes('乳牙期错合矫治费（常规）'));
assert(orthoTpl && orthoTpl.exclusions.includes('矫治器'), '乳牙期矫治除外内容应为「矫治器、托槽」');
const bite = ITEMS_114_MAIN.find(i => i.name === '咬合板治疗费');
assert(bite && bite.exclusions.includes('咬合板'), '咬合板治疗费除外内容应为「咬合板」');
console.log(`  矫治器 / 咬合板 除外内容正确 ✅`);

// IF-T4 计价说明分列（不再混入 restrictions 之外的重复）
console.log('[IF-T4] 计价说明单独成列');
const pulpOpen = ITEMS_114_MAIN.find(i => i.name === '牙体开髓引流费');
assert(pulpOpen && pulpOpen.billingNote.includes('仅限于牙髓急症'), '计价说明应为开髓急症限定说明');
assert(pulpOpen.restrictions.includes('仅限于牙髓急症'), 'restrictions 应同时保留官方说明用于列表提示');
console.log(`  billingNote 与 restrictions 双列并行 ✅`);

// IF-T5 全量字段结构一致性（UI 详情弹层依赖）
console.log('[IF-T5] 全量字段结构一致性');
const DETAIL_KEYS = ['code', 'name', 'category', 'insuranceType', 'unit', 'output', 'composition', 'exclusions', 'billingNote', 'restrictions', 'isAddon'];
ITEMS_114_ALL.forEach(i => {
  DETAIL_KEYS.forEach(k => {
    if (!(k in i)) throw new Error(`${i.name} 缺少字段 ${k}`);
  });
});
console.log(`  11 个详情字段 195/195 齐备 ✅`);

console.log('');
console.log('================ 项目详情字段测试全部通过！ ================');

/* ============================================================
   医保病历模块
   ============================================================ */
console.log('');
console.log('================ 医保病历模块专项测试 ================');

const REC_TOOTH = '46';
const recItems = [
  { item: ITEMS_114_MAIN.find(i => i.name === '根管预备费'), quantity: 1 },
  { item: ITEMS_114_MAIN.find(i => i.name === '根管充填费'), quantity: 1 }
];
const recCtx = {
  clinicName: '康泰口腔门诊部',
  patientName: '李四',
  gender: '男',
  age: '32',
  recordNo: '2026-000123',
  tooth: REC_TOOTH,
  cityName: '成都市',
  visitDate: '2026年10月16日'
};

// RT-T1 字段定义完整
console.log('[RT-T1] 病历字段定义完整性');
assert(RECORD_DOCTOR_FIELDS.length >= 8, '病历字段不少于 8 段');
assert(RECORD_DOCTOR_FIELDS.every(f => f.key && f.label && f.rows), '字段定义缺少 key/label/rows');
assert(RECORD_DEPARTMENTS.length >= 5, '科室列表过少');
console.log(`  ${RECORD_DOCTOR_FIELDS.length} 个段落 · ${RECORD_DEPARTMENTS.length} 个科室 ✅`);

// RT-T2 自动草稿
console.log('[RT-T2] 按处方自动生成草稿');
const draft = draftRecord({ selectedItems: recItems, ctx: recCtx });
assert(draft.fields.chiefComplaint && draft.fields.chiefComplaint.length > 0, '主诉草稿为空');
assert(draft.fields.diagnosis.includes(REC_TOOTH), '诊断草稿应含患牙位');
assert(draft.fields.treatment.includes('根管预备费'), '处置草稿应含项目名');
assert(draft.fields.presentIllness.includes(REC_TOOTH), '现病史应含患牙位');
console.log(`  主诉/诊断/处置 均自动生成 ✅`);

// RT-T3 占位符全部替换（不得残留 {tooth} / {items}）
console.log('[RT-T3] 占位符替换干净');
Object.entries(draft.fields).forEach(([k, v]) => {
  assert(!/\{[a-z]+\}/i.test(v), `字段 ${k} 残留未替换占位符：${v}`);
});
console.log(`  无残留占位符 ✅`);

// RT-T4 多分类处方合并（拔牙 + 修复）
console.log('[RT-T4] 跨分类处方草稿合并');
const multiItems = [
  { item: ITEMS_114_MAIN.find(i => i.category === 'surgery'), quantity: 1 },
  { item: ITEMS_114_MAIN.find(i => i.category === 'prostho'), quantity: 1 }
];
const multiDraft = draftRecord({ selectedItems: multiItems, ctx: recCtx });
assert(multiDraft.categories.length === 2, `应覆盖 2 个分类，实际 ${multiDraft.categories.length}`);
assert(multiDraft.fields.treatment.split('\n').length === 2, '处置段应合并两段分类内容');
console.log(`  覆盖 ${multiDraft.categories.join(' + ')} ✅`);

// RT-T5 空处方降级安全
console.log('[RT-T5] 空处方安全降级');
const emptyDraft = draftRecord({ selectedItems: [], ctx: {} });
assert(emptyDraft.fields.diagnosis, '空处方仍应产出可编辑草稿');
assert(!JSON.stringify(emptyDraft.fields).includes('undefined'), '空处方草稿不得含 undefined');
console.log(`  空处方不崩溃、不留 undefined ✅`);

// RT-T6 患者信息与同意书同源
console.log('[RT-T6] 病历抬头复用同意书患者字段');
const recDoc = buildMedicalRecord({ ctx: recCtx, fields: draft.fields, items: [], extra: { department: '口腔内科', doctor: '张牙科' } });
const metaKeys = recDoc.meta.map(m => m.label);
assert(metaKeys.includes('患者姓名') && metaKeys.includes('病历号'), '抬头缺少患者信息');
assert(recDoc.meta.find(m => m.label === '患者姓名').value === '李四', '患者姓名未带入');
assert(recDoc.meta.find(m => m.label === '接诊医师').value === '张牙科', '医师未带入');
console.log(`  ${recDoc.meta.length} 项抬头，患者/医师信息已带入 ✅`);

// RT-T7 医生改写内容优先（不被草稿覆盖）
console.log('[RT-T7] 医生改写内容保留');
const edited = { ...draft.fields, diagnosis: '46 急性牙髓炎' };
const recDoc2 = buildMedicalRecord({ ctx: recCtx, fields: edited, items: [], extra: {} });
assert(recDoc2.sections.find(s => s.key === 'diagnosis').value === '46 急性牙髓炎', '医生改写被覆盖');
console.log(`  改写后的诊断被保留 ✅`);

// RT-T8 空段落占位（不出现 undefined / null）
console.log('[RT-T8] 空段落占位');
const blankDoc = buildMedicalRecord({ ctx: {}, fields: {}, items: [], extra: {} });
assert(blankDoc.sections.every(s => s.value === ''), '空字段应为空串');
const blankHtml = recordDocHtml(blankDoc);
assert(!blankHtml.includes('undefined') && !blankHtml.includes('null'), '空段落 HTML 含 undefined/null');
assert(blankHtml.includes('（待接诊医师填写）'), '空段落应显示待填写占位');
console.log(`  空段落显示占位提示 ✅`);

// RT-T9 HTML 输出转义（XSS）
console.log('[RT-T9] 病历 HTML 转义');
const xssDoc = buildMedicalRecord({
  ctx: { patientName: '<script>alert(1)</script>', recordNo: '" onmouseover="x' },
  fields: { chiefComplaint: '<img src=x onerror=alert(1)>' },
  items: [{ code: '0131', name: '<b>注入</b>', quantity: 1 }],
  extra: {}
});
const xssHtml = recordDocHtml(xssDoc);
assert(!xssHtml.includes('<script>'), 'script 未转义');
assert(!xssHtml.includes('<img src=x'), 'img 注入未转义');
assert(!xssHtml.includes('<b>注入</b>'), '项目名未转义');
console.log(`  script / img / 标签注入均被转义 ✅`);

// RT-T10 双形态输出 + 项目清单
console.log('[RT-T10] HTML 与纯文本双形态');
const fullDoc = buildMedicalRecord({ ctx: recCtx, fields: draft.fields, items: [{ code: '013105010050000', name: '根管预备费', quantity: 1, unit: '根管' }], extra: {} });
const recHtml = recordDocHtml(fullDoc);
const recText = recordDocText(fullDoc);
assert(recHtml.includes('record-doc') && recHtml.includes('根管预备费'), 'HTML 输出缺内容');
assert(recText.includes('根管预备费') && recText.split('\n').length > 20, '文本输出缺内容');
assert(!recText.includes('<div'), '文本输出混入 HTML');
assert(recordPackHtml([fullDoc]).includes('record-doc'), '打包输出失败');
assert(recordPackHtml([]) === '', '空数组打包应为空串');
console.log(`  HTML ${recHtml.length} 字符 · 文本 ${recText.split('\n').length} 行 ✅`);

// RT-T11 样式导出
console.log('[RT-T11] 病历样式随引擎导出');
assert(typeof RECORD_DOC_CSS === 'string' && RECORD_DOC_CSS.includes('.record-doc'), 'RECORD_DOC_CSS 缺失');
assert(recordTemplateOf('implant') === recordTemplateOf('surgery'), '旧版 implant 分类应映射到 surgery 模板');
assert(recordTemplateOf('imaging') === recordTemplateOf('exam'), '影像类 imaging 分类应映射到 exam 模板');
assert(recordTemplateOf('不存在的分类') === recordTemplateOf('other'), '未知分类应兜底 other');
console.log(`  CSS ${RECORD_DOC_CSS.length} 字符 · 分类别名兜底正常 ✅`);

console.log('');
console.log('================ 医保病历模块测试全部通过！ ================');

/* ============================================================
   影像检查（放射类）模块 —— 国家医保局《放射检查类立项指南》
   医保价采函〔2024〕233号；编码段 0123
   ============================================================ */
console.log('');
console.log('================ 影像检查（放射类）测试 ================');

// IM-T1 数据装载
console.log('[IM-T1] 影像类数据装载');
assert(Array.isArray(IMAGING_ITEMS) && IMAGING_ITEMS.length >= 6, '影像类条目不足');
assert(IMAGING_META.totalCount === 26, '立项指南项目总数应为 26');
assert(IMAGING_MAIN.length === IMAGING_ITEMS.filter(i => !i.isAddon).length, 'IMAGING_MAIN 过滤错误');
assert(IMAGING_ALL.length === IMAGING_ITEMS.length, 'IMAGING_ALL 应为全量');
console.log(`  ${IMAGING_ITEMS.length} 条（主项目 ${IMAGING_MAIN.length} + 加收/扩展 ${IMAGING_ITEMS.length - IMAGING_MAIN.length}）✅`);

// IM-T2 用户截图项必须存在（本轮问题根因）
console.log('[IM-T2] 用户截图项目可检索');
const shot = IMAGING_ALL.find(i => i.code === '012301010010000');
assert(shot, '缺少 012301010010000 X线摄影成像');
assert(shot.name === 'X线摄影成像', '项目名不符');
assert(shot.priceLevel3 === 50 && shot.priceLevel2 === 43 && shot.priceLevel1 === 35, 'X线摄影成像三档价不符');
assert(shot.insuranceType === '甲类', 'X线摄影成像应为甲类');
assert(shot.unit === '部位·体位', '计价单位应为 部位·体位');
console.log(`  ${shot.name} / ${shot.code} / ¥${shot.priceLevel3}·${shot.priceLevel2}·${shot.priceLevel1} ✅`);

// IM-T3 字段完整性
console.log('[IM-T3] 字段完整性');
IMAGING_ALL.forEach(i => {
  assert(i.code && /^\d{15}$/.test(i.code), `编码格式错误: ${i.code}`);
  assert(i.code.startsWith('0123'), `编码段应为 0123: ${i.code}`);
  assert(i.name, `缺名称: ${i.code}`);
  assert(i.category === 'imaging', `分类应为 imaging: ${i.code}`);
  assert(['甲类', '乙类', '自费'].includes(i.insuranceType), `医保类别非法: ${i.code}`);
  assert(i.priceLevel3 != null && i.priceLevel2 != null && i.priceLevel1 != null, `缺三档价格: ${i.code}`);
  assert(i.priceLevel3 >= i.priceLevel2 && i.priceLevel2 >= i.priceLevel1, `价格档位倒挂: ${i.code}`);
  assert(i.unit, `缺计价单位: ${i.code}`);
  assert(i.output && i.composition, `缺服务产出/价格构成: ${i.code}`);
  assert(typeof i.isAddon === 'boolean', `缺 isAddon: ${i.code}`);
});
console.log(`  ${IMAGING_ALL.length} 条字段全部齐备 ✅`);

// IM-T4 医保类别与先行自付一致
console.log('[IM-T4] 医保类别与先行自付率一致');
IMAGING_ALL.forEach(i => {
  if (i.insuranceType === '甲类') assert(i.copayRate === 0, `甲类自付率应为 0: ${i.code}`);
  if (i.insuranceType === '乙类') assert(i.copayRate > 0 && i.copayRate < 1, `乙类自付率应在 (0,1): ${i.code}`);
});
const cbct = IMAGING_ALL.find(i => i.code === '012301020011100');
assert(cbct && cbct.insuranceType === '乙类', 'CBCT 应按多数省份口径标为乙类');
assert(cbct.billingNote.includes('仅限口腔颌面使用'), 'CBCT 缺少使用范围限制');
console.log(`  CBCT 乙类自付 ${(cbct.copayRate * 100).toFixed(0)}% · 使用范围限制已标注 ✅`);

// IM-T5 与口腔类 114 项目无编码冲突
console.log('[IM-T5] 与口腔类项目无编码冲突');
const overlap = IMAGING_ALL.filter(i => ITEMS_114_ALL.some(x => x.code === i.code));
assert(overlap.length === 0, `编码冲突: ${overlap.map(x => x.code).join(',')}`);
assert(CATEGORIES_114.some(c => c.id === 'imaging'), 'CATEGORIES_114 缺少 imaging 分类');
console.log(`  0 冲突 · 分类「${CATEGORIES_114.find(c => c.id === 'imaging').name}」已登记 ✅`);

// IM-T6 别名覆盖（口语叫法可搜）
console.log('[IM-T6] 常用叫法覆盖');
const needAlias = ['012301010011100', '012301010020000', '012301020011100'];
needAlias.forEach(code => {
  const it = IMAGING_ALL.find(i => i.code === code);
  assert(it.aliases && it.aliases.trim().length > 0, `${it.name} 缺别名`);
});
const panorama = IMAGING_ALL.find(i => i.code === '012301010011100');
assert(panorama.aliases.includes('全景片'), '曲面体层成像应可被「全景片」搜到');
assert(IMAGING_ALL.find(i => i.code === '012301020011100').aliases.includes('CBCT'), 'CBCT 别名缺失');
console.log(`  全景片 / 牙片 / CBCT 等口语叫法已覆盖 ✅`);

// IM-T7 各地参考价展示
console.log('[IM-T7] 各地指导价参考');
const withRegion = IMAGING_ALL.filter(i => Array.isArray(i.regionalPrices) && i.regionalPrices.length);
assert(withRegion.length >= 4, '带各地参考价的项目不足');
withRegion.forEach(i => i.regionalPrices.forEach(r => {
  assert(r.city && r.levels && r.value, `各地参考价字段不全: ${i.code}`);
}));
console.log(`  ${withRegion.length} 个项目带 4 城市参考价 ✅`);

console.log('');
console.log('================ 影像检查（放射类）测试全部通过！ ================');

/* ============================================================
   医生合规助手 —— 门诊实务知识库（收费边界 / 治疗组合 / 自查 / 营销 / 税负）
   ============================================================ */
console.log('');
console.log('================ 医生合规助手测试 ================');

const AD_ITEMS = ITEMS_114_ALL.concat(IMAGING_ALL);
const adItem = (name) => {
  const it = AD_ITEMS.find((i) => i.name === name);
  assert(it, '系统项目库中找不到项目：' + name);
  return { item: it, quantity: 1 };
};
const adOf = (...names) => names.map(adItem);

// AD-T1 知识库装载
console.log('[AD-T1] 知识库装载');
assert(MUTEX_BOUNDARIES.length === 18, `收费边界应为 18 组，实际 ${MUTEX_BOUNDARIES.length}`);
assert(TREATMENT_COMBOS.length >= 25, `治疗组合应 ≥25 个，实际 ${TREATMENT_COMBOS.length}`);
assert(MARKETING_SCENARIOS.length === 6, `营销场景应为 6 类，实际 ${MARKETING_SCENARIOS.length}`);
assert(SELF_CHECK_MODULES.length === 9, `自查模块应为 9 个，实际 ${SELF_CHECK_MODULES.length}`);
assert(TAX_MATRIX.rows.length === 7, '税率矩阵应为 7 行收入类别');
assert(FEE_SPLIT_SECTIONS.length === 3, '技耗分离应为三段式');
console.log(`  边界 ${MUTEX_BOUNDARIES.length} 组 · 组合 ${TREATMENT_COMBOS.length} 个 · 营销 ${MARKETING_SCENARIOS.length} 类 · 自查 ${SELF_CHECK_MODULES.length} 模块 ✅`);

// AD-T2 边界字段完整性
console.log('[AD-T2] 边界数据完整性');
MUTEX_BOUNDARIES.forEach((b) => {
  assert(b.id && b.sub && b.sub.keys.length && b.main && b.main.keys.length, `边界字段缺失: ${b.id}`);
  assert(Array.isArray(b.scenes) && b.scenes.length, `缺合规场景: ${b.id}`);
  assert(b.script && b.script.length > 8, `缺病历话术: ${b.id}`);
});
console.log(`  ${MUTEX_BOUNDARIES.length} 组边界均含「子项 / 主项 / 场景 / 话术」✅`);

// AD-T3 检出：洁治 + 牙周冲洗上药（WARN）
console.log('[AD-T3] 检出叠加冲突（WARN）');
const hit1 = checkBillingBoundaries(adOf('龈上洁治费', '牙周冲洗上药费'));
assert(hit1.length === 1 && hit1[0].id === 'perio_irrigation', `应命中 perio_irrigation，实际 ${JSON.stringify(hit1.map(h => h.id))}`);
assert(hit1[0].level === 'WARN', '应为 WARN 级');
assert(hit1[0].script.includes('未实施洁治'), '话术内容不符');
console.log(`  ${hit1[0].subItems.join('/')} ↔ ${hit1[0].mainItems.join('/')} · ${hit1[0].level} ✅`);

// AD-T4 检出：根管预备 + 开髓引流（FATAL，且排首位）
console.log('[AD-T4] FATAL 级冲突优先排序');
const hit2 = checkBillingBoundaries(adOf('牙周冲洗上药费', '龈上洁治费', '根管预备费', '牙体开髓引流费'));
assert(hit2.length >= 2, `应命中 ≥2 组，实际 ${hit2.length}`);
assert(hit2[0].level === 'FATAL', `FATAL 应排首位，实际 ${hit2[0].level}`);
assert(hit2[0].id === 'pulp_decompression', 'FATAL 组应为开髓引流');
console.log(`  命中 ${hit2.length} 组，首位 ${hit2[0].id}（FATAL）✅`);

// AD-T5 无误报
console.log('[AD-T5] 无误报');
assert(checkBillingBoundaries(adOf('龈上洁治费')).length === 0, '单一项目不应触发');
assert(checkBillingBoundaries(adOf('根管预备费', '根管充填费')).length === 0, '根管预备+充填不应触发互斥（属正常治疗路径）');
assert(checkBillingBoundaries([]).length === 0, '空处方不应触发');
assert(checkBillingBoundaries(null).length === 0, '空值不应崩溃');
console.log('  单项目 / 正常治疗路径 / 空处方 均不误报 ✅');

// AD-T6 病历话术文本
console.log('[AD-T6] 整改话术文本');
const txt = boundarySummaryText(hit2);
assert(txt.includes('【叠加收费边界提示】'), '缺标题');
assert(txt.includes('病历必须写明'), '缺话术提示');
assert(txt.includes('可单独收费的前提'), '缺合规场景');
assert(boundarySummaryText([]) === '', '空结果应为空串');
console.log(`  ${txt.split('\n').length} 行整改说明 ✅`);

// AD-T7 技耗分离归类
console.log('[AD-T7] 技耗分离归类');
const fs1 = feeSplitAdvice(adOf('根管预备费', '根管预备费-儿童（加收）'));
assert(fs1.counts.services === 1 && fs1.counts.addons === 1, `归类错误: ${JSON.stringify(fs1.counts)}`);
assert(fs1.addonTip.includes('加收'), '加收项提示缺失');
assert(fs1.conclusion.includes('技耗分离'), '税负结论缺失');
assert(feeSplitAdvice([]).counts.services === 0, '空处方应 0 项');
console.log(`  基础 ${fs1.counts.services} / 加收 ${fs1.counts.addons} · 税负口径已提示 ✅`);

// AD-T8 治疗组合筛选与检索
console.log('[AD-T8] 治疗组合筛选');
assert(filterCombos({ group: '种植' }).length >= 5, '种植组合不足');
assert(filterCombos({ group: '正畸' }).length >= 15, '正畸组合不足');
assert(filterCombos({}).length === TREATMENT_COMBOS.length, '不传条件应返回全部');
const imm = filterCombos({ keyword: '即刻' });
assert(imm.length >= 4 && imm.every((c) => c.name.includes('即刻')), '关键词检索失败');
assert(filterCombos({ keyword: '不存在的组合xyz' }).length === 0, '无匹配应返回空');
console.log(`  种植 ${filterCombos({ group: '种植' }).length} · 正畸 ${filterCombos({ group: '正畸' }).length} · 搜「即刻」${imm.length} ✅`);

// AD-T9 组合项目库收录标注
console.log('[AD-T9] 组合项目库收录标注');
const cImplant = filterCombos({ group: '种植' })[0];
const avail = comboAvailability(cImplant, AD_ITEMS);
assert(avail.length === cImplant.parts.length, '收录标注数量不符');
assert(avail.every((a) => typeof a.inLibrary === 'boolean'), '缺 inLibrary 标记');
assert(avail.filter((a) => a.inLibrary).length === 0, '种植类项目当前不在 114 项目库中，应全部标为未收录');
const cOrtho = filterCombos({ keyword: '保持期安装' })[0];
assert(comboAvailability(cOrtho, AD_ITEMS).every((a) => a.inLibrary), '保持器安装费应在项目库中');
console.log(`  种植组合 0/${avail.length} 收录 · 保持器组合 ${comboAvailability(cOrtho, AD_ITEMS).length}/${comboAvailability(cOrtho, AD_ITEMS).length} 收录 ✅`);

// AD-T10 智能关联组合
console.log('[AD-T10] 处方智能关联组合');
const rel = relatedCombos(adOf('口腔固定保持器安装费'), AD_ITEMS, 3);
assert(rel.length >= 1 && rel[0].combo.id === 'ortho_retainer_install', '未关联到保持期安装组合');
assert(relatedCombos([], AD_ITEMS).length === 0, '空处方应无关联');
console.log(`  关联到「${rel[0].combo.name}」 ✅`);

// AD-T11 自查进度
console.log('[AD-T11] 合规自查进度');
const repAll = selfCheckReport(SELF_CHECK_MODULES.map((m) => m.id));
assert(repAll.percent === 100 && repAll.done === repAll.total, '全选应为 100%');
assert(repAll.violations.length === 0, '全完成时不应有整改项');
const repPart = selfCheckReport([1, 2]);
assert(repPart.percent === Math.round((2 / SELF_CHECK_MODULES.length) * 100), '进度计算错误');
assert(repPart.violations.length > 0, '未完成模块应给出高频违规清单');
assert(repPart.conclusion.includes('未完成自查'), '结论未提示剩余模块');
assert(selfCheckReport([]).percent === 0, '空进度应为 0%');
assert(selfCheckReport(null).percent === 0, '空值不应崩溃');
console.log(`  全选 100% · 选 2 项 ${repPart.percent}% · 整改项 ${repPart.violations.length} 条 ✅`);

// AD-T12 营销场景结构
console.log('[AD-T12] 营销场景结构完整性');
const mks = listMarketingScenarios();
assert(mks.length === 6, '应返回 6 类场景');
mks.forEach((s) => {
  assert(s.id && s.name, '缺 id/name');
  ['premise', 'flow', 'record', 'split', 'entry', 'forbid'].forEach((k) => {
    assert(Array.isArray(s[k]) && s[k].length, `${s.name} 缺字段 ${k}`);
  });
});
assert(MARKETING_IRON_RULE.includes('技术服务费'), '通用铁律缺失');
console.log(`  ${mks.length} 类场景 × 6 个维度（前提/流程/病历/技耗/录入/禁止）✅`);

console.log('');
console.log('================ 医生合规助手测试全部通过！ ================');

/* ============================================================
   报税引擎测试（第 13 轮新增）
   ============================================================ */
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

console.log('\n[TX-T1] 小规模纳税人季度未达起征点免征');
{
  const r = computePeriodTax({
    entityId: 'small_company', periodType: 'quarterly',
    revenue: { medical: 0, consumable: 290000, cosmetic: 0 }
  });
  assert(near(r.vat.taxableNet, 287128.71), `应税不含税应为 287128.71，实际 ${r.vat.taxableNet}`);
  assert(r.vat.belowThreshold === true, '29 万（含税）应判定为未达 30 万起征点');
  assert(r.vat.payable === 0, '未达起征点应纳增值税应为 0');
  assert(r.surcharge.total === 0, '增值税为 0 时附加税费应为 0');
  const sheet = buildVatFilingSheet(r);
  const l10 = sheet.rows.find((x) => x.no === '10');
  assert(near(l10.value, 287128.71), '企业身份应填入第 10 栏小微企业免税销售额');
  console.log('  29 万 → 免税 · 第 10 栏 287128.71 ✅');
}

console.log('[TX-T2] 小规模纳税人季度超起征点，3% 减按 1% 的申报表口径');
{
  const r = computePeriodTax({
    entityId: 'small_company', periodType: 'quarterly',
    revenue: { medical: 0, consumable: 315000, cosmetic: 0 }
  });
  assert(near(r.vat.taxableNet, 311881.19), `不含税 311881.19，实际 ${r.vat.taxableNet}`);
  assert(r.vat.belowThreshold === false, '31.5 万应判定为已达起征点');
  assert(near(r.vat.line15, 9356.44), `第 15 栏按 3% 应为 9356.44，实际 ${r.vat.line15}`);
  assert(near(r.vat.line16, 6237.62), `第 16 栏减征 2% 应为 6237.62，实际 ${r.vat.line16}`);
  assert(near(r.vat.payable, 3118.82), `20=15-16 应为 3118.82，实际 ${r.vat.payable}`);
  assert(near(r.surcharge.urban, 109.16), `城建税（7%×50%）应为 109.16，实际 ${r.surcharge.urban}`);
  assert(near(r.surcharge.total, 187.13), `附加合计（12%×50%）应为 187.13，实际 ${r.surcharge.total}`);
  console.log('  15=9356.44 · 16=6237.62 · 20=3118.82 · 附加 187.13 ✅');
}

console.log('[TX-T3] 医疗免税与耗材应税分离，起征点只看应税部分');
{
  const r = computePeriodTax({
    entityId: 'small_company', periodType: 'monthly',
    revenue: { medical: 1000000, consumable: 50000, cosmetic: 0 }
  });
  assert(r.revenue.exemptShare === 95.2, `免税占比 95.2%，实际 ${r.revenue.exemptShare}`);
  assert(near(r.vat.taxableNet, 49504.95), '起征点基数应只含应税 49504.95');
  assert(r.vat.payable === 0, '应税 4.95 万未达月 10 万，应免征');
  const sheet = buildVatFilingSheet(r);
  assert(near(sheet.rows.find((x) => x.no === '12').value, 1000000), '医疗服务免税应填第 12 栏');
  assert(near(sheet.rows.find((x) => x.no === '9').value, 1049504.95), '第 9 栏 = 10+11+12');
  console.log('  免税 100 万 + 应税 5 万 → 增值税 0 · 第 12 栏 1000000 ✅');
}

console.log('[TX-T4] 未分别核算 → FATAL 风险');
{
  const r = computePeriodTax({
    entityId: 'small_company', periodType: 'monthly',
    revenue: { medical: 80000, consumable: 20000 }, separated: false
  });
  const ids = taxRiskChecks(r).map((h) => h.id);
  assert(ids.includes('no_separation'), '未分别核算应命中 no_separation');
  assert(ids.includes('bundle_implant'), '销售耗材应命中 bundle_implant');
  assert(taxRiskChecks(r).find((h) => h.id === 'no_separation').level === 'FATAL', '应为 FATAL 级');
  console.log('  命中 no_separation(FATAL) / bundle_implant ✅');
}

console.log('[TX-T5] 个体工商户：五级超额累进 + 200 万以内减半');
{
  const r = computePeriodTax({
    entityId: 'individual_business', periodType: 'quarterly',
    revenue: { medical: 400000 }, costTotal: 320000
  });
  assert(r.income.type === 'iit', '个体户应缴经营所得个税');
  assert(near(r.totals.taxableIncome, 80000), `应纳税所得额 80000，实际 ${r.totals.taxableIncome}`);
  assert(near(r.income.grossTax, 14250), `8 万按五级累进应为 14250，实际 ${r.income.grossTax}`);
  assert(near(r.income.reliefAmount, 7125), `减半额 7125，实际 ${r.income.reliefAmount}`);
  assert(near(r.income.tax, 7125), `实缴 7125，实际 ${r.income.tax}`);
  console.log('  8 万 → 累进 14250 · 减半 7125 · 实缴 7125 ✅');
}

console.log('[TX-T6] 个体户超过 200 万：仅 200 万部分减半');
{
  const r = computePeriodTax({
    entityId: 'individual_business', periodType: 'monthly',
    revenue: { medical: 5000000 }, costTotal: 2000000
  });
  assert(near(r.totals.taxableIncome, 3000000, 1), `应纳税所得额 300 万，实际 ${r.totals.taxableIncome}`);
  assert(near(r.income.grossTax, 1035250, 1), `300 万毛税 1035250，实际 ${r.income.grossTax}`);
  assert(near(r.income.reliefAmount, 342625, 1), `减免 342625，实际 ${r.income.reliefAmount}`);
  assert(near(r.income.tax, 692625, 1), `实缴 692625，实际 ${r.income.tax}`);
  console.log('  300 万 → 毛税 1035250 · 减免 342625 · 实缴 692625 ✅');
}

console.log('[TX-T7] 小型微利企业 300 万临界点');
{
  const a = computePeriodTax({
    entityId: 'small_company', periodType: 'monthly',
    revenue: { medical: 4000000 }, costTotal: 1000000
  });
  assert(a.income.isSmallProfit === true, '300 万应仍属小型微利企业');
  assert(near(a.income.tax, 150000, 1), `300 万 ×5% = 150000，实际 ${a.income.tax}`);

  const b = computePeriodTax({
    entityId: 'small_company', periodType: 'monthly',
    revenue: { medical: 4000100 }, costTotal: 1000000
  });
  assert(b.income.isSmallProfit === false, '超过 300 万应丧失小微资格');
  assert(near(b.income.tax, b.totals.taxableIncome * 0.25, 1), '超额后应全额按 25% 计税');
  assert(b.income.tax > a.income.tax * 4, '临界点应体现出税负跳跃');
  console.log('  300 万 5% → 150000；超 1 元 → 25%（跳跃式上升）✅');
}

console.log('[TX-T8] 一般纳税人：销项 13%/6%，进项抵扣与转出');
{
  const r = computePeriodTax({
    entityId: 'general_company', periodType: 'monthly',
    revenue: { medical: 200000, consumable: 113000, cosmetic: 53000 },
    inputVat: 8000, inputTransfer: 2000
  });
  assert(near(r.vat.goodsNet, 100000), `货物不含税 100000，实际 ${r.vat.goodsNet}`);
  assert(near(r.vat.serviceNet, 50000), `服务不含税 50000，实际 ${r.vat.serviceNet}`);
  assert(near(r.vat.outputVat, 16000), `销项 16000，实际 ${r.vat.outputVat}`);
  assert(near(r.vat.deductibleInput, 6000), `可抵扣 6000，实际 ${r.vat.deductibleInput}`);
  assert(near(r.vat.payable, 10000), `应纳 10000，实际 ${r.vat.payable}`);
  assert(r.surcharge.halved === false, '一般纳税人不享六税两费减半');
  assert(near(r.surcharge.total, 1200), `附加 1200，实际 ${r.surcharge.total}`);
  console.log('  销项 16000 − 抵扣 6000 = 10000 · 附加 1200 ✅');
}

console.log('[TX-T9] 申报日历：季度截止日在季末次月 15 日');
{
  const q = filingCalendar(2026, 'quarterly', 'cit');
  const byLabel = (txt) => q.find((c) => c.periodLabel.includes(txt));
  assert(byLabel('第 1 季度').dueDate === '2026-04-15', `Q1 应为 2026-04-15，实际 ${byLabel('第 1 季度').dueDate}`);
  assert(byLabel('第 3 季度').dueDate === '2026-10-15', `Q3 应为 2026-10-15，实际 ${byLabel('第 3 季度').dueDate}`);
  assert(byLabel('第 4 季度').dueDate === '2027-01-15', `Q4 应跨年 2027-01-15，实际 ${byLabel('第 4 季度').dueDate}`);
  assert(byLabel('年度汇算清缴').dueDate === '2027-05-31', '企业所得税汇缴应为次年 5-31');
  assert(q.length === 5, `季度日历应为 4 期 + 1 年度，实际 ${q.length}`);

  const iit = filingCalendar(2026, 'monthly', 'iitBusiness');
  assert(iit[iit.length - 1].dueDate === '2027-03-31', '经营所得汇缴应为次年 3-31');
  assert(iit.length === 13, `月度日历应为 12 期 + 1 年度，实际 ${iit.length}`);
  iit.forEach((c) => {
    const d = new Date(c.dueDate + 'T00:00:00');
    assert(d.getDay() !== 0 && d.getDay() !== 6, `${c.dueDate} 落在周末，应顺延`);
  });
  console.log('  Q1 04-15 / Q4 次年 01-15 / 汇缴 05-31 与 03-31 · 周末已顺延 ✅');
}

console.log('[TX-T10] 台账按申报期汇总');
{
  const entries = [
    { date: '2026-01-05', medical: 1000, consumable: 100, cosmetic: 0, cost: 400 },
    { date: '2026-02-11', medical: 2000, consumable: 0, cosmetic: 0, cost: 500 },
    { date: '2026-04-02', medical: 3000, consumable: 50, cosmetic: 0, cost: 600 }
  ];
  const q = summarizeLedger(entries, 'quarterly');
  assert(q.length === 2, `应汇总为 2 个季度，实际 ${q.length}`);
  assert(q[0].periodKey === '2026-Q2', '应按期间倒序，最新在前');
  assert(near(q[1].medical, 3000), `Q1 医疗 3000，实际 ${q[1].medical}`);
  assert(near(q[1].cost, 900), `Q1 成本 900，实际 ${q[1].cost}`);
  assert(periodKeyOf('2026-01-01', 'quarterly') === '2026-Q1', '1 月应归 Q1');
  assert(periodKeyOf('2026-12-31', 'quarterly') === '2026-Q4', '12 月应归 Q4');
  assert(periodKeyOf('bad', 'monthly') === '', '非法日期应返回空串');
  assert(periodLabel('2026-Q3', 'quarterly').includes('7—9 月'), '季度标签应标出月份区间');
  console.log('  2 个季度 · 倒序 · Q1 医疗 3000 / 成本 900 ✅');
}

console.log('[TX-T11] 单笔测算：免税收入不进增值税基数');
{
  const base = {
    cityPolicy: CITIES_POLICY.chengdu,
    patientTypeId: CITIES_POLICY.chengdu.patientTypes[0].id,
    institutionLevel: 'primary',
    selectedItems: [{ item: ITEMS_114_MAIN[0], quantity: 1, customPrice: 6 }],
    accumulatedDeductible: 0,
    accumulatedReimbursement: 0
  };
  const allExempt = calculateDentalFees({
    ...base,
    taxSettings: { vatRate: 0.01, surchargeRate: 0.06, incomeTaxRate: 0.05, costRate: 0.65, taxableShare: 0 }
  });
  assert(allExempt.taxBreakdown.vatAmount === 0, '应税占比 0 时增值税应为 0');
  assert(allExempt.taxBreakdown.exemptRevenue > 0, '应识别出免税收入');

  const allTaxable = calculateDentalFees({
    ...base,
    taxSettings: { vatRate: 0.01, surchargeRate: 0.06, incomeTaxRate: 0.05, costRate: 0.65, taxableShare: 1 }
  });
  assert(allTaxable.taxBreakdown.vatAmount > 0, '应税占比 1 时应产生增值税');
  assert(allTaxable.taxBreakdown.vatAmount > allExempt.taxBreakdown.vatAmount, '全额应税的增值税应更高');
  assert(typeof allTaxable.taxBreakdown.netProfit === 'number', 'netProfit 必须仍存在（兼容既有断言）');
  console.log(`  免税单 增值税 0 · 应税单 增值税 ${allTaxable.taxBreakdown.vatAmount} ✅`);
}

console.log('[TX-T12] 最优方案：方案二与方案一必须有实质数字差异');
{
  const items = [{ item: ITEMS_114_MAIN[0], quantity: 1, customPrice: 600 }];
  // 造一个含自费项的场景，让个账结算有意义
  const selfPayItem = ITEMS_114_ALL.find(i => i.insuranceType === '自费') || ITEMS_114_MAIN[1];
  items.push({ item: selfPayItem, quantity: 1, customPrice: 1200 });

  const { plans } = generateOptimalPricingPlans({
    cityPolicy: CITIES_POLICY.chengdu,
    patientTypeId: CITIES_POLICY.chengdu.patientTypes[0].id,
    institutionLevel: 'primary',
    selectedItems: items,
    redLineViolations: []
  });
  const p1 = plans.find((p) => p.id === 'plan_reimbursement_max');
  const p2 = plans.find((p) => p.id === 'plan_quality_balance');
  assert(p1 && p2, '应生成方案一与方案二');

  const pt = CITIES_POLICY.chengdu.patientTypes[0];
  assert(typeof p1.patientCash === 'number' && typeof p2.patientCash === 'number',
    '两个方案都要给出 patientCash（当期现金支出）');
  if (pt.personalAccountEligible) {
    assert(p2.patientCash < p1.patientCash,
      `方案二现金支出应低于方案一（${p2.patientCash} 应 < ${p1.patientCash}）`);
    assert(p2.advice.includes('现金支出'), '方案二说明应点出「现金支出」差异');
  }
  assert(p1.fundPay === p2.fundPay, '两方案统筹金额相同（差别在自付结算方式）');
  console.log(`  统筹同为 ${p1.fundPay} · 现金支出 ${p1.patientCash} → ${p2.patientCash} ✅`);
}

console.log('[TX-T13] 红线罚款敞口按违规金额×1~3 倍估算，不用拍脑袋数字');
{
  // 造一个拆套处方：牙体开髓引流费 + 根管治疗
  const endo = ITEMS_114_ALL.find((i) => (i.name || '').startsWith('牙体开髓引流费'));
  const main = ITEMS_114_MAIN.find((i) => /根管预备费/.test(i.name || ''));
  assert(endo && main, '需要找到开髓引流费与根管预备费');

  const selected = [
    { item: main, quantity: 1, customPrice: 500 },
    { item: endo, quantity: 1, customPrice: 80 }
  ];
  const rl = checkInsuranceRedLines({
    selectedItems: selected, cityPolicy: CITIES_POLICY.chengdu,
    version: 'gg114', institutionLevel: 'primary'
  });
  const { plans } = generateOptimalPricingPlans({
    cityPolicy: CITIES_POLICY.chengdu,
    patientTypeId: CITIES_POLICY.chengdu.patientTypes[0].id,
    institutionLevel: 'primary',
    selectedItems: selected,
    redLineViolations: rl.violations
  });
  const p3 = plans.find((p) => p.id === 'plan_compliance_sanitized');
  assert(p3, '存在红线时应生成净化方案');
  assert(p3.involvedAmount > 0, `应归集出违规涉及金额，实际 ${p3.involvedAmount}`);
  assert(Math.abs(p3.penaltyHigh - p3.penaltyLow * 3) < 0.02, '罚款区间应为 1~3 倍');
  assert(p3.advice.includes('风险敞口'), '说明里应写明风险敞口区间');
  assert(!/\d{4,}\+ 元/.test(p3.advice), '不应再出现「项数×2000」式的拍脑袋金额');
  console.log(`  涉及违规 ¥${p3.involvedAmount} → 敞口 ¥${p3.penaltyLow}~¥${p3.penaltyHigh} ✅`);
}

console.log('[TX-T14] 单期申报截止日');
{
  assert(periodDueDate('2026-01', 'monthly') === '2026-02-16', `2026-01 应为 2026-02-16（2-15 周日），实际 ${periodDueDate('2026-01', 'monthly')}`);
  assert(periodDueDate('2026-10', 'monthly') === '2026-11-16', `2026-10 应为 2026-11-16（11-15 周日），实际 ${periodDueDate('2026-10', 'monthly')}`);
  assert(periodDueDate('2026-Q1', 'quarterly') === '2026-04-15', `Q1 应为 2026-04-15，实际 ${periodDueDate('2026-Q1', 'quarterly')}`);
  assert(periodDueDate('2026-Q3', 'quarterly') === '2026-10-15', 'Q3 应为 2026-10-15');
  assert(periodDueDate('2026-Q4', 'quarterly') === '2027-01-15', 'Q4 应跨年到 2027-01-15');
  assert(periodDueDate('', 'monthly') === '', '空入参应返回空串');
  assert(periodDueDate('2026-13', 'monthly') === '', '非法月份应返回空串');
  console.log('  月 2026-10 → 2026-11-16 · 季 2026-Q4 → 2027-01-15 ✅');
}

console.log('');
console.log('================ 报税引擎测试全部通过！ ================');
