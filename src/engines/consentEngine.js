/**
 * 知情同意书匹配与文书生成引擎
 * ------------------------------------------------------------------
 * 职责：
 *   1) 按当前处方自动匹配应签署的知情同意书（matchConsents）
 *   2) 按模板 + 患者/机构信息生成可打印的规范文书（buildConsentDoc）
 *   3) 输出 HTML / 纯文本两种形态，供预览、打印与导出复用
 * 不依赖任何外部库，可在 Node 与浏览器中直接运行。
 */
import { CONSENT_TEMPLATES, CONSENT_COMMON } from '../data/consents.js';

/** 文书抬头与落款共用的机构／患者字段定义 */
const META_FIELDS = [
  { key: 'clinicName', label: '医疗机构' },
  { key: 'patientName', label: '患者姓名' },
  { key: 'gender', label: '性别' },
  { key: 'age', label: '年龄' },
  { key: 'recordNo', label: '病历号' },
  { key: 'tooth', label: '患牙位 / 治疗部位' },
  { key: 'cityName', label: '统筹地区' },
  { key: 'visitDate', label: '就诊日期' }
];

const FOOTER_NOTE =
  '本文书一式两份，医患双方各执一份，随门诊病历一并归档保存（依据《医疗机构病历管理规定》，门诊病历保存期不少于 15 年）。本文书内容为格式化告知文本，具体诊疗方案以医师当面告知与病历记载为准。';

/**
 * 文书本体样式。
 * 单一数据源：运行时由 UI 注入 <style>，导出 HTML 时原样内嵌，
 * 保证「屏幕预览 == 打印稿 == 导出文件」三者完全一致。
 */
export const CONSENT_DOC_CSS = `
.consent-doc {
  background: #fff;
  color: #111827;
  font-size: 12.5px;
  line-height: 1.8;
  padding: 4px 2px 10px;
}
.consent-doc .doc-head { text-align: center; border-bottom: 2px solid #111827; padding-bottom: 10px; }
.consent-doc .doc-title { font-size: 19px; font-weight: 800; letter-spacing: .5px; margin: 0 0 7px; }
.consent-doc .doc-sub { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; font-size: 11px; color: #4b5563; }
.consent-doc .doc-badge { padding: 1px 8px; border-radius: 999px; background: #111827; color: #fff; font-weight: 700; }
.consent-doc .doc-meta { display: grid; grid-template-columns: 1fr; gap: 4px 14px; margin: 12px 0 4px; font-size: 12px; }
@media (min-width: 560px) { .consent-doc .doc-meta { grid-template-columns: 1fr 1fr; } }
.consent-doc .doc-meta-item { display: flex; gap: 6px; border-bottom: 1px dotted #9ca3af; padding-bottom: 3px; }
.consent-doc .doc-meta-item .k { color: #6b7280; flex: 0 0 auto; }
.consent-doc .doc-meta-item .v { font-weight: 650; }
.consent-doc .doc-sec { margin-top: 13px; }
.consent-doc .doc-h { font-weight: 800; font-size: 13px; margin-bottom: 5px; color: #0f172a; }
.consent-doc .doc-ul, .consent-doc .doc-ol { margin: 0; padding-left: 20px; }
.consent-doc .doc-ul li, .consent-doc .doc-ol li { margin-bottom: 4px; }
.consent-doc .doc-sec-em { border: 1px solid #111827; border-radius: 6px; padding: 10px 12px; background: #f9fafb; }
.consent-doc .doc-em-line { margin-top: 8px; font-weight: 750; }
.consent-doc .doc-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px; }
.consent-doc .doc-table th, .consent-doc .doc-table td { border: 1px solid #9ca3af; padding: 4px 7px; text-align: left; }
.consent-doc .doc-table th { background: #f3f4f6; font-weight: 700; }
.consent-doc .doc-table .c { text-align: center; }
.consent-doc .doc-signs { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 14px; }
@media (min-width: 560px) { .consent-doc .doc-signs { grid-template-columns: 1fr 1fr; } }
.consent-doc .doc-sign { border: 1px dashed #9ca3af; border-radius: 6px; padding: 8px 10px; }
.consent-doc .doc-sign-title { font-size: 11px; font-weight: 750; color: #374151; margin-bottom: 5px; }
.consent-doc .doc-sign-lines { font-size: 12px; }
.consent-doc .doc-sign-line { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; }
.consent-doc .doc-sign-line .wline { flex: 1; border-bottom: 1px solid #6b7280; height: 15px; }
.consent-doc .doc-foot { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d1d5db; font-size: 11px; color: #6b7280; line-height: 1.7; }
`;

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function todayStr(d) {
  const dt = d || new Date();
  return `${dt.getFullYear()}年${pad2(dt.getMonth() + 1)}月${pad2(dt.getDate())}日`;
}

/* ============================================================
   1. 自动匹配
   ============================================================ */

