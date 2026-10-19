/**
 * 医生合规助手引擎
 *
 * 把 src/data/billingRules.js 的规则知识转成「开单时能看到的建议」：
 *   ① checkBillingBoundaries  处方中的互斥叠加收费风险 + 病历强制书写话术
 *   ② feeSplitAdvice          技耗分离视角的收费归类与税务口径提示
 *   ③ filterCombos / relatedCombos  治疗方案标准组合查询与智能关联
 *   ④ comboAvailability       组合内项目在系统项目库中的收录情况
 *   ⑤ selfCheckReport         10 大模块合规自查进度与整改清单
 *
 * 设计原则：本引擎只产出数据结构，不生成 HTML —— 渲染交给 UI 层，
 *          这样 Node 单测可以直接断言结果，不需要解析 DOM。
 */
import {
  MUTEX_BOUNDARIES,
  TREATMENT_COMBOS,
  MARKETING_SCENARIOS,
  SELF_CHECK_MODULES,
  SELF_CHECK_PRINCIPLES,
  TAX_MATRIX,
  FEE_SPLIT_SECTIONS
} from '../data/billingRules.js';

/** 项目名是否命中关键词组（任一关键词被包含即命中） */
function hitKeys(name, keys) {
  if (!name || !keys) return false;
  return keys.some((k) => name.includes(k));
}

/** 去掉组合条目里的数量后缀（如「种植牙冠修复置入（固定咬合重建）×2」） */
function stripQty(part) {
  return String(part || '').replace(/[×x]\s*\d+\s*$/, '').trim();
}

/** 去掉项目名末尾的「费」与括号后缀，用于宽松匹配 */
function looseName(name) {
  return String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/费$/, '')
    .replace(/术$/, '')
    .trim();
}

/* ============================================================
   ① 独立收费边界检查
   ============================================================ */

/**
 * 检查处方中是否存在「子项目 + 内含包干的主项目」叠加。
 * @param {Array<{item:{name:string,code:string,isAddon?:boolean},quantity:number}>} selectedItems
 * @returns {Array<object>} 命中的边界组（含合规场景与病历话术）
 */
export function checkBillingBoundaries(selectedItems) {
  const rows = (selectedItems || []).filter((s) => s && s.item && s.item.name);
  const hits = [];

  for (const b of MUTEX_BOUNDARIES) {
    const subRows = rows.filter((s) => hitKeys(s.item.name, b.sub.keys));
    const mainRows = rows.filter((s) => hitKeys(s.item.name, b.main.keys));
    if (!subRows.length || !mainRows.length) continue;

    // 同一项目既命中子项又命中主项时，把它从主项里剔除，避免自己和自己冲突
    const subCodes = new Set(subRows.map((s) => s.item.code));
    const mains = mainRows.filter((s) => !subCodes.has(s.item.code)).map((s) => s.item.name);
    if (!mains.length) continue;

    hits.push({
      id: b.id,
      level: b.id === 'pulp_decompression' ? 'FATAL' : 'WARN',
      subLabel: b.sub.label,
      mainLabel: b.main.label,
      subItems: subRows.map((s) => s.item.name),
      mainItems: mains,
      scenes: (b.scenes || []).slice(),
      script: b.script || '',
      scope: b.scope || '同期同一术区',
      caveat: b.caveat || '',
      note: b.note || ''
    });
  }

  // FATAL 优先
  hits.sort((a, b) => (a.level === b.level ? 0 : a.level === 'FATAL' ? -1 : 1));
  return hits;
}

/** 把边界检查结果拼成可复制的整改说明 */
export function boundarySummaryText(hits) {
  if (!hits || !hits.length) return '';
  const lines = ['【叠加收费边界提示】'];
  hits.forEach((h, i) => {
    lines.push('');
    lines.push(`${i + 1}. 【${h.level}】${h.subItems.join(' / ')} ↔ ${h.mainItems.join(' / ')}`);
    lines.push(`   冲突原因：${h.mainLabel} 的包干价已内含该操作，${h.scope}叠加收取易被认定为分解收费。`);
    lines.push(`   可单独收费的前提（满足其一）：${h.scenes.join('；')}`);
    lines.push(`   病历必须写明：${h.script}`);
    if (h.caveat) lines.push(`   注意：${h.caveat}`);
  });
  return lines.join('\n');
}

/* ============================================================
   ② 技耗分离建议
   ============================================================ */

/**
 * 按技耗分离三段式归类当前处方。
 * @returns {{sections:Array, services:Array, addons:Array, counts:object, taxTip:string, conclusion:string}}
 */
