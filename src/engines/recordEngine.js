/**
 * 医保门诊病历生成引擎
 * ------------------------------------------------------------------
 * 职责：
 *   1) 依处方项目所属分类，自动拼出「主诉 / 现病史 / 检查 / 诊断 / 处置 / 医嘱」草稿
 *      （draftRecord）——草稿只是起点，必须由接诊医师核对修改；
 *   2) 把「患者信息 + 医生补充内容 + 项目清单」组装成完整病历对象（buildMedicalRecord）；
 *   3) 输出 HTML / 纯文本，供预览、A4 打印与导出复用。
 *
 * 与知情同意书共用同一份患者信息（ctx 结构一致），保证同一患者两处填写一次即可。
 * 无任何外部依赖，Node 与浏览器均可直接运行。
 */
import { RECORD_DOCTOR_FIELDS, RECORD_DEPARTMENTS, recordTemplateOf } from '../data/records.js';

/** 病历正文分区顺序（未在模板中命中的字段留空由医生补写） */
const FIELD_ORDER = RECORD_DOCTOR_FIELDS.map(f => f.key);

const EMPTY_PLACEHOLDER = '（待接诊医师填写）';

const RECORD_FOOTER =
  '本病历由执业医师依据《病历书写基本规范》书写并签名，随门诊病历归档保存（门诊病历自患者最后一次就诊之日起保存期不少于 15 年）。系统按收费项目自动生成的内容仅为草稿，最终以医师核对、修改、签名后的记载为准。';

/** 病历文书补充样式（基础排版复用知情同意书同一份 CSS，避免两套样式漂移） */
export const RECORD_DOC_CSS = `
.record-doc .doc-title { letter-spacing: 2px; }
.record-doc .rec-sec { margin-top: 11px; }
.record-doc .rec-h {
  font-weight: 800; font-size: 12.5px; color: #0f172a;
  background: #f3f4f6; border-left: 4px solid #0284c7;
  padding: 3px 8px; margin-bottom: 5px;
}
.record-doc .rec-body { white-space: pre-wrap; padding-left: 2px; line-height: 1.85; }
.record-doc .rec-body.is-empty { color: #9ca3af; font-style: italic; }
.record-doc .rec-diagnosis { font-weight: 750; }
.record-doc .rec-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
.record-doc .rec-sign { font-size: 12px; display: flex; align-items: baseline; gap: 6px; }
.record-doc .rec-sign .wline { flex: 1; border-bottom: 1px solid #6b7280; height: 15px; }
.record-doc .rec-draft-note {
  margin-top: 10px; padding: 7px 10px; border: 1px dashed #f59e0b;
  background: #fffbeb; border-radius: 6px; font-size: 11.5px; color: #92400e; line-height: 1.7;
}
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

/** 用占位符替换模板 */
function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

/* ============================================================
   1. 自动草稿
   ============================================================ */

/**
 * 依处方自动生成病历草稿。
 * 同一份处方可能横跨多个分类，逐分类取模板并拼接，避免「拔牙 + 修复」时漏掉一半。
 *
 * @param {Object} params
 * @param {Array} params.selectedItems [{ item, quantity }]
 * @param {Object} [params.ctx] 患者上下文（tooth 等）
 * @returns {{ fields: Object, categories: string[], usedTemplate: boolean }}
 */
export function draftRecord({ selectedItems = [], ctx = {} } = {}) {
  const tooth = (ctx.tooth || '').trim() || '患牙';
  const items = selectedItems
    .map(e => (e && e.item ? e.item.name : ''))
    .filter(Boolean);
  const itemsText = items.length ? items.join('、') : '口腔专科检查与处理';

  // 保持出现顺序去重
  const cats = [];
  selectedItems.forEach(e => {
    const c = e && e.item && e.item.category;
    if (c && !cats.includes(c)) cats.push(c);
  });
  if (!cats.length) cats.push('other');

  const vars = { tooth, items: itemsText, n: items.length };

  const fields = {};
  FIELD_ORDER.forEach(key => {
    const parts = [];
    cats.forEach(c => {
      const tpl = recordTemplateOf(c);
      const v = tpl[key];
      if (v && !parts.includes(v)) parts.push(v);
    });
    fields[key] = parts.map(p => fill(p, vars)).join('\n');
  });

  const department = RECORD_DEPARTMENTS[0];
  return { fields, categories: cats, department, usedTemplate: true };
}

/* ============================================================
   2. 病历组装
   ============================================================ */

/**
 * 组装完整病历对象。
 * @param {Object} params
 * @param {Object} params.ctx     患者/机构上下文（与知情同意书一致）
 * @param {Object} params.fields  医生确认后的各段文字（缺项自动用草稿兜底）
 * @param {Array}  params.items   本次诊疗项目清单
 * @param {Object} [params.extra] { department, doctor, chiefDraft }
 * @returns {Object} 病历对象
 */
export function buildMedicalRecord({ ctx = {}, fields = {}, items = [], extra = {} } = {}) {
  const sections = RECORD_DOCTOR_FIELDS.map(f => {
    const raw = fields[f.key] != null ? String(fields[f.key]).trim() : '';
    return { key: f.key, label: f.label, value: raw };
  });

  const meta = [
    { label: '医疗机构', value: ctx.clinicName || '' },
    { label: '患者姓名', value: ctx.patientName || '' },
    { label: '性别', value: ctx.gender || '' },
    { label: '年龄', value: ctx.age || '' },
    { label: '病历号', value: ctx.recordNo || '' },
    { label: '就诊日期', value: ctx.visitDate || todayStr() },
    { label: '科室', value: extra.department || RECORD_DEPARTMENTS[0] },
    { label: '接诊医师', value: extra.doctor || '' }
  ];

  return {
    title: '口腔门诊病历',
    type: 'medical-record',
    meta,
    sections,
    items,
    cityName: ctx.cityName || '',
    tooth: ctx.tooth || '',
    footer: RECORD_FOOTER,
    generatedAt: todayStr(),
    recordNo: ctx.recordNo || ''
  };
}

/* ============================================================
   3. 输出形态
   ============================================================ */

function itemsTableHtml(items) {
  if (!items.length) return '';
  const rows = items.map((it, i) =>
    `<tr><td class="c">${i + 1}</td><td>${escHtml(it.name)}</td><td class="c">${escHtml(it.code || '')}</td><td class="c">${it.quantity || 1}${escHtml(it.unit ? ' ' + it.unit : '')}</td></tr>`
  ).join('');
  return `
    <div class="rec-sec">
      <div class="rec-h">本次诊疗项目清单</div>
      <table class="doc-table">
        <thead><tr><th class="c">序号</th><th>项目名称</th><th class="c">项目编码</th><th class="c">数量</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * 病历对象 → 可打印 HTML 片段。
 * 使用 .consent-doc 基础类以复用同一份文书排版 CSS。
 */
