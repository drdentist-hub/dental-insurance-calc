# -*- coding: utf-8 -*-
"""
从国家医保局《口腔类医疗服务价格项目立项指南(试行)》(医保价采函〔2025〕18号)
官方原表 _scratch/gg114.xlsx 生成 src/data/items114.js

为什么用生成器而不是手抄：114 条主项目 + 81 条加收项，手工录入必然出错。
用法：
  "C:/Users/drqua/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/gen_items114.py
"""
import json
import pathlib

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "_scratch" / "gg114.xlsx"
OUT = ROOT / "src" / "data" / "items114.js"

# 项目名 -> 分类。全部显式声明，避免靠编码前缀猜。
CATEGORY = {
    # 检查
    "牙髓活力测验费": "exam", "颌位转移检查费": "exam", "全口牙周系统检查费": "exam",
    "牙周探诊费": "exam", "牙周指数检查费": "exam", "咬合力检测费": "exam",
    "下颌运动功能检查费": "exam", "咀嚼效率检查费": "exam", "唾液腺功能测定费": "exam",
    # 牙体牙髓
    "橡皮障隔离费": "endo", "牙体开髓引流费": "endo", "牙髓失活费": "endo",
    "干髓治疗费": "endo", "根管预备费": "endo", "根管冲洗费": "endo",
    "根管充填费": "endo", "根管再治疗费": "endo", "根管内异物取出费": "endo",
    "活髓保存治疗费": "endo", "牙髓再生治疗费": "endo", "牙体缺损直接粘接修复费": "endo",
    "根尖诱导成形费": "endo", "根尖屏障手术费": "endo", "根尖手术费": "endo",
    # 牙周
    "牙周冲洗上药费": "perio", "牙周塞治费": "perio", "龈上洁治费": "perio",
    "牙面抛光费": "perio", "牙面喷砂费": "perio", "龈下刮治费": "perio",
    "松牙固定费": "perio", "松牙固定拆除费": "perio", "调𬌗治疗费": "perio",
    "牙根牵引费": "perio", "根面平整费": "perio", "牙周翻瓣费": "perio",
    "牙龈成形费": "perio", "游离龈移植费": "perio", "引导性牙周组织再生费": "perio",
    "牙周纤维环状切断费": "perio", "口内游离软组织移植费": "perio",
    "口腔骨突修整费": "perio", "口腔系带修整费": "perio",
    # 预防与美白
    "窝沟封闭费": "prevent", "氟防龋治疗费": "prevent", "牙脱敏治疗费": "prevent",
    "牙齿内漂白费": "esthetic", "全口牙齿漂白费": "esthetic", "前牙形态修复费": "esthetic",
    # 外科
    "牙拔除费": "surgery", "阻生牙拔除费": "surgery", "阻生牙开窗助萌费": "surgery",
    "阻生牙牙冠切除费": "surgery", "拔牙创搔刮费": "surgery", "阻生牙龈瓣修整费": "surgery",
    "预防性拔牙窝组织封闭费": "surgery", "牙移植费": "surgery",
    "口腔良性肿物切除费": "surgery", "颌骨病变刮切费（口内）": "surgery",
    "颌骨病变刮切费（颌面部）": "surgery", "颌骨囊肿减压费": "surgery",
    "口腔牵引钉植入费": "surgery", "口腔牵引钉取出费": "surgery",
    "牙槽突骨折复位固定费": "surgery", "脓肿切开引流费（口内）": "surgery",
    "脓肿切开引流费（颌面部）": "surgery", "下牙槽神经探查解剖费": "surgery",
    "口腔上颌窦瘘修补费": "surgery", "皮质骨切开费": "surgery",
    # 正畸
    "乳牙期错合矫治费（常规）": "ortho", "乳牙期错合矫治费（复杂）": "ortho",
    "替牙期Ⅰ类错合矫治费（常规）": "ortho", "替牙期Ⅰ类错合矫治费（复杂）": "ortho",
    "替牙期Ⅱ类错合矫治费（常规）": "ortho", "替牙期Ⅱ类错合矫治费（复杂）": "ortho",
    "替牙期Ⅲ类错合矫治费（常规）": "ortho", "替牙期Ⅲ类错合矫治费（复杂）": "ortho",
    "恒牙期Ⅰ类错合矫治费（常规）": "ortho", "恒牙期Ⅰ类错合矫治费（复杂）": "ortho",
    "恒牙期Ⅱ类错合矫治费（常规）": "ortho", "恒牙期Ⅱ类错合矫治费（复杂）": "ortho",
    "恒牙期Ⅲ类错合矫治费（常规）": "ortho", "恒牙期Ⅲ类错合矫治费（复杂）": "ortho",
    "恒牙期Ⅰ类错合矫形功能治疗费": "ortho", "恒牙期Ⅱ类错合矫形功能治疗费": "ortho",
    "恒牙期Ⅲ类错合矫形功能治疗费": "ortho", "局部正畸矫治费": "ortho",
    "口腔固定保持器安装费": "ortho", "口腔固定保持器拆除费": "ortho",
    "错合畸形治疗设计费": "ortho", "正畸支抗钉植入费": "ortho",
    "新生儿唇腭裂术前治疗费": "ortho",
    "睡眠呼吸暂停综合征口腔正畸辅助治疗费": "ortho",
    # 修复
    "预成冠修复费": "prostho", "临时固定修复费": "prostho", "修复体固定修复费": "prostho",
    "桩核修复费": "prostho", "附着体修复费": "prostho", "全口义齿修复费": "prostho",
    "胶连可摘局部义齿修复费": "prostho", "铸造支架可摘局部义齿修复费": "prostho",
    "颌骨/腭部缺损赝复体修复费（常规）": "prostho", "颌骨/腭部缺损赝复体修复费（复杂）": "prostho",
    "面部缺损赝复体修复费": "prostho", "修复体拆除费": "prostho", "修复体维护费": "prostho",
    # 其他治疗
    "颌间结扎费": "other", "颌间结扎拆除费": "other", "口腔无回吸辅助治疗费": "other",
    "咬合板治疗费": "other", "唾液腺药物灌注费": "other",
    "口腔黏膜病局部药物治疗费": "other", "唾液腺导管取石费": "other",
    "唾液腺导管治疗费": "other",
}

