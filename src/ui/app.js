/* ============================================================
   肘边备急 · 应用交互层
   Copyright (c) 2026 肘边备急项目全体贡献者（Contributors）
   以 GNU GPL-3.0 发布（见项目根 LICENSE 或应用内「关于」）。
   依赖（由 build.js 前置内联）：APP_INFO / CITIES_POLICY / TAX_MODES /
   DENTAL_CATEGORIES / DENTAL_ITEMS / ITEMS_114_* / CATEGORIES_114 /
   IMAGING_META / IMAGING_MAIN / IMAGING_ALL /
   calculateDentalFees / checkInsuranceRedLines / generateOptimalPricingPlans
   ============================================================ */

/* STORAGE_KEY 随改名升到新命名空间：旧键不会被读到，避免读到结构不一致的历史数据 */
const STORAGE_KEY = 'zhoubianbeiji.dental.state.v1';

/** 项目库版本。gg114 = 2025 立项指南 114 项（当前主流）；legacy = 旧版项目规范 */
const VERSIONS = {
  gg114: {
    id: 'gg114',
    name: '114 项版',
    fullName: '2025 立项指南版（114 项 + 放射检查类）',
    doc: '医保价采函〔2025〕18号 / 〔2024〕233号',
    categories: () => CATEGORIES_114,
    mainItems: () => ITEMS_114_MAIN.concat(IMAGING_MAIN),
    allItems: () => ITEMS_114_ALL.concat(IMAGING_ALL)
  },
  legacy: {
    id: 'legacy',
    name: '旧版项目规范',
    fullName: '旧版医疗服务项目规范（330xxxxx 编码）',
    doc: '全国医疗服务项目技术规范',
    categories: () => DENTAL_CATEGORIES,
    mainItems: () => DENTAL_ITEMS,
    allItems: () => DENTAL_ITEMS
  }
};

const state = {
  view: 'order',
  cityId: 'chengdu',
  patientTypeId: '',
  institutionLevel: 'primary',
  accumulatedDeductible: 0,
  accumulatedReimbursement: 0,
  version: 'gg114',
  category: 'all',
  keyword: '',
  taxModeId: 'exempt_medical',
  taxSettings: null,
  prescription: [],       // [{ code, quantity }]  仅存 code+数量
  consentPatient: {},     // 知情同意书抬头信息
  consentSel: [],         // 已选知情同意书模板 id（自动匹配 + 手动加入）
  consentAuto: [],        // 其中由处方自动匹配进来的 id（用于区分手动项）
  consentDismissed: [],   // 用户手动移除、且当前处方仍相关 → 不再自动加回
  consentKeyword: '',     // 同意书库检索词（不持久化）
  recordFields: {},       // 病历各段内容（医生确认后）
  recordSnapshot: {},     // 上一次自动生成的草稿（判断医生是否改过）
  recordTouched: [],      // 医生手动改过的段落 key（不再被自动草稿覆盖）
  recordMeta: { department: '', doctor: '' },
  selfCheckDone: [],          // 已完成自查的合规模块 id
  advisorComboGroup: '种植',  // 助手页「治疗方案组合」分组
  advisorComboKeyword: '',     // 助手页组合检索词（不持久化）

  /* ---- 报税助手（第 13 轮新增） ---- */
  taxProfile: {
    entityId: 'small_company',
    periodType: 'quarterly',
    cityType: 'urban',
    periodKey: '',
    separated: true,
    specialInvoiceOnExempt: false,
    overGuidePrice: false,
    inputVat: 0,
    inputTransfer: 0
  },
  taxLedger: []               // 收入台账 [{ id, date, medical, consumable, cosmetic, cost }]
};

const $ = (id) => document.getElementById(id);

/* ---------------- 版本 / 项目查询 ---------------- */
function currentVersion() { return VERSIONS[state.version] || VERSIONS.gg114; }
function allItemsOfVersion() { return currentVersion().allItems(); }
function findItem(code) { return allItemsOfVersion().find(i => i.code === code); }

/**
 * 取项目的当前适用单价。
 * 114 版给的是三级/二级/一级三档政府指导价，需按当前门诊级别取值；
 * 旧版只有 defaultPrice。
 */
function priceOf(item, level = state.institutionLevel) {
  if (item == null) return 0;
  if (item.priceLevel3 != null) {
    const map = { tertiary: item.priceLevel3, secondary: item.priceLevel2, primary: item.priceLevel1 };
    const v = map[level];
    return v != null ? Number(v) : Number(item.priceLevel3);
  }
  return Number(item.defaultPrice) || 0;
}

/* ---------------- 工具 ---------------- */
function yuan(n) {
  const v = Number(n) || 0;
  return '¥' + v.toFixed(2);
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** 金额归一：非数字/负数一律归零，统一保留 2 位小数 */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}
/** 轻量唯一 id（本地台账用，无需加密强度） */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
/** 本地日期 YYYY-MM-DD（不能用 toISOString，会按 UTC 少一天） */
function localDateStr(d = new Date()) {
  const p = (x) => (x < 10 ? '0' + x : String(x));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function currentCity() { return CITIES_POLICY[state.cityId] || CITIES_POLICY.chengdu; }
function currentPatientType() {
  const city = currentCity();
  return city.patientTypes.find(p => p.id === state.patientTypeId) || city.patientTypes[0];
}
/** 由 state.prescription 还原成引擎需要的 selectedItems（价格按当前门诊级别解析） */
function buildSelectedItems() {
  const out = [];
  state.prescription.forEach(row => {
    const item = findItem(row.code);
    if (item && row.quantity > 0) {
      out.push({ item, quantity: row.quantity, customPrice: priceOf(item) });
    }
  });
  return out;
}
function countOf(code) {
  const row = state.prescription.find(r => r.code === code);
  return row ? row.quantity : 0;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------------- 持久化 ---------------- */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cityId: state.cityId,
      patientTypeId: state.patientTypeId,
      institutionLevel: state.institutionLevel,
      accumulatedDeductible: state.accumulatedDeductible,
      accumulatedReimbursement: state.accumulatedReimbursement,
      version: state.version,
      taxModeId: state.taxModeId,
      taxSettings: state.taxSettings,
      prescription: state.prescription,
      consentPatient: state.consentPatient,
      consentSel: state.consentSel,
      consentAuto: state.consentAuto,
      consentDismissed: state.consentDismissed,
      recordFields: state.recordFields,
      recordSnapshot: state.recordSnapshot,
      recordTouched: state.recordTouched,
      recordMeta: state.recordMeta,
      selfCheckDone: state.selfCheckDone,
      taxProfile: state.taxProfile,
      taxLedger: state.taxLedger
    }));
  } catch (e) { /* 隐私模式下忽略 */ }
}

function loadState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }

  state.taxSettings = { ...(TAX_MODES[0].settings) };
  if (!saved) return;

  if (saved.cityId && CITIES_POLICY[saved.cityId]) state.cityId = saved.cityId;
  if (saved.institutionLevel) state.institutionLevel = saved.institutionLevel;
  if (Number.isFinite(saved.accumulatedDeductible)) state.accumulatedDeductible = saved.accumulatedDeductible;
  if (Number.isFinite(saved.accumulatedReimbursement)) state.accumulatedReimbursement = saved.accumulatedReimbursement;
  if (saved.version && VERSIONS[saved.version]) state.version = saved.version;

  const city = CITIES_POLICY[state.cityId];
  const savedPt = saved.patientTypeId;
  state.patientTypeId = (savedPt && city.patientTypes.some(p => p.id === savedPt))
    ? savedPt : city.patientTypes[0].id;

  const tm = TAX_MODES.find(m => m.id === saved.taxModeId);
  if (tm) {
    state.taxModeId = tm.id;
    state.taxSettings = { ...tm.settings };
  }
  if (saved.taxSettings && typeof saved.taxSettings === 'object') {
    state.taxSettings = { ...state.taxSettings, ...saved.taxSettings };
  }

  // 处方按当前版本过滤：切换版本后旧编码可能已不存在，直接丢弃并提示
  const savedRx = Array.isArray(saved.prescription) ? saved.prescription : [];
  const items = allItemsOfVersion();
  const kept = savedRx
    .filter(r => r && items.some(i => i.code === r.code) && Number(r.quantity) > 0)
    .map(r => ({ code: r.code, quantity: Math.max(1, Math.min(99, Math.round(Number(r.quantity)))) }));
  state.prescription = kept;
  state.droppedOnLoad = savedRx.length - kept.length;

  // 知情同意书：抬头信息 + 已选文书（模板被移除的自动丢弃）
  if (saved.consentPatient && typeof saved.consentPatient === 'object') {
    const clean = {};
    CONSENT_PATIENT_FIELDS.forEach(f => {
      const v = saved.consentPatient[f.key];
      if (typeof v === 'string') clean[f.key] = v.slice(0, 60);
    });
    state.consentPatient = clean;
  }
  if (Array.isArray(saved.consentSel)) {
    state.consentSel = saved.consentSel
      .filter(id => typeof id === 'string' && CONSENT_TEMPLATES.some(t => t.id === id))
      .slice(0, 40);
  }
  const onlyKnown = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(id => typeof id === 'string' && CONSENT_TEMPLATES.some(t => t.id === id))
    .slice(0, 40);
  state.consentAuto = onlyKnown(saved.consentAuto);
  state.consentDismissed = onlyKnown(saved.consentDismissed);

  // 病历：各段文本 + 医生改动标记 + 科室/医师
  const RECORD_KEYS = RECORD_DOCTOR_FIELDS.map(f => f.key);
  if (saved.recordFields && typeof saved.recordFields === 'object') {
    const clean = {};
    RECORD_KEYS.forEach(k => {
      const v = saved.recordFields[k];
      if (typeof v === 'string') clean[k] = v.slice(0, 4000);
    });
    state.recordFields = clean;
  }
  if (saved.recordSnapshot && typeof saved.recordSnapshot === 'object') {
    const clean = {};
    RECORD_KEYS.forEach(k => {
      const v = saved.recordSnapshot[k];
      if (typeof v === 'string') clean[k] = v.slice(0, 4000);
    });
    state.recordSnapshot = clean;
  }
  state.recordTouched = (Array.isArray(saved.recordTouched) ? saved.recordTouched : [])
    .filter(k => RECORD_KEYS.includes(k));
  if (saved.recordMeta && typeof saved.recordMeta === 'object') {
    state.recordMeta = {
      department: typeof saved.recordMeta.department === 'string' ? saved.recordMeta.department.slice(0, 30) : '',
      doctor: typeof saved.recordMeta.doctor === 'string' ? saved.recordMeta.doctor.slice(0, 30) : ''
    };
  }
  if (Array.isArray(saved.selfCheckDone)) {
    state.selfCheckDone = saved.selfCheckDone
      .map(x => Number(x))
      .filter(x => Number.isInteger(x) && x >= 1 && x <= 20);
  }

  // 报税助手：身份 / 申报期 / 合规开关 + 收入台账
  if (saved.taxProfile && typeof saved.taxProfile === 'object') {
    const p = saved.taxProfile;
    const tp = state.taxProfile;
    if (entityById(p.entityId).id === p.entityId) tp.entityId = p.entityId;
    if (p.periodType === 'monthly' || p.periodType === 'quarterly') tp.periodType = p.periodType;
    if (['urban', 'county', 'other'].includes(p.cityType)) tp.cityType = p.cityType;
    if (typeof p.periodKey === 'string') tp.periodKey = p.periodKey;
    tp.separated = p.separated !== false;
    tp.specialInvoiceOnExempt = p.specialInvoiceOnExempt === true;
    tp.overGuidePrice = p.overGuidePrice === true;
    tp.inputVat = money(p.inputVat);
    tp.inputTransfer = money(p.inputTransfer);
  }
  if (Array.isArray(saved.taxLedger)) {
    state.taxLedger = saved.taxLedger
      .filter(e => e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
      .slice(-2000)
      .map(e => ({
        id: typeof e.id === 'string' ? e.id : uid(),
        date: e.date,
        medical: money(e.medical),
        consumable: money(e.consumable),
        cosmetic: money(e.cosmetic),
        cost: money(e.cost)
      }));
  }
}

/* ---------------- 初始化 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  if (!state.patientTypeId) state.patientTypeId = currentCity().patientTypes[0].id;
  if (state.prescription.length === 0 && !localStorage.getItem(STORAGE_KEY)) {
    // 首次使用：预置一组典型处方，方便直接体验
    state.prescription = defaultPrescription();
  }

  injectConsentDocStyles();
  renderAll();
  registerServiceWorker();
  if (state.droppedOnLoad > 0) {
    toast(`已切换项目版本，${state.droppedOnLoad} 个不兼容项目已移出清单`);
  }
});

/** 把文书本体样式注入页面（与导出 HTML 共用同一份 CSS 源，避免两处漂移） */
function injectConsentDocStyles() {
  if (document.getElementById('consentDocStyles')) return;
  const style = document.createElement('style');
  style.id = 'consentDocStyles';
  style.textContent = CONSENT_DOC_CSS + '\n' + RECORD_DOC_CSS;
  document.head.appendChild(style);
}

/** 各版本的体验用默认处方 */
function defaultPrescription() {
  if (state.version === 'gg114') {
    return [
      { code: '013105010050000', quantity: 1 }, // 根管预备费
      { code: '013105010060000', quantity: 1 }, // 根管冲洗费
      { code: '013105010070000', quantity: 1 }, // 根管充填费
      { code: '013306020060000', quantity: 1 }  // 阻生牙拔除费
    ];
  }
  return [
    { code: '330501003', quantity: 1 },
    { code: '310401002', quantity: 2 },
    { code: '110200001', quantity: 1 }
  ];
}

function renderAll() {
  document.body.setAttribute('data-view', state.view);
  renderCityScroller();
  renderPolicyBanner();
  renderConfigFields();
  renderVersionSwitcher();
  renderCategoryScroller();
  renderItemList();
  renderPrescription();
  renderTaxPanel();
  renderConsentPatientFields();
  renderRecordPanel();
  renderConsentPanel();
  renderAdvisorPanel();   // 助手页（A 区「叠加收费边界」随后由 refreshCalculation 再同步一次）
  renderTaxAssistant();   // 报税页（依赖台账汇总，与精算结果无关）
  refreshCalculation();
}

/* ---------------- 版本切换 ---------------- */
function renderVersionSwitcher() {
  const box = $('versionSwitcher');
  if (!box) return;
  box.innerHTML = Object.keys(VERSIONS).map(k => {
    const v = VERSIONS[k];
    return `<button type="button" class="ver-pill${k === state.version ? ' active' : ''}"
      onclick="switchVersion('${k}')">${escapeHtml(v.name)}</button>`;
  }).join('');

  const v = currentVersion();
  $('versionMeta').innerHTML = v.id === 'gg114'
    ? `<b>${escapeHtml(v.fullName)}</b> · ${escapeHtml(v.doc)}<br>
       口腔类 114 项主项目 + 81 项加收分项，另收录<b>放射检查类</b>口腔常用影像项目（X线摄影成像 / 全景片 / 牙片 / CBCT）。
       按「服务产出」设项，原「根管治疗术」已拆分为
       <b>根管预备费 / 根管冲洗费 / 根管充填费</b>；基本物耗（镍钛锉、充填材料、根管封闭剂等）成本已计入项目价格，
       <b>不得另行收费</b>；所定价格为最高限价，不得上浮。`
    : `<b>${escapeHtml(v.fullName)}</b><br>
       旧版按诊疗步骤设项（如 330501003 磨牙根管治疗术），配套口腔种植集采调控规则。`;
}

