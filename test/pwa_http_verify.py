"""PWA 运行验证：在 HTTP 环境下（等同线上发布形态）检查 manifest / 图标 / Service Worker"""
import asyncio
import contextlib
import http.server
import os
import pathlib
import re
import socketserver
import subprocess
import sys
import threading

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

results = []
errors = []


def check(name, cond, detail=""):
    cond = bool(cond)
    results.append((cond, name, detail))
    print(("  ✅ " if cond else "  ❌ ") + name + (f"   [{detail}]" if detail and not cond else ""), flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def log_message(self, *a):
        pass


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


async def main():
    # 清理上一次硬退出遗留的 headless 浏览器进程
    with contextlib.suppress(Exception):
        subprocess.run(["taskkill", "/F", "/IM", "chrome-headless-shell.exe", "/T"],
                       capture_output=True, timeout=15)

    httpd = ReusableTCPServer(("127.0.0.1", 0), Quiet)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"服务已启动: {url}\n", flush=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True, has_touch=True, device_scale_factor=2,
        )
        page = await ctx.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

        await page.goto(url)
        await page.wait_for_timeout(2000)

        print("[1] 资源加载", flush=True)
        check("页面正常渲染", await page.locator(".city-pill").count() == 5)
        # 默认版本为 114 项版，一级价默认处方合计 377
        check("计算正常", await page.locator("#mGross").inner_text() == "¥377.00",
              await page.locator("#mGross").inner_text())
        check("文书模块已装载", await page.locator("#consentLibrary .consent-card").count() == 22,
              f"count={await page.locator('#consentLibrary .consent-card').count()}")
        check("文书样式已注入", await page.evaluate("() => !!document.getElementById('consentDocStyles')"))
        check("病历模块已装载", await page.locator("#recordForm .rec-field").count() == 8,
              f"count={await page.locator('#recordForm .rec-field').count()}")
        check("病历草稿已自动生成",
              len(await page.locator("#rec_diagnosis").input_value()) > 0)
        # 项目详情字段（官方原表 7 列）已在离线产物中
        check("项目详情含价格构成", await page.evaluate(
            "() => ITEMS_114_MAIN.every(i => i.composition.length > 0)"))
        check("项目详情含除外内容字段", await page.evaluate(
            "() => ITEMS_114_ALL.every(i => typeof i.exclusions === 'string')"))
        # 影像检查（放射类）项目已并入 114 版项目库
        check("影像类项目已装载", await page.evaluate(
            "() => typeof IMAGING_ALL !== 'undefined' && IMAGING_ALL.length >= 6"))
        check("影像类项目字段完整", await page.evaluate(
            "() => IMAGING_ALL.every(i => i.code && i.name && i.output && i.composition && i.unit)"))
        check("X线摄影成像可检索", await page.evaluate(
            "() => !!IMAGING_ALL.find(i => i.code === '012301010010000' && i.name === 'X线摄影成像')"))
        check("影像类已并入 114 版全量列表", await page.evaluate(
            "() => ITEMS_114_ALL.concat(IMAGING_ALL).length > ITEMS_114_ALL.length"))

        # 医生合规助手知识库（门诊实务文档沉淀：收费表设计 / 合规自查 / 病历经管）
        check("助手知识库已装载（18 组叠加收费边界）", await page.evaluate(
            "() => typeof MUTEX_BOUNDARIES !== 'undefined' && MUTEX_BOUNDARIES.length === 18"))
        check("治疗方案组合知识库已装载", await page.evaluate(
            "() => typeof TREATMENT_COMBOS !== 'undefined' && TREATMENT_COMBOS.length >= 25"))
        check("合规自查模块知识库已装载", await page.evaluate(
            "() => SELF_CHECK_MODULES.length === 9 && SELF_CHECK_PRINCIPLES.length === 3"))
        check("营销场景知识库已装载", await page.evaluate(
            "() => MARKETING_SCENARIOS.length === 6 && typeof MARKETING_IRON_RULE === 'string'"))
        check("技耗分离税率矩阵已装载", await page.evaluate(
            "() => TAX_MATRIX.rows.length === 7 && FEE_SPLIT_SECTIONS.length === 3"))
        check("助手引擎函数已装载", await page.evaluate(
            "() => typeof checkBillingBoundaries === 'function' && typeof feeSplitAdvice === 'function'"
            " && typeof selfCheckReport === 'function' && typeof filterCombos === 'function'"))
        check("助手页首屏已渲染（边界 / 营销 / 税率矩阵）", await page.evaluate(
            "() => document.querySelectorAll('#advBoundaryList .adv-boundary, #advBoundaryList .adv-ok').length >= 1"
            " && document.querySelectorAll('#advMarketingList .mk-card').length === 6"
            " && document.querySelectorAll('#advFeeSplit .fs-card').length === 7"))
        check("底部页签含「助手」入口", await page.locator('.tab[data-tab="advisor"]').count() == 1)

        # 开源声明与产品名（改名后必须全链路一致）
        check("APP_INFO 已内联", await page.evaluate(
            "() => typeof APP_INFO === 'object' && APP_INFO.name === '肘边备急'"))
        check("页面标题为新名且无旧名残留", await page.evaluate(
            "() => document.title.includes(APP_INFO.name) && !/齿康保|chikangbao/i.test(document.title)"))
        check("页头品牌名与 APP_INFO 一致", await page.evaluate(
            "() => document.querySelector('.brand-title').innerText.trim() === APP_INFO.name"))
        check("「关于」弹层已渲染开源声明", await page.evaluate("""() => {
            openAbout();
            // 用 textContent：许可全文在默认收起的 <details> 里，innerText 取不到
            const t = document.getElementById('aboutBody').textContent;
            const ok = t.includes('肘边备急') && t.includes('GPL-3.0') && t.includes('Contributors')
                    && t.includes('GNU GENERAL PUBLIC LICENSE')
                    && t.includes('完整可编译的源码')
                    && t.includes('闭源专有软件');
            closeSheet('aboutSheet');
            return ok;
        }"""))
        check("许可全文已内嵌单文件产物", await page.evaluate(
            "() => document.documentElement.outerHTML.includes('Version 3, 29 June 2007')"
            " && document.documentElement.outerHTML.includes('15. Disclaimer of Warranty')"))
        check("APP_INFO 许可为 GPL-3.0", await page.evaluate(
            "() => APP_INFO.license === 'GPL-3.0' && APP_INFO.licensePoints.must.length >= 3"))
        lic = await page.evaluate(
            "async () => { const r = await fetch('./LICENSE'); return {s: r.status, t: await r.text()}; }")
        check("dist/LICENSE 可访问且为 GPL-3.0 原文",
              lic.get("s") == 200 and "GNU GENERAL PUBLIC LICENSE" in lic.get("t")
              and len(lic.get("t")) > 33000,
              f"status={lic.get('s')} len={len(lic.get('t') or '')}")

        print("\n[2] PWA manifest", flush=True)
        mf = await page.evaluate("""async () => {
            const link = document.querySelector('link[rel=manifest]');
            if (!link) return {err: 'no manifest link'};
            const r = await fetch(link.href);
            return {status: r.status, body: await r.json()};
        }""")
        check("manifest 请求 200", mf.get("status") == 200, str(mf.get("err") or mf.get("status")))
        if mf.get("body"):
            b = mf["body"]
            check("start_url 指向 index.html", b.get("start_url") == "./index.html", str(b.get("start_url")))
            check("display = standalone", b.get("display") == "standalone", str(b.get("display")))
            check("含 maskable 图标", any(i.get("purpose") == "maskable" for i in b.get("icons", [])))
            check("manifest 名称为新名且无旧名残留",
                  "肘边备急" in str(b.get("name")) and not re.search("齿康保|chikangbao", str(b)),
                  f"{b.get('name')} / {b.get('short_name')}")

            print("\n[3] 图标可访问", flush=True)
            for ic in b.get("icons", []):
                r = await page.evaluate(
                    "async (u) => (await fetch(u)).status", f"http://127.0.0.1:{port}/{ic['src']}")
                check(f"{ic['src']} 可访问", r == 200, f"status={r}")

        print("\n[4] Service Worker", flush=True)
        sw = await page.evaluate("""async () => {
            if (!('serviceWorker' in navigator)) return {ok: false, why: 'unsupported'};
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return {ok: false, why: 'not registered'};
            return {ok: true, scope: reg.scope, active: !!reg.active};
        }""")
        check("SW 注册成功", sw.get("ok"), str(sw.get("why")))
        check("SW 已激活", sw.get("active"), str(sw))

        # 离线可用性：断开网络后重载
        print("\n[5] 离线可用", flush=True)
        await ctx.set_offline(True)
        try:
            await page.reload()
            await page.wait_for_timeout(1500)
            offline_ok = await page.locator(".city-pill").count() == 5
            gross = await page.locator("#mGross").inner_text()
            check("断网后可重新打开", offline_ok)
            check("断网后仍可计算", gross == "¥377.00", gross)
            check("断网后文书模块可用",
                  await page.locator("#consentLibrary .consent-card").count() == 22,
                  f"count={await page.locator('#consentLibrary .consent-card').count()}")
            check("断网后病历模块可用",
                  await page.locator("#recordForm .rec-field").count() == 8,
                  f"count={await page.locator('#recordForm .rec-field').count()}")
            check("断网后项目详情可打开",
                  await page.evaluate("""() => {
                      const rows = document.querySelectorAll('.item-row');
                      return rows.length > 0 && typeof openItemDetail === 'function';
                  }"""))
            check("断网后助手知识库可用",
                  await page.evaluate(
                      "() => MUTEX_BOUNDARIES.length === 18 && TREATMENT_COMBOS.length >= 25"
                      " && document.querySelectorAll('#advFeeSplit .fs-card').length === 7"))
        except Exception as e:
            check("断网后可重新打开", False, str(e)[:80])
        finally:
            await ctx.set_offline(False)

        # 汇总 + 硬退出都放在 async with 内部：
        # Playwright 的 __aexit__/stop() 在本机偶发无限阻塞，放在外面根本跑不到。
        passed = sum(1 for r in results if r[0])
        print("\n" + "=" * 56, flush=True)
        print(f"通过 {passed}/{len(results)}", flush=True)
        if errors:
            print("\n控制台错误：", flush=True)
            for e in errors:
                print("  ! " + e, flush=True)
        sys.stdout.flush()
        os._exit(0 if passed == len(results) and not errors else 1)


asyncio.run(main())