/**
 * 按处方自动匹配知情同意书。
 * 匹配优先级：名称前缀 / 编码精确 > 类别兜底；同一项目最多挂 3 份文书，
 * 取 order 最小的几份（order 越小越具体），避免一份处方刷出十几张纸。
 *
 * @param {Object} params
 * @param {Array} params.selectedItems [{ item: {...}, quantity }]
 * @param {number} [params.maxPerItem=3] 单个项目最多关联的文书数
 * @returns {{ matched: Array, unmatched: Array, templates: Array }}
 *   matched: [{ id, template, items: [{ code, name }] }]
 *   unmatched: [{ code, name }] 未匹配到任何专属文书（由通用告知书兜底）
 */
export function matchConsents({ selectedItems = [], maxPerItem = 3 } = {}) {
  const byTemplate = new Map(); // id -> { id, template, items: [] }
  const unmatched = [];

  for (const entry of selectedItems) {
    const it = (entry && entry.item) || {};
    const name = it.name || '';
    const code = it.code || '';

    let hits = CONSENT_TEMPLATES.filter(t =>
      (t.matchCodes && t.matchCodes.includes(code)) ||
      (t.matchNames && t.matchNames.some(k => name === k || name.startsWith(k)))
    );

    if (!hits.length && it.category) {
      hits = CONSENT_TEMPLATES.filter(t => t.matchCategories && t.matchCategories.includes(it.category));
    }

    // 通用告知书不自动弹出（可在文书页或库中手动加入）
    hits = hits.filter(t => t.id !== 'general').sort((a, b) => a.order - b.order).slice(0, maxPerItem);

    if (!hits.length) {
      if (code) unmatched.push({ code, name });
      continue;
    }

    for (const t of hits) {
      if (!byTemplate.has(t.id)) byTemplate.set(t.id, { id: t.id, template: t, items: [] });
      const bucket = byTemplate.get(t.id);
      if (!bucket.items.some(x => x.code === code)) bucket.items.push({ code, name });
    }
  }

  const matched = [...byTemplate.values()].sort((a, b) => a.template.order - b.template.order);
  return { matched, unmatched, templates: CONSENT_TEMPLATES };
}

/* ============================================================
   2. 文书生成
   ============================================================ */

/**
 * 生成一份完整的知情同意书文书对象（纯数据，便于测试与多形态输出）。
 * @param {Object} params
 * @param {Object} params.template 同意书模板
 * @param {Object} [params.ctx] 患者/机构上下文
 * @returns {Object} 文书对象
 */
export function buildConsentDoc({ template, ctx = {} }) {
  if (!template) throw new Error('buildConsentDoc: template 不能为空');

  const meta = META_FIELDS.map(f => {
    const raw = ctx[f.key];
    return { label: f.label, value: raw ? String(raw) : '　　　　　　' };
  });

  const items = Array.isArray(ctx.items) ? ctx.items : [];

  return {
    templateId: template.id,
    title: template.title,
    category: template.category,
    level: template.level,
    meta,
    items,
    sections: (template.sections || []).map(s => ({ h: s.h, items: [...s.items] })),
    declarationsTitle: CONSENT_COMMON.declarationTitle,
    declarations: [...CONSENT_COMMON.declarations],
    signBlocks: CONSENT_COMMON.signBlocks.map(b => ({ label: b.label, lines: [...b.lines] })),
    footer: FOOTER_NOTE,
    generatedAt: todayStr(),
    docNo: ctx.recordNo ? String(ctx.recordNo) : ''
  };
}