export function recordDocHtml(record) {
  if (!record) return '';
  const metaRow = record.meta
    .map(m => `<div class="doc-meta-item"><span class="k">${escHtml(m.label)}</span><span class="v">${escHtml(m.value || '　　　　　　')}</span></div>`)
    .join('');

  const secs = record.sections.map(s => {
    const empty = !s.value;
    const cls = s.key === 'diagnosis' ? 'rec-body rec-diagnosis' : 'rec-body';
    return `
    <div class="rec-sec">
      <div class="rec-h">${escHtml(s.label)}</div>
      <div class="${cls}${empty ? ' is-empty' : ''}">${escHtml(empty ? EMPTY_PLACEHOLDER : s.value)}</div>
    </div>`;
  }).join('');

  const sigDate = record.generatedAt;

  return `
  <article class="consent-doc record-doc" data-record-id="${escHtml(record.recordNo || 'record')}">
    <header class="doc-head">
      <h1 class="doc-title">${escHtml(record.title)}</h1>
      <div class="doc-sub">
        <span class="doc-badge">门诊病历</span>
        ${record.cityName ? `<span class="doc-cat">${escHtml(record.cityName)}</span>` : ''}
        ${record.recordNo ? `<span class="doc-no">病历号：${escHtml(record.recordNo)}</span>` : ''}
        <span class="doc-date">就诊日期：${escHtml(sigDate)}</span>
      </div>
    </header>
    <div class="doc-meta">${metaRow}</div>
    ${itemsTableHtml(record.items || [])}
    ${secs}
    <div class="rec-draft-note">说明：以上「主诉 / 现病史 / 检查 / 诊断 / 处置 / 医嘱」由系统按本次收费项目自动生成草稿，须由接诊医师核对、修改后签名生效。</div>
    <div class="rec-signs">
      <div class="rec-sign">接诊医师签名<span class="wline"></span></div>
      <div class="rec-sign">日期<span class="wline"></span></div>
    </div>
    <footer class="doc-foot">${escHtml(record.footer)}</footer>
  </article>`;
}

/** 病历对象 → 纯文本 */
export function recordDocText(record) {
  if (!record) return '';
  const L = [];
  const hr = '─'.repeat(38);
  L.push(record.title);
  L.push(`【门诊病历】　就诊日期：${record.generatedAt}`);
  L.push(hr);
  record.meta.forEach(m => L.push(`${m.label}：${m.value || '　　'}`));
  if ((record.items || []).length) {
    L.push(hr);
    L.push('本次诊疗项目清单');
    record.items.forEach((it, i) => L.push(`  ${i + 1}. ${it.name}（${it.code || '-'}）× ${it.quantity || 1}`));
  }
  record.sections.forEach(s => {
    L.push(hr);
    L.push(s.label);
    L.push('  ' + (s.value || EMPTY_PLACEHOLDER).split('\n').join('\n  '));
  });
  L.push(hr);
  L.push('接诊医师签名：____________________　　日期：____________________');
  L.push(hr);
  L.push(record.footer);
  return L.join('\n');
}

/** 多份病历打包（当前仅一份，保留接口以对齐同意书引擎） */
export function recordPackHtml(records) {
  const list = (records || []).filter(Boolean);
  if (!list.length) return '';
  return list.map(recordDocHtml).join('\n');
}

/** 病历页医生需填字段定义（透出，避免 UI 再抄一份） */
export { RECORD_DOCTOR_FIELDS, RECORD_DEPARTMENTS };