function switchVersion(id) {
  if (!VERSIONS[id] || id === state.version) return;
  const prevCount = state.prescription.length;
  state.version = id;
  state.category = 'all';
  state.keyword = '';
  $('itemSearchInput').value = '';

  const items = allItemsOfVersion();
  state.prescription = state.prescription.filter(r => items.some(i => i.code === r.code));
  const dropped = prevCount - state.prescription.length;

  renderVersionSwitcher();
  renderCategoryScroller();
  renderItemList();
  renderPrescription();
  refreshCalculation();
  saveState();
  toast(dropped > 0
    ? `已切换到${currentVersion().name}，${dropped} 个编码不兼容的项目已移出`
    : `已切换到${currentVersion().name}`);
}

/* ---------------- 城市 ---------------- */
function renderCityScroller() {
  $('cityScroller').innerHTML = Object.keys(CITIES_POLICY).map(key => {
    const c = CITIES_POLICY[key];
    return `<button type="button" class="city-pill${c.id === state.cityId ? ' active' : ''}"
      onclick="switchCity('${c.id}')">${escapeHtml(c.name)}</button>`;
  }).join('');
}

function switchCity(cityId) {
  if (!CITIES_POLICY[cityId] || cityId === state.cityId) return;
  state.cityId = cityId;
  state.patientTypeId = currentCity().patientTypes[0].id;
  state.accumulatedDeductible = 0;
  state.accumulatedReimbursement = 0;
  renderCityScroller();
  renderPolicyBanner();
  renderConfigFields();
  renderItemList();
  refreshCalculation();
  saveState();
  $('appMain').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPolicyBanner() {
  const city = currentCity();
  $('policyBanner').innerHTML = `
    <div class="pb-desc"><b>${escapeHtml(city.name)}</b> · ${escapeHtml(city.description)}</div>
    <div class="policy-chips">
      <span class="policy-chip emphasis">种植调控上限 ¥${city.implantMaxGuidancePrice}</span>
      ${city.features.map(f => `<span class="policy-chip">${escapeHtml(f)}</span>`).join('')}
    </div>`;
}

function renderConfigFields() {
  const city = currentCity();
  $('patientTypeSelect').innerHTML = city.patientTypes.map(p => {
    const lv = p.deductibleLevels || { primary: p.deductible, secondary: p.deductible, tertiary: p.deductible };
    const rt = p.ratesByLevel || { primary: p.reimbursementRate, secondary: p.reimbursementRate, tertiary: p.reimbursementRate };
    return `<option value="${p.id}">${escapeHtml(p.name)}（起付 ${lv.primary}~${lv.tertiary} 元 / 报销 ${(rt.primary * 100).toFixed(0)}%~${(rt.tertiary * 100).toFixed(0)}%）</option>`;
  }).join('');
  $('patientTypeSelect').value = state.patientTypeId;
  $('institutionLevelSelect').value = state.institutionLevel;
  $('accumulatedDeductibleInput').value = state.accumulatedDeductible;
  $('accumulatedReimbursementInput').value = state.accumulatedReimbursement;
}

/* ---------------- 配置变更 ---------------- */
function onPatientTypeChange() {
  state.patientTypeId = $('patientTypeSelect').value;
  refreshCalculation(); saveState();
}
function onInstitutionLevelChange() {
  state.institutionLevel = $('institutionLevelSelect').value;
  // 114 版价格随机构级别变化，需要整表重算显示价
  renderPrescription();
  renderItemList();
  refreshCalculation(); saveState();
}
function onAccumulatedChange() {
  state.accumulatedDeductible = Math.max(0, parseFloat($('accumulatedDeductibleInput').value) || 0);
  state.accumulatedReimbursement = Math.max(0, parseFloat($('accumulatedReimbursementInput').value) || 0);
  refreshCalculation(); saveState();
}

/* ---------------- 项目库 ---------------- */
function renderCategoryScroller() {
  const cats = currentVersion().categories();
  const mains = currentVersion().mainItems();
  $('categoryScroller').innerHTML = cats.map(c => {
    const n = c.id === 'all'
      ? mains.length
      : (c.id === 'addon'
        ? allItemsOfVersion().filter(i => i.isAddon).length
        : mains.filter(i => i.category === c.id).length);
    return `<button type="button" class="cat-btn${c.id === state.category ? ' active' : ''}"
      onclick="switchCategory('${c.id}')">${escapeHtml(c.name)} ${n}</button>`;
  }).join('');
}

function switchCategory(id) {
  state.category = id;
  renderCategoryScroller();
  renderItemList();
}

/**
 * 把元素顶到粘性顶栏之下（配合 .search-wrap 的 scroll-margin-top）。
 * 必须「延后一帧 + 瞬时滚动」：聚焦后紧接着的列表重渲染 / 折叠面板收起
 * 会把平滑滚动动画打断，实测 scrollY 只走到目标的 1/10，
 * 结果就是「聚焦了、键盘起来了，但搜索结果仍在屏幕外点不到」。
 */
function revealElement(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
}

/**
 * 搜索框行为：
 * 1) 收起「参保类别」面板，把项目列表顶到屏幕上方（手机键盘弹出时尤其关键）
 * 2) 把搜索区滚到粘性顶栏之下，保证输入框与结果同时可见
 */
function onSearchFocus() {
  const toggle = document.querySelector('.collapse-toggle[data-target="settings"]');
  if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
    toggle.setAttribute('aria-expanded', 'false');
    const body = toggle.nextElementSibling;
    if (body) body.classList.remove('open');
  }
  revealElement($('itemSearchInput').closest('.search-wrap'));
}

function onSearchInput() {
  state.keyword = $('itemSearchInput').value.trim();
  const c = $('itemSearchClear');
  if (c) c.hidden = !state.keyword;
  renderItemList();
}

function clearSearch() {
  state.keyword = '';
  $('itemSearchInput').value = '';
  const c = $('itemSearchClear');
  if (c) c.hidden = true;
  renderItemList();
  $('itemSearchInput').focus();
}

/* ---------------- 关键词高亮 / 命中定位 ---------------- */

/** 转义后把命中的关键词包一层 <mark>（先转义再包，避免 XSS） */
function hl(text, kw) {
  const s = String(text == null ? '' : text);
  if (!kw) return escapeHtml(s);
  const i = s.toLowerCase().indexOf(kw.toLowerCase());
  if (i < 0) return escapeHtml(s);
  return escapeHtml(s.slice(0, i)) +
    '<mark class="hl">' + escapeHtml(s.slice(i, i + kw.length)) + '</mark>' +
    escapeHtml(s.slice(i + kw.length));
}

/** 项目字段与中文名的映射，顺序即相关度（越小越靠前） */
const SEARCH_FIELDS = [
  ['名称', i => i.name],
  ['别名', i => i.aliases],
  ['编码', i => i.code],
  ['服务产出', i => i.output || i.description],
  ['价格构成', i => i.composition],
  ['除外内容', i => i.exclusions],
  ['计价说明', i => i.billingNote || i.restrictions],
  ['计价单位', i => i.unit]
];

/**
 * 定位关键词命中的字段。
 * @returns {{rank:number, field:string, text:string}} rank = -1 表示未命中
 */
function matchInfo(item, kw) {
  if (!kw) return { rank: -1, field: '', text: '' };
  const k = kw.toLowerCase();
  for (let i = 0; i < SEARCH_FIELDS.length; i++) {
    const [field, get] = SEARCH_FIELDS[i];
    const t = get(item);
    if (t && String(t).toLowerCase().includes(k)) return { rank: i, field, text: String(t) };
  }
  return { rank: -1, field: '', text: '' };
}

/** 无结果时给用户的备选关键词 */
const SUGGEST_KEYWORDS = ['根管', '拔牙', '洁治', '充填', '阻生', '矫治', '修复', '全景', '牙片', 'CBCT'];

function applySuggest(kw) {
  state.keyword = kw;
  const input = $('itemSearchInput');
  if (input) input.value = kw;
  const c = $('itemSearchClear');
  if (c) c.hidden = false;
  renderItemList();
  revealElement($('itemSearchWrap'));
}

/** 当前版本下应展示的项目集合 */
function visibleItems() {
  const v = currentVersion();
  const kw = state.keyword.trim().toLowerCase();

  if (kw) {
    // 有关键词：跨全量（含加收分项）搜索，按命中字段相关度排序
    return v.allItems()
      .map((i, idx) => ({ i, idx, m: matchInfo(i, kw) }))
      .filter(x => x.m.rank >= 0)
      .sort((a, b) => (a.m.rank - b.m.rank) || (a.idx - b.idx))
      .map(x => x.i);
  }

  // 无关键词：按分类展示（全部=主项目；加收/分项=仅加收项）
  if (state.category === 'addon') return v.allItems().filter(i => i.isAddon);
  const mains = v.mainItems();
  if (state.category === 'all') return mains;
  return mains.filter(i => i.category === state.category);
}