INS_MAP = {
    "甲类": "甲类",
    "乙类": "乙类",
    "丙类": "自费",
    "甲类（限：乳牙自费）": "甲类",
}

# 价格限制/常量——抽取为可追溯的注释来源
EXTRA_NOTE = {
    "牙拔除费": "甲类属性仅限符合规定情形；乳牙拔除为自费。政府指导价 90 元/牙（三级），不得上浮。",
}


def s(v):
    """单元格转字符串；openpyxl 会把纯数字读成 int/float"""
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def num(v):
    v = s(v)
    if v in ("", "-"):
        return None
    if "市场调节价" in v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def price_literal(v):
    n = num(v)
    if n is None:
        return "null"
    return str(int(n)) if n == int(n) else str(n)


def js_str(s):
    return json.dumps(s or "", ensure_ascii=False)


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["口腔类"]

    rows = []
    for r in ws.iter_rows(min_row=7, values_only=True):
        if r[0] is None or s(r[0]) == "":
            continue
        code = s(r[1])
        if not code:
            continue
        rows.append({
            "seq": s(r[0]),
            "code": code,
            "name": s(r[2]),
            "output": s(r[3]),          # 服务产出
            "composition": s(r[4]),     # 价格构成
            "unit": s(r[5]),            # 计价单位
            "exclusions": s(r[6]),      # 除外内容
            "t3": num(r[7]), "t2": num(r[8]), "t1": num(r[9]),
            "raw_price": s(r[7]),
            "note": s(r[10]),           # 计价说明
            "ins": s(r[11]),
        })

    mains = [x for x in rows if x["code"].endswith("0000")]
    addons = [x for x in rows if not x["code"].endswith("0000")]

    unmapped = [x["name"] for x in mains if x["name"] not in CATEGORY]
    if unmapped:
        raise SystemExit("以下主项目未指定分类，请补 CATEGORY：\n  " + "\n  ".join(unmapped))
    if len(mains) != 114:
        raise SystemExit(f"主项目数不是 114，实际 {len(mains)}，请核对源表")

    def emit(items, is_addon):
        out = []
        for x in items:
            cat = CATEGORY.get(x["name"], "other")
            if is_addon:
                cat = CATEGORY.get(x["name"].split("-")[0], "other")
            ins = INS_MAP.get(x["ins"], "自费")
            # restrictions = 界面上「⚠ 提示行」展示的合集（官方计价说明 + 程序推断的风险提示）
            # billingNote = 官方「计价说明」原文，供详情弹层单列展示
            notes = [x["note"]] if x["note"] else []
            if x["raw_price"] == "市场调节价":
                notes.append("价格类型为市场调节价，由医疗机构自主定价（丙类）。")
            if x["name"] in EXTRA_NOTE:
                notes.append(EXTRA_NOTE[x["name"]])
            restriction = "；".join(n for n in notes if n)
            out.append(
                "  {\n"
                f"    code: {js_str(x['code'])},\n"
                f"    name: {js_str(x['name'])},\n"
                f"    category: {js_str(cat)},\n"
                f"    insuranceType: {js_str(ins)},\n"
                f"    priceLevel3: {price_literal(x['t3'])},\n"
                f"    priceLevel2: {price_literal(x['t2'])},\n"
                f"    priceLevel1: {price_literal(x['t1'])},\n"
                f"    unit: {js_str(x['unit'])},\n"
                f"    copayRate: {'0.0' if ins == '甲类' else ('0.10' if ins == '乙类' else '1.0')},\n"
                f"    output: {js_str(x['output'])},\n"
                f"    composition: {js_str(x['composition'])},\n"
                f"    exclusions: {js_str(x['exclusions'])},\n"
                f"    billingNote: {js_str(x['note'])},\n"
                f"    restrictions: {js_str(restriction)},\n"
                f"    isAddon: {'true' if is_addon else 'false'}\n"
                "  }"
            )
        return ",\n".join(out)

    header = '''/**
 * 国家医保局《口腔类医疗服务价格项目立项指南（试行）》规范整合项目表
 * 依据：医保价采函〔2025〕18号
 * 数据来源：国家医保局统一发布的《口腔类医疗服务价格项目》官方表（各省对接落地时同一份底表）
 *
 * 结构：114 项主项目 + 81 项加收/分项
 * 价格：政府指导价（最高限价），三级/二级/一级三档；医疗机构不得上浮，下浮不限
 * 医保属性：甲类 / 乙类 / 丙类（丙类即全自费）
 *
 * ⚠️ 本文件由 tools/gen_items114.py 从官方原表生成，请勿手工编辑。
 *    如需更新版本，替换 _scratch/gg114.xlsx 后重跑生成脚本。
 */

export const ITEMS_114_META = {
  id: 'gg114',
  name: '2025 立项指南版（114 项）',
  shortName: '114 项版',
  docNo: '医保价采函〔2025〕18号',
  docName: '国家医保局《口腔类医疗服务价格项目立项指南（试行）》',
  effective: '各省自 2026 年起陆续执行（河北 2026-03-01、福建/厦门 2026-10-15 等）',
  mainCount: 114,
  addonCount: 81,
  keyChanges: [
    '由「按诊疗步骤」改为「按服务产出」设项：原「根管治疗术」拆分为根管预备费、根管冲洗费、根管充填费三个独立项目',
    '「基本物质资源消耗」成本计入项目价格，不另行收费：镍钛锉、棉球(卷)、棉签、纱布、印模材、咬合纸、充填材料、根管封闭剂、盖髓材料、一次性吸唾管、氟化物等一律不得单收',
    '除基本物耗外的其他耗材，按实际采购价格零差率销售',
    '错合矫治：方案设计属诊查治疗应尽事项，不得同时收取设计费',
    '矫治器、保持器、运动护齿等个性化产品采取「产品化」定价，由机构自主确定价格，不再按制作步骤拆分设立项目',
    '根尖手术类别中「口腔内植骨费」适用范围扩大：牙槽骨增量手术费、牙周植骨费可按此项目计费',
    '「复杂」情形满足任意一种即算复杂，不同复杂情况不得累计叠加收费',
    '手术类项目面向 6 周岁及以下儿童统一落实儿童加收，加收项已单列，不得自行加收',
    '所定价格为最高限价，不得上浮、下浮不限'
  ]
};

/** 114 项主项目 */
export const ITEMS_114_MAIN = [
'''

    footer = '''
];

/** 81 项加收 / 分项（本身不可单独作为主项目收费，须挂靠对应主项目） */
export const ITEMS_114_ADDONS = [
'''

    tail = '''
];

/** 合并导出，便于检索 */
export const ITEMS_114_ALL = ITEMS_114_MAIN.concat(ITEMS_114_ADDONS);

/** 114 版分类（顺序即界面展示顺序；addon 为伪分类，仅收录加收项） */
export const CATEGORIES_114 = [
  { id: 'all', name: '全部主项目' },
  { id: 'exam', name: '检查与诊断' },
  { id: 'imaging', name: '影像检查（放射）' },
  { id: 'endo', name: '牙体牙髓' },
  { id: 'perio', name: '牙周治疗' },
  { id: 'surgery', name: '拔牙与外科' },
  { id: 'prostho', name: '修复' },
  { id: 'ortho', name: '正畸矫治' },
  { id: 'prevent', name: '预防与脱敏' },
  { id: 'esthetic', name: '美白与美学' },
  { id: 'other', name: '其他治疗' },
  { id: 'addon', name: '加收/分项' }
];
'''

    js = header + emit(mains, False) + footer + emit(addons, True) + tail
    # newline="\n"：固定写 LF，避免 Windows 上 write_text 默认转成 CRLF
    # （行尾在 LF/CRLF 之间反复横跳会让 diff 失真，也可能干扰按行解析的校验脚本）
    OUT.write_text(js, encoding="utf-8", newline="\n")

    from collections import Counter
    print(f"已生成 {OUT.relative_to(ROOT)}")
    print(f"  主项目 {len(mains)} 条 | 加收分项 {len(addons)} 条")
    print("  医保属性分布：", dict(Counter(x['insuranceType'] for x in
          [{"insuranceType": INS_MAP.get(m['ins'], '自费')} for m in mains])))
    print("  分类分布：", dict(Counter(CATEGORY[m['name']] for m in mains)))


if __name__ == "__main__":
    main()