export function feeSplitAdvice(selectedItems) {
  const rows = (selectedItems || []).filter((s) => s && s.item);
  const services = rows.filter((r) => !r.item.isAddon);
  const addons = rows.filter((r) => r.item.isAddon);

  return {
    sections: FEE_SPLIT_SECTIONS,
    services,
    addons,
    counts: { services: services.length, addons: addons.length, materials: 0 },
    taxTip: '技术服务费（含基础耗材：棉球、麻药、普通器械）走免税；高值耗材须按采购价零差率单独计价、单独开票。系统项目库收录的是医疗服务价格项目，耗材需在 HIS 中按「耗材收费」段单独录入。',
    addonTip: addons.length
      ? `当前处方包含 ${addons.length} 项加收/分项，须确认已挂靠对应主项目，且不同加收情形不得累计叠加。`
      : '',
    conclusion: TAX_MATRIX.conclusion
  };
}

/* ============================================================
   ③ 治疗方案组合
   ============================================================ */

/** 按分组 / 关键词筛选标准治疗方案组合 */
export function filterCombos({ group = '', keyword = '' } = {}) {
  const kw = String(keyword || '').trim();
  return TREATMENT_COMBOS.filter((c) => {
    if (group && c.group !== group) return false;
    if (!kw) return true;
    return (
      c.name.includes(kw) ||
      c.group.includes(kw) ||
      (c.parts || []).some((p) => p.includes(kw)) ||
      String(c.note || '').includes(kw)
    );
  });
}

/** 组合内项目在系统项目库的收录情况 */
export function comboAvailability(combo, allItems) {
  const items = allItems || [];
  return (combo.parts || []).map((part) => {
    const base = stripQty(part);
    const loose = looseName(base);
    let found = items.find((i) => i.name === base);
    if (!found && loose) {
      found = items.find((i) => looseName(i.name) === loose) ||
              items.find((i) => i.name.includes(loose) || loose.includes(looseName(i.name)));
    }
    return { name: base, inLibrary: !!found, code: found ? found.code : '' };
  });
}

/**
 * 根据当前处方，找出与该处方相关的标准组合（按命中项目数排序）。
 * @returns {Array<{combo:object, matched:Array<string>, score:number}>}
 */
export function relatedCombos(selectedItems, allItems, limit = 3) {
  const names = (selectedItems || [])
    .filter((s) => s && s.item && s.item.name)
    .map((s) => s.item.name);
  if (!names.length) return [];

  const scored = [];
  for (const c of TREATMENT_COMBOS) {
    const avail = comboAvailability(c, allItems);
    const matched = [];
    for (const a of avail) {
      const loose = looseName(a.name);
      if (!loose) continue;
      if (names.some((n) => n.includes(loose) || loose.includes(looseName(n)))) matched.push(a.name);
    }
    if (matched.length) scored.push({ combo: c, matched, score: matched.length });
  }
  scored.sort((a, b) => b.score - a.score || (a.combo.parts || []).length - (b.combo.parts || []).length);
  return scored.slice(0, limit);
}

/* ============================================================
   ④ 合规自查
   ============================================================ */

/**
 * 计算自查进度并给出整改清单。
 * @param {Array<number|string>} checkedIds 已完成自查的模块 id
 */
export function selfCheckReport(checkedIds) {
  const set = new Set((checkedIds || []).map((x) => Number(x)));
  const modules = SELF_CHECK_MODULES.map((m) => ({ ...m, checked: set.has(Number(m.id)) }));
  const done = modules.filter((m) => m.checked).length;
  const total = modules.length;
  const pending = modules.filter((m) => !m.checked);

  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    principles: SELF_CHECK_PRINCIPLES,
    modules,
    pending,
    violations: pending.reduce((acc, m) => acc.concat(m.violations || []), []),
    conclusion: done === total
      ? `${total} 大模块自查全部完成。建议留存本次自查记录与整改报告（保存 ≥5 年），并安排年度第三方复核。`
      : `还有 ${total - done} 个模块未完成自查：${pending.map((m) => m.name).join('、')}。按「每月小自查、每季度全面自查、每年第三方复核」推进。`
  };
}

/* ============================================================
   ⑤ 营销场景合规
   ============================================================ */

export function listMarketingScenarios() {
  return MARKETING_SCENARIOS.map((s) => ({ ...s }));
}

export function findMarketingScenario(id) {
  return MARKETING_SCENARIOS.find((s) => s.id === id) || null;
}