function renderItemList() {
  const list = visibleItems();
  const box = $('itemList');
  const kw = state.keyword.trim();
  const kwl = kw.toLowerCase();
  $('itemCount').textContent = list.length + ' 项';
  const bar = $('resultBar');
  if (bar) bar.hidden = !kw;
  if (kw) $('resultText').textContent = `「${kw}」命中 ${list.length} 项`;
  const hint = $('searchHint');
  if (hint) hint.hidden = !!kw;

  if (!list.length) {
    box.innerHTML = kw
      ? `<div class="empty-hint">
           <div>没有匹配「${escapeHtml(kw)}」的项目</div>
           <div class="sug-title">换个关键词试试</div>
           <div class="sug-chips">${SUGGEST_KEYWORDS.map(k =>
             `<button type="button" class="sug-chip" onclick="applySuggest('${k}')">${k}</button>`).join('')}</div>
         </div>`
      : '<div class="empty-hint">该分类暂无项目</div>';
    return;
  }

  box.innerHTML = list.map(item => {
    const q = countOf(item.code);
    const price = priceOf(item);
    const isC = item.insuranceType === '自费';
    const meta = [`单位：${escapeHtml(item.unit || '次')}`];
    if (item.insuranceType === '乙类') meta.push(`先行自付 ${((item.copayRate ?? 0.1) * 100).toFixed(0)}%`);
    if (item.isAddon) meta.push('加收/分项，须挂靠主项目');
    if (item.priceLevel3 != null) {
      const lvName = { tertiary: '三级', secondary: '二级', primary: '一级' }[state.institutionLevel];
      meta.push(`政府指导价·${lvName}`);
    }

    // 搜索态：展示命中字段，命中非名称/编码时额外给一行摘要
    const m = kwl ? matchInfo(item, kwl) : null;
    const hitNonPrimary = m && m.rank >= 2;
    const excerpt = m && m.text
      ? `<div class="item-excerpt"><span class="ex-field">${escapeHtml(m.field)}</span>${hl(m.text.length > 120 ? m.text.slice(0, 120) + '…' : m.text, kwl)}</div>`
      : '';

    return `
      <div class="item-row${q > 0 ? ' added' : ''}" role="button" tabindex="0"
           onclick="openItemDetail('${item.code}')"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openItemDetail('${item.code}');}">
        <div class="item-info">
          <div class="item-line1">
            <span class="item-name">${hl(item.name, kwl)}</span>
            <span class="tag tag-${item.insuranceType}">${item.insuranceType}</span>
            ${item.isAddon ? '<span class="tag tag-addon">加收</span>' : ''}
          </div>
          <div class="item-code">${hl(item.code, kwl)}</div>
          <div class="item-meta">${meta.map(x => `<span>${x}</span>`).join('')}</div>
          ${excerpt}
          ${item.restrictions ? `<div class="item-meta"><span class="item-warn">⚠ ${escapeHtml(item.restrictions)}</span></div>` : ''}
        </div>
        <div class="item-right">
          <div class="item-price">${isC && price === 0 ? '自主定价' : '¥' + price}<small>${isC && price === 0 ? '' : '/' + escapeHtml(item.unit || '次')}</small></div>
          <div class="item-btns">
            <button type="button" class="detail-btn"
                    onclick="event.stopPropagation();openItemDetail('${item.code}')">详情</button>
            <button type="button" class="add-btn${q > 0 ? ' added' : ''}"
                    onclick="event.stopPropagation();addItem('${item.code}')">${q > 0 ? '已选 ' + q : '＋ 加入'}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // 命中非主字段时给一行提示，避免用户疑惑「为什么这条会被搜出来」
  if (kw && list.every(i => matchInfo(i, kwl).rank >= 2)) {
    const note = document.createElement('div');
    note.className = 'search-match-note';
    note.innerHTML = '以上结果命中的是项目的<b>服务产出 / 价格构成 / 除外内容 / 计价说明</b>，点「详情」可查看完整内容。';
    box.prepend(note);
  }
}

/* ---------------- 项目详情 ---------------- */

let currentItemCode = null;

/** 把不同版本的项目结构统一成详情展示模型 */
function itemDetailModel(item) {
  const lv = { tertiary: '三级', secondary: '二级', primary: '一级' }[state.institutionLevel];
  return {
    name: item.name,
    code: item.code,
    insuranceType: item.insuranceType,
    unit: item.unit || '次',
    isAddon: !!item.isAddon,
    isSelfPay: item.insuranceType === '自费',
    copayRate: item.copayRate,
    prices: item.priceLevel3 != null
      ? [
          { label: '三级', v: item.priceLevel3 },
          { label: '二级', v: item.priceLevel2 },
          { label: '一级', v: item.priceLevel1 }
        ]
      : [{ label: '指导价', v: item.defaultPrice }],
    activeLevel: lv,
    currentPrice: priceOf(item),
    isLegacy: item.priceLevel3 == null,
    output: item.output || item.description || '',
    composition: item.composition || '',
    exclusions: item.exclusions || '',
    billingNote: item.billingNote || '',
    restrictions: item.restrictions || '',
    aliases: item.aliases || '',
    regionalPrices: item.regionalPrices || null
  };
}

/** 详情弹层正文 */
function itemDetailHtml(d) {
  const priceRows = d.prices.map(p => `
    <div class="price-cell${p.label === d.activeLevel ? ' active' : ''}">
      <div class="pc-label">${escapeHtml(p.label)}${p.label === d.activeLevel ? '（本院）' : ''}</div>
      <div class="pc-value">${p.v == null ? '市场调节价' : '¥' + p.v}</div>
    </div>`).join('');

  const isSelf = d.insuranceType === '自费';
  const reimburseText = d.insuranceType === '甲类'
    ? '甲类：医保全额纳入统筹基数，无先行自付。'
    : d.insuranceType === '乙类'
      ? `乙类：先行自付 ${((d.copayRate ?? 0.1) * 100).toFixed(0)}%，剩余部分方计入统筹基数。`
      : '丙类（自费）：医保基金不予支付，由患者全额自付。';

  const block = (title, text, cls) =>
    text ? `<div class="det-block ${cls || ''}"><div class="det-h">${title}</div><div class="det-b">${escapeHtml(text)}</div></div>` : '';

  // 别名（口语叫法）：帮助医生确认「我要的是不是这个项目」
  const aliasBlock = d.aliases
    ? block('常用叫法', d.aliases.split(/\s+/).filter(Boolean).join('、'), 'det-alias')
    : '';

  // 各地指导价参考（仅影像类等有地区差异的项目提供）
  const regionBlock = d.regionalPrices && d.regionalPrices.length
    ? `<div class="det-block det-region">
         <div class="det-h">各地指导价参考 <span class="det-h-sub">（政府指导价，以当地医保局文件为准）</span></div>
         <table class="det-region-table">
           <thead><tr><th>城市</th><th>档位</th><th>价格（元）</th></tr></thead>
           <tbody>${d.regionalPrices.map(r =>
             `<tr><td>${escapeHtml(r.city)}</td><td>${escapeHtml(r.levels)}</td><td>${escapeHtml(r.value)}</td></tr>`
           ).join('')}</tbody>
         </table>
       </div>`
    : '';

  // restrictions 里含官方计价说明（列表 ⚠ 行要用），详情页已单列「计价说明」，
  // 此处只保留程序额外追加的风险提示，避免同一段文字出现两遍。
  let extraWarn = d.restrictions || '';
  if (d.billingNote && extraWarn.startsWith(d.billingNote)) {
    extraWarn = extraWarn.slice(d.billingNote.length).replace(/^[；;]\s*/, '').trim();
  }
  if (extraWarn === d.billingNote) extraWarn = '';

  return `
    <div class="det-top">
      <div class="det-name">${escapeHtml(d.name)}</div>
      <div class="det-tags">
        <span class="tag tag-${d.insuranceType}">${d.insuranceType}</span>
        ${d.isAddon ? '<span class="tag tag-addon">加收/分项</span>' : ''}
        <span class="det-unit">计价单位：${escapeHtml(d.unit)}</span>
      </div>
      <div class="det-code">${escapeHtml(d.code)}</div>
    </div>
    <div class="det-prices" style="grid-template-columns:repeat(${d.prices.length},1fr)">${priceRows}</div>
    <div class="det-insure">${escapeHtml(reimburseText)}</div>
    ${aliasBlock}
    ${block(d.isLegacy ? '项目说明' : '服务产出', d.output)}
    ${block('价格构成', d.composition, 'det-composition')}
    ${block('除外内容', d.exclusions, 'det-exclusions')}
    ${block('计价说明', d.billingNote, 'det-note')}
    ${block('风险与限制提示', extraWarn, 'det-warn')}
    ${regionBlock}`;
}

function renderItemSheetFoot() {
  const foot = $('itemSheetFoot');
  if (!foot || !currentItemCode) return;
  const q = countOf(currentItemCode);
  foot.innerHTML = `
    ${q > 0 ? `<button type="button" class="btn-ghost" style="flex:0 0 auto" onclick="sheetStep(-1)">− 减一</button>` : ''}
    <button type="button" class="btn-primary" style="flex:1" onclick="sheetStep(1)">
      ${q > 0 ? `已入选 ${q} ${escapeHtml(findItem(currentItemCode).unit || '次')}，再加一项` : '＋ 加入处方'}
    </button>`;
}

function openItemDetail(code) {
  const item = findItem(code);
  if (!item) return;
  currentItemCode = code;
  $('itemSheetTitle').textContent = item.name;
  $('itemSheetBody').innerHTML = itemDetailHtml(itemDetailModel(item));
  renderItemSheetFoot();
  openSheet('itemSheet');
}

function sheetStep(delta) {
  if (!currentItemCode) return;
  if (delta > 0) addItem(currentItemCode);
  else changeQty(currentItemCode, -1);
  renderItemSheetFoot();
}

/* ---------------- 处方 ---------------- */
function addItem(code) {
  const row = state.prescription.find(r => r.code === code);
  if (row) {
    if (row.quantity >= 99) { toast('单项数量已达上限'); return; }
    row.quantity += 1;
  } else {
    state.prescription.push({ code, quantity: 1 });
    const item = findItem(code);
    toast('已加入：' + (item ? item.name : code));
  }
  renderItemList();
  renderPrescription();
  refreshCalculation();
  saveState();
}

function changeQty(code, delta) {
  const idx = state.prescription.findIndex(r => r.code === code);
  if (idx < 0) return;
  const next = state.prescription[idx].quantity + delta;
  if (next <= 0) state.prescription.splice(idx, 1);
  else state.prescription[idx].quantity = Math.min(99, next);
  renderItemList();
  renderPrescription();
  refreshCalculation();
  saveState();
}

function removeItem(code) {
  state.prescription = state.prescription.filter(r => r.code !== code);
  renderItemList();
  renderPrescription();
  refreshCalculation();
  saveState();
}

function clearPrescription() {
  if (!state.prescription.length) { toast('清单已经是空的'); return; }
  state.prescription = [];
  renderItemList();
  renderPrescription();
  refreshCalculation();
  saveState();
  toast('已清空处方清单');
}

function renderPrescription() {
  const box = $('prescList');
  $('prescCount').textContent = state.prescription.length;

  if (!state.prescription.length) {
    box.innerHTML = '<div class="empty-hint">处方单为空<br>请在「项目库」点击任意项目卡片加入</div>';
    return;
  }

  box.innerHTML = state.prescription.map(row => {
    const item = findItem(row.code);
    if (!item) return '';
    const unitPrice = priceOf(item);
    const subtotal = unitPrice * row.quantity;
    const lvName = { tertiary: '三级', secondary: '二级', primary: '一级' }[state.institutionLevel];
    return `
      <div class="presc-card">
        <div class="presc-l1">
          <span class="presc-name">${escapeHtml(item.name)}</span>
          <span class="tag tag-${item.insuranceType}">${item.insuranceType}</span>
        </div>
        <div class="presc-l2">
          <span class="item-code">${escapeHtml(item.code)}</span>
          <span>¥${unitPrice} / ${escapeHtml(item.unit || '次')}${item.priceLevel3 != null ? `（${lvName}价）` : ''}</span>
        </div>
        <div class="presc-l3">
          <div class="qty-group">
            <button type="button" class="qty-btn" aria-label="减少" onclick="changeQty('${item.code}',-1)">−</button>
            <span class="qty-val">${row.quantity}</span>
            <button type="button" class="qty-btn" aria-label="增加" onclick="changeQty('${item.code}',1)">＋</button>
          </div>
          <span class="presc-sum">${yuan(subtotal)}</span>
          <button type="button" class="del-btn" aria-label="该项目的知情同意书" onclick="openConsentForItem('${item.code}')">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          </button>
          <button type="button" class="del-btn" aria-label="删除" onclick="removeItem('${item.code}')">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

/* ---------------- 税务 ---------------- */
function renderTaxPanel() {
  const mode = TAX_MODES.find(m => m.id === state.taxModeId) || TAX_MODES[0];
  $('taxPills').innerHTML = TAX_MODES.map(m => {
    const short = m.name.includes('：') ? m.name.split('：')[1] : m.name;
    return `<button type="button" class="tax-pill${m.id === state.taxModeId ? ' active' : ''}"
      onclick="switchTaxMode('${m.id}')">${escapeHtml(short)}</button>`;
  }).join('');
  $('taxModeDesc').textContent = mode.description;
  $('taxCategoryBadge').textContent = mode.category;
  if ($('taxModeNote')) $('taxModeNote').textContent = mode.note || '';
  fillTaxInputs();
}

function fillTaxInputs() {
  const s = state.taxSettings;
  $('taxVatInput').value = (s.vatRate * 100).toFixed(1);
  $('taxSurchargeInput').value = (s.surchargeRate * 100).toFixed(1);
  $('taxIncomeInput').value = (s.incomeTaxRate * 100).toFixed(1);
  $('taxCostInput').value = (s.costRate * 100).toFixed(0);
  if ($('taxShareInput')) $('taxShareInput').value = ((s.taxableShare || 0) * 100).toFixed(0);
}

function switchTaxMode(id) {
  const mode = TAX_MODES.find(m => m.id === id);
  if (!mode) return;
  state.taxModeId = mode.id;
  state.taxSettings = { ...mode.settings };
  renderTaxPanel();
  refreshCalculation();
  saveState();
}

/**
 * 用户手动改税务参数。
 * 注意：这里只切换高亮、不重填输入框，否则每敲一个字符都会重写 value，
 * 导致光标跳动、数字被吃掉（原实现即有该 bug）。
 */
function onTaxInput() {
  const clamp = (v, min, max, dflt) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  };
  state.taxSettings = {
    ...state.taxSettings,   // 保留 vatRate 之外的字段（如 description），避免每次输入都被抹掉
    vatRate: clamp($('taxVatInput').value, 0, 100, 0) / 100,
    surchargeRate: clamp($('taxSurchargeInput').value, 0, 100, 0) / 100,
    incomeTaxRate: clamp($('taxIncomeInput').value, 0, 100, 5) / 100,
    costRate: clamp($('taxCostInput').value, 0, 100, 65) / 100,
    taxableShare: clamp($('taxShareInput') ? $('taxShareInput').value : 0, 0, 100, 0) / 100
  };
  if (state.taxModeId !== 'custom_tax') {
    state.taxModeId = 'custom_tax';
    setTaxPillActive('custom_tax');
    $('taxModeDesc').textContent = '已进入自定义模式：参数由您手动设定。';
    $('taxCategoryBadge').textContent = '自定义';
  }
  refreshCalculation();
  saveState();
}

/** 仅切换 pill 高亮，绝不触碰输入框内容 */
function setTaxPillActive(id) {
  const pills = $('taxPills').querySelectorAll('.tax-pill');
  const idx = TAX_MODES.findIndex(m => m.id === id);
  pills.forEach((p, i) => p.classList.toggle('active', i === idx));
}

/* ============================================================
   报税与缴税助手
   ------------------------------------------------------------
   与「精算页」的税务面板分工：
     · 精算页 = 单笔处方的税负估算（医生开单时看毛利）
     · 本页   = 按申报期汇总的正式计算（财务报税用）
   进口径统一来自 src/engines/taxEngine.js，避免两套算法漂移。
   ============================================================ */

/** 当前申报期 key（未选时取当前月/季） */
function activePeriodKey() {
  const p = state.taxProfile;
  if (p.periodKey) return p.periodKey;
  return periodKeyOf(localDateStr(), p.periodType);
}

/** 可选申报期：最近若干期 + 台账里出现过的期，倒序 */
function taxPeriodOptions() {
  const p = state.taxProfile;
  const set = new Set();
  const now = new Date();
  const n = p.periodType === 'quarterly' ? 10 : 16;
  const step = p.periodType === 'quarterly' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i * step, 1);
    const k = periodKeyOf(localDateStr(d), p.periodType);
    if (k) set.add(k);
  }
  state.taxLedger.forEach((e) => {
    const k = periodKeyOf(e.date, p.periodType);
    if (k) set.add(k);
  });
  return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
}

/** 汇总当前申报期的台账 */
function currentPeriodLedger() {
  const p = state.taxProfile;
  const key = activePeriodKey();
  const empty = { medical: 0, consumable: 0, cosmetic: 0, cost: 0, total: 0, count: 0, entries: [] };
  if (!key) return empty;
  const entries = state.taxLedger
    .filter((e) => periodKeyOf(e.date, p.periodType) === key)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const sum = { ...empty, entries };
  entries.forEach((e) => {
    sum.medical += money(e.medical);
    sum.consumable += money(e.consumable);
    sum.cosmetic += money(e.cosmetic);
    sum.cost += money(e.cost);
    sum.count += 1;
  });
  ['medical', 'consumable', 'cosmetic', 'cost'].forEach((k) => { sum[k] = money(sum[k]); });
  // 实收合计：结论卡与结算预览都要用，别让调用方各自拼
  sum.total = money(sum.medical + sum.consumable + sum.cosmetic);
  return sum;
}

/** 组装引擎入参 */
function taxAssistantParams() {
  const p = state.taxProfile;
  const sum = currentPeriodLedger();
  return {
    entityId: p.entityId,
    periodType: p.periodType,
    cityType: p.cityType,
    revenue: { medical: sum.medical, consumable: sum.consumable, cosmetic: sum.cosmetic },
    costTotal: sum.cost,
    inputVat: p.inputVat,
    inputTransfer: p.inputTransfer,
    separated: p.separated,
    specialInvoiceOnExempt: p.specialInvoiceOnExempt,
    overGuidePrice: p.overGuidePrice
  };
}

/** 只在用户没有聚焦时回写 value，避免打字时光标跳动 */
function setInputIfIdle(el, v) {
  if (!el) return;
  if (document.activeElement === el) return;
  el.value = v;
}

function renderTaxAssistant() {
  if (!$('entityPills')) return;
  const p = state.taxProfile;

  /* --- 身份 --- */
  $('entityPills').innerHTML = TAX_POLICY.entityTypes.map((e) => `
    <button type="button" class="tax-pill${e.id === p.entityId ? ' active' : ''}"
      onclick="setTaxEntity('${e.id}')">${escapeHtml(e.short)}</button>`).join('');
  const ent = entityById(p.entityId);
  // 医生通常不知道自己是哪类纳税人 —— 直接告诉他「不确定就保持默认」
  $('entityDesc').textContent = ent.description
    + '　不确定自己属于哪一类？绝大多数口腔门诊是小规模纳税人，保持第一项即可。';

  /* --- 申报期 --- */
  document.querySelectorAll('#txPeriodTypeSeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.pt === p.periodType);
  });
  const opts = taxPeriodOptions();
  const cur = activePeriodKey();
  $('txPeriodSelect').innerHTML = opts.map((k) =>
    `<option value="${k}"${k === cur ? ' selected' : ''}>${escapeHtml(periodLabel(k, p.periodType))}</option>`
  ).join('');
  document.querySelectorAll('#txCitySeg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.ct === p.cityType);
  });

  /* --- 合规开关 --- */
  $('txSeparated').checked = p.separated;
  $('txSpecialInvoice').checked = p.specialInvoiceOnExempt;
  $('txOverGuide').checked = p.overGuidePrice;
  $('txGeneralInputs').hidden = ent.vatType !== 'general';
  setInputIfIdle($('txInputVat'), p.inputVat ? String(p.inputVat) : '');
  setInputIfIdle($('txInputTransfer'), p.inputTransfer ? String(p.inputTransfer) : '');

  /* --- 台账列表 --- */
  const sum = currentPeriodLedger();
  $('ledgerList').innerHTML = sum.entries.length
    ? sum.entries.map((e) => `
      <div class="ledger-item">
        <div class="ledger-date">${escapeHtml(e.date)}</div>
        <div class="ledger-amts">
          <span class="lg-tag lg-exempt">免税 ${yuan(e.medical)}</span>
          <span class="lg-tag lg-taxable">应税 ${yuan(e.consumable + e.cosmetic)}</span>
          <span class="lg-tag lg-cost">成本 ${yuan(e.cost)}</span>
        </div>
        <button type="button" class="ledger-del" aria-label="删除该条台账"
          onclick="deleteLedgerEntry('${e.id}')">×</button>
      </div>`).join('')
    : `<div class="empty-hint">本期暂无台账记录。可手动录入，或用「按当前处方预填」快速带出。</div>`;

  /* --- 计算结果 --- */
  const result = computePeriodTax(taxAssistantParams());
  window.__lastTaxResult = result;   // 导出底稿时复用，避免重复计算口径不一致
  paintTaxResult(result, sum);

  /* --- 申报底稿 --- */
  const sheet = buildVatFilingSheet(result);
  $('filingFormName').textContent = sheet.formName;
  $('filingRows').innerHTML = sheet.rows.map((r) => `
    <div class="filing-row${r.strong ? ' strong' : ''}${r.dim ? ' dim' : ''}">
      <div class="fr-no">${escapeHtml(r.no)}</div>
      <div class="fr-name">${escapeHtml(r.name)}${r.note ? `<span class="fr-note">${escapeHtml(r.note)}</span>` : ''}</div>
      <div class="fr-val">${yuan(r.value)}</div>
    </div>`).join('');
  $('filingWarning').textContent = sheet.warning || '';

  /* --- 风险 --- */
  const risks = taxRiskChecks(result);
  $('taxRiskList').innerHTML = risks.length
    ? risks.map((r) => `
      <div class="tax-risk lv-${r.level.toLowerCase()}">
        <div class="tr-head"><span class="tr-level">${r.level}</span>${escapeHtml(r.title)}</div>
        <div class="tr-detail">${escapeHtml(r.detail)}</div>
        <div class="tr-fix"><b>怎么办：</b>${escapeHtml(r.fix)}</div>
      </div>`).join('')
    : `<div class="empty-hint">当前配置未命中已知税务风险项。请仍按「分别核算 + 按指导价收费」执行。</div>`;

  /* --- 日历 --- */
  const year = Number((cur || '').slice(0, 4)) || new Date().getFullYear();
  const cal = filingCalendar(year, p.periodType, ent.incomeTaxType);
  const nextDue = cal.filter((c) => !c.annual).slice().sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const upcoming = nextDue.find((c) => c.dueDate >= localDateStr()) || nextDue[nextDue.length - 1];
  /* --- 自动结论卡（医生只看这一张） --- */
  renderTaxConclusion(result, sum);

  $('filingCal').innerHTML = `
    <div class="cal-next">
      <div class="cal-next-label">最近一期申报截止</div>
      <div class="cal-next-date">${upcoming ? escapeHtml(upcoming.dueDate) : '—'}</div>
      <div class="cal-next-sub">${upcoming ? escapeHtml(upcoming.periodLabel) + ' · ' + escapeHtml(upcoming.items.join(' / ')) : ''}</div>
    </div>
    ${cal.map((c) => `
      <div class="cal-row${c.annual ? ' annual' : ''}">
        <div class="cal-period">${escapeHtml(c.periodLabel)}</div>
        <div class="cal-due">${escapeHtml(c.dueDate)}</div>
        <div class="cal-items">${escapeHtml(c.items.join(' · '))}</div>
      </div>`).join('')}
    <div class="tp-hint">遇周末已自动顺延至下一工作日；法定节假日以税务机关公告为准。</div>`;

  $('taxPolicyNote').textContent = `政策口径 ${TAX_POLICY.version}`;
}

