"""移动端 UI 验证：真机视口渲染 + 交互流程 + 关键断言 + 截图

覆盖：
  - 移动端布局与触控目标
  - 搜索后结果可见、可整行点选（回归：曾经"看得到搜不到、点不到"）
  - 114 版立项指南条目接入 + 版本切换器
  - 114 版专属红线（牙体开髓引流费 × 根管治疗 = FATAL）
  - 税务参数自由修改
  - 状态持久化、桌面端适配
"""
import asyncio
import os
import pathlib
import subprocess
import sys

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "dist" / "index.html").as_uri()
OUT = ROOT / "_scratch"
OUT.mkdir(exist_ok=True)

results = []
errors = []
T = 8000  # 单步超时，避免整轮挂死


def check(name, cond, detail=""):
    cond = bool(cond)
    results.append((cond, name, detail))
    print(("  ✅ " if cond else "  ❌ ") + name + (f"   [{detail}]" if detail and not cond else ""), flush=True)


async def main():
    # 清理上一次硬退出遗留的 headless 浏览器进程
    try:
        subprocess.run(["taskkill", "/F", "/IM", "chrome-headless-shell.exe", "/T"],
                       capture_output=True, timeout=15)
    except Exception:
        pass

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()

        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent=("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"),
        )
        page = await ctx.new_page()
        page.set_default_timeout(T)
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        await page.goto(URL)
        await page.wait_for_timeout(500)

        print("\n[1] 初始渲染（默认 114 项版）", flush=True)
        check("页面标题为新名「肘边备急」", "肘边备急" in await page.title(), await page.title())
        check("标题不含旧名「齿康保」", "齿康保" not in await page.title())
        check("页头品牌名已更新", "肘边备急" in await page.locator(".brand-title").inner_text(),
              await page.locator(".brand-title").inner_text())
        check("城市胶囊渲染 5 个", await page.locator(".city-pill").count() == 5)
        check("版本胶囊渲染 2 个", await page.locator(".ver-pill").count() == 2,
              f"count={await page.locator('.ver-pill').count()}")
        check("默认选中 114 项版", "114" in await page.locator(".ver-pill.active").inner_text(),
              await page.locator(".ver-pill.active").inner_text())
        meta = await page.locator("#versionMeta").inner_text()
        check("版本说明含立项指南文号", "医保价采函" in meta, meta[:40])
        check("项目库有内容", await page.locator(".item-row").count() > 20,
              f"count={await page.locator('.item-row').count()}")
        check("主项目计数 122 项（114 口腔类 + 8 影像类）", "122" in await page.locator("#itemCount").inner_text(),
              await page.locator("#itemCount").inner_text())
        check("处方默认 4 项", await page.locator(".presc-card").count() == 4,
              f"count={await page.locator('.presc-card').count()}")
        check("原价总额 ¥377.00（一级价合计）", await page.locator("#mGross").inner_text() == "¥377.00",
              await page.locator("#mGross").inner_text())
        fund = await page.locator("#mFund").inner_text()
        pat = await page.locator("#mPatient").inner_text()
        check("统筹支付有值", fund.startswith("¥") and fund != "¥0.00", fund)
        check("患者自付有值", pat.startswith("¥") and pat != "¥0.00", pat)

        print("\n[2] 移动端布局", flush=True)
        of = await page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("无横向溢出", of <= 1, f"溢出 {of}px")
        small = await page.evaluate("""() => {
            const sel = '.city-pill,.cat-btn,.add-btn,.detail-btn,.qty-btn,.del-btn,.tab,.tax-pill,.ver-pill,.result-clear,.link-btn,.sug-chip,.search-clear,input:not([type=checkbox]),label.chk,select';
            const bad = [];
            document.querySelectorAll(sel).forEach(el => {
                if (el.offsetParent === null) return;
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return;
                if (r.height < 36) bad.push(el.className + '=' + Math.round(r.height));
            });
            return bad.slice(0, 5);
        }""")
        check("触控目标高度均 ≥36px", not small, "; ".join(small))
        check("底部控制台可见", await page.locator(".dock").is_visible())
        check("底部页签 8 个（开单/精算/风控/助手/文书/病历/方案/报税）",
              await page.locator(".dock .tab").count() == 8,
              f"count={await page.locator('.dock .tab').count()}")
        check("8 个页签全部落在视口内（无横向挤爆）", await page.evaluate("""() => {
            const vw = document.documentElement.clientWidth;
            return [...document.querySelectorAll('.dock .tab')].every(t => {
                const r = t.getBoundingClientRect();
                return r.x >= -0.5 && r.right <= vw + 0.5;
            });
        }"""))
        check("结算条显示统筹金额", (await page.locator("#dockFund").inner_text()).startswith("¥"))

        # 小屏回归：7 个页签必须挤得下（360px 是最窄的常见安卓视口）
        await page.set_viewport_size({"width": 360, "height": 780})
        await page.wait_for_timeout(500)
        of360 = await page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("360px 小屏无横向溢出", of360 <= 1, f"溢出 {of360}px")
        check("360px 下 7 个页签仍全部在视口内", await page.evaluate("""() => {
            const vw = document.documentElement.clientWidth;
            return [...document.querySelectorAll('.dock .tab')].every(t => {
                const r = t.getBoundingClientRect();
                return r.x >= -0.5 && r.right <= vw + 0.5 && r.width >= 40;
            });
        }"""))
        check("360px 下品牌标题与副标题均未被省略号截断", await page.evaluate("""() => {
            return ['.brand-title', '.brand-sub'].every(sel => {
                const el = document.querySelector(sel);
                return el.scrollWidth <= el.clientWidth + 1;
            });
        }"""), await page.evaluate("""() => {
            return ['.brand-title', '.brand-sub'].map(sel => {
                const el = document.querySelector(sel);
                return sel + ' ' + el.scrollWidth + '/' + el.clientWidth;
            }).join('  ');
        }"""))
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.wait_for_timeout(400)

        print("\n[3] 搜索 → 项目详情弹层 → 加入处方", flush=True)
        check("搜索前结果条隐藏", not await page.locator("#resultBar").is_visible())
        check("搜索前显示搜索范围提示", await page.locator("#searchHint").is_visible())
        await page.locator("#itemSearchInput").fill("引流")
        await page.wait_for_timeout(400)
        cnt = await page.locator(".item-row").count()
        check("搜索有命中结果", cnt >= 1, f"count={cnt}")
        check("结果提示条出现", await page.locator("#resultBar").is_visible())
        check("有搜索词时范围提示自动隐藏", not await page.locator("#searchHint").is_visible())
        check("搜索框内置清除按钮出现", await page.locator("#itemSearchClear").is_visible())
        rtext = await page.locator("#resultText").inner_text()
        check("结果条显示命中数", "命中" in rtext and "引流" in rtext, rtext)
        first = (await page.locator(".item-row .item-name").first.inner_text()).strip()
        check("相关度排序：首条为牙体开髓引流费", "开髓引流" in first, f"首条={first}")
        check("命中的关键词被高亮", await page.locator(".item-row mark.hl").count() >= 1,
              f"count={await page.locator('.item-row mark.hl').count()}")
        box = await page.locator(".item-row").first.bounding_box()
        vh = 844
        check("首条结果落在可视区内", box is not None and box["y"] < vh - 60,
              f"y={box['y'] if box else None}")

        # 点整行左侧（item-info 区域）→ 打开详情弹层
        await page.mouse.click(box["x"] + 20, box["y"] + 20)
        await page.wait_for_timeout(450)
        check("点击卡片打开项目详情弹层", await page.locator("#itemSheet").is_visible())
        check("详情标题为项目名", "开髓引流" in await page.locator("#itemSheetTitle").inner_text(),
              await page.locator("#itemSheetTitle").inner_text())
        det = await page.locator("#itemSheetBody").inner_text()
        check("详情含「服务产出」", "服务产出" in det, det[:60])
        check("详情含「价格构成」", "价格构成" in det)
        check("详情含三档价格（三级/二级/一级）",
              await page.locator("#itemSheetBody .price-cell").count() == 3,
              f"count={await page.locator('#itemSheetBody .price-cell').count()}")
        check("详情标注当前机构级别价", "本院" in det)
        check("详情含医保属性说明", "统筹基数" in det or "先行自付" in det, det[:80])
        check("详情页脚有加入按钮", await page.locator("#itemSheetFoot .btn-primary").is_visible())
        await page.screenshot(path=str(OUT / "m11-item-detail.png"))

        await page.locator("#itemSheetFoot .btn-primary").click()
        await page.wait_for_timeout(400)
        check("弹层内加入处方生效", await page.locator(".presc-card").count() == 5,
              f"处方数={await page.locator('.presc-card').count()}")
        check("弹层内数量状态回显", "已入选" in await page.locator("#itemSheetFoot").inner_text(),
              await page.locator("#itemSheetFoot").inner_text())
        await page.locator("#itemSheet .sheet-head .btn-ghost").click()
        await page.wait_for_timeout(300)
        check("详情弹层可关闭", not await page.locator("#itemSheet").is_visible())
        check("已选状态回写到列表行", await page.locator(".item-row.added").count() >= 1)

        print("\n[4] 搜索结果条可清除 / 可搜详情字段", flush=True)
        await page.locator("#resultBar .result-clear").click()
        await page.wait_for_timeout(400)
        check("清除后搜索框为空", await page.locator("#itemSearchInput").input_value() == "")
        check("清除后结果条隐藏", not await page.locator("#resultBar").is_visible())
        check("清除后恢复分类全量列表", await page.locator(".item-row").count() > 20,
              f"count={await page.locator('.item-row').count()}")
        check("清除后范围提示重新出现", await page.locator("#searchHint").is_visible())
        check("清除后内置清除按钮隐藏", not await page.locator("#itemSearchClear").is_visible())

        # 搜「除外内容」字段：矫治器只出现在除外内容里，验证搜索已覆盖详情字段
        await page.locator("#itemSearchInput").fill("矫治器")
        await page.wait_for_timeout(400)
        ex_n = await page.locator(".item-row").count()
        check("可按「除外内容」字段搜索", ex_n >= 5, f"count={ex_n}")
        check("命中非主字段时给出摘要行", await page.locator(".item-excerpt").count() >= 1,
              f"count={await page.locator('.item-excerpt').count()}")
        check("命中提示条说明命中的字段", "服务产出" in await page.locator("#itemList").inner_text())
        # 空结果 → 推荐关键词
        await page.locator("#itemSearchInput").fill("zzz不存在的项目")
        await page.wait_for_timeout(400)
        check("无结果时显示推荐关键词", await page.locator(".sug-chip").count() >= 4,
              f"count={await page.locator('.sug-chip').count()}")
        await page.locator(".sug-chip").first.click()
        await page.wait_for_timeout(400)
        check("点推荐词直接出结果", await page.locator(".item-row").count() >= 1,
              f"count={await page.locator('.item-row').count()}")
        await page.locator("#itemSearchClear").click()
        await page.wait_for_timeout(400)
        check("内置清除按钮可用", await page.locator("#itemSearchInput").input_value() == "")

        print("\n[4b] 影像检查（放射类）项目可检索", flush=True)
        await page.locator("#itemSearchInput").fill("X线摄影")
        await page.wait_for_timeout(400)
        n_xray = await page.locator(".item-row").count()
        check("搜「X线摄影」有命中", n_xray >= 3, f"count={n_xray}")
        names = await page.locator(".item-row .item-name").all_inner_texts()
        check("命中含「X线摄影成像」", any("X线摄影成像" in x for x in names), str(names[:4]))
        check("命中含「口腔曲面体层成像」", any("曲面体层" in x for x in names), str(names[:6]))

        await page.locator("#itemSearchInput").fill("全景片")
        await page.wait_for_timeout(400)
        n_pano = await page.locator(".item-row").count()
        check("口语叫法「全景片」可检索", n_pano >= 1, f"count={n_pano}")
        pano_first = (await page.locator(".item-row .item-name").first.inner_text()).strip()
        check("「全景片」首条为口腔曲面体层成像", "曲面体层" in pano_first, pano_first)

        await page.locator("#itemSearchInput").fill("CBCT")
        await page.wait_for_timeout(400)
        n_cbct = await page.locator(".item-row").count()
        check("「CBCT」可检索", n_cbct >= 1, f"count={n_cbct}")
        cbct_first = (await page.locator(".item-row .item-name").first.inner_text()).strip()
        check("「CBCT」首条为锥形束CT扩展项", "锥形束" in cbct_first, cbct_first)

        await page.locator("#itemSearchInput").fill("012301010010000")
        await page.wait_for_timeout(400)
        check("可按 15 位编码检索", await page.locator(".item-row").count() >= 1,
              f"count={await page.locator('.item-row').count()}")
        b = await page.locator(".item-row").first.bounding_box()
        await page.mouse.click(b["x"] + 20, b["y"] + 20)
        await page.wait_for_timeout(450)
        check("影像项目详情可打开", await page.locator("#itemSheet").is_visible())
        d2 = await page.locator("#itemSheetBody").inner_text()
        check("详情含「常用叫法」", "常用叫法" in d2, d2[:80])
        check("详情含「各地指导价参考」", "各地指导价参考" in d2)
        check("各地参考价含 4 个城市",
              await page.locator("#itemSheetBody .det-region-table tbody tr").count() == 4,
              f"count={await page.locator('#itemSheetBody .det-region-table tbody tr').count()}")
        await page.screenshot(path=str(OUT / "m12-imaging-detail.png"))
        await page.locator("#itemSheet .sheet-head .btn-ghost").click()
        await page.wait_for_timeout(250)
        check("影像详情弹层可关闭", not await page.locator("#itemSheet").is_visible())
        await page.locator("#itemSearchClear").click()
        await page.wait_for_timeout(400)
        check("影像检索后可恢复全量列表", await page.locator(".item-row").count() > 20,
              f"count={await page.locator('.item-row').count()}")

        print("\n[5] Tab 导航", flush=True)
        check("开单面板可见", await page.locator('section[data-view="order"]').first.is_visible())
        check("精算面板初始隐藏", not await page.locator('section[data-view="calc"]').first.is_visible())
        await page.locator('.tab[data-tab="calc"]').click()
        await page.wait_for_timeout(250)
        check("切到精算后面板显示", await page.locator('section[data-view="calc"]').first.is_visible())
        check("切到精算后开单隐藏", not await page.locator('section[data-view="order"]').first.is_visible())
        check("税务模式 5 个", await page.locator("#taxPills .tax-pill").count() == 5)
        await page.screenshot(path=str(OUT / "m2-calc.png"), full_page=True)

        print("\n[6] 税务参数自由修改", flush=True)
        vat = page.locator("#taxVatInput")
        await vat.click()
        await vat.fill("")
        await vat.press_sequentially("1.5", delay=50)
        await page.wait_for_timeout(250)
        check("输入框内容未被重写", await vat.input_value() == "1.5", f"实际={await vat.input_value()}")
        check("自动切到自定义模式", "自定义" in await page.locator("#taxPills .tax-pill.active").inner_text(),
              await page.locator("#taxPills .tax-pill.active").inner_text())
        check("净利润随税率重算", await page.locator("#mNetProfit").inner_text() != "¥0.00",
              await page.locator("#mNetProfit").inner_text())
        check("税负率已更新", "%" in await page.locator("#mTaxIncomeSub").inner_text(),
              await page.locator("#mTaxIncomeSub").inner_text())

        print("\n[7] 114 版红线拦截（承接 [3] 加入的牙体开髓引流费）", flush=True)
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(200)
        score = int(await page.locator("#radarScore .num").inner_text())
        check("加入开髓引流费后安全分下降", score < 100, f"分数={score}")
        check("触发 FATAL 等级", "FATAL" in (await page.locator("#radarBanner").get_attribute("class")),
              await page.locator("#radarBanner").get_attribute("class"))
        check("底部状态条变红", "FATAL" in (await page.locator("#dockRisk").get_attribute("class")),
              await page.locator("#dockRisk").get_attribute("class"))
        await page.screenshot(path=str(OUT / "m1-order.png"), full_page=True)

        print("\n[8] 风控页签（114 版规则文案）", flush=True)
        await page.locator('.tab[data-tab="risk"]').click()
        await page.wait_for_timeout(300)
        check("风控 Tab 红点角标出现", await page.locator("#riskTabBadge").is_visible())
        check("违规卡片渲染", await page.locator(".violation").count() >= 1,
              f"count={await page.locator('.violation').count()}")
        body = await page.locator("#violationList").inner_text()
        check("定位到开髓引流重复计费", "开髓引流" in body, body[:60])
        check("引用 114 版计价说明", "价格构成" in body or "不单独收费" in body, body[:80])
        check("含整改指引", "整改指引" in body)
        check("含飞检后果", "飞检后果" in body)
        await page.screenshot(path=str(OUT / "m3-risk.png"), full_page=True)

        print("\n[9] 最优方案", flush=True)
        await page.locator('.tab[data-tab="plan"]').click()
        await page.wait_for_timeout(300)
        plans = await page.locator(".plan").count()
        check("方案 ≥3 套", plans >= 3, f"count={plans}")
        check("出现合规净化方案", "净化" in await page.locator("#planList").inner_text())
        await page.screenshot(path=str(OUT / "m4-plan.png"), full_page=True)

        print("\n[10] 费用明细弹层", flush=True)
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(200)
        await page.locator(".link-btn").first.click()
        await page.wait_for_timeout(400)
        check("弹层打开", await page.locator("#breakdownSheet").is_visible())
        check("明细表有行", await page.locator(".detail-table tbody tr").count() >= 5,
              f"rows={await page.locator('.detail-table tbody tr').count()}")
        await page.screenshot(path=str(OUT / "m5-sheet.png"))
        await page.locator("#breakdownSheet .btn-ghost").click()
        await page.wait_for_timeout(250)
        check("弹层可关闭", not await page.locator("#breakdownSheet").is_visible())

        print("\n[11] 知情同意书（自动输出 / 手动检索 / 预览 / 打印）", flush=True)
        check("文书样式已注入", await page.evaluate("() => !!document.getElementById('consentDocStyles')"))
        check("打印宿主存在且屏幕上隐藏",
              await page.evaluate("() => { const h = document.getElementById('printHost'); return !!h && getComputedStyle(h).display === 'none'; }"))
        await page.locator('.tab[data-tab="consent"]').click()
        await page.wait_for_timeout(450)
        check("文书面板显示", await page.locator('section[data-view="consent"]').first.is_visible())

        auto = await page.locator("#autoConsentList .consent-card").count()
        check("自动匹配到 ≥4 份同意书", auto >= 4, f"count={auto}")
        summary = await page.locator("#autoConsentSummary").inner_text()
        check("摘要说明已自动生成并加入", "自动生成并加入" in summary, summary)
        auto_titles = await page.locator("#autoConsentList .consent-card-title").all_inner_texts()
        check("含根管治疗同意书", any("根管治疗" in t for t in auto_titles), str(auto_titles))
        check("含牙体开髓引流急症同意书", any("开髓引流" in t for t in auto_titles), str(auto_titles))
        check("含局部麻醉同意书", any("局部麻醉" in t for t in auto_titles), str(auto_titles))
        check("含阻生牙拔除同意书", any("阻生牙" in t for t in auto_titles), str(auto_titles))

        sel0 = await page.locator("#consentSelList .consent-card").count()
        check("选中项目即自动进入已选清单（自动输出）", sel0 == auto, f"{sel0} vs {auto}")
        check("已选清单标注「处方自动匹配」",
              "处方自动匹配" in await page.locator("#consentSelList").inner_text())
        check("文书页签角标显示份数", await page.locator("#consentTabBadge").is_visible())
        await page.screenshot(path=str(OUT / "m7-consent.png"), full_page=True)

        await page.locator("#consentSelList .consent-card").first.locator(".link-btn").last.click()
        await page.wait_for_timeout(400)
        sel1 = await page.locator("#consentSelList .consent-card").count()
        check("移除后清单减少一份", sel1 == sel0 - 1, f"{sel0} → {sel1}")
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(300)
        await page.locator('.tab[data-tab="consent"]').click()
        await page.wait_for_timeout(450)
        check("已移除的文书不会被自动加回",
              await page.locator("#consentSelList .consent-card").count() == sel1,
              f"count={await page.locator('#consentSelList .consent-card').count()}")
        check("摘要提示可重新纳入",
              "重新纳入" in await page.locator("#autoConsentSummary").inner_text(),
              await page.locator("#autoConsentSummary").inner_text())
        await page.locator('section[data-view="consent"] .auto-head .link-btn').click()
        await page.wait_for_timeout(400)
        check("「全部纳入」恢复被移除的文书",
              await page.locator("#consentSelList .consent-card").count() == auto,
              f"count={await page.locator('#consentSelList .consent-card').count()}")

        await page.locator("#consentSearchInput").fill("种植")
        await page.wait_for_timeout(450)
        check("文书检索结果条出现", await page.locator("#consentResultBar").is_visible())
        lib = await page.locator("#consentLibrary .consent-card").count()
        check("文书库有检索结果", lib >= 1, f"count={lib}")
        first_lib = (await page.locator("#consentLibrary .consent-card-title").first.inner_text()).strip()
        check("检索首条为口腔种植同意书", "种植" in first_lib, first_lib)
        boxc = await page.locator("#consentLibrary .consent-card").first.bounding_box()
        check("检索结果落在可视区内", boxc is not None and boxc["y"] < 844 - 60,
              f"y={boxc['y'] if boxc else None}")
        before = await page.locator("#consentSelList .consent-card").count()
        await page.mouse.click(boxc["x"] + 20, boxc["y"] + 18)
        await page.wait_for_timeout(400)
        check("手动检索点击即可加入文书",
              await page.locator("#consentSelList .consent-card").count() == before + 1,
              f"{before} → {await page.locator('#consentSelList .consent-card').count()}")
        await page.locator("#consentResultBar .result-clear").click()
        await page.wait_for_timeout(300)
        check("文书检索可清除", await page.locator("#consentSearchInput").input_value() == ""
              and not await page.locator("#consentResultBar").is_visible())

        print("\n[12] 文书抬头信息与预览", flush=True)
        # 检索框聚焦会自动收起抬头面板（保证结果可见），这里重新展开再填
        toggle = page.locator('.collapse-toggle[data-target="consentPatient"]')
        check("检索聚焦自动收起抬头面板", await toggle.get_attribute("aria-expanded") == "false",
              await toggle.get_attribute("aria-expanded"))
        await toggle.click()
        await page.wait_for_timeout(300)
        check("抬头面板可重新展开", await toggle.get_attribute("aria-expanded") == "true")
        await page.locator("#cp_patientName").fill("李四")
        await page.locator("#cp_recordNo").fill("2026-000888")
        await page.locator("#cp_tooth").fill("36")
        await page.wait_for_timeout(250)
        check("抬头输入不被回写（光标不跳）", await page.locator("#cp_patientName").input_value() == "李四",
              await page.locator("#cp_patientName").input_value())

        await page.locator("#consentSelList .consent-card").first.locator(".link-btn").first.click()
        await page.wait_for_timeout(450)
        check("文书预览弹层打开", await page.locator("#consentSheet").is_visible())
        check("文书标题渲染", await page.locator("#consentDocBody .doc-title").count() >= 1)
        check("签署区 ≥3 个", await page.locator("#consentDocBody .doc-sign").count() >= 3,
              f"count={await page.locator('#consentDocBody .doc-sign').count()}")
        check("抬头带入患者姓名", "李四" in await page.locator("#consentDocBody").inner_text())
        check("含诊疗项目清单表", await page.locator("#consentDocBody .doc-table tbody tr").count() >= 1)
        await page.screenshot(path=str(OUT / "m8-consent-doc.png"))
        await page.locator("#consentSheet .btn-ghost").last.click()
        await page.wait_for_timeout(300)
        check("预览弹层可关闭", not await page.locator("#consentSheet").is_visible())

        await page.locator('section[data-view="consent"] .consent-actions .btn-ghost').first.click()
        await page.wait_for_timeout(500)
        check("全文预览含全部已选文书",
              await page.locator("#consentDocBody .consent-doc").count() == 5,
              f"count={await page.locator('#consentDocBody .consent-doc').count()}")
        docbody = await page.locator("#consentDocBody").inner_text()
        check("全文预览带入抬头信息", "李四" in docbody and "2026-000888" in docbody)

        # 打印链路：替换 window.print 避免真实弹窗，验证 printHost 被填充且打印媒体下只输出文书
        await page.evaluate("() => { window.__printed = 0; window.print = () => { window.__printed++; }; }")
        await page.locator("#consentSheet .btn-ghost").first.click()
        await page.wait_for_timeout(400)
        check("点击打印触发打印调用", await page.evaluate("() => window.__printed") == 1)
        check("打印宿主已灌入文书 HTML",
              await page.evaluate("() => document.getElementById('printHost').innerHTML.length") > 500)
        await page.emulate_media(media="print")
        await page.wait_for_timeout(200)
        check("打印媒体下页面外壳隐藏",
              await page.evaluate("() => getComputedStyle(document.querySelector('.app-header')).display") == "none")
        check("打印媒体下仅打印宿主可见",
              await page.evaluate("() => getComputedStyle(document.getElementById('printHost')).display") == "block")
        await page.emulate_media(media="screen")
        await page.evaluate("() => { document.getElementById('printHost').innerHTML = ''; }")
        await page.locator("#consentSheet .btn-ghost").last.click()
        await page.wait_for_timeout(300)

        print("\n[12b] 医保门诊病历（自动草稿 / 医生补齐 / 患者信息复用）", flush=True)
        await page.locator('.tab[data-tab="record"]').click()
        await page.wait_for_timeout(500)
        check("病历面板显示", await page.locator('section[data-view="record"]').first.is_visible())
        check("患者信息字段渲染 6 项", await page.locator("#recordPatientFields .field").count() == 6,
              f"count={await page.locator('#recordPatientFields .field').count()}")
        check("患者信息与知情同意书共用（自动带出李四）",
              await page.locator("#rp_patientName").input_value() == "李四",
              await page.locator("#rp_patientName").input_value())
        check("病历段落表单渲染 8 段", await page.locator("#recordForm .rec-field").count() == 8,
              f"count={await page.locator('#recordForm .rec-field').count()}")
        check("科室下拉有选项", await page.locator("#rec_department option").count() >= 5)

        diag = await page.locator("#rec_diagnosis").input_value()
        treat = await page.locator("#rec_treatment").input_value()
        check("诊断草稿自动生成", len(diag) > 0, diag[:40])
        check("处置草稿含处方项目名", "开髓引流" in treat or "根管" in treat, treat[:60])
        check("草稿段落标记为「自动草稿」",
              "自动草稿" in await page.locator("#recordForm .rec-field-state").first.inner_text())
        await page.screenshot(path=str(OUT / "m9-record.png"), full_page=True)

        # 医生改写 → 标记「已修改」，且处方变化时不覆盖
        await page.locator("#rec_diagnosis").fill("46 急性牙髓炎（医生判定）")
        await page.wait_for_timeout(300)
        check("改写后段落标记为「已修改」",
              "已修改" in await page.locator('.rec-field-state[data-for="diagnosis"]').inner_text(),
              await page.locator('.rec-field-state[data-for="diagnosis"]').inner_text())
        check("顶部状态条显示已修改段数",
              "已修改" in await page.locator("#recordStatusNote").inner_text(),
              await page.locator("#recordStatusNote").inner_text())

        # 病历页改患者信息 → 知情同意书页同步
        await page.locator("#rp_tooth").fill("46")
        await page.wait_for_timeout(300)
        await page.locator('.tab[data-tab="consent"]').click()
        await page.wait_for_timeout(400)
        check("病历页改患牙位 → 知情同意书页同步",
              await page.locator("#cp_tooth").input_value() == "46",
              await page.locator("#cp_tooth").input_value())
        await page.locator('.tab[data-tab="record"]').click()
        await page.wait_for_timeout(500)
        check("切回病历页改写内容仍在",
              await page.locator("#rec_diagnosis").input_value() == "46 急性牙髓炎（医生判定）",
              await page.locator("#rec_diagnosis").input_value())

        # 处方变动 → 草稿刷新但不覆盖医生改写
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(300)
        rx_before = await page.locator(".presc-card").count()
        await page.locator("#itemSearchInput").fill("洁治")
        await page.wait_for_timeout(400)
        if await page.locator(".item-row").count() > 0:
            await page.locator(".item-row").first.locator(".add-btn").click()
            await page.wait_for_timeout(400)
        check("新增项目进入处方（触发处方变动）",
              await page.locator(".presc-card").count() == rx_before + 1,
              f"{rx_before} → {await page.locator('.presc-card').count()}")
        await page.locator("#itemSearchClear").click()
        await page.wait_for_timeout(300)
        await page.locator('.tab[data-tab="record"]').click()
        await page.wait_for_timeout(500)
        check("处方变化不覆盖医生改写的诊断",
              await page.locator("#rec_diagnosis").input_value() == "46 急性牙髓炎（医生判定）",
              await page.locator("#rec_diagnosis").input_value())
        await page.locator('section[data-view="record"] .auto-head .link-btn').click()
        await page.wait_for_timeout(400)
        check("「重新生成草稿」清空改动标记",
              "自动草稿" in await page.locator("#recordForm .rec-field-state").first.inner_text())

        # 预览
        await page.locator('section[data-view="record"] .consent-actions .btn-ghost').first.click()
        await page.wait_for_timeout(500)
        check("病历预览弹层打开", await page.locator("#consentSheet").is_visible())
        check("渲染为病历文书", await page.locator("#consentDocBody .record-doc").count() == 1,
              f"count={await page.locator('#consentDocBody .record-doc').count()}")
        rec_body = await page.locator("#consentDocBody").inner_text()
        check("病历含患者姓名", "李四" in rec_body)
        check("病历含本次项目清单表", await page.locator("#consentDocBody .doc-table tbody tr").count() >= 5,
              f"rows={await page.locator('#consentDocBody .doc-table tbody tr').count()}")
        check("病历含 8 个段落标题",
              await page.locator("#consentDocBody .rec-sec .rec-h").count() >= 9,
              f"count={await page.locator('#consentDocBody .rec-sec .rec-h').count()}")
        check("病历含医师签名区", await page.locator("#consentDocBody .rec-signs").count() == 1)
        await page.screenshot(path=str(OUT / "m10-record-doc.png"))

        # 打印链路
        await page.evaluate("() => { window.__printed = 0; window.print = () => { window.__printed++; }; }")
        await page.locator("#consentSheet .btn-ghost").first.click()
        await page.wait_for_timeout(400)
        check("病历打印触发打印调用", await page.evaluate("() => window.__printed") == 1)
        check("打印宿主已灌入病历 HTML",
              await page.evaluate("() => document.getElementById('printHost').innerHTML.includes('record-doc')"))
        await page.evaluate("() => { document.getElementById('printHost').innerHTML = ''; }")
        await page.locator("#consentSheet .btn-ghost").last.click()
        await page.wait_for_timeout(300)
        check("病历预览弹层可关闭", not await page.locator("#consentSheet").is_visible())

        print("\n[12c] 医生合规助手（叠加收费边界 / 治疗组合 / 合规自查 / 营销场景 / 技耗分离）", flush=True)
        await page.locator('.tab[data-tab="advisor"]').click()
        await page.wait_for_timeout(600)
        check("助手页签激活",
              "active" in (await page.locator('.tab[data-tab="advisor"]').get_attribute("class")))
        check("助手面板显示", await page.locator('section[data-view="advisor"]').first.is_visible())

        # ---- A. 叠加收费边界（随处方实时） ----
        check("叠加收费边界区已渲染", await page.locator("#advBoundaryList").is_visible())
        n_bd = await page.locator("#advBoundaryList .adv-boundary").count()
        check("默认处方命中收费边界（根管冲洗费 ↔ 根管预备费）", n_bd >= 1, f"count={n_bd}")
        check("边界卡片含冲突原因 / 可单独收费前提",
              await page.locator("#advBoundaryList .ab-row").count() >= 2 * n_bd,
              f"rows={await page.locator('#advBoundaryList .ab-row').count()} cards={n_bd}")
        check("边界卡片含「病历必须写明」话术",
              await page.locator("#advBoundaryList .ab-script").count() == n_bd,
              f"count={await page.locator('#advBoundaryList .ab-script').count()}")
        check("助手页签徽标显示待确认数",
              await page.locator("#advisorTabBadge").is_visible() and
              int((await page.locator("#advisorTabBadge").inner_text()).strip()) == n_bd,
              await page.locator("#advisorTabBadge").inner_text())
        check("板块说明显示待确认摘要", "待确认" in await page.locator("#advNote").inner_text(),
              await page.locator("#advNote").inner_text())

        # ---- B. 治疗方案标准组合 ----
        await page.locator('.collapse-toggle[data-target="advCombo"]').click()
        await page.wait_for_timeout(400)
        check("治疗组合区展开", await page.locator("#advComboList").is_visible())
        check("分组胶囊 3 个（种植 / 正畸 / 全部）",
              await page.locator("#advComboGroup .seg-btn").count() == 3,
              f"count={await page.locator('#advComboGroup .seg-btn').count()}")
        check("默认种植组列出 8 个组合",
              await page.locator("#advComboList .combo-card").count() == 8,
              f"count={await page.locator('#advComboList .combo-card').count()}")
        check("组合卡片标注项目库收录情况",
              await page.locator("#advComboList .combo-lib").count() == 8,
              f"count={await page.locator('#advComboList .combo-lib').count()}")
        await page.locator("#advComboGroup .seg-btn", has_text="正畸").click()
        await page.wait_for_timeout(300)
        check("切到正畸组列出 22 个组合",
              await page.locator("#advComboList .combo-card").count() == 22,
              f"count={await page.locator('#advComboList .combo-card').count()}")
        await page.locator("#advComboSearch").fill("保持器")
        await page.wait_for_timeout(400)
        n_keep = await page.locator("#advComboList .combo-card").count()
        check("组合检索命中（保持器）", n_keep == 2, f"count={n_keep}")
        await page.locator("#advComboSearch").fill("")
        await page.wait_for_timeout(300)
        await page.locator("#advComboGroup .seg-btn", has_text="全部").click()
        await page.wait_for_timeout(300)
        check("「全部」列出 30 个组合",
              await page.locator("#advComboList .combo-card").count() == 30,
              f"count={await page.locator('#advComboList .combo-card').count()}")

        # ---- C. 医保税务合规自查 ----
        await page.locator('.collapse-toggle[data-target="advCheck"]').click()
        await page.wait_for_timeout(400)
        check("合规自查模块 9 个",
              await page.locator("#advCheckList .check-mod").count() == 9,
              f"count={await page.locator('#advCheckList .check-mod').count()}")
        check("自查进度初始 0/9", "0/9" in await page.locator("#advCheckDone").inner_text(),
              await page.locator("#advCheckDone").inner_text())
        await page.locator("#advCheckList .check-mod-head input").first.check()
        await page.wait_for_timeout(400)
        check("勾选后进度 1/9", "1/9" in await page.locator("#advCheckDone").inner_text(),
              await page.locator("#advCheckDone").inner_text())
        check("进度条宽度随勾选更新",
              await page.evaluate("() => document.querySelector('.check-track i').style.width") != "0%")
        check("模块含自查要点 ≥30 条",
              await page.locator("#advCheckList .check-ol li").count() >= 30,
              f"count={await page.locator('#advCheckList .check-ol li').count()}")
        check("模块含高频违规 ≥30 条",
              await page.locator("#advCheckList .check-vio span").count() >= 30,
              f"count={await page.locator('#advCheckList .check-vio span').count()}")
        check("每个模块都有合格标准",
              await page.locator("#advCheckList .check-std").count() == 9,
              f"count={await page.locator('#advCheckList .check-std').count()}")

        # ---- D. 营销 / 优惠场景合规 ----
        await page.locator('.collapse-toggle[data-target="advMarketing"]').click()
        await page.wait_for_timeout(400)
        check("营销场景 6 类",
              await page.locator("#advMarketingList .mk-card").count() == 6,
              f"count={await page.locator('#advMarketingList .mk-card').count()}")
        check("营销铁律提示条渲染", await page.locator("#advMarketingList .mk-iron").count() == 1)
        await page.locator("#advMarketingList .mk-head").first.click()
        await page.wait_for_timeout(300)
        check("营销卡片可展开明细",
              await page.locator("#advMarketingList .mk-card.open").count() == 1,
              f"count={await page.locator('#advMarketingList .mk-card.open').count()}")
        check("场景含「绝对禁止动作」段",
              await page.locator("#advMarketingList .mk-sec.forbid").count() == 6,
              f"count={await page.locator('#advMarketingList .mk-sec.forbid').count()}")

        # ---- E. 技耗分离与税负口径 ----
        await page.locator('.collapse-toggle[data-target="advFeeSplit"]').click()
        await page.wait_for_timeout(400)
        check("税率矩阵 7 个收入类别卡片",
              await page.locator("#advFeeSplit .fs-card").count() == 7,
              f"count={await page.locator('#advFeeSplit .fs-card').count()}")
        check("每类含一般/小规模两行 × 3 档税率筹码",
              await page.locator("#advFeeSplit .fs-line").count() == 14 and
              await page.locator("#advFeeSplit .fs-chip").count() == 42,
              f"lines={await page.locator('#advFeeSplit .fs-line').count()} "
              f"chips={await page.locator('#advFeeSplit .fs-chip').count()}")
        check("税率矩阵无横向滚动容器（改用卡片式）",
              await page.locator("#advFeeSplit .fs-table-wrap").count() == 0)
        check("当前处方归类 3 格（基础项目 / 加收 / 耗材）",
              await page.locator("#advFeeSplit .fs-cell").count() == 3,
              f"count={await page.locator('#advFeeSplit .fs-cell').count()}")
        check("技耗分离结论输出", len((await page.locator("#advFeeSplit .fs-concl").inner_text()).strip()) > 10)
        of_adv = await page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("助手页 5 个面板全展开后无横向溢出", of_adv <= 1, f"溢出 {of_adv}px")
        await page.screenshot(path=str(OUT / "m13-advisor.png"), full_page=True)

        print("\n[13] 城市切换（上海）", flush=True)
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(200)
        await page.locator(".city-pill").nth(3).click()
        await page.wait_for_timeout(500)
        check("政策条切到上海", "上海" in await page.locator("#policyBanner").inner_text())
        check("上海起付线 1500 生效", "1500" in await page.locator("#stripDeductible").inner_text(),
              await page.locator("#stripDeductible").inner_text())

        print("\n[14] 状态持久化（刷新）", flush=True)
        await page.reload()
        await page.wait_for_timeout(700)
        check("刷新后城市保持", "上海" in await page.locator("#policyBanner").inner_text())
        check("刷新后版本保持 114", "114" in await page.locator(".ver-pill.active").inner_text())
        check("刷新后处方保持 6 项", await page.locator(".presc-card").count() == 6,
              f"count={await page.locator('.presc-card').count()}")
        check("刷新后文书清单保持", await page.locator("#consentSelList .consent-card").count() >= 4,
              f"count={await page.locator('#consentSelList .consent-card').count()}")
        check("刷新后抬头信息保持", await page.locator("#cp_patientName").input_value() == "李四",
              await page.locator("#cp_patientName").input_value())
        check("刷新后病历患牙位保持", await page.locator("#rp_tooth").input_value() == "46",
              await page.locator("#rp_tooth").input_value())
        await page.locator('.tab[data-tab="advisor"]').click()
        await page.wait_for_timeout(500)
        check("刷新后合规自查勾选保持",
              "1/9" in await page.locator("#advCheckDone").inner_text(),
              await page.locator("#advCheckDone").inner_text())
        await page.locator('.tab[data-tab="record"]').click()
        await page.wait_for_timeout(500)
        check("刷新后病历草稿仍在", len(await page.locator("#rec_diagnosis").input_value()) > 0)
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(300)

        print("\n[15] 版本切换（114 ↔ 旧版规范）", flush=True)
        await page.locator(".ver-pill").nth(1).click()
        await page.wait_for_timeout(500)
        check("切换后旧版胶囊激活", "旧版" in await page.locator(".ver-pill.active").inner_text(),
              await page.locator(".ver-pill.active").inner_text())
        check("不兼容处方已移出", await page.locator(".presc-card").count() == 0,
              f"count={await page.locator('.presc-card').count()}")
        old_code = (await page.locator(".item-row .item-code").first.inner_text()).strip()
        check("旧版项目编码为 9 位数字码（310xxxxx / 330xxxxx）",
              len(old_code) == 9 and old_code.isdigit(), old_code)
        check("旧版说明条切换", "旧版" in await page.locator("#versionMeta").inner_text())
        await page.screenshot(path=str(OUT / "m6-legacy.png"), full_page=True)
        await page.locator(".ver-pill").nth(0).click()
        await page.wait_for_timeout(500)
        check("切回 114 版成功", "114" in await page.locator(".ver-pill.active").inner_text())
        new_code = (await page.locator(".item-row .item-code").first.inner_text()).strip()
        check("114 版编码恢复为 15 位数字码", len(new_code) == 15 and new_code.isdigit(), new_code)

        print("\n[15b] 关于 · 开源声明", flush=True)
        check("头部有「关于」入口",
              await page.locator('.icon-btn[aria-label="关于与开源声明"]').count() == 1)
        await page.locator('.icon-btn[aria-label="关于与开源声明"]').click()
        await page.wait_for_timeout(500)
        check("关于弹层打开", await page.locator("#aboutSheet").is_visible())
        about = await page.locator("#aboutBody").inner_text()
        check("显示产品名", "肘边备急" in about)
        # 版本号动态取 APP_INFO，避免每次升版都要改测试
        ver, rel = await page.evaluate(
            "() => [APP_INFO.version, APP_INFO.releaseDate]")
        check(f"显示版本号与发布日（{ver} / {rel}）",
              ver in about and rel in about,
              [l for l in about.split("\n") if "版本" in l][:1])
        check("hero 标注 GPL-3.0 许可", "GPL-3.0" in about,
              [l for l in about.split("\n") if "GPL" in l][:1])
        check("含名字典故出处（肘后备急方）", "肘后备急方" in about)
        check("开源声明标明著作权人",
              "开源软件" in about and "Contributors" in about)
        check("许可须知含「可以」条款（含商业使用、内部自用无需公开修改）",
              "包括商业使用" in about and "无需公开你的修改" in about)
        check("许可须知含「必须」条款（对外分发须以 GPL-3.0 提供源码）",
              "完整可编译的源码" in about and "标明你做了哪些修改" in about)
        check("许可须知含「不可以」条款（不得并入闭源专有软件）",
              "闭源专有软件" in about and "不得" in about)
        check("说明「挂到网上供他人访问也构成分发」", "同样构成「分发」" in about)
        check("点明 GPL-3.0 与 AGPL-3.0 的差别在服务端", "AGPL-3.0" in about)
        check("给出 HIS 集成边界提示", "HIS" in about)
        check("零第三方依赖声明", "第三方" in about and "无" in about)
        check("列出内置数据来源（两份立项指南文号）",
              "医保价采函〔2025〕18号" in about and "医保价采函〔2024〕233号" in about)
        check("免责声明含 5 条",
              await page.locator("#aboutBody .about-warn li").count() == 5,
              f"count={await page.locator('#aboutBody .about-warn li').count()}")
        check("免责声明覆盖医保/税务/医师决策",
              "不构成医保结算依据" in about and "税务" in about and "执业资质" in about)
        # 许可全文可展开（GPL-3.0 第 4 条要求分发时随附许可原文）
        await page.locator("#aboutBody .about-details summary").click()
        await page.wait_for_timeout(300)
        lic_text = await page.locator("#aboutBody .about-pre").inner_text()
        check("GPL-3.0 许可全文可展开查看",
              "GNU GENERAL PUBLIC LICENSE" in lic_text
              and "Version 3, 29 June 2007" in lic_text
              and "TERMS AND CONDITIONS" in lic_text,
              lic_text[:60])
        check("许可全文含第 15/17 条（完整原文，非摘要）",
              "15. Disclaimer of Warranty" in lic_text
              and "17. Interpretation of Sections 15 and 16" in lic_text)
        check("许可全文体积达官方原文量级（≥30KB）", len(lic_text) >= 30000,
              f"len={len(lic_text)}")
        check("提供「复制 GPL-3.0 全文」按钮",
              await page.locator("#aboutBody .about-actions .btn-ghost").count() == 1
              and "GPL-3.0" in await page.locator("#aboutBody .about-actions .btn-ghost").inner_text())
        of_about = await page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("关于弹层无横向溢出", of_about <= 1, f"溢出 {of_about}px")
        await page.screenshot(path=str(OUT / "m14-about.png"), full_page=True)
        # ⚠️ #aboutSheet 下有两个 .btn-ghost（头部关闭 + 复制许可全文），选择器必须按容器限定
        await page.locator("#aboutSheet .sheet-head .btn-ghost").click()
        await page.wait_for_timeout(300)
        check("关于弹层可关闭", not await page.locator("#aboutSheet").is_visible())

        print("\n[15c] 报税与缴税助手（身份 / 台账 / 申报表底稿 / 风险 / 日历 / 导出）", flush=True)
        await page.locator('.tab[data-tab="tax"]').click()
        await page.wait_for_timeout(350)
        tax_sec = page.locator('section[data-view="tax"]').first
        check("报税页签切入并显示", await tax_sec.is_visible())
        check("其他页已隐藏", not await page.locator('section[data-view="order"]').first.is_visible())
        check("纳税人身份 4 种", await page.locator("#entityPills .tax-pill").count() == 4,
              f"count={await page.locator('#entityPills .tax-pill').count()}")
        check("默认小规模企业",
              "小规模" in await page.locator("#entityPills .tax-pill.active").inner_text())
        check("身份说明非空", len(await page.locator("#entityDesc").inner_text()) > 10)
        check("申报期下拉可选", await page.locator("#txPeriodSelect option").count() >= 4)
        check("城建税三档", await page.locator("#txCitySeg button").count() == 3)
        check("空台账有引导提示", "暂无台账" in await page.locator("#ledgerList").inner_text())

        # 录入一条：医疗 80 万（免税）+ 耗材 5 万（应税），季度申报
        await page.fill("#txMedical", "800000")
        await page.fill("#txConsumable", "50000")
        await page.fill("#txCost", "500000")
        await page.click(".tx-form-actions .btn-primary")
        await page.wait_for_timeout(400)
        check("台账新增 1 条", await page.locator(".ledger-item").count() == 1,
              f"count={await page.locator('.ledger-item').count()}")

        r = await page.evaluate("() => window.__lastTaxResult")
        check("精算结果已生成", r is not None)
        check("免税收入 800000", abs(r["revenue"]["medical"] - 800000) < 0.01, str(r["revenue"]))
        check("应税收入 50000", abs(r["revenue"]["consumable"] - 50000) < 0.01)
        check("免税占比 94.1%（技耗分离指标）", abs(r["revenue"]["exemptShare"] - 94.1) < 0.2,
              str(r["revenue"]["exemptShare"]))
        check("起征点只看应税部分（未达 30 万）", r["vat"]["belowThreshold"] is True,
              str(r["vat"]["taxableNet"]))
        check("未达起征点增值税为 0", abs(r["vat"]["payable"]) < 0.01)

        check("底稿行数 ≥ 15", await page.locator(".filing-row").count() >= 15,
              f"count={await page.locator('.filing-row').count()}")
        check("显示小规模申报表名称", "小规模" in await page.locator("#filingFormName").inner_text())
        line12 = page.locator('.filing-row:has(.fr-no:text-is("12"))')
        check("第 12 栏 = 其他免税销售额（医疗服务填这里）", await line12.count() == 1)
        check("第 12 栏金额 = 800000", "800000" in await line12.locator(".fr-val").inner_text(),
              await line12.locator(".fr-val").inner_text())
        check("第 22 栏（本期应补退税额）存在",
              await page.locator('.filing-row:has(.fr-no:text-is("22"))').count() == 1)
        check("第 23~25 栏（附加税费）齐全",
              await page.locator('.filing-row:has(.fr-no:text-is("23"))').count() == 1
              and await page.locator('.filing-row:has(.fr-no:text-is("25"))').count() == 1)

        check("命中税务风险 ≥1 条", await page.locator(".tax-risk").count() >= 1)
        check("存在 FATAL 级风险（耗材打包未拆分）",
              await page.locator(".tax-risk.lv-fatal").count() >= 1)
        await page.uncheck("#txSeparated")
        await page.wait_for_timeout(350)
        check("取消「已分别核算」后 FATAL 风险增加",
              await page.locator(".tax-risk.lv-fatal").count() >= 2,
              f"count={await page.locator('.tax-risk.lv-fatal').count()}")
        await page.check("#txSeparated")
        await page.wait_for_timeout(300)

        check("最近一期申报截止卡片存在", await page.locator(".cal-next-date").count() == 1)
        due = await page.locator(".cal-next-date").inner_text()
        check("截止日格式 YYYY-MM-DD", len(due) == 10 and due[4] == "-", due)
        check("日历行 ≥5", await page.locator(".cal-row").count() >= 5)
        cal_text = await page.locator("#filingCal").inner_text()
        check("季度截止日为季末次月 15 日（Q1 → 04-15，不是 03-15）",
              "2026-04-15" in cal_text and "2026-03-15" not in cal_text,
              cal_text[:80])
        check("含年度汇算清缴", "汇算清缴" in cal_text)

        # 跨过起征点：再补 40 万应税
        await page.fill("#txConsumable", "400000")
        await page.click(".tx-form-actions .btn-primary")
        await page.wait_for_timeout(400)
        r = await page.evaluate("() => window.__lastTaxResult")
        check("已达季度起征点", r["vat"]["belowThreshold"] is False)
        check("应纳增值税 ≈ 4455.45（减按 1%）", abs(r["vat"]["payable"] - 4455.45) < 1.0,
              str(r["vat"]["payable"]))
        check("第 15 栏按 3% 计（> 第 20 栏）", r["vat"]["line15"] > r["vat"]["payable"],
              f"15={r['vat']['line15']} 20={r['vat']['payable']}")
        check("第 16 栏减征额 > 0", r["vat"]["line16"] > 0)
        check("六税两费已减半", r["surcharge"]["halved"] is True)
        check("附加税费 > 0", r["surcharge"]["total"] > 0)

        # 个体户身份：改缴经营所得个税
        await page.click('#entityPills .tax-pill:has-text("个体户")')
        await page.wait_for_timeout(400)
        r = await page.evaluate("() => window.__lastTaxResult")
        check("切换为个体工商户", r["entity"]["id"] == "individual_business")
        check("所得税类型变为经营所得", r["income"]["type"] == "iit", r["income"]["type"])
        check("经营所得含 200 万减半字段", "reliefAmount" in r["income"])
        check("个体户未达起征点填第 11 栏",
              await page.locator('.filing-row:has(.fr-no:text-is("11"))').count() == 1)
        await page.click('#entityPills .tax-pill:has-text("小规模")')
        await page.wait_for_timeout(300)

        # 布局
        of_tax = await page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("报税页无横向溢出", of_tax <= 1, f"溢出 {of_tax}px")
        small_tax = await page.evaluate("""() => {
            const bad = [];
            document.querySelectorAll('section[data-view="tax"] button, section[data-view="tax"] input:not([type=checkbox]), section[data-view="tax"] label.chk, section[data-view="tax"] select').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.height > 0 && r.height < 36) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.height));
            });
            return bad.slice(0, 8);
        }""")
        check("报税页触控目标 ≥36px", len(small_tax) == 0, str(small_tax))
        font_tax = await page.evaluate("""() => {
            const bad = [];
            ['txMedical','txConsumable','txCosmetic','txCost','txDate'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const fs = parseFloat(getComputedStyle(el).fontSize);
                if (fs < 16) bad.push(id + ':' + fs);
            });
            return bad;
        }""")
        check("报税表单字号 ≥16px", len(font_tax) == 0, str(font_tax))
        await page.screenshot(path=str(OUT / "m15c-tax.png"), full_page=True)

        # 导出底稿
        exported = await page.evaluate("""() => {
            try {
                let got = null;
                const orig = window.downloadFile;
                window.downloadFile = (text, name) => { got = { text, name }; };
                exportFilingSheet();
                window.downloadFile = orig;
                if (!got) return { error: 'downloadFile 未被调用' };
                return {
                    len: got.text.length,
                    name: got.name,
                    hasLine: got.text.includes('栏'),
                    hasRisk: got.text.includes('税务风险自检'),
                    hasPolicy: got.text.includes('政策口径')
                };
            } catch (e) { return { error: String(e) }; }
        }""")
        check("报税底稿可导出", "error" not in exported, str(exported))
        check("底稿含申报表栏次", exported.get("hasLine") is True)
        check("底稿含风险自检段落", exported.get("hasRisk") is True)
        check("底稿标注政策口径", exported.get("hasPolicy") is True)
        check("底稿文件名含「报税底稿」", "报税底稿" in exported.get("name", ""),
              exported.get("name"))

        await page.reload()
        await page.wait_for_timeout(600)
        await page.locator('.tab[data-tab="tax"]').click()
        await page.wait_for_timeout(400)
        check("刷新后台账保留 2 条", await page.locator(".ledger-item").count() == 2,
              f"count={await page.locator('.ledger-item').count()}")

        print("\n[15d] 结算自动入账（医生不用填税表，点一下即记账）", flush=True)
        await page.locator('.tab[data-tab="order"]').click()
        await page.wait_for_timeout(300)

        # 保证有可结算的处方
        has_rx = await page.evaluate("() => state.prescription.length")
        if has_rx == 0:
            await page.fill("#itemSearchInput", "根管")
            await page.wait_for_timeout(500)
            await page.locator("#itemList .add-btn").first.click()
            await page.wait_for_timeout(350)

        settle_btn = page.locator("#dockSettle")
        check("底部有「结算」按钮", await settle_btn.count() == 1)
        check("有处方时可点结算", not await settle_btn.is_disabled())
        h = (await settle_btn.bounding_box() or {}).get("height", 0)
        check("结算按钮触控高度 ≥36px", h >= 36, f"h={h}")

        before = await page.evaluate("() => state.taxLedger.length")
        await settle_btn.click()
        await page.wait_for_timeout(450)
        check("结算弹层打开", await page.locator("#settleSheet").is_visible())
        check("实收金额自动带出",
              (await page.locator("#stRevenue").inner_text()) != "¥0.00",
              await page.locator("#stRevenue").inner_text())
        check("结算日期默认今天", len(await page.locator("#stDate").input_value()) == 10)
        check("成本已按成本率自动估算",
              float(await page.locator("#stCost").input_value() or 0) > 0)
        check("材料销售输入默认隐藏", not await page.locator("#stTaxableWrap").is_visible())
        check("默认全部记为医疗服务免税",
              await page.locator("#stTax").inner_text() == "¥0.00")
        check("提示将记入哪一期", "将记入" in await page.locator("#stPeriodHint").inner_text())

        # 勾选材料销售，验证拆分与上限夹取
        await page.check("#stMaterial")
        await page.wait_for_timeout(250)
        check("勾选后材料金额框出现", await page.locator("#stTaxableWrap").is_visible())
        rev_txt = await page.locator("#stRevenue").inner_text()
        rev = float(rev_txt.replace("¥", "").replace(",", ""))
        mat = round(rev * 0.4, 2)
        await page.fill("#stTaxable", str(mat))
        await page.wait_for_timeout(300)
        ex_txt = await page.locator("#stExempt").inner_text()
        check("免税 = 实收 − 应税",
              abs(float(ex_txt.replace("¥", "").replace(",", "")) - (rev - mat)) < 0.01,
              f"{ex_txt} vs {rev}-{mat}")
        await page.fill("#stTaxable", "99999999")
        await page.wait_for_timeout(300)
        check("材料金额被夹到实收上限",
              float(await page.locator("#stTaxable").input_value()) <= rev + 0.01)
        check("免税不会为负",
              float((await page.locator("#stExempt").inner_text()).replace("¥", "").replace(",", "")) >= 0)
        await page.fill("#stTaxable", str(mat))
        await page.wait_for_timeout(250)

        await page.click(".settle-actions .btn-primary")
        await page.wait_for_timeout(650)
        check("确认后弹层关闭", not await page.locator("#settleSheet").is_visible())
        left = await page.evaluate("() => state.prescription.length")
        check("结算后处方自动清空", left == 0, f"剩 {left} 条")
        check("空处方时结算按钮置灰", await settle_btn.is_disabled())
        after = await page.evaluate("() => state.taxLedger.length")
        check("台账自动 +1 条", after == before + 1, f"{before} → {after}")
        last = await page.evaluate("() => state.taxLedger[state.taxLedger.length - 1]")
        check("入账记录带 source=settle", last.get("source") == "settle", str(last.get("source")))
        check("入账记录含免税金额", round(last.get("medical", 0), 2) == round(rev - mat, 2), str(last))
        check("入账记录含应税金额", round(last.get("consumable", 0), 2) == mat, str(last))

        # 报税页结论卡：把「交多少 / 什么时候交」说成人话
        await page.locator('.tab[data-tab="tax"]').click()
        await page.wait_for_timeout(600)
        concl = page.locator("#txConclusion")
        check("报税页顶部有自动结论卡", await concl.count() == 1)
        ct = await concl.inner_text()
        check("结论卡显示预计应缴税费", "预计应缴税费" in ct, ct[:60])
        check("结论卡显示申报截止日", "申报截止" in ct)
        check("结论卡显示实收合计（不再误显示 ¥0.00）",
              "实收 ¥0.00" not in ct, ct[:140])
        check("结论卡给出一句人话结论",
              ("不用交税" in ct) or ("未达起征点" in ct) or ("应缴" in ct), ct[-80:])
        of_concl = await page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("结论卡无横向溢出", of_concl <= 1, f"溢出 {of_concl}px")
        await page.screenshot(path=str(OUT / "m15d-settle.png"), full_page=False)

        print("\n[16] 桌面端适配", flush=True)
        ctx2 = await browser.new_context(viewport={"width": 1440, "height": 900})
        p2 = await ctx2.new_page()
        p2.set_default_timeout(T)
        await p2.goto(URL)
        await p2.wait_for_timeout(700)
        check("桌面端精算面板可见", await p2.locator('section[data-view="calc"]').first.is_visible())
        check("桌面端风控面板可见", await p2.locator('section[data-view="risk"]').first.is_visible())
        check("桌面端文书面板可见", await p2.locator('section[data-view="consent"]').first.is_visible())
        check("桌面端病历面板可见", await p2.locator('section[data-view="record"]').first.is_visible())
        check("桌面端病历段落表单已渲染", await p2.locator("#recordForm .rec-field").count() == 8,
              f"count={await p2.locator('#recordForm .rec-field').count()}")
        check("桌面端助手面板可见", await p2.locator('section[data-view="advisor"]').first.is_visible())
        check("桌面端助手面板 5 个折叠区已渲染",
              await p2.locator('section[data-view="advisor"] .collapse-toggle').count() == 5,
              f"count={await p2.locator('section[data-view=\"advisor\"] .collapse-toggle').count()}")
        check("桌面端助手「叠加收费边界」已有内容（首屏即渲染）",
              await p2.locator("#advBoundaryList .adv-boundary, #advBoundaryList .adv-ok").count() >= 1)
        check("桌面端报税面板可见", await p2.locator('section[data-view="tax"]').first.is_visible())
        check("桌面端报税身份药丸已渲染",
              await p2.locator('#entityPills .tax-pill').count() == 4,
              f"count={await p2.locator('#entityPills .tax-pill').count()}")
        check("桌面端申报表底稿已渲染（首屏即出）",
              await p2.locator('#filingRows .filing-row').count() >= 15,
              f"count={await p2.locator('#filingRows .filing-row').count()}")
        check("桌面端助手税率矩阵已渲染",
              await p2.locator("#advFeeSplit .fs-card").count() == 7,
              f"count={await p2.locator('#advFeeSplit .fs-card').count()}")
        check("桌面端营销场景已渲染",
              await p2.locator("#advMarketingList .mk-card").count() == 6,
              f"count={await p2.locator('#advMarketingList .mk-card').count()}")
        check("桌面端隐藏底部控制台", not await p2.locator(".dock").is_visible())
        check("桌面端项目列表用内层滚动",
              await p2.evaluate("() => getComputedStyle(document.getElementById('itemList')).overflowY") == "auto")
        of2 = await p2.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("桌面端无横向溢出", of2 <= 1, f"溢出 {of2}px")
        await p2.screenshot(path=str(OUT / "desktop.png"), full_page=True)

        passed = sum(1 for r in results if r[0])
        print("\n" + "=" * 58, flush=True)
        print(f"通过 {passed}/{len(results)}", flush=True)
        if errors:
            print("\n控制台错误：", flush=True)
            for e in errors:
                print("  ! " + e, flush=True)
        print("截图目录: " + str(OUT), flush=True)
        sys.stdout.flush()
        # Playwright 驱动的 __aexit__/stop() 在本机偶发无限阻塞，
        # 直接硬退出保证脚本可被自动化消费；残留 headless 进程由下次运行开头清理。
        os._exit(0 if passed == len(results) and not errors else 1)


asyncio.run(main())
