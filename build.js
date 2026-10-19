/**
 * 构建脚本：把「数据 + 引擎 + UI」打包成 100% 自包含单文件离线应用
 * 单一数据源：引擎逻辑只在 src/engines 与 src/data 维护一份，
 * 由本脚本剥掉 ESM 语法后内联进 dist/index.html，避免多份副本互相漂移。
 *
 * Copyright (C) 2026 肘边备急项目全体贡献者（Contributors）· GNU GPL-3.0
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const write = (p, c) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, p), c, 'utf-8');
};

/** 需要打进的引擎源码，顺序即依赖顺序（定义在前，使用在后） */
const ENGINE_FILES = [
  'src/data/appInfo.js',
  'src/data/citiesPolicy.js',
  'src/data/taxModes.js',
  'src/data/taxPolicy.js',
  'src/data/dentalItems.js',
  'src/data/items114.js',
  'src/data/imagingItems.js',
  'src/data/billingRules.js',
  'src/data/consents.js',
  'src/data/records.js',
  'src/engines/feeCalculator.js',
  'src/engines/taxEngine.js',
  'src/engines/redLineChecker.js',
  'src/engines/optimizer.js',
  'src/engines/consentEngine.js',
  'src/engines/recordEngine.js',
  'src/engines/advisorEngine.js'
];

function bundleEngine() {
  return ENGINE_FILES.map((file) => {
    const src = read(file);
    const stripped = src
      // 多行 import（如 `import {\n a,\n b\n} from 'x.js';`）先整体剥掉
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
      .replace(/^\s*export\s+default\s+/gm, 'const __default__ = ')
      .replace(/^\s*export\s+/gm, '');
    if (/\bexport\b/.test(stripped)) {
      throw new Error(`内联失败：${file} 仍残留 export（可能新增了多行 import/export 语法）`);
    }
    return `/* ===== ${file} ===== */\n${stripped.trim()}`;
  }).join('\n\n');
}

function build() {
  const tpl = read('src/ui/index.html');
  const css = read('src/ui/styles.css');
  const app = read('src/ui/app.js');
  const engine = bundleEngine();
  const license = read('LICENSE');

  // ⚠️ 一律用「函数形式」的替换回调：许可证正文含 `$&` / `$'` 之类序列时，
  //    字符串形式的 replace 会把它们当替换模式解析，导致产物里的许可文本被改坏。
  const html = tpl
    .replace('/*__STYLES__*/', () => css)
    .replace('/*__ENGINE__*/', () => engine)
    .replace('/*__APP__*/', () => app)
    .replace('/*__LICENSE_TEXT__*/', () => license);

  const leftovers = html.match(/\/\*__(?:STYLES|ENGINE|APP|LICENSE_TEXT)__\*\//g);
  if (leftovers) throw new Error('构建失败：占位符未全部替换 -> ' + leftovers.join(','));
  // 许可全文里若出现 </script 会提前闭合内嵌块，导致后续脚本全部失效
  if (/<\/script/i.test(license)) throw new Error('构建失败：LICENSE 含 </script，无法安全内嵌');

  write('dist/index.html', html);
  write('android/app/src/main/assets/www/index.html', html);
  // 许可随分发物走：GPL-3.0 第 4 条要求分发时随附完整许可原文（HTML 内也已内嵌一份）
  write('dist/LICENSE', license);

  const manifest = {
    name: '肘边备急 · 口腔门诊医保智能精算与合规风控',
    short_name: '肘边备急',
    description: '口腔门诊五地最新医保政策、多税务模式测算、最优收费筹划与医保红线实时拦截（GPL-3.0 开源）',
    start_url: './index.html',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    lang: 'zh-CN',
    background_color: '#f1f5f9',
    theme_color: '#0284c7',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  write('dist/manifest.json', JSON.stringify(manifest, null, 2));

  const sw = `/* 肘边备急 Service Worker —— 离线优先缓存 */
// 缓存前缀随产品名走。历次改名前留下的缓存不会被本条命中，
// 由下方 activate 里「删除所有非当前 CACHE」的逻辑自动清理，无需手动干预。
const CACHE = 'zhoubianbeiji-v3';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
`;
  write('dist/sw.js', sw);

  // GitHub Pages 从 /dist 目录托管时，需要 .nojekyll 跳过 Jekyll 处理
  // （否则以下划线开头的文件/目录会被静默忽略）
  write('dist/.nojekyll', '');

  const kb = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
  console.log('构建完成：');
  console.log('  dist/index.html              ' + kb + ' KB（单文件离线版）');
  console.log('  dist/manifest.json           PWA 清单');
  console.log('  dist/sw.js                   Service Worker 离线缓存');
  console.log('  dist/LICENSE                 GPL-3.0 许可全文（随分发物）');
  console.log('  android/.../assets/www/      已同步原生工程资源');
}

build();