/**
 * 自动结论卡。
 * 医生的真实需求不是「看懂申报表」，而是「这期交多少、什么时候交、会不会漏」。
 * 所以这一段只讲三件事，申报表放在后面给财务用。
 */
function renderTaxConclusion(r, sum) {
  const box = $('txConclusion');
  if (!box) return;

  if (!sum || sum.count === 0) {
    box.className = 'tx-conclusion is-empty';
    box.innerHTML = `
      <div class="tc-label">本期还没有入账</div>
      <div class="tc-advice">开完单点底部「结算」，会自动记入台账，税费也随之算好。
        不需要你填任何税表，也不用记税率。</div>`;
    return;
  }

  const today = localDateStr();
  // 用「本期自己的截止日」，不是「最近一个未来截止日」—— 后者在跨期时会答错
  const due = periodDueDate(activePeriodKey(), state.taxProfile.periodType);
  const days = due
    ? Math.round((new Date(due + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
    : null;

  let dueText = '';
  if (due) {
    if (days === null) dueText = `申报截止 ${due}`;
    else if (days > 0) dueText = `申报截止 ${due} · 还剩 ${days} 天`;
    else if (days === 0) dueText = `申报截止 ${due} · 就是今天`;
    else dueText = `申报截止 ${due} · 已逾期 ${-days} 天`;
  }

  let advice;
  if (r.totals.totalTax <= 0.005) {
    advice = '本期不用交税。但即使不用交，也要在截止日前做零申报，否则会留下逾期记录。';
  } else if (r.vat.kind === 'smallScale' && r.vat.belowThreshold) {
    advice = `本期应税销售额 ${yuan(r.vat.taxableNet)} 未达起征点，增值税与附加都不用交；`
      + '所得税仍需按期申报。';
  } else {
    advice = `本期应缴 ${yuan(r.totals.totalTax)}，${due ? '请在 ' + due + ' 前' : '请按期'}完成申报并缴款。`;
  }

  const cls = ['tx-conclusion'];
  if (days !== null && days < 0) cls.push('is-overdue');
  else if (days !== null && days <= 7) cls.push('is-urgent');
  box.className = cls.join(' ');

  box.innerHTML = `
    <div class="tc-top">
      <div class="tc-main">
        <div class="tc-label">${escapeHtml(periodLabel(activePeriodKey(), state.taxProfile.periodType))} 预计应缴税费</div>
        <div class="tc-amount">${yuan(r.totals.totalTax)}</div>
        <div class="tc-sub">增值税 ${yuan(r.vat.payable)} · 附加 ${yuan(r.surcharge.total)} · ${r.income.type === 'cit' ? '企业所得税' : '个人所得税'} ${yuan(r.income.tax)}</div>
      </div>
      <div class="tc-badge">${r.totals.burdenRate}<span>% 税负率</span></div>
    </div>
    <div class="tc-meta">${escapeHtml(dueText)}</div>
    <div class="tc-meta">台账 ${sum.count} 笔 · 实收 ${yuan(sum.total)} · 免税占比 ${r.revenue.exemptShare}%</div>
    <div class="tc-advice">${escapeHtml(advice)}</div>`;
}

function paintTaxResult(r, sum) {
  const grid = $('txResultGrid');
  const vatLabel = r.vat.kind === 'general' ? '应缴增值税（销项-进项）'
    : (r.vat.belowThreshold ? '应缴增值税（未达起征点免征）' : '应缴增值税（减按 1%）');

  grid.innerHTML = `
    <div class="metric">
      <div class="metric-label">${vatLabel}</div>
      <div class="metric-value">${yuan(r.vat.payable)}</div>
      <div class="metric-sub">${r.vat.kind === 'general'
        ? `销项 ${yuan(r.vat.outputVat)} − 抵扣 ${yuan(r.vat.deductibleInput)}`
        : `应税不含税 ${yuan(r.vat.taxableNet)}`}</div>
    </div>
    <div class="metric">
      <div class="metric-label">附加税费</div>
      <div class="metric-value">${yuan(r.surcharge.total)}</div>
      <div class="metric-sub">${r.surcharge.halved ? '六税两费减半' : '未减半'} · 城建 ${(r.surcharge.ucRate * 100).toFixed(0)}%</div>
    </div>
    <div class="metric">
      <div class="metric-label">${r.income.type === 'cit' ? '企业所得税' : '个人所得税（经营所得）'}</div>
      <div class="metric-value">${yuan(r.income.tax)}</div>
      <div class="metric-sub">应纳税所得额 ${yuan(r.income.taxableIncome)}</div>
    </div>
    <div class="metric metric-full m-profit">
      <div class="metric-label">本期税费合计 / 综合税负率</div>
      <div class="metric-value v-profit">${yuan(r.totals.totalTax)}</div>
      <div class="metric-sub">税负率 ${r.totals.burdenRate}% · 免税占比 ${r.revenue.exemptShare}% · 台账 ${sum.count} 条</div>
    </div>`;

  const badge = r.vat.belowThreshold
    ? `未达起征点（还差 ${yuan(r.vat.thresholdGap)} 到 ${yuan(r.vat.threshold)}）`
    : (r.vat.kind === 'general' ? '一般纳税人计税' : '已达起征点，按 1% 计征');
  const strip = document.createElement('div');
  strip.className = 'tx-split-strip';
  strip.innerHTML = `
    <div class="row">免税医疗服务 <b>${yuan(r.revenue.medical)}</b> · 应税收入 <b>${yuan(r.revenue.consumable + r.revenue.cosmetic)}</b></div>
    <div class="row">${escapeHtml(badge)}</div>
    <div class="row">${r.income.note ? escapeHtml(r.income.note) : ''}</div>`;
  grid.insertAdjacentElement('afterend', strip);
  const old = document.querySelectorAll('.tx-split-strip');
  if (old.length > 1) old[0].remove();
}

/* --- 交互 --- */

function setTaxEntity(id) {
  const e = entityById(id);
  state.taxProfile.entityId = e.id;
  renderTaxAssistant();
  saveState();
}

function setTaxPeriodType(pt) {
  if (pt !== 'monthly' && pt !== 'quarterly') return;
  state.taxProfile.periodType = pt;
  state.taxProfile.periodKey = '';           // 换周期口径后旧 key 失效，回到当期
  renderTaxAssistant();
  saveState();
}

function setTaxCityType(ct) {
  state.taxProfile.cityType = ct;
  renderTaxAssistant();
  saveState();
}

function onTaxPeriodChange() {
  state.taxProfile.periodKey = $('txPeriodSelect').value || '';
  renderTaxAssistant();
  saveState();
}

function onTaxFlagChange() {
  const p = state.taxProfile;
  p.separated = $('txSeparated').checked;
  p.specialInvoiceOnExempt = $('txSpecialInvoice').checked;
  p.overGuidePrice = $('txOverGuide').checked;
  p.inputVat = money($('txInputVat') ? $('txInputVat').value : 0);
  p.inputTransfer = money($('txInputTransfer') ? $('txInputTransfer').value : 0);
  renderTaxAssistant();
  saveState();
}

/** 台账草稿改动 —— 只更新按钮可用状态，不重渲染（否则光标跳） */
function onLedgerDraftChange() {
  const has = ['txMedical', 'txConsumable', 'txCosmetic', 'txCost']
    .some((id) => money($(id) && $(id).value) > 0);
  const btn = document.querySelector('.tx-form-actions .btn-primary');
  if (btn) btn.disabled = !has && !$('txDate').value;
}

function addLedgerEntry() {
  const date = $('txDate').value || localDateStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    toast('请先选择台账日期');
    return;
  }
  const entry = {
    id: uid(),
    date,
    medical: money($('txMedical').value),
    consumable: money($('txConsumable').value),
    cosmetic: money($('txCosmetic').value),
    cost: money($('txCost').value)
  };
  if (entry.medical + entry.consumable + entry.cosmetic + entry.cost === 0) {
    toast('请至少填写一个金额');
    return;
  }
  state.taxLedger.push(entry);
  if (state.taxLedger.length > 2000) state.taxLedger = state.taxLedger.slice(-2000);

  // 记到哪一期就跟到哪一期，避免用户记完看不到
  state.taxProfile.periodKey = periodKeyOf(date, state.taxProfile.periodType);

  ['txMedical', 'txConsumable', 'txCosmetic', 'txCost'].forEach((id) => { $(id).value = ''; });
  renderTaxAssistant();
  saveState();
  toast(`已记入台账：${date}`);
}

function deleteLedgerEntry(id) {
  const i = state.taxLedger.findIndex((e) => e.id === id);
  if (i < 0) return;
  state.taxLedger.splice(i, 1);
  renderTaxAssistant();
  saveState();
  toast('已删除该条台账');
}

/**
 * 按当前处方预填台账表单。
 * 口径：医保结算款 + 政策内自付 = 医疗服务（免税）；
 *       丙类完全自费默认归为应税耗材，可手动改到「医疗服务」。
 */
function prefillLedgerFromPrescription() {
  const c = lastCalc();
  if (!c || !c.itemBreakdown || c.itemBreakdown.length === 0) {
    toast('当前没有可预填的处方');
    return;
  }
  const b = c.insuranceBreakdown;
  const s = c.summary;
  const taxable = money(b.classCTotal);
  $('txDate').value = localDateStr();
  $('txMedical').value = money(s.clinicTotalRevenue - taxable).toFixed(2);
  $('txConsumable').value = taxable.toFixed(2);
  $('txCosmetic').value = '0.00';
  $('txCost').value = money(s.clinicTotalRevenue * (state.taxSettings.costRate || 0)).toFixed(2);
  onLedgerDraftChange();
  toast('已按当前处方预填，请核对后记入台账');
}

/* --- 导出底稿 --- */

function exportFilingSheet() {
  const r = window.__lastTaxResult || computePeriodTax(taxAssistantParams());
  const sheet = buildVatFilingSheet(r);
  const sum = currentPeriodLedger();
  const p = state.taxProfile;
  const periodText = periodLabel(activePeriodKey(), p.periodType);

  const L = [];
  L.push(`${APP_INFO.name} · 报税底稿`);
  L.push(`申报期：${periodText}（${p.periodType === 'monthly' ? '按月' : '按季'}申报）`);
  L.push(`纳税人身份：${r.entity.name}`);
  L.push(`政策口径：${TAX_POLICY.version} · ${TAX_POLICY.effectiveNote}`);
  L.push('');
  L.push('【收入构成（含税）】');
  L.push(`  医疗服务（免税）：${yuan(r.revenue.medical)}`);
  L.push(`  耗材商品（应税）：${yuan(r.revenue.consumable)}`);
  L.push(`  非医疗美容（应税）：${yuan(r.revenue.cosmetic)}`);
  L.push(`  合计：${yuan(r.revenue.total)}　免税占比 ${r.revenue.exemptShare}%`);
  L.push(`  台账条数：${sum.count}`);
  L.push('');
  L.push('【税额】');
  L.push(`  增值税：${yuan(r.vat.payable)}`);
  L.push(`  附加税费：${yuan(r.surcharge.total)}`);
  L.push(`  ${r.income.type === 'cit' ? '企业所得税' : '个人所得税（经营所得）'}：${yuan(r.income.tax)}`);
  L.push(`  合计：${yuan(r.totals.totalTax)}　税负率 ${r.totals.burdenRate}%`);
  L.push('');
  L.push(`【${sheet.formName}】`);
  sheet.rows.forEach((row) => {
    L.push(`  第 ${row.no} 栏  ${row.name}：${yuan(row.value)}`);
  });
  if (sheet.warning) {
    L.push('');
    L.push(`  提示：${sheet.warning}`);
  }
  L.push('');
  L.push('【税务风险自检】');
  const risks = taxRiskChecks(r);
  if (risks.length === 0) {
    L.push('  未命中已知风险项。');
  } else {
    risks.forEach((k, i) => {
      L.push(`  ${i + 1}. [${k.level}] ${k.title}`);
      L.push(`     ${k.detail}`);
      L.push(`     处理：${k.fix}`);
    });
  }
  L.push('');
  L.push('————————');
  L.push(APP_INFO.disclaimers[0] || '本底稿仅供报税准备参考，不构成税务鉴证意见。');
  L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);

  const stamp = localDateStr().replace(/-/g, '');
  downloadFile(L.join('\n'), `${APP_INFO.name}报税底稿_${stamp}.txt`, 'text/plain;charset=utf-8');
}

/* ============================================================
   结算并入账
   ------------------------------------------------------------
   设计前提：口腔医生不懂税务。所以「记账」这件事不能靠医生手工填。
   做法：点「结算」→ 金额与成本全部自动带出 → 医生只点一次确认。
   默认把整单记为医疗服务（免税），只有当本单另售材料时才拆出应税部分。
   ============================================================ */

/**
 * 高耗材相关项目名特征。
 * ⚠️ 只认「材料实体」名词，不要用「种植」「修复」这种宽词 ——
 *    否则「龈上洁治费·种植牙洁治（加收）」这类服务项目会被误判成含材料销售，
 *    反而诱导医生把医疗服务拆成应税收入。
 * 仅用于提醒，不自动判定。
 */
const HIGH_MATERIAL_RE = /(种植体|基台|牙冠|全冠|嵌体|高嵌体|义齿|保持器|矫治器|贴面|桥体|骨粉|骨膜|导板)/;

let settleCtx = null;   // { revenue, fund, patient, count }

function openSettle() {
  const c = lastCalc();
  if (!c || !Array.isArray(c.itemBreakdown) || c.itemBreakdown.length === 0) {
    toast('还没有开单项目，先选项目再结算');
    return;
  }
  const s = c.summary;
  if (!(s.clinicTotalRevenue > 0)) {
    toast('本单金额为 0，无需结算');
    return;
  }

  settleCtx = {
    revenue: money(s.clinicTotalRevenue),
    fund: money(s.fundPayAmount),
    patient: money(s.patientTotalPay),
    count: c.itemBreakdown.length
  };

  $('stFund').textContent = yuan(settleCtx.fund);
  $('stPatient').textContent = yuan(settleCtx.patient);
  $('stRevenue').textContent = yuan(settleCtx.revenue);
  $('stItems').textContent = settleCtx.count + ' 项';
  $('stDate').value = localDateStr();

  // 材料销售默认不勾（医疗服务免税是常态），成本按成本率自动估
  $('stMaterial').checked = false;
  $('stTaxableWrap').hidden = true;
  $('stTaxable').value = '';
  $('stCost').value = money(settleCtx.revenue * (state.taxSettings.costRate || 0.65)).toFixed(2);

  // 含种植/修复类项目时主动提醒，但不替医生做判断
  const hitNames = c.itemBreakdown
    .filter((it) => HIGH_MATERIAL_RE.test(it.name || ''))
    .map((it) => it.name)
    .slice(0, 2);
  $('stMaterialHint').textContent = hitNames.length
    ? `本单含「${hitNames.join('、')}」${c.itemBreakdown.length > hitNames.length ? ' 等项目' : ''}，若材料是单独计价售卖的请勾选`
    : '材料销售属于应税收入，需与医疗服务分开记账';

  updateSettlePreview();
  openSheet('settleSheet');
}

function onSettleMaterialChange() {
  const on = $('stMaterial').checked;
  $('stTaxableWrap').hidden = !on;
  if (on && !$('stTaxable').value) $('stTaxable').focus();
  updateSettlePreview();
}

/** 实时刷新拆分预览与「本期已累计」提示 */
function updateSettlePreview() {
  if (!settleCtx) return;
  const rev = settleCtx.revenue;
  // 材料金额不能超过本单实收（超出视为录入错误，直接夹住）
  let taxable = $('stMaterial').checked ? money($('stTaxable').value) : 0;
  if (taxable > rev) {
    taxable = rev;
    $('stTaxable').value = rev.toFixed(2);
  }
  const exempt = money(rev - taxable);

  $('stExempt').textContent = yuan(exempt);
  $('stTax').textContent = yuan(taxable);

  const date = $('stDate').value || localDateStr();
  const key = periodKeyOf(date, state.taxProfile.periodType);
  const sum = summarizeLedger(state.taxLedger, state.taxProfile.periodType)
    .find((r) => r.periodKey === key);

  const parts = [`将记入 ${periodLabel(key, state.taxProfile.periodType)}`];
  parts.push(sum ? `本期已累计 ${sum.count} 笔 · 实收 ${yuan(sum.total)}` : '本期尚无记录');
  $('stPeriodHint').textContent = parts.join(' · ');
}

function onSettleAmountChange() {
  updateSettlePreview();
}

function confirmSettle() {
  if (!settleCtx) return;
  const date = $('stDate').value || localDateStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    toast('请先选择结算日期');
    return;
  }
  const rev = settleCtx.revenue;
  const taxable = $('stMaterial').checked ? Math.min(money($('stTaxable').value), rev) : 0;
  const exempt = money(rev - taxable);
  const cost = money($('stCost').value);

  if (exempt + taxable <= 0) {
    toast('本单金额为 0，无法入账');
    return;
  }

  state.taxLedger.push({
    id: uid(),
    date,
    medical: exempt,
    consumable: taxable,
    cosmetic: 0,
    cost,
    source: 'settle',
    items: settleCtx.count
  });
  if (state.taxLedger.length > 2000) state.taxLedger = state.taxLedger.slice(-2000);

  // 记到哪一期就切到哪一期，避免医生记完在报税页看不到
  state.taxProfile.periodKey = periodKeyOf(date, state.taxProfile.periodType);

  // 结算即清空处方，直接接诊下一位
  state.prescription = [];
  settleCtx = null;
  closeSheet('settleSheet');
  renderItemList();
  renderPrescription();
  refreshCalculation();
  renderTaxAssistant();
  saveState();

  // 给一句人话结论，而不是抛一堆数字
  const periodKey = state.taxProfile.periodKey;
  const agg = summarizeLedger(state.taxLedger, state.taxProfile.periodType)
    .find((r) => r.periodKey === periodKey);
  const r = computePeriodTax({
    ...taxAssistantParams(),
    revenue: {
      medical: agg ? agg.medical : 0,
      consumable: agg ? agg.consumable : 0,
      cosmetic: agg ? agg.cosmetic : 0
    },
    costTotal: agg ? agg.cost : 0
  });
  const due = periodDueDate(periodKey, state.taxProfile.periodType);
  toast(`已入账 · 本期累计税费 ${yuan(r.totals.totalTax)}${due ? `，${due} 前申报` : ''}`);
}