/** 本次诊疗项目清单（表格用） */
function itemsTableHtml(items) {
  if (!items.length) return '';
  const rows = items.map((it, i) =>
    `<tr><td class="c">${i + 1}</td><td>${escHtml(it.name)}</td><td class="c">${escHtml(it.code || '')}</td><td class="c">${it.quantity || 1}${escHtml(it.unit ? ' ' + it.unit : '')}</td></tr>`
  ).join('');
  return `
    <div class="doc-sec">
      <div class="doc-h">本次诊疗项目清单</div>
      <table class="doc-table">
        <thead><tr><th class="c">序号</th><th>项目名称</th><th class="c">项目编码</th><th class="c">数量</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * 文书 → 可打印 HTML 片段。
 * @param {Object} doc buildConsentDoc 的输出
 * @returns {string} HTML 字符串（已做转义）
 */
export function consentDocHtml(doc) {
  if (!doc) return '';
  const metaRow = doc.meta
    .map(m => `<div class="doc-meta-item"><span class="k">${escHtml(m.label)}</span><span class="v">${escHtml(m.value)}</span></div>`)
    .join('');

  const sections = doc.sections.map(s => `
    <div class="doc-sec">
      <div class="doc-h">${escHtml(s.h)}</div>
      <ul class="doc-ul">${s.items.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>
    </div>`).join('');

  const declarations = `
    <div class="doc-sec doc-sec-em">
      <div class="doc-h">${escHtml(doc.declarationsTitle)}</div>
      <ol class="doc-ol">${doc.declarations.map(x => `<li>${escHtml(x)}</li>`).join('')}</ol>
      <div class="doc-em-line">本人已仔细阅读上述全部内容，理解并自愿接受本次诊疗。</div>
    </div>`;

  const signs = doc.signBlocks.map(b => `
    <div class="doc-sign">
      <div class="doc-sign-title">${escHtml(b.label)}</div>
      <div class="doc-sign-lines">
        ${b.lines.map(l => `<div class="doc-sign-line">${escHtml(l)}<span class="wline"></span></div>`).join('')}
      </div>
    </div>`).join('');

  return `
  <article class="consent-doc" data-consent-id="${escHtml(doc.templateId)}">
    <header class="doc-head">
      <h1 class="doc-title">${escHtml(doc.title)}</h1>
      <div class="doc-sub">
        <span class="doc-badge">${escHtml(doc.level)}</span>
        <span class="doc-cat">${escHtml(doc.category)}</span>
        ${doc.docNo ? `<span class="doc-no">病历号：${escHtml(doc.docNo)}</span>` : ''}
        <span class="doc-date">生成日期：${escHtml(doc.generatedAt)}</span>
      </div>
    </header>
    <div class="doc-meta">${metaRow}</div>
    ${itemsTableHtml(doc.items)}
    ${sections}
    ${declarations}
    <div class="doc-signs">${signs}</div>
    <footer class="doc-foot">${escHtml(doc.footer)}</footer>
  </article>`;
}

/**
 * 文书 → 纯文本（导出 .txt 用）
 * @param {Object} doc
 * @returns {string}
 */
export function consentDocText(doc) {
  if (!doc) return '';
  const L = [];
  const hr = '─'.repeat(38);
  L.push(doc.title);
  L.push(`【${doc.category} · ${doc.level}】　生成日期：${doc.generatedAt}`);
  L.push(hr);
  doc.meta.forEach(m => L.push(`${m.label}：${m.value}`));
  if (doc.items.length) {
    L.push(hr);
    L.push('本次诊疗项目清单');
    doc.items.forEach((it, i) => L.push(`  ${i + 1}. ${it.name}（${it.code || '-'}）× ${it.quantity || 1}`));
  }
  doc.sections.forEach(s => {
    L.push(hr);
    L.push(s.h);
    s.items.forEach((x, i) => L.push(`  ${i + 1}) ${x}`));
  });
  L.push(hr);
  L.push(doc.declarationsTitle);
  doc.declarations.forEach((x, i) => L.push(`  ${i + 1}) ${x}`));
  L.push('  本人已仔细阅读上述全部内容，理解并自愿接受本次诊疗。');
  L.push(hr);
  doc.signBlocks.forEach(b => {
    L.push(b.label);
    b.lines.forEach(l => L.push(`  ${l}${/签名|审核人|盖章|身份证号|联系电话|执业证号|科室|与患者关系|日期/.test(l) ? '　____________________' : ''}`));
    L.push('');
  });
  L.push(hr);
  L.push(doc.footer);
  return L.join('\n');
}

/**
 * 同意书库关键词检索（名称 / 类别 / 正文正文命中）
 * @param {string} keyword
 * @returns {Array} 命中的模板数组，按相关度排序
 */
export function searchConsents(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return [...CONSENT_TEMPLATES];

  const score = (t) => {
    if (t.title.toLowerCase().includes(kw)) return 0;
    if ((t.category || '').toLowerCase().includes(kw)) return 1;
    const body = (t.sections || []).map(s => s.h + s.items.join('')).join('');
    if (body.toLowerCase().includes(kw)) return 2;
    if ((t.matchNames || []).some(n => n.toLowerCase().includes(kw))) return 1;
    return 9;
  };

  return CONSENT_TEMPLATES
    .map((t, idx) => ({ t, idx, r: score(t) }))
    .filter(x => x.r < 9)
    .sort((a, b) => (a.r - b.r) || (a.idx - b.idx))
    .map(x => x.t);
}

/**
 * 汇总多份文书为一个可打印的整包（供 window.print 一次性输出）
 * @param {Array<Object>} docs
 * @returns {string} HTML
 */
export function consentPackHtml(docs) {
  const list = (docs || []).filter(Boolean);
  if (!list.length) return '';
  return list.map(consentDocHtml).join('\n');
}

/** 患者信息字段定义（UI 渲染与持久化共用，避免两处手抄） */
export const CONSENT_PATIENT_FIELDS = [
  { key: 'clinicName', label: '医疗机构名称', type: 'text', placeholder: '如：康泰口腔门诊部' },
  { key: 'patientName', label: '患者姓名', type: 'text', placeholder: '请输入姓名' },
  { key: 'gender', label: '性别', type: 'select', options: ['男', '女'] },
  { key: 'age', label: '年龄', type: 'text', placeholder: '如：32' },
  { key: 'recordNo', label: '病历号', type: 'text', placeholder: '如：2026-000123' },
  { key: 'tooth', label: '患牙位 / 治疗部位', type: 'text', placeholder: '如：36、46 或 全口' }
];
