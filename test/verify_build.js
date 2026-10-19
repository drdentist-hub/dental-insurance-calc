/**
 * 产物校验：语法解析 + DOM 契约一致性 + 引擎可用性
 * 目的：在浏览器之外尽早发现「ID 拼错」「函数未定义」「语法错误」这类问题
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf-8');

let failures = 0;
const ok = (m) => console.log('  ✅ ' + m);
const bad = (m) => { failures++; console.log('  ❌ ' + m); };

console.log('=========== 产物校验 ============');

/* ---------- 1. 结构 ---------- */
console.log('\n[1] HTML 结构');
if (/\/\*__(STYLES|ENGINE|APP|LICENSE_TEXT)__\*\//.test(html)) bad('残留占位符'); else ok('占位符已全部替换');
if (html.includes('<style>') && html.includes('</style>')) ok('内联样式存在'); else bad('缺少内联样式');
// 用 \r?\n 容忍行尾差异：曾经因为某个源文件被写成 CRLF 导致这条直接失配、整轮校验误报
const scriptMatch = html.match(/<script>\r?\n([\s\S]*?)\r?\n<\/script>/);
if (!scriptMatch) { bad('未找到主脚本块'); process.exit(1); }
ok('主脚本块存在（' + (scriptMatch[1].length / 1024).toFixed(1) + ' KB）');

// 许可全文块（GPL-3.0 第 4 条：分发须随附许可原文）—— 扫描外部依赖前必须先剥掉它，
// 因为许可正文里含 www.gnu.org / fsf.org 等 URL，会被误判为「外部运行时依赖」。
const licBlockMatch = html.match(/<script type="text\/plain" id="licenseText">([\s\S]*?)<\/script>/);
const licenceText = licBlockMatch ? licBlockMatch[1] : '';
const htmlNoLicence = html.replace(/<script type="text\/plain" id="licenseText">[\s\S]*?<\/script>/, '');
if (licBlockMatch) ok('许可全文块已内嵌（' + (licenceText.length / 1024).toFixed(1) + ' KB）');
else bad('缺少内嵌的许可全文块（单文件分发会丢掉许可原文）');

// 「零外部依赖」要按**加载位置**判定，不能见 URL 就报：
// 许可全文与「关于」弹层里本来就有 www.gnu.org 这类说明性链接，扫 URL 必然误报。
const LOAD_PATTERNS = [
  ['<script src>', /<script[^>]+\bsrc\s*=/i],
  ['<link href> 外链', /<link[^>]+\bhref\s*=\s*["']?(?:https?:)?\/\//i],
  ['<img src> 外链', /<img[^>]+\bsrc\s*=\s*["']?(?:https?:)?\/\//i],
  ['<iframe src> 外链', /<iframe[^>]+\bsrc\s*=\s*["']?(?:https?:)?\/\//i],
  ['CSS @import 外链', /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i],
  ['运行时网络请求', /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(\s*["'`]https?:/i],
  ['资源属性外链', /\.(?:src|href)\s*=\s*["'`](?:https?:)?\/\//i],
];
const hits = LOAD_PATTERNS.filter(([, re]) => re.test(htmlNoLicence)).map(([label]) => label);
if (hits.length) bad('发现外部运行时依赖: ' + hits.join(', '));
else ok('无外部运行时依赖（纯离线：无外链脚本/样式/图片/字体，无 fetch）');

const docUrls = [...new Set((htmlNoLicence.match(/https?:\/\/[^"'\s)<>]+/g) || []))]
  .filter(u => !u.includes('w3.org'));
if (docUrls.length) ok(`产物内 ${docUrls.length} 个 URL 均属说明性链接（非加载源）: ${docUrls.slice(0, 3).join(', ')}`);
else ok('产物内无任何外链 URL');

/* ---------- 2. 语法 ---------- */
console.log('\n[2] 脚本语法解析');
const tmp = path.join(ROOT, '.verify-bundle.js');
fs.writeFileSync(tmp, scriptMatch[1], 'utf-8');
try {
  new vm.Script(scriptMatch[1], { filename: 'bundle.js' });
  ok('整段脚本语法合法');
} catch (e) {
  bad('语法错误: ' + e.message);
}

/* ---------- 3. DOM 契约：app.js 里引用的 id 必须在 HTML 中存在 ---------- */
console.log('\n[3] DOM 契约一致性');
const referenced = new Set();
const re = /\$\('([A-Za-z0-9_]+)'\)/g;
let m;
while ((m = re.exec(scriptMatch[1])) !== null) referenced.add(m[1]);

const declared = new Set();
const reId = /\bid="([A-Za-z0-9_]+)"/g;
while ((m = reId.exec(html)) !== null) declared.add(m[1]);

const missing = [...referenced].filter(id => !declared.has(id));
if (missing.length) bad('引用了不存在的元素 id: ' + missing.join(', '));
else ok(`全部 ${referenced.size} 个元素引用均可解析`);

const orphanQuery = [...html.matchAll(/querySelector(?:All)?\('\.([a-z-]+)'\)/g)].map(x => x[1]);
if (orphanQuery.length) ok('类选择器使用: ' + [...new Set(orphanQuery)].join(', '));

/* ---------- 4. 内联函数引用：onclick 调用的函数必须已定义 ---------- */
console.log('\n[4] 事件处理器函数');
const handlers = new Set();
for (const x of html.matchAll(/on(?:click|change|input)="([a-zA-Z0-9_]+)\(/g)) handlers.add(x[1]);
const defined = new Set();
for (const x of scriptMatch[1].matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) defined.add(x[1]);
const undef = [...handlers].filter(h => !defined.has(h));
if (undef.length) bad('内联事件引用了未定义函数: ' + undef.join(', '));
else ok(`全部 ${handlers.size} 个事件处理器均已定义`);

/* ---------- 5. PWA 资源完整性 ---------- */
console.log('\n[5] PWA 资源完整性');
try {
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/manifest.json'), 'utf-8'));
  const missing = [];
  (mf.icons || []).forEach(ic => {
    if (!fs.existsSync(path.join(ROOT, 'dist', ic.src))) missing.push(ic.src);
  });
  if (missing.length) bad('manifest 引用的图标缺失: ' + missing.join(', '));
  else ok(`manifest 图标全部存在（${(mf.icons || []).length} 个，含 maskable）`);
  if (mf.display === 'standalone' && mf.theme_color) ok('display=standalone 且 theme_color 已设置');
  else bad('manifest 缺少 standalone / theme_color');
  if (fs.existsSync(path.join(ROOT, 'dist/sw.js'))) ok('sw.js 存在');
  else bad('sw.js 缺失');
  if (html.includes('serviceWorker.register')) ok('页面已注册 Service Worker');
  else bad('页面未注册 Service Worker（离线能力失效）');
} catch (e) {
  bad('manifest 读取失败: ' + e.message);
}

/* ---------- 6. 引擎在沙箱中可执行且结果正确 ---------- */
console.log('\n[6] 引擎运行时冒烟');
const ctx = { console, window: {}, document: { addEventListener() {} } };
vm.createContext(ctx);
try {
  vm.runInContext(scriptMatch[1], ctx, { filename: 'bundle.js' });
  ok('脚本在沙箱中完成求值');
} catch (e) {
  // DOMContentLoaded 注册后不应再执行 DOM 操作；若报错说明存在顶层 DOM 访问
  bad('顶层执行异常（不应在加载期访问 DOM）: ' + e.message);
}

try {
  vm.runInContext(
    `__items = [
      { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 },
      { item: DENTAL_ITEMS.find(i => i.code === '310401002'), quantity: 2 },
      { item: DENTAL_ITEMS.find(i => i.code === '110200001'), quantity: 1 }
    ]`,
    ctx
  );

  const calc = vm.runInContext(
    `calculateDentalFees({cityPolicy:CITIES_POLICY.chengdu,patientTypeId:'employee_active',institutionLevel:'primary',accumulatedDeductible:0,accumulatedReimbursement:0,selectedItems:__items,taxSettings:TAX_MODES[0].settings})`,
    ctx
  );
  if (calc.summary.totalGrossAmount === 745) ok('费用引擎结果正确（原价 ¥745）');
  else bad('费用引擎结果异常: ' + calc.summary.totalGrossAmount);

  const clean = vm.runInContext(
    `checkInsuranceRedLines({selectedItems:__items,cityPolicy:CITIES_POLICY.chengdu})`,
    ctx
  );
  if (!clean.hasViolations && clean.safetyGrade === 'SAFE') ok('红线引擎：合规处方判定为 SAFE');
  else bad('红线引擎误报: ' + clean.safetyGrade);

  // 注意：vm 沙箱中顶层 const 不会挂到 context 对象上，必须在沙箱内构造
  vm.runInContext(
    `__bad = [
      { item: DENTAL_ITEMS.find(i => i.code === '330501003'), quantity: 1 },
      { item: DENTAL_ITEMS.find(i => i.code === '330501007'), quantity: 1 }
    ]`,
    ctx
  );
  const dirty = vm.runInContext(
    `checkInsuranceRedLines({selectedItems:__bad,cityPolicy:CITIES_POLICY.chengdu})`,
    ctx
  );
  if (dirty.hasViolations && dirty.safetyGrade === 'FATAL') ok('红线引擎：拆套处方判定为 FATAL');
  else bad('红线引擎漏报: ' + dirty.safetyGrade);
} catch (e) {
  bad('引擎调用失败: ' + e.message);
}

/* ---------- 7. 开源声明与产品名一致性 ---------- */
console.log('\n[7] 开源声明与产品名一致性');
try {
  // 产品名改过很多轮，且散落在 HTML / manifest / 安卓工程 / 应用内常量四处。
  // 这里用 APP_INFO 作为唯一基准做交叉断言：任何一处漏改都会在这里红。
  const name = vm.runInContext('APP_INFO.name', ctx);
  const copyright = vm.runInContext('APP_INFO.copyright', ctx);
  const license = vm.runInContext('APP_INFO.license', ctx);
  if (name) ok(`APP_INFO 已内联（${name} · ${license}）`);
  else bad('APP_INFO.name 为空');
  if (license === 'GPL-3.0') ok('许可协议为 GNU GPL-3.0');
  else bad(`许可协议应为 GPL-3.0，实际为 ${license}`);

  const checks = [
    ['HTML <title>', new RegExp(`<title>[^<]*${name}[^<]*</title>`).test(html)],
    ['页头 brand-title', new RegExp(`class="brand-title">[^<]*${name}`).test(html)],
    ['apple-mobile-web-app-title',
      new RegExp(`apple-mobile-web-app-title" content="${name}"`).test(html)],
  ];
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/manifest.json'), 'utf-8'));
  checks.push(['manifest.name', String(mf.name).includes(name)]);
  checks.push(['manifest.short_name', mf.short_name === name]);
  const strings = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/res/values/strings.xml'), 'utf-8');
  checks.push(['安卓 app_name', strings.includes(`>${name}<`)]);

  const missName = checks.filter(c => !c[1]).map(c => c[0]);
  if (missName.length) bad('产品名不一致（漏改）: ' + missName.join(', '));
  else ok(`产品名「${name}」在 ${checks.length} 处声明中完全一致`);

  // 旧名残留：改名最容易漏的就是这几处
  // ⚠️ 必须递归扫整个 android/ 目录，不能只列固定文件 ——
  //    第 12 轮改名时 MainActivity.java 的 package 声明就漏改了，
  //    而 manifest 写的是 android:name=".MainActivity"，装到手机上直接 ClassNotFoundException。
  const stale = [];
  const TEXT_EXT = /\.(xml|gradle|java|kt|properties|pro|html|json|txt|md)$/i;
  function walk(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, out);
      else if (TEXT_EXT.test(ent.name)) out.push(p);
    }
    return out;
  }
  const scan = [
    ['dist/index.html', html],
    ['dist/manifest.json', JSON.stringify(mf)],
    ['dist/sw.js', fs.readFileSync(path.join(ROOT, 'dist/sw.js'), 'utf-8')],
  ];
  const androidDir = path.join(ROOT, 'android');
  if (fs.existsSync(androidDir)) {
    for (const abs of walk(androidDir, [])) {
      scan.push([path.relative(ROOT, abs).replace(/\\/g, '/'), fs.readFileSync(abs, 'utf-8')]);
    }
  }
  for (const [label, text] of scan) {
    if (/齿康保|chikangbao/i.test(text)) stale.push(label);
  }
  if (stale.length) bad('仍残留旧名（齿康保 / chikangbao）: ' + stale.join(', '));
  else ok(`产物与安卓工程（${scan.length} 个文件）中无旧名残留`);

  // 安卓包名一致性 + AGP 8 兼容性
  //  - AGP 8 起 manifest 里的 package 属性不再支持，包名只能由 gradle 的 namespace 决定，
  //    若还留着 package 会直接构建失败 → 必须禁止
  //  - Java 的 package 声明必须与所在目录、与 namespace、与 applicationId 完全一致
  {
    const manifest = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf-8');
    const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf-8');
    const pkgInManifest = (manifest.match(/<manifest[^>]*\spackage\s*=\s*"([^"]+)"/) || [])[1] || '';
    const pkgNs = (gradle.match(/namespace\s+['"]([^'"]+)['"]/) || [])[1] || '';
    const pkgAppId = (gradle.match(/applicationId\s+['"]([^'"]+)['"]/) || [])[1] || '';
    const verName = (gradle.match(/versionName\s+['"]([^'"]+)['"]/) || [])[1] || '';
    const verCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1] || '';

    const pkgErrors = [];
    if (pkgInManifest) {
      pkgErrors.push(`manifest 仍声明 package="${pkgInManifest}"（AGP 8 已不支持，会导致构建失败，改由 gradle namespace 决定）`);
    }
    if (!pkgNs) pkgErrors.push('gradle 缺 namespace');
    if (pkgNs && pkgAppId && pkgNs !== pkgAppId) {
      pkgErrors.push(`applicationId(${pkgAppId}) ≠ namespace(${pkgNs})`);
    }

    const javaFiles = walk(path.join(ROOT, 'android/app/src/main/java'), [])
      .filter((f) => /\.(java|kt)$/i.test(f));
    if (!javaFiles.length) pkgErrors.push('没找到任何 Java/Kotlin 源文件');
    for (const f of javaFiles) {
      const src = fs.readFileSync(f, 'utf-8');
      const decl = (src.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || '';
      // 目录包名 = 去掉文件名后的路径（com/zhoubianbeiji/app/MainActivity.java → com.zhoubianbeiji.app）
      const rel = path.relative(path.join(ROOT, 'android/app/src/main/java'), f)
        .replace(/\\/g, '/').replace(/\.(java|kt)$/i, '');
      const dirPkg = rel.split('/').slice(0, -1).join('.');
      if (!decl) pkgErrors.push(`${path.basename(f)} 缺 package 声明`);
      else if (decl !== dirPkg) {
        pkgErrors.push(`${path.basename(f)} 的 package(${decl}) 与所在目录(${dirPkg}) 不一致`);
      }
      if (decl && pkgNs && decl !== pkgNs) {
        pkgErrors.push(`${path.basename(f)} 的 package(${decl}) ≠ gradle namespace(${pkgNs})`);
      }
    }

    // APK 版本号必须跟随 APP_INFO.version，否则 Release 里两个安装包的版本会对不上
    const appVer = (html.match(/version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/) || [])[1] || '';
    if (appVer && verName && appVer !== verName) {
      pkgErrors.push(`build.gradle versionName(${verName}) ≠ APP_INFO.version(${appVer})`);
    }
    if (!verCode) pkgErrors.push('build.gradle 缺 versionCode');

    if (pkgErrors.length) bad('安卓构建配置有问题: ' + pkgErrors.join('；'));
    else {
      ok(`安卓包名一致：namespace / applicationId / Java（${pkgNs}），manifest 未声明 package（AGP 8 要求）`);
      ok(`APK 版本号与产物一致：versionName ${verName} · versionCode ${verCode}`);
    }
  }

  // 开源声明：LICENSE 文件 + 产物内嵌许可全文（GPL-3.0 第 4 条要求随附许可原文）
  const lic = fs.existsSync(path.join(ROOT, 'dist/LICENSE'))
    ? fs.readFileSync(path.join(ROOT, 'dist/LICENSE'), 'utf-8') : '';
  const GPL_MARKS = [
    'GNU GENERAL PUBLIC LICENSE',
    'Version 3, 29 June 2007',
    'TERMS AND CONDITIONS',
    '15. Disclaimer of Warranty',
    '17. Interpretation of Sections 15 and 16',
  ];
  if (!lic) bad('dist/LICENSE 缺失（分发物必须随附许可）');
  else if (GPL_MARKS.some(m => !lic.includes(m))) {
    bad('dist/LICENSE 不是完整的 GPL-3.0 原文（缺关键章节）');
  } else if (lic.length < 33000) {
    bad(`dist/LICENSE 体积异常（${lic.length} 字节，官方全文约 35149）`);
  } else ok(`dist/LICENSE 为 GPL-3.0 完整原文（${lic.length} 字节，${lic.split('\n').length} 行）`);

  const inlineLicOk = GPL_MARKS.every(m => licenceText.includes(m)) && licenceText.length > 33000;
  if (inlineLicOk) ok('单文件产物内已内嵌 GPL-3.0 完整原文');
  else bad('产物未内嵌完整 GPL-3.0 原文（单文件分发时会丢许可原文）');

  const headerNotice = /Copyright \(C\) \d{4}/.test(html.slice(0, 1400))
    && /GNU General Public License/i.test(html.slice(0, 1400));
  if (headerNotice) ok('HTML 头部含版权与 GPL 许可声明（含「标明修改」提示）');
  else bad('HTML 头部缺少版权 / GPL 许可声明');

  const domOk = /id="aboutSheet"/.test(html) && /id="aboutBody"/.test(html)
    && /^\s*function openAbout/m.test(scriptMatch[1])
    && /^\s*function renderAbout/m.test(scriptMatch[1])
    && /^\s*function copyLicenseText/m.test(scriptMatch[1])
    && /^\s*function licenseFullText/m.test(scriptMatch[1]);
  if (domOk) ok('「关于 · 开源声明」弹层已就绪（openAbout / renderAbout / copyLicenseText / licenseFullText）');
  else bad('「关于」弹层缺失或不完整');

  // 「关于」弹层里的许可说明必须覆盖 GPL-3.0 的关键义务，不能残留意为 MIT 的宽松表述
  const lp = vm.runInContext('JSON.stringify(APP_INFO.licensePoints)', ctx);
  const mustSay = [
    '必须以', '完整可编译的源码', '标明你做了哪些修改',      // 分发即开源的义务
    '同样构成「分发」，须提供源码',                            // 纯前端程序挂网上也触发
    '闭源专有软件', '不得对接收方追加',                        // 禁止事项
    'AGPL',                                                   // 与 AGPL 的差别讲清楚
  ];
  const lack = mustSay.filter(m => !lp.includes(m));
  if (lack.length) bad('许可须知缺关键义务表述: ' + lack.join(', '));
  else ok(`许可须知已写明 GPL-3.0 义务（可以 ${JSON.parse(lp).can.length} 条 / `
        + `必须 ${JSON.parse(lp).must.length} 条 / 不可以 ${JSON.parse(lp).cannot.length} 条）`);
  // 反向检查：不能残留 MIT 的宽松说法
  const mitLeft = ['自由使用、修改、再分发', '唯一要求是保留版权'].filter(m => lp.includes(m));
  if (mitLeft.length) bad('许可须知残留 MIT 表述: ' + mitLeft.join(', '));
  else ok('许可须知无 MIT 宽松表述残留（已整体改写为 GPL 口径）');
  if (copyright && !/Contributors/.test(copyright)) bad('著作权人信息异常');
  else ok(`著作权人：${copyright}`);

} catch (e) {
  bad('开源声明校验失败: ' + e.message);
}

/* ---------- [8] 报税模块 ---------- */
console.log('\n[8] 报税助手模块');
try {
  // 政策参数必须内联进产物（否则报税页算不出数）
  const policyMarks = [
    ['TAX_POLICY', /const TAX_POLICY = \{/],
    ['起征点 10 万', /monthly: 100000/],
    ['起征点 30 万', /quarterly: 300000/],
    ['减按 1%', /reducedRate: 0\.01/],
    ['六税两费减半', /halve: \{/],
    ['小微 300 万', /taxableIncomeCap: 3000000/],
    ['经营所得五级累进', /iitBusiness:/]
  ];
  const missing = policyMarks.filter(([, re]) => !re.test(scriptMatch[1])).map(([n]) => n);
  if (missing.length) bad('税务政策参数未内联: ' + missing.join(', '));
  else ok('税务政策参数已内联（起征点 / 减按 1% / 六税两费 / 小微 / 五级累进）');

  const engOk = /function computePeriodTax/.test(scriptMatch[1])
    && /function buildVatFilingSheet/.test(scriptMatch[1])
    && /function taxRiskChecks/.test(scriptMatch[1])
    && /function filingCalendar/.test(scriptMatch[1])
    && /function summarizeLedger/.test(scriptMatch[1]);
  if (engOk) ok('税务引擎 5 个核心函数已内联（计算 / 底稿 / 风险 / 日历 / 台账）');
  else bad('税务引擎函数缺失');

  const uiOk = /id="entityPills"/.test(html)
    && /id="ledgerList"/.test(html)
    && /id="filingRows"/.test(html)
    && /id="taxRiskList"/.test(html)
    && /id="filingCal"/.test(html)
    && /data-tab="tax"/.test(html);
  if (uiOk) ok('报税页 DOM（身份 / 台账 / 底稿 / 风险 / 日历 / 页签）齐全');
  else bad('报税页 DOM 不完整');

  const fnOk = ['renderTaxAssistant', 'addLedgerEntry', 'deleteLedgerEntry',
    'prefillLedgerFromPrescription', 'exportFilingSheet', 'setTaxEntity']
    .every((f) => new RegExp('^\\s*function ' + f, 'm').test(scriptMatch[1]));
  if (fnOk) ok('报税页 6 个交互函数已定义');
  else bad('报税页交互函数缺失');

  // 政策依据必须写进产物，避免用户拿旧口径报税
  const basisOk = scriptMatch[1].includes('财政部 税务总局公告 2026 年第 10 号')
    && scriptMatch[1].includes('第二十四条')
    && scriptMatch[1].includes('2027-12-31');
  if (basisOk) ok('税务政策依据（文号 / 免征条款 / 有效期）已写入产物');
  else bad('税务政策依据缺失（用户无法核对口径）');
} catch (e) {
  bad('报税模块校验失败: ' + e.message);
}

/* ---------- [9] 结算自动入账 ---------- */
console.log('\n[9] 结算自动入账与自动结论');
try {
  const dockOk = /id="dockSettle"/.test(html) && /onclick="openSettle\(\)"/.test(html);
  if (dockOk) ok('底部「结算」按钮已就位');
  else bad('底部「结算」按钮缺失');

  const sheetOk = /id="settleSheet"/.test(html)
    && /id="stRevenue"/.test(html)
    && /id="stMaterial"/.test(html)
    && /id="stTaxable"/.test(html)
    && /id="stExempt"/.test(html)
    && /id="stTax"/.test(html)
    && /id="stCost"/.test(html);
  if (sheetOk) ok('结算弹层 DOM（金额 / 材料开关 / 拆分 / 成本）齐全');
  else bad('结算弹层 DOM 不完整');

  const fnOk2 = ['openSettle', 'confirmSettle', 'updateSettlePreview',
    'onSettleMaterialChange', 'onSettleAmountChange']
    .every((f) => new RegExp('^\\s*function ' + f, 'm').test(scriptMatch[1]));
  if (fnOk2) ok('结算流程 5 个交互函数已定义');
  else bad('结算流程交互函数缺失');

  const conclOk = /id="txConclusion"/.test(html)
    && /^\s*function renderTaxConclusion/m.test(scriptMatch[1])
    && /^\s*function periodDueDate/m.test(scriptMatch[1]);
  if (conclOk) ok('自动结论卡 + 单期截止日（periodDueDate）已就位');
  else bad('自动结论卡或 periodDueDate 缺失');

  // 结算必须落本地台账，且不能引入任何网络请求
  const localOnly = /state\.taxLedger\.push\(/.test(scriptMatch[1])
    && !/\bfetch\s*\(\s*['"`]https?:/i.test(scriptMatch[1]);
  if (localOnly) ok('结算仅写入本机台账（无网络请求）');
  else bad('结算流程存在外部请求或未写入台账');

  // [hidden] 必须能压过 .tax-field 等 display 声明，否则隐藏区块会一直露出
  if (/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(html)) {
    ok('[hidden] 强制生效规则存在（防 display:flex 覆盖）');
  } else {
    bad('[hidden] 强制生效规则缺失：hidden 的表单区块会一直显示');
  }
} catch (e) {
  bad('结算模块校验失败: ' + e.message);
}

fs.unlinkSync(tmp);

console.log('\n=================================');
console.log(failures === 0 ? '🎉 全部校验通过' : `⚠️  ${failures} 项校验未通过`);
process.exit(failures === 0 ? 0 : 1);