/* ============================================================
   知情同意书
   ============================================================ */

/** 处方条目 → 文书用的项目明细 */
function consentItemList() {
  return buildSelectedItems().map(e => ({
    code: e.item.code,
    name: e.item.name,
    quantity: e.quantity,
    unit: e.item.unit || '次'
  }));
}

/** 当前处方自动匹配到的同意书 */
function matchedConsents() {
  return matchConsents({ selectedItems: buildSelectedItems() });
}

/**
 * 自动输出：处方一变，把匹配到的知情同意书同步进「已选清单」。
 * - 用户手动移除过的（consentDismissed）不自动加回；该项目离开处方后标记自动失效。
 * - 用户从文书库手动加入的条目原样保留。
 */
function syncAutoConsents() {
  const autoIds = matchedConsents().matched.map(m => m.template.id);

  // 项目已经不在处方里了 → 之前的「不再需要」标记失效，下次再开单会重新自动带上
  state.consentDismissed = state.consentDismissed.filter(id => autoIds.includes(id));

  const prevAuto = new Set(state.consentAuto);
  const manual = state.consentSel.filter(id => !prevAuto.has(id));
  const keptAuto = state.consentSel.filter(id =>
    prevAuto.has(id) && autoIds.includes(id) && !state.consentDismissed.includes(id));
  const toAdd = autoIds.filter(id =>
    !state.consentDismissed.includes(id) && !keptAuto.includes(id));

  state.consentAuto = [...new Set([...keptAuto, ...toAdd])];
  state.consentSel = [...new Set([...state.consentAuto, ...manual])];
}

/* ---------------- 患者/机构信息（知情同意书 与 病历 共用同一份数据） ---------------- */

/** 单个字段的输入控件 HTML（prefix 区分两处渲染，数据同源） */
function patientFieldHtml(f, prefix) {
  const v = state.consentPatient[f.key] || '';
  if (f.type === 'select') {
    return `
      <div class="field">
        <label class="field-label" for="${prefix}${f.key}">${escapeHtml(f.label)}</label>
        <select class="input" id="${prefix}${f.key}" onchange="onPatientFieldInput('${prefix}')">
          ${(f.options || []).map(o =>
            `<option value="${escapeHtml(o)}"${o === v ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>`;
  }
  return `
    <div class="field">
      <label class="field-label" for="${prefix}${f.key}">${escapeHtml(f.label)}</label>
      <input class="input" type="text" id="${prefix}${f.key}" value="${escapeHtml(v)}"
             placeholder="${escapeHtml(f.placeholder || '')}" oninput="onPatientFieldInput('${prefix}')">
    </div>`;
}

function renderPatientFieldsInto(boxId, prefix) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = CONSENT_PATIENT_FIELDS.map(f => patientFieldHtml(f, prefix)).join('');
}

/** 一处修改 → 另一处同步（只改 value，不重渲染，避免光标跳动） */
function syncPatientValues(fromPrefix) {
  ['cp_', 'rp_'].forEach(p => {
    if (p === fromPrefix) return;
    CONSENT_PATIENT_FIELDS.forEach(f => {
      const el = $(p + f.key);
      if (el) el.value = state.consentPatient[f.key] || '';
    });
  });
}

/** 从某一处的 DOM 读回 state */
function onPatientFieldInput(prefix) {
  CONSENT_PATIENT_FIELDS.forEach(f => {
    const el = $(prefix + f.key);
    if (el) state.consentPatient[f.key] = el.value;
  });
  syncPatientValues(prefix);
  saveState(); // 不重渲染表单，避免每敲一字就重写 value
}

/** 知情同意书页的抬头信息表单（只渲染一次，输入过程中绝不回写） */
function renderConsentPatientFields() {
  renderPatientFieldsInto('consentPatientFields', 'cp_');
}

/** 单张同意书卡片 */
function consentCardHtml(t, matchedNames) {
  const added = state.consentSel.includes(t.id);
  const sections = (t.sections || []).length;
  return `
    <div class="consent-card lv-${escapeHtml(t.level)}${added ? ' added' : ''}" role="button" tabindex="0"
         onclick="toggleConsent('${t.id}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleConsent('${t.id}');}">
      <div class="consent-card-top">
        <span class="consent-card-title">${escapeHtml(t.title)}</span>
        <span class="ltag ltag-${escapeHtml(t.level)}">${escapeHtml(t.level)}</span>
      </div>
      <div class="consent-card-meta">
        <span>${escapeHtml(t.category)}</span>
        <span>${sections} 个告知章节</span>
        <span>${added ? '✓ 已加入文书清单' : '点击加入'}</span>
      </div>
      ${matchedNames && matchedNames.length
        ? `<div class="consent-card-items">关联项目：${matchedNames.map(escapeHtml).join('、')}</div>` : ''}
      <div class="consent-card-actions">
        <button type="button" class="link-btn"
                onclick="event.stopPropagation();previewConsent('${t.id}')">预览全文</button>
        <button type="button" class="link-btn"
                onclick="event.stopPropagation();printConsent('${t.id}')">打印本份</button>
      </div>
    </div>`;
}

function renderConsentPanel() {
  if (!$('autoConsentList')) return;

  /* --- 自动匹配区（同时把匹配结果同步进已选清单 = 「自动输出」） --- */
  syncAutoConsents();
  const { matched, unmatched } = matchedConsents();
  const autoBox = $('autoConsentList');
  const dismissedN = state.consentDismissed.length;
  if (!matched.length) {
    $('autoConsentSummary').innerHTML = '当前处方尚未匹配到专属知情同意书，可在下方文书库手动检索添加。';
    autoBox.innerHTML = '';
  } else {
    $('autoConsentSummary').innerHTML =
      `已根据当前处方<b>自动生成并加入 ${matched.length} 份</b>知情同意书，可直接打印或导出` +
      (dismissedN ? `（其中 ${dismissedN} 份被您移出，可点右侧按钮重新纳入）` : '') +
      (unmatched.length ? `<br>另有 ${unmatched.length} 个项目无专属文书，建议附通用告知书` : '');
    autoBox.innerHTML = matched
      .map(m => consentCardHtml(m.template, m.items.map(i => i.name)))
      .join('');
  }

  /* --- 文书库（手动检索） --- */
  const kw = state.consentKeyword;
  const lib = searchConsents(kw);
  $('consentResultBar').hidden = !kw;
  if (kw) $('consentResultText').textContent = `「${kw}」命中 ${lib.length} 份知情同意书`;
  $('consentLibrary').innerHTML = lib.length
    ? lib.map(t => consentCardHtml(t, [])).join('')
    : `<div class="empty-hint">没有匹配「${escapeHtml(kw)}」的知情同意书<br>试试更短的关键词，如 根管 / 拔牙 / 种植</div>`;

  /* --- 已选清单 --- */
  const sel = state.consentSel
    .map(id => CONSENT_TEMPLATES.find(t => t.id === id))
    .filter(Boolean);
  $('consentCount').textContent = sel.length ? `已选 ${sel.length} 份` : `${CONSENT_TEMPLATES.length} 份可选用`;
  $('consentSelCount').textContent = sel.length;

  const selBox = $('consentSelList');
  selBox.innerHTML = sel.length ? sel.map(t => `
    <div class="consent-card lv-${escapeHtml(t.level)} added">
      <div class="consent-card-top">
        <span class="consent-card-title">${escapeHtml(t.title)}</span>
        <span class="ltag ltag-${escapeHtml(t.level)}">${escapeHtml(t.level)}</span>
      </div>
      <div class="consent-card-meta">
        ${state.consentAuto.includes(t.id) ? '<span>处方自动匹配</span>' : '<span>手动加入</span>'}
      </div>
      <div class="consent-card-actions">
        <button type="button" class="link-btn" onclick="previewConsent('${t.id}')">预览</button>
        <button type="button" class="link-btn" onclick="printConsent('${t.id}')">打印</button>
        <button type="button" class="link-btn" onclick="removeConsent('${t.id}')">移除</button>
      </div>
    </div>`).join('')
    : '<div class="empty-hint">尚未加入任何文书<br>处方加入项目后会自动生成，或从上方文书库手动检索加入</div>';

  const badge = $('consentTabBadge');
  if (badge) {
    if (sel.length) { badge.hidden = false; badge.textContent = sel.length; }
    else badge.hidden = true;
  }
}

function onConsentSearchInput() {
  state.consentKeyword = $('consentSearchInput').value.trim();
  renderConsentPanel();
}

/**
 * 文书检索框聚焦行为：与项目库检索一致 —— 收起抬头面板并把检索区顶到粘性顶栏下，
 * 否则检索结果会落在屏幕外，手机键盘弹出时尤其明显。
 */
function onConsentSearchFocus() {
  const toggle = document.querySelector('.collapse-toggle[data-target="consentPatient"]');
  if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
    toggle.setAttribute('aria-expanded', 'false');
    const body = toggle.nextElementSibling;
    if (body) body.classList.remove('open');
  }
  revealElement($('consentSearchInput').closest('.search-wrap'));
}

function clearConsentSearch() {
  state.consentKeyword = '';
  $('consentSearchInput').value = '';
  renderConsentPanel();
}

function toggleConsent(id) {
  if (!CONSENT_TEMPLATES.some(t => t.id === id)) return;
  const idx = state.consentSel.indexOf(id);
  if (idx >= 0) {
    state.consentSel.splice(idx, 1);
    state.consentAuto = state.consentAuto.filter(x => x !== id);
    // 处方仍相关的条目，记下「不再需要」，避免下次重算又被自动加回
    const stillRelated = matchedConsents().matched.some(m => m.template.id === id);
    if (stillRelated) state.consentDismissed = [...new Set([...state.consentDismissed, id])];
    toast('已移出文书清单');
  } else {
    state.consentSel.push(id);
    state.consentDismissed = state.consentDismissed.filter(x => x !== id);
    const t = CONSENT_TEMPLATES.find(x => x.id === id);
    toast('已加入：' + (t ? t.title : id));
  }
  renderConsentPanel();
  saveState();
}

function removeConsent(id) { toggleConsent(id); }

/** 把当前处方匹配到的文书全部（重新）纳入清单 */
function addAllMatchedConsents() {
  const { matched } = matchedConsents();
  if (!matched.length) { toast('当前处方未匹配到专属同意书'); return; }
  const ids = matched.map(m => m.template.id);
  const added = ids.filter(id => !state.consentSel.includes(id)).length;
  state.consentDismissed = state.consentDismissed.filter(id => !ids.includes(id));
  state.consentAuto = [...new Set([...state.consentAuto, ...ids])];
  state.consentSel = [...new Set([...state.consentSel, ...ids])];
  renderConsentPanel();
  saveState();
  toast(added ? `已纳入 ${added} 份知情同意书` : '匹配到的文书均已在清单中');
}

function clearConsents() {
  if (!state.consentSel.length) { toast('文书清单已经是空的'); return; }
  state.consentDismissed = [...new Set([...state.consentDismissed, ...state.consentAuto])];
  state.consentSel = [];
  state.consentAuto = [];
  renderConsentPanel();
  saveState();
  toast('已清空文书清单');
}

/** 从处方卡片直达：把该项目的同意书加入清单并跳到文书页 */
function openConsentForItem(code) {
  const item = findItem(code);
  if (!item) return;
  const { matched } = matchConsents({ selectedItems: [{ item, quantity: 1 }] });
  if (!matched.length) {
    switchView('consent');
    toast('该项目暂无专属同意书，可在文书库检索通用告知书');
    return;
  }
  const ids = matched.map(m => m.template.id);
  state.consentDismissed = state.consentDismissed.filter(id => !ids.includes(id));
  state.consentSel = [...new Set([...state.consentSel, ...ids])];
  renderConsentPanel();
  saveState();
  switchView('consent');
  toast(`已加入 ${ids.length} 份：${matched.map(m => m.template.title).join('、')}`);
}

/** 生成文书用的上下文 */
function currentConsentCtx() {
  const p = state.consentPatient || {};
  return {
    clinicName: p.clinicName || '',
    patientName: p.patientName || '',
    gender: p.gender || '男',
    age: p.age || '',
    recordNo: p.recordNo || '',
    tooth: p.tooth || '',
    cityName: currentCity().name,
    visitDate: new Date().toLocaleDateString('zh-CN'),
    items: consentItemList()
  };
}

function buildConsentDocs(ids) {
  const ctx = currentConsentCtx();
  return (ids || []).map(id => {
    const t = CONSENT_TEMPLATES.find(x => x.id === id);
    return t ? buildConsentDoc({ template: t, ctx }) : null;
  }).filter(Boolean);
}

function openConsentPreview(docs, title) {
  if (!docs.length) { toast('请先加入至少一份知情同意书'); return; }
  openDocPreview(title, docs.map(consentDocHtml).join(''));
}

/** 通用文书预览（知情同意书 / 病历共用同一个弹层） */
function openDocPreview(title, html) {
  if (!html) { toast('没有可预览的内容'); return; }
  $('consentSheetTitle').textContent = title;
  $('consentDocBody').innerHTML = html;
  openSheet('consentSheet');
}

function previewConsent(id) {
  const docs = buildConsentDocs([id]);
  openConsentPreview(docs, docs.length ? docs[0].title : '知情同意书预览');
}

function previewConsents() {
  const docs = buildConsentDocs(state.consentSel);
  openConsentPreview(docs, `知情同意书全文预览（${docs.length} 份）`);
}

/** 打印：把文书灌进 printHost，让 @media print 只输出文书 */
function doPrintDoc(html, emptyTip) {
  if (!html) { toast(emptyTip); return; }
  const host = $('printHost');
  host.innerHTML = html;
  const finish = () => {
    window.removeEventListener('afterprint', finish);
    setTimeout(() => { host.innerHTML = ''; }, 300);
  };
  window.addEventListener('afterprint', finish);
  try {
    window.print();
  } catch (e) {
    // 部分内嵌 WebView 不支持打印：降级为预览，用户可长按复制或截图
    $('consentDocBody').innerHTML = html;
    $('consentSheetTitle').textContent = '打印不可用，已改为全文预览';
    openSheet('consentSheet');
    toast('当前环境不支持直接打印，已改为预览');
  }
}

/** 兼容旧调用名 */
function doPrintConsent(html, emptyTip) { doPrintDoc(html, emptyTip); }

function printConsent(id) {
  const docs = buildConsentDocs([id]);
  doPrintConsent(consentPackHtml(docs), '未找到该同意书');
}

function printConsents() {
  const docs = buildConsentDocs(state.consentSel);
  doPrintConsent(consentPackHtml(docs), '文书清单为空，请先加入知情同意书');
}

function printConsentSheet() {
  const html = $('consentDocBody').innerHTML;
  doPrintConsent(html, '没有可打印的内容');
}

/* ---------------- 文书导出（同意书 / 病历共用） ---------------- */

/** 触发下载；内嵌 WebView 不支持时返回 false，由调用方降级为预览 */
function downloadFile(text, filename, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    return false;
  }
}

/** 打印/导出用的整页 HTML（文书 CSS 与屏幕预览同源） */
function docExportHtml(title, bodyHtml) {
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    'body{background:#f1f5f9;margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#111827;}',
    '.consent-doc{background:#fff;max-width:820px;margin:0 auto 18px;padding:26px 30px;box-shadow:0 1px 6px rgba(15,23,42,.12);border-radius:6px;}',
    CONSENT_DOC_CSS,
    RECORD_DOC_CSS,
    '@media print{body{background:#fff;padding:0;} .consent-doc{box-shadow:none;padding:0;margin:0;max-width:none;break-after:page;} .consent-doc:last-child{break-after:auto;}}',
    '</style></head><body>',
    bodyHtml,
    '</body></html>'
  ].join('\n');
}

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/* ---------------- 导出（知情同意书） ---------------- */
function exportConsents(fmt) {
  const docs = buildConsentDocs(state.consentSel);
  if (!docs.length) { toast('文书清单为空，请先加入知情同意书'); return; }

  const stamp = nowStamp();
  const isTxt = fmt === 'txt';
  const text = isTxt
    ? '\ufeff' + docs.map(consentDocText).join('\n\n' + '='.repeat(46) + '\n\n')
    : docExportHtml(`${APP_INFO.name} · 知情同意书`, consentPackHtml(docs));
  const filename = isTxt ? `${APP_INFO.name}知情同意书_${stamp}.txt` : `${APP_INFO.name}知情同意书_${stamp}.html`;
  const mime = isTxt ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8';

  if (downloadFile(text, filename, mime)) {
    toast(`已导出 ${docs.length} 份知情同意书`);
    return;
  }
  // 内嵌 WebView 不支持下载：降级为全文预览
  const plain = docs.map(consentDocText).join('\n\n');
  $('consentDocBody').innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.7">${escapeHtml(plain)}</pre>`;
  $('consentSheetTitle').textContent = '导出不可用，已改为全文预览';
  openSheet('consentSheet');
  toast('已展示全文，可长按复制');
}

/* ============================================================
   医保门诊病历
   ============================================================ */

/** 病历页的患者信息（与知情同意书同一份数据） */
function renderRecordPatientFields() {
  renderPatientFieldsInto('recordPatientFields', 'rp_');
}

/** 科室下拉与医师输入（只在初始化时填值，输入时不回写） */
function renderRecordMeta() {
  const dept = $('rec_department');
  if (dept) {
    const cur = state.recordMeta.department || RECORD_DEPARTMENTS[0];
    dept.innerHTML = RECORD_DEPARTMENTS.map(d =>
      `<option value="${escapeHtml(d)}"${d === cur ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('');
    if (!state.recordMeta.department) state.recordMeta.department = cur;
  }
  const doc = $('rec_doctor');
  if (doc) doc.value = state.recordMeta.doctor || '';
}

function onRecordMetaInput() {
  state.recordMeta.department = ($('rec_department') || {}).value || RECORD_DEPARTMENTS[0];
  state.recordMeta.doctor = ($('rec_doctor') || {}).value || '';
  saveState();
}

/**
 * 处方变动 → 同步病历草稿。
 * 医生手动改写过的段落（recordTouched）原样保留，绝不被覆盖。
 */
function syncRecordDraft() {
  const { fields: draft, categories } = draftRecord({
    selectedItems: buildSelectedItems(),
    ctx: currentConsentCtx()
  });
  RECORD_DOCTOR_FIELDS.forEach(f => {
    const cur = state.recordFields[f.key];
    const snap = state.recordSnapshot[f.key];
    const touched = state.recordTouched.includes(f.key);
    const untouched = !touched && (cur == null || cur === '' || cur === snap);
    if (untouched) state.recordFields[f.key] = draft[f.key] || '';
    state.recordSnapshot[f.key] = draft[f.key] || '';
  });
  state.recordDraftCategories = categories;
  return { categories };
}

/** 病历各段录入表单 */
function renderRecordForm() {
  const box = $('recordForm');
  if (!box) return;
  box.innerHTML = RECORD_DOCTOR_FIELDS.map(f => {
    const v = state.recordFields[f.key] || '';
    const touched = state.recordTouched.includes(f.key);
    return `
      <div class="rec-field">
        <div class="rec-field-top">
          <label class="rec-field-label" for="rec_${f.key}">${escapeHtml(f.label)}</label>
          <span class="rec-field-state${touched ? ' edited' : ''}" data-for="${f.key}">${touched ? '已修改' : '自动草稿'}</span>
        </div>
        <textarea class="input rec-textarea" id="rec_${f.key}" rows="${f.rows || 2}"
                  placeholder="${escapeHtml(f.ph || '')}"
                  oninput="onRecordFieldInput('${f.key}')">${escapeHtml(v)}</textarea>
        <div class="rec-field-hint">${escapeHtml(f.hint || '')}</div>
      </div>`;
  }).join('');
}

/** 处方变动时只更新「未被医生改过」的 textarea，不重渲染以免打断输入 */
function updateRecordFormValues() {
  RECORD_DOCTOR_FIELDS.forEach(f => {
    const el = $('rec_' + f.key);
    if (el && !state.recordTouched.includes(f.key)) el.value = state.recordFields[f.key] || '';
  });
}

function onRecordFieldInput(key) {
  const el = $('rec_' + key);
  if (!el) return;
  state.recordFields[key] = el.value;
  const snap = state.recordSnapshot[key] || '';
  const touched = el.value.trim() !== snap.trim();
  state.recordTouched = touched
    ? [...new Set([...state.recordTouched, key])]
    : state.recordTouched.filter(k => k !== key);
  const st = document.querySelector(`.rec-field-state[data-for="${key}"]`);
  if (st) {
    st.textContent = touched ? '已修改' : '自动草稿';
    st.classList.toggle('edited', touched);
  }
  updateRecordStatus();
  saveState();
}

function updateRecordStatus() {
  const note = $('recordStatusNote');
  if (!note) return;
  const touched = state.recordTouched.length;
  note.textContent = touched ? `${touched} 段已修改` : `草稿 ${RECORD_DOCTOR_FIELDS.length} 段`;
}

function renderRecordDraftSummary() {
  const el = $('recordDraftSummary');
  if (!el) return;
  const n = buildSelectedItems().length;
  if (!n) {
    el.innerHTML = '当前处方为空，请先在「开单」页加入项目，病历将自动生成草稿。';
    return;
  }
  const cats = (state.recordDraftCategories || []).length;
  el.innerHTML = `已按当前处方的 <b>${n} 个项目</b>自动生成草稿（覆盖 ${cats} 个诊疗类别），可直接修改后打印。`;
}

/** 病历页整体渲染（面板展开 / 切页时调用） */
function renderRecordPanel() {
  if (!$('recordForm')) return;
  renderRecordPatientFields();
  renderRecordMeta();
  syncRecordDraft();
  renderRecordForm();
  renderRecordDraftSummary();
  updateRecordStatus();
}

/** 处方变动时的轻量刷新（不重渲染 textarea） */
function refreshRecordDraftOnly() {
  if (!$('recordForm')) return;
  syncRecordDraft();
  updateRecordFormValues();
  renderRecordDraftSummary();
}

/** 用户点「重新生成草稿」：清空改动标记，全量按处方重写 */
function regenerateRecordDraft() {
  state.recordTouched = [];
  syncRecordDraft();
  renderRecordForm();
  renderRecordDraftSummary();
  updateRecordStatus();
  saveState();
  toast('已按当前处方重新生成病历草稿');
}

/** 组装病历对象 */
function buildRecordDoc() {
  return buildMedicalRecord({
    ctx: currentConsentCtx(),
    fields: state.recordFields,
    items: consentItemList(),
    extra: {
      department: state.recordMeta.department || RECORD_DEPARTMENTS[0],
      doctor: state.recordMeta.doctor || ''
    }
  });
}

function previewRecord() {
  const doc = buildRecordDoc();
  if (!buildSelectedItems().length) { toast('处方为空，请先加入项目再生成病历'); return; }
  openDocPreview('医保门诊病历预览', recordDocHtml(doc));
}

function printRecord() {
  if (!buildSelectedItems().length) { toast('处方为空，请先加入项目再生成病历'); return; }
  doPrintDoc(recordDocHtml(buildRecordDoc()), '没有可打印的病历内容');
}

function exportRecord(fmt) {
  if (!buildSelectedItems().length) { toast('处方为空，请先加入项目再生成病历'); return; }
  const doc = buildRecordDoc();
  const stamp = nowStamp();
  const isTxt = fmt === 'txt';
  const text = isTxt
    ? '\ufeff' + recordDocText(doc)
    : docExportHtml(`${APP_INFO.name} · 医保门诊病历`, recordDocHtml(doc));
  const filename = isTxt ? `${APP_INFO.name}病历_${stamp}.txt` : `${APP_INFO.name}病历_${stamp}.html`;
  const mime = isTxt ? 'text/plain;charset=utf-8' : 'text/html;charset=utf-8';

  if (downloadFile(text, filename, mime)) { toast('病历已导出'); return; }
  $('consentDocBody').innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.7">${escapeHtml(recordDocText(doc))}</pre>`;
  $('consentSheetTitle').textContent = '导出不可用，已改为全文预览';
  openSheet('consentSheet');
  toast('已展示病历全文，可长按复制');
}

/* ---------------- 计算与渲染 ---------------- */
/** 最近一次精算结果缓存（refreshCalculation 写入） */
let lastCalcCache = null;
function lastCalc() { return lastCalcCache; }

function refreshCalculation() {
  const selectedItems = buildSelectedItems();
  const city = currentCity();

  const calc = calculateDentalFees({
    cityPolicy: city,
    patientTypeId: state.patientTypeId,
    institutionLevel: state.institutionLevel,
    accumulatedDeductible: state.accumulatedDeductible,
    accumulatedReimbursement: state.accumulatedReimbursement,
    selectedItems,
    taxSettings: state.taxSettings
  });

  const redline = checkInsuranceRedLines({
    selectedItems,
    cityPolicy: city,
    version: state.version,
    institutionLevel: state.institutionLevel
  });

  const { plans } = generateOptimalPricingPlans({
    cityPolicy: city,
    patientTypeId: state.patientTypeId,
    institutionLevel: state.institutionLevel,
    accumulatedDeductible: state.accumulatedDeductible,
    accumulatedReimbursement: state.accumulatedReimbursement,
    selectedItems,
    taxSettings: state.taxSettings,
    redLineViolations: redline.violations
  });

  paintFinance(calc);
  paintTax(calc);
  paintRadar(redline);
  paintPlans(plans);
  paintDock(calc, redline);
  lastCalcCache = calc;   // 供「按当前处方预填台账」复用，避免二次计算口径不一致
  // 处方变了，自动匹配的知情同意书也要跟着变
  renderConsentPanel();
  // 病历草稿同理（不改写医生已编辑的段落）
  refreshRecordDraftOnly();
  refreshAdvisorBoundary();
}

function paintFinance(c) {
  const b = c.insuranceBreakdown, s = c.summary;

  $('mGross').textContent = yuan(s.totalGrossAmount);
  $('mGrossSub').textContent = `甲 ¥${b.classATotal.toFixed(0)} · 乙 ¥${b.classBTotal.toFixed(0)} · 自费 ¥${b.classCTotal.toFixed(0)}`;

  $('mFund').textContent = yuan(s.fundPayAmount);
  $('mFundSub').textContent = `统筹综合报销率 ${s.effectiveReimbursementRatio}%`;

  $('mPatient').textContent = yuan(s.patientTotalPay);
  $('mPatientSub').textContent = b.classCTotal > 0
    ? `含完全自费 ¥${b.classCTotal.toFixed(2)}`
    : '全部为医保范围内自付';

  $('mRevenue').textContent = yuan(s.clinicTotalRevenue);
  $('mRevenueSub').textContent = '基金结算款 + 患者实付';

  $('stripDeductible').innerHTML =
    `起付线 <b>¥${b.deductibleLine}</b> · 本次承担 <b>¥${b.currentDeductiblePaid.toFixed(2)}</b>`;
  $('stripRatio').innerHTML =
    `统筹比例 <b>${(b.reimbursementRate * 100).toFixed(0)}%</b> · 乙类先行自付 <b>¥${b.classBCopayTotal.toFixed(2)}</b>`;
  $('stripRemaining').innerHTML = `年度统筹剩余额度 <b>${yuan(s.remainingAnnualLimit)}</b>`;
}

function paintTax(c) {
  const t = c.taxBreakdown, s = c.summary;
  $('mTaxVat').textContent = yuan(t.vatAmount + t.surchargeAmount);
  // 说明「为什么这单的税只有这么多」：免税收入不参与增值税
  const share = Math.round((t.taxableShare || 0) * 100);
  $('mTaxVatSub').textContent = share > 0
    ? `应税占比 ${share}% · 增值税 ${yuan(t.vatAmount)} · 附加 ${yuan(t.surchargeAmount)}`
    : `全额免税 · 增值税 ${yuan(0)} · 附加 ${yuan(0)}`;

  $('mTaxIncome').textContent = yuan(t.incomeTaxAmount);
  $('mTaxIncomeSub').textContent = `单笔估算 · 税负率 ${t.totalTaxBurdenRate}%`;

  $('mNetProfit').textContent = yuan(t.netProfit);
  const margin = s.clinicTotalRevenue > 0 ? (t.netProfit / s.clinicTotalRevenue * 100).toFixed(1) : '0.0';
  $('mNetProfitSub').textContent =
    `税后净利率 ${margin}% · 成本率 ${(state.taxSettings.costRate * 100).toFixed(0)}%`;
}

function paintRadar(r) {
  const gradeText = { SAFE: '合规', WARNING: '提示', DANGER: '风险', FATAL: '高危' }[r.safetyGrade];
  const score = $('radarScore');
  score.className = 'radar-score ' + r.safetyGrade;
  score.innerHTML = `<div><div class="num">${r.riskScore}</div><div class="lbl">${gradeText}</div></div>`;

  const banner = $('radarBanner');
  banner.className = 'radar-banner ' + r.safetyGrade;

  if (r.hasViolations) {
    $('radarTitle').textContent = `检出 ${r.violationCount} 项医保飞行检查违规红线`;
    $('radarSub').textContent = r.safetyGrade === 'FATAL'
      ? '存在一票否决级违规，触发医保拒付、罚款与信用降级风险，请立即按整改指引处理。'
      : '存在合规风险点，建议按整改指引调整后再行收费。';
  } else {
    $('radarTitle').textContent = '处方组合安全合规';
    $('radarSub').textContent = '未检出拆套分解收费、超频次、美容项目套用统筹等违规行为。';
  }

  $('violationList').innerHTML = r.violations.map(v => `
    <div class="violation lv-${v.level}">
      <span class="vio-cat">${escapeHtml(v.category || '违规风险')}</span>
      <div class="vio-title">${escapeHtml(v.title)}</div>
      <div class="vio-desc">${escapeHtml(v.description)}</div>
      <div class="vio-box">
        <div class="vio-action"><b>整改指引</b>${escapeHtml(v.actionAdvice)}</div>
        <div class="vio-penalty"><b>飞检后果</b>${escapeHtml(v.penalty)}</div>
      </div>
    </div>`).join('');
}

function paintPlans(plans) {
  $('planList').innerHTML = plans.map((p, i) => {
    const cls = p.id === 'plan_compliance_sanitized' ? ' sanitized' : (i === 1 ? ' recommended' : '');
    // 方案二与方案一的实质差别在「现金支出」而非自付总额（自付改由个人账户结算）
    const cashDiff = p.patientCash !== undefined && Math.abs(p.patientCash - p.patientPay) > 0.01;
    return `
      <div class="plan${cls}">
        <div class="plan-top">
          <div class="plan-name">${escapeHtml(p.name)}</div>
          <span class="plan-tag">${escapeHtml(p.tag)}</span>
        </div>
        <div class="plan-nums">
          <div class="plan-num"><div class="k">统筹基金支付</div><div class="v v-fund">${yuan(p.fundPay)}</div></div>
          <div class="plan-num"><div class="k">患者自付</div><div class="v v-patient">${yuan(p.patientPay)}</div></div>
          <div class="plan-num"><div class="k">统筹报销率</div><div class="v">${p.effectiveRatio}%</div></div>
          <div class="plan-num"><div class="k">门诊净利润</div><div class="v v-profit">${yuan(p.netProfit)}</div></div>
        </div>
        ${cashDiff ? `<div class="plan-cash">当期现金支出 <b>${yuan(p.patientCash)}</b> · 自付与自费改走个人账户，患者少掏现金 ${yuan(p.patientPay - p.patientCash)}</div>` : ''}
        <div class="plan-advice">${escapeHtml(p.advice)}</div>
      </div>`;
  }).join('');
}

function paintDock(c, r) {
  $('dockFund').textContent = yuan(c.summary.fundPayAmount);
  $('dockPatient').textContent = yuan(c.summary.patientTotalPay);
  // 没有开单项目时「结算」置灰，避免空单入账
  const settleBtn = $('dockSettle');
  if (settleBtn) settleBtn.disabled = !(c.itemBreakdown && c.itemBreakdown.length > 0);
  const risk = $('dockRisk');
  risk.className = 'dock-risk ' + r.safetyGrade;
  risk.textContent = r.hasViolations ? `红线 ${r.violationCount}` : '合规';

  const badge = $('riskTabBadge');
  if (r.violationCount > 0) {
    badge.hidden = false;
    badge.textContent = r.violationCount;
  } else {
    badge.hidden = true;
  }
}

/* ---------------- Tab 切换 ---------------- */
function switchView(view) {
  state.view = view;
  document.body.setAttribute('data-view', view);
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === view);
  });
  if (view === 'consent') renderConsentPanel();
  if (view === 'record') renderRecordPanel();
  if (view === 'advisor') renderAdvisorPanel();
  if (view === 'tax') renderTaxAssistant();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- 折叠面板 ---------------- */
function toggleCollapse(btn) {
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  const body = btn.nextElementSibling;
  if (body) body.classList.toggle('open', !open);
}

/* ---------------- 弹层 ---------------- */
function openSheet(id) {
  $(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  $(id).classList.remove('open');
  document.body.style.overflow = '';
}
function closeSheetFromMask(e, id) {
  if (e.target === $(id)) closeSheet(id);
}

/* ---------------- 关于 · 开源声明 ---------------- */
/**
 * 许可全文不写死在这里，而是从产物里的 <script type="text/plain" id="licenseText">
 * 读取（构建时由 build.js 把 LICENSE 文件内容注入该块）。
 * 这样做有两个好处：
 *   ① 换许可证只需替换 LICENSE 文件，不用改 JS（GPL-3.0 全文 35 KB，也不适合当 JS 字符串）；
 *   ② GPL-3.0 第 4 条要求分发时随附许可全文 —— 本应用以单文件分发，
 *      许可全文必须随文件本身走，不能只放在仓库里。
 */
function licenseFullText() {
  const el = document.getElementById('licenseText');
  return el ? el.textContent.replace(/^\s+|\s+$/g, '') : '';
}

function openAbout() {
  renderAbout();
  openSheet('aboutSheet');
}

function copyLicenseText() {
  copyPlainText(licenseFullText(), `${APP_INFO.license} 许可全文已复制`);
}

function renderAbout() {
  const box = $('aboutBody');
  if (!box) return;

  box.innerHTML = `
    <div class="about-hero">
      <div class="about-name">${escapeHtml(APP_INFO.name)}</div>
      <div class="about-full">${escapeHtml(APP_INFO.fullName)}</div>
      <div class="about-tag">${escapeHtml(APP_INFO.tagline)}</div>
      <div class="about-meta">
        <span>版本 ${escapeHtml(APP_INFO.version)}</span>
        <span class="about-dot">·</span>
        <span>${escapeHtml(APP_INFO.releaseDate)}</span>
        <span class="about-dot">·</span>
        <span class="about-lic">${escapeHtml(APP_INFO.license)} 许可</span>
      </div>
      <p class="about-origin">${escapeHtml(APP_INFO.nameOrigin)}</p>
    </div>

    <div class="sheet-block about-open">
      <h4 class="green">开源声明</h4>
      <p>本软件为<b>开源软件</b>，以 <b>${escapeHtml(APP_INFO.licenseFullName)}</b>
      （${escapeHtml(APP_INFO.license)}）发布，著作权人为 <b>${escapeHtml(APP_INFO.copyright)}</b>。</p>

      <div class="about-k">你可以</div>
      <ul class="about-can">${APP_INFO.licensePoints.can.map(x => `<li>${x}</li>`).join('')}</ul>

      <div class="about-k">你必须</div>
      <ul class="about-must">${APP_INFO.licensePoints.must.map(x => `<li>${x}</li>`).join('')}</ul>

      <div class="about-k">你不可以</div>
      <ul class="about-cannot">${APP_INFO.licensePoints.cannot.map(x => `<li>${x}</li>`).join('')}</ul>

      <div class="about-note">${APP_INFO.licensePoints.note}</div>

      <div class="about-actions">
        <button type="button" class="btn-ghost" onclick="copyLicenseText()">复制 ${escapeHtml(APP_INFO.license)} 全文</button>
      </div>
      <details class="about-details">
        <summary>查看 ${escapeHtml(APP_INFO.license)} 许可全文（${(licenseFullText().length / 1024).toFixed(0)} KB）</summary>
        <pre class="about-pre">${escapeHtml(licenseFullText())}</pre>
      </details>
    </div>

    <div class="sheet-block">
      <h4 class="purple">零第三方依赖</h4>
      <p>${escapeHtml(APP_INFO.zeroDepNote)}</p>
      ${APP_INFO.dependencies.length
        ? `<ul>${APP_INFO.dependencies.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`
        : '<p class="about-none">第三方组件清单：<b>无</b></p>'}
    </div>

    <div class="sheet-block">
      <h4>内置数据来源</h4>
      <ul>${APP_INFO.dataSources.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
    </div>

    <div class="sheet-block">
      <h4 class="red">免责声明</h4>
      <ul class="about-warn">${APP_INFO.disclaimers.map(s => `<li>${s}</li>`).join('')}</ul>
    </div>

    <button type="button" class="btn-primary" onclick="closeSheet('aboutSheet')">我知道了</button>`;
}

/* ---------------- 费用明细 ---------------- */
function showBreakdown() {
  const items = buildSelectedItems();
  if (!items.length) { toast('处方单为空，暂无明细'); return; }
  const rows = items.map(e => {
    const it = e.item;
    const sub = e.customPrice * e.quantity;
    const copay = it.insuranceType === '乙类'
      ? (sub * (it.copayRate ?? 0.1)).toFixed(2)
      : (it.insuranceType === '自费' ? sub.toFixed(2) : '0.00');
    return `<tr>
      <td>${escapeHtml(it.name)}</td>
      <td>${it.insuranceType}</td>
      <td class="num">¥${e.customPrice}</td>
      <td class="num">${e.quantity}</td>
      <td class="num">¥${sub.toFixed(2)}</td>
      <td class="num">¥${copay}</td>
    </tr>`;
  }).join('');

  const c = calculateDentalFees({
    cityPolicy: currentCity(),
    patientTypeId: state.patientTypeId,
    institutionLevel: state.institutionLevel,
    accumulatedDeductible: state.accumulatedDeductible,
    accumulatedReimbursement: state.accumulatedReimbursement,
    selectedItems: items,
    taxSettings: state.taxSettings
  });
  const s = c.summary, b = c.insuranceBreakdown;

  $('breakdownBody').innerHTML = `
    <div class="scroll-x">
      <table class="detail-table">
        <thead><tr>
          <th>项目</th><th>属性</th><th>单价</th><th>数量</th><th>小计</th><th>先行自付</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="status-strip" style="margin-top:12px">
      <div class="row"><span>纳统筹基数（甲类 + 乙类纳统）</span><b>${yuan(b.totalEligibleFundBase)}</b></div>
      <div class="row"><span>本次扣减起付线</span><b>− ${yuan(b.currentDeductiblePaid)}</b></div>
      <div class="row"><span>计统筹金额 × ${(b.reimbursementRate * 100).toFixed(0)}%</span><b>${yuan(s.fundPayAmount)}</b></div>
      <div class="row"><span>政策内个人自负</span><b>${yuan(b.policySelfPay)}</b></div>
      <div class="row"><span>乙类先行自付</span><b>${yuan(b.classBCopayTotal)}</b></div>
      <div class="row"><span>完全自费（丙类）</span><b>${yuan(b.classCTotal)}</b></div>
      <div class="row" style="border-top:1px solid var(--ink-200);padding-top:7px">
        <span><b>患者实际支付合计</b></span><b>${yuan(s.patientTotalPay)}</b>
      </div>
    </div>`;
  openSheet('breakdownSheet');
}

/* ---------------- 保存 / 导出 ---------------- */
function exportPrescription() {
  const items = buildSelectedItems();
  if (!items.length) { toast('处方单为空'); return; }
  const city = currentCity(), pt = currentPatientType();
  const c = calculateDentalFees({
    cityPolicy: city,
    patientTypeId: state.patientTypeId,
    institutionLevel: state.institutionLevel,
    accumulatedDeductible: state.accumulatedDeductible,
    accumulatedReimbursement: state.accumulatedReimbursement,
    selectedItems: items,
    taxSettings: state.taxSettings
  });
  const r = checkInsuranceRedLines({
    selectedItems: items,
    cityPolicy: city,
    version: state.version,
    institutionLevel: state.institutionLevel
  });

  const lines = [];
  lines.push(`${APP_INFO.name} · 口腔门诊费用测算单`);
  lines.push('生成时间：' + new Date().toLocaleString('zh-CN'));
  lines.push('项目版本：' + currentVersion().fullName);
  lines.push('统筹地区：' + city.name + '　参保类别：' + pt.name);
  lines.push('门诊级别：' + ({ primary: '基层/一级', secondary: '二级', tertiary: '三级' }[state.institutionLevel] || '-'));
  lines.push('─'.repeat(34));
  items.forEach(e => {
    lines.push(`${e.item.name}　${e.item.insuranceType}　¥${e.customPrice} × ${e.quantity} = ¥${(e.customPrice * e.quantity).toFixed(2)}`);
  });
  lines.push('─'.repeat(34));
  lines.push(`原价总额：${yuan(c.summary.totalGrossAmount)}`);
  lines.push(`医保统筹支付：${yuan(c.summary.fundPayAmount)}`);
  lines.push(`患者实际支付：${yuan(c.summary.patientTotalPay)}`);
  lines.push(`统筹综合报销率：${c.summary.effectiveReimbursementRatio}%`);
  lines.push('─'.repeat(34));
  lines.push(`增值税及附加：${yuan(c.taxBreakdown.vatAmount + c.taxBreakdown.surchargeAmount)}`);
  lines.push(`所得税：${yuan(c.taxBreakdown.incomeTaxAmount)}`);
  lines.push(`门诊税后净利润：${yuan(c.taxBreakdown.netProfit)}`);
  lines.push('─'.repeat(34));
  lines.push(`医保合规安全分：${r.riskScore} / 100　违规项：${r.violationCount}`);
  r.violations.forEach(v => lines.push('  ⚠ ' + v.title));

  const text = lines.join('\n');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `${APP_INFO.name}测算单_${stamp}.txt`;

  try {
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('测算单已导出');
  } catch (e) {
    // 部分内嵌 WebView 不支持下载，降级为弹层展示
    $('breakdownBody').innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;line-height:1.7">${escapeHtml(text)}</pre>`;
    openSheet('breakdownSheet');
    toast('已展示测算单全文，可长按复制');
  }
}

function resetAll() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  state.prescription = [];
  state.cityId = 'chengdu';
  state.patientTypeId = CITIES_POLICY.chengdu.patientTypes[0].id;
  state.institutionLevel = 'primary';
  state.accumulatedDeductible = 0;
  state.accumulatedReimbursement = 0;
  state.version = 'gg114';
  state.category = 'all';
  state.keyword = '';
  state.taxModeId = TAX_MODES[0].id;
  state.taxSettings = { ...TAX_MODES[0].settings };
  state.consentPatient = {};
  state.consentSel = [];
  state.consentAuto = [];
  state.consentDismissed = [];
  state.consentKeyword = '';
  state.recordFields = {};
  state.recordSnapshot = {};
  state.recordTouched = [];
  state.recordMeta = { department: RECORD_DEPARTMENTS[0], doctor: '' };
  state.selfCheckDone = [];
  state.advisorComboGroup = '种植';
  state.advisorComboKeyword = '';
  state.view = 'order';
  $('itemSearchInput').value = '';
  $('consentSearchInput').value = '';
  const cs = $('advComboSearch');
  if (cs) cs.value = '';
  const sc = $('itemSearchClear');
  if (sc) sc.hidden = true;
  renderAll();
  toast('已恢复出厂设置');
}

/* ============================================================
   医生合规助手
   数据来源：src/data/billingRules.js（门诊实务文档知识库）
   引擎：src/engines/advisorEngine.js
   ============================================================ */

const ADVISOR_COMBO_GROUPS = ['种植', '正畸', '全部'];

/** 通用文本复制（含降级方案） */
function copyPlainText(text, okMsg) {
  const done = () => toast(okMsg || '已复制到剪贴板');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done(); else toast('复制失败，可长按选择文本');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

/* ---------------- A. 叠加收费边界（随处方实时） ---------------- */
function refreshAdvisorBoundary() {
  const hits = checkBillingBoundaries(buildSelectedItems());

  const badge = $('advisorTabBadge');
  if (badge) { badge.hidden = hits.length === 0; badge.textContent = String(hits.length); }
  const bBadge = $('advBoundaryBadge');
  if (bBadge) { bBadge.hidden = hits.length === 0; bBadge.textContent = String(hits.length); }

  const note = $('advNote');
  if (note) note.textContent = hits.length ? `${hits.length} 项待确认` : '无叠加冲突';

  const list = $('advBoundaryList');
  if (!list) return;

  if (!hits.length) {
    list.innerHTML = `<div class="adv-ok">
        ✅ 当前处方未发现叠加收费边界冲突
        <div class="adv-ok-sub">系统按 18 组「可独立收费子项目 ↔ 内含包干主项目」规则实时检查。</div>
      </div>`;
    return;
  }

  list.innerHTML = `<div class="ab-intro">
      以下组合在收费上存在「包干内含」关系。请确认：<b>若本次确实分别开展了这些操作，按提示在病历中写明；若未实际开展，请勿叠加收费。</b>
    </div>` + hits.map(h => `
    <div class="adv-boundary ${h.level === 'FATAL' ? 'fatal' : 'warn'}">
      <div class="ab-head">
        <span class="ab-level">${h.level === 'FATAL' ? '一票否决' : '高风险'}</span>
        <span class="ab-pair">${escapeHtml(h.subItems.join(' / '))} <b>↔</b> ${escapeHtml(h.mainItems.join(' / '))}</span>
      </div>
      <div class="ab-row"><span class="ab-k">冲突原因</span>
        <span>${escapeHtml(h.mainLabel)} 的包干价已内含该操作，${escapeHtml(h.scope)}叠加收取易被认定为分解收费。</span></div>
      <div class="ab-row"><span class="ab-k">可单独收费前提</span>
        <span>${h.scenes.map(s => escapeHtml(s)).join('；')}</span></div>
      <div class="ab-script"><span class="ab-k">病历必须写明</span><em>${escapeHtml(h.script)}</em></div>
      ${h.caveat ? `<div class="ab-caveat">⚠ ${escapeHtml(h.caveat)}</div>` : ''}
      ${h.note ? `<div class="ab-caveat">${escapeHtml(h.note)}</div>` : ''}
    </div>`).join('');
}

/* ---------------- B. 治疗方案标准组合 ---------------- */
function renderComboGroupTabs() {
  const box = $('advComboGroup');
  if (!box) return;
  box.innerHTML = ADVISOR_COMBO_GROUPS.map(g =>
    `<button type="button" class="seg-btn${g === state.advisorComboGroup ? ' active' : ''}"
       onclick="switchComboGroup('${g}')">${g}</button>`).join('');
}

function switchComboGroup(g) {
  state.advisorComboGroup = g;
  renderComboGroupTabs();
  renderComboList();
}

function onComboSearch(v) {
  state.advisorComboKeyword = v;
  renderComboList();
}

function renderComboList() {
  const box = $('advComboList');
  if (!box) return;
  const group = state.advisorComboGroup === '全部' ? '' : state.advisorComboGroup;
  const list = filterCombos({ group, keyword: state.advisorComboKeyword });
  if (!list.length) {
    box.innerHTML = '<div class="empty-hint">没有匹配的治疗组合，换个词试试</div>';
    return;
  }
  const allItems = allItemsOfVersion();
  box.innerHTML = list.map(c => {
    const avail = comboAvailability(c, allItems);
    const inLib = avail.filter(a => a.inLibrary).length;
    const parts = avail.map(a =>
      `<span class="combo-part${a.inLibrary ? ' in-lib' : ''}">${escapeHtml(a.name)}</span>`).join('');
    const tip = inLib < avail.length
      ? `项目库收录 ${inLib}/${avail.length}，未收录项属旧版编码体系（种植/3D 类），需在 HIS 中单独开单`
      : `项目库已收录全部 ${avail.length} 项`;
    return `
      <div class="combo-card">
        <div class="combo-head">
          <span class="combo-tag ${c.group === '种植' ? 'implant' : 'ortho'}">${escapeHtml(c.group)}</span>
          <span class="combo-name">${escapeHtml(c.name)}</span>
          ${c.refPrice ? `<span class="combo-price">¥${c.refPrice}</span>` : ''}
        </div>
        <div class="combo-parts">${parts}</div>
        ${c.note ? `<div class="combo-note">${escapeHtml(c.note)}</div>` : ''}
        ${c.caveat ? `<div class="combo-caveat">⚠ ${escapeHtml(c.caveat)}</div>` : ''}
        <div class="combo-lib">${escapeHtml(tip)}</div>
      </div>`;
  }).join('');
}

/* ---------------- C. 合规自查 ---------------- */
function renderSelfCheckPanel() {
  const rep = selfCheckReport(state.selfCheckDone);

  const bar = $('advCheckBar');
  if (bar) {
    bar.innerHTML = `
      <div class="check-bar">
        <div class="check-bar-top">
          <span>自查进度 <b id="advCheckDone">${rep.done}/${rep.total}</b></span>
          <span class="check-pct" id="advCheckPct">${rep.percent}%</span>
        </div>
        <div class="check-track"><i style="width:${rep.percent}%"></i></div>
        <div class="check-tip" id="advCheckTip">${escapeHtml(rep.conclusion)}</div>
      </div>`;
  }

  const list = $('advCheckList');
  if (!list) return;
  list.innerHTML = rep.modules.map(m => `
    <div class="check-mod${m.checked ? ' done' : ''}">
      <label class="check-mod-head">
        <input type="checkbox" ${m.checked ? 'checked' : ''}
               onchange="toggleSelfCheck(${m.id}, this.checked)">
        <span class="check-name">${m.id}. ${escapeHtml(m.name)}</span>
        <span class="check-tag">${escapeHtml(m.tag)}</span>
      </label>
      <div class="check-body">
        <div class="check-k">自查要点</div>
        <ol class="check-ol">${m.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
        <div class="check-k">高频违规</div>
        <div class="check-vio">${m.violations.map(v => `<span>${escapeHtml(v)}</span>`).join('')}</div>
        <div class="check-k">合格标准</div>
        <div class="check-std">${escapeHtml(m.standard)}</div>
      </div>
    </div>`).join('');
}

function toggleSelfCheck(id, on) {
  const set = new Set(state.selfCheckDone.map(Number));
  if (on) set.add(Number(id)); else set.delete(Number(id));
  state.selfCheckDone = Array.from(set).sort((a, b) => a - b);
  renderSelfCheckPanel();
  saveState();
}

/** 生成可复制的自查报告纯文本 */
function selfCheckReportText(rep) {
  const lines = ['【医保税务合规自查报告】', `完成进度：${rep.done}/${rep.total}（${rep.percent}%）`, '', '自查原则：'];
  rep.principles.forEach(p => lines.push(`· ${p.name}：${p.desc}`));
  lines.push('', '模块明细：');
  rep.modules.forEach(m => {
    lines.push(`${m.checked ? '[✓]' : '[ ]'} ${m.id}. ${m.name}（${m.tag}）`);
    if (!m.checked) {
      m.violations.forEach(v => lines.push(`     高频违规：${v}`));
      lines.push(`     合格标准：${m.standard}`);
    }
  });
  lines.push('', rep.conclusion);
  return lines.join('\n');
}

function copySelfCheckReport() {
  const rep = selfCheckReport(state.selfCheckDone);
  copyPlainText(selfCheckReportText(rep), '自查报告已复制');
}

/* ---------------- D. 营销 / 优惠场景合规 ---------------- */
function mkSection(title, arr, cls) {
  if (!arr || !arr.length) return '';
  return `<div class="mk-sec ${cls || ''}">
      <div class="mk-k">${title}</div>
      <ul>${arr.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
    </div>`;
}

function toggleMarketing(id) {
  const el = $('mk_' + id);
  if (el) el.classList.toggle('open');
}

function renderMarketingPanel() {
  const box = $('advMarketingList');
  if (!box) return;
  const list = listMarketingScenarios();
  box.innerHTML = `
    <div class="mk-iron">🔒 ${escapeHtml(MARKETING_IRON_RULE)}</div>
    ${list.map(s => `
      <div class="mk-card" id="mk_${s.id}">
        <button type="button" class="mk-head" onclick="toggleMarketing('${s.id}')">
          <span class="mk-name">${escapeHtml(s.name)}</span>
          <svg class="chev" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
        <div class="mk-body">
          ${mkSection('核心合规前提', s.premise)}
          ${mkSection('收费操作全流程', s.flow)}
          ${mkSection('病历书写硬性要求', s.record)}
          ${mkSection('技耗分离执行规范', s.split)}
          ${mkSection('费用录入 / 优惠处理', s.entry)}
          ${mkSection('绝对禁止动作', s.forbid, 'forbid')}
        </div>
      </div>`).join('')}`;
}

/* ---------------- E. 技耗分离与税负口径 ---------------- */
function renderFeeSplitPanel() {
  const box = $('advFeeSplit');
  if (!box) return;
  const adv = feeSplitAdvice(buildSelectedItems());
  const LVS = ['超价', '不超价', '技耗分离'];
  // 税率矩阵用卡片式呈现（不使用横向表格：手机端会产生内层横向滚动）
  const cards = TAX_MATRIX.rows.map(r => {
    const line = (who, arr) => `
      <div class="fs-line">
        <span class="fs-who">${who}</span>
        <span class="fs-chips">${arr.map((v, i) =>
          `<span class="fs-chip${v === 0 ? ' zero' : ''}"><em>${LVS[i]}</em><b>${(v * 100).toFixed(0)}%</b></span>`
        ).join('')}</span>
      </div>`;
    return `
      <div class="fs-card">
        <div class="fs-card-name">${escapeHtml(r.name)}</div>
        ${line('一般纳税人', r.general)}
        ${line('小规模纳税人', r.small)}
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="fs-current">
      <div class="fs-h">当前处方归类</div>
      <div class="fs-grid">
        <div class="fs-cell"><b>${adv.counts.services}</b><span>基础项目</span><em>免税</em></div>
        <div class="fs-cell"><b>${adv.counts.addons}</b><span>加收 / 分项</span><em>免税</em></div>
        <div class="fs-cell"><b>—</b><span>耗材</span><em>应税</em></div>
      </div>
      <div class="fs-tip">${escapeHtml(adv.taxTip)}</div>
      ${adv.addonTip ? `<div class="fs-warn">⚠ ${escapeHtml(adv.addonTip)}</div>` : ''}
    </div>
    <div class="fs-h">技耗分离 × 纳税人身份 税率矩阵</div>
    <div class="fs-cards">${cards}</div>
    <div class="fs-concl">💡 ${escapeHtml(adv.conclusion)}</div>`;
}

/* ---------------- 助手页总渲染 ---------------- */
function renderAdvisorPanel() {
  refreshAdvisorBoundary();
  renderComboGroupTabs();
  renderComboList();
  renderSelfCheckPanel();
  renderMarketingPanel();
  renderFeeSplitPanel();
}

/* ---------------- PWA ---------------- */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* 离线单文件场景可忽略 */ });
}
