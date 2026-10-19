/**
 * 口腔门诊电子病历（医保门诊病历）模板库
 * ------------------------------------------------------------------
 * 依据《病历书写基本规范》（卫医政发〔2010〕11 号）与《医疗机构病历管理规定》
 * 门诊病历必备要素：主诉、现病史、既往史、过敏史、口腔检查、辅助检查、
 * 诊断、治疗处置、医嘱、医师签名。
 *
 * 设计原则：
 *   1) 按「项目分类」自动生成草稿，医生只需补齐与修正，不写字数从零开始；
 *   2) 生成的内容一律是可编辑文本，允许医生整段改写；
 *   3) 患者识别信息（姓名/性别/年龄/病历号/患牙）与知情同意书共用同一份数据，
 *      避免同一台机器上两处各填一遍。
 *
 * ⚠️ 本文件仅为文书模板数据，不含任何诊疗决策逻辑，最终以医师判断为准。
 */

/** 病历中「需医生补齐/确认」的字段定义（UI 渲染顺序即此顺序） */
export const RECORD_DOCTOR_FIELDS = [
  { key: 'chiefComplaint', label: '主诉', rows: 2, hint: '主要症状 + 持续时间，一般不超过 20 字', ph: '如：右下后牙冷热刺激痛 3 天' },
  { key: 'presentIllness', label: '现病史', rows: 3, hint: '起病时间、诱因、症状演变、诊治经过', ph: '按「何时起病 → 什么症状 → 有无诱因 → 是否诊治」写' },
  { key: 'pastHistory', label: '既往史 / 过敏史', rows: 2, hint: '全身疾病、用药、过敏史（含药物/材料）', ph: '如：否认高血压、糖尿病；否认药物过敏史' },
  { key: 'examination', label: '口腔检查', rows: 3, hint: '牙位 + 视诊 + 叩诊 + 松动度 + 牙周情况', ph: '如：46 牙合面深龋，探（+），叩（−），松动（−），牙龈无红肿' },
  { key: 'auxiliary', label: '辅助检查', rows: 2, hint: '影像学与实验室检查所见', ph: '如：X 线示 46 近髓，根尖未见明显低密度影' },
  { key: 'diagnosis', label: '诊断', rows: 2, hint: '牙位 + 疾病全称（主诊断在前）', ph: '如：46 慢性牙髓炎' },
  { key: 'treatment', label: '治疗处置', rows: 3, hint: '本次实施的操作与用药，应与收费项目对应', ph: '如：46 局麻下开髓、拔髓，根管预备至 25#，封药' },
  { key: 'advice', label: '医嘱', rows: 2, hint: '复诊时间、饮食与口腔卫生注意事项', ph: '如：勿咬硬物；1 周后复诊；不适随诊' }
];

/** 病历可用科室（草稿默认取第一个） */
export const RECORD_DEPARTMENTS = ['口腔内科', '口腔外科', '口腔修复科', '口腔正畸科', '口腔综合科', '牙周科', '儿童口腔科'];

const COMMON_ADVICE = '保持口腔卫生，早晚刷牙、饭后漱口；近期避免患侧咀嚼硬物；遵医嘱按时复诊，不适随诊。';

/**
 * 分类 → 病历草稿模板。
 * 占位符：{tooth} 患牙位、{items} 本次项目名称串、{n} 项目数量。
 */
export const RECORD_CATEGORY_TEMPLATES = {
  exam: {
    chiefComplaint: '因口腔不适就诊，要求检查。',
    presentIllness: '患者自述近期口腔出现不适，未行系统诊治，今来我院要求检查。',
    examination: '口腔卫生状况一般，{tooth}区牙体及牙周情况见辅助检查。',
    diagnosis: '口腔检查待明确（依据检查结果完善诊断）。',
    treatment: '行口腔专科检查：{items}。',
    advice: '根据检查结果决定后续治疗方案；建议定期口腔检查（每 6 个月一次）。'
  },
  endo: {
    chiefComplaint: '患牙自发痛 / 冷热刺激痛，要求治疗。',
    presentIllness: '患者自述{tooth}近期出现冷热刺激痛，遇冷热刺激后疼痛持续，无明显咬合痛，未行系统治疗，今来我院要求治疗。',
    examination: '{tooth}牙体见深龋，探（+），叩（±），松动（−），牙龈无明显红肿，冷测反应敏感，根尖区无明显膨隆。',
    auxiliary: 'X 线示{tooth}龋损近髓 / 已及髓，根尖周未见明显低密度影，牙槽骨未见明显吸收。',
    diagnosis: '{tooth} 慢性牙髓炎（依据检查结果最终确认）',
    treatment: '{tooth}常规消毒、局部麻醉下开髓、拔髓，行{items}，术毕封药观察。',
    advice: '患牙治疗期间避免咬硬物、防止牙体折裂；按约复诊完成后续根管充填与冠修复；' + COMMON_ADVICE
  },
  perio: {
    chiefComplaint: '牙龈出血 / 口腔异味 / 牙齿松动，要求治疗。',
    presentIllness: '患者自述刷牙时牙龈出血、口腔异味，{tooth}区牙龈红肿，未行系统牙周治疗，今来我院就诊。',
    examination: '全口口腔卫生欠佳，软垢、牙石（++），{tooth}区牙龈红肿、探诊出血（+），牙周袋深度见探诊记录，附着丧失见记录。',
    auxiliary: '全口曲面体层片示{tooth}区牙槽骨水平 / 垂直吸收。',
    diagnosis: '慢性牙周炎（依据牙周检查结果最终确认）',
    treatment: '行{items}，术区冲洗、上药，嘱牙周维护。',
    advice: '掌握正确刷牙方法（Bass 刷牙法）、使用牙线；戒烟、控制血糖；3 个月后复查牙周状况；' + COMMON_ADVICE
  },
  surgery: {
    chiefComplaint: '患牙疼痛 / 松动 / 阻生，要求拔除。',
    presentIllness: '患者自述{tooth}反复疼痛 / 已无保留价值，要求拔除。否认拔牙禁忌证，否认麻药过敏史。',
    examination: '{tooth}牙体破坏明显 / 阻生，叩诊（±），松动（++），牙龈无明显急性炎症，张口度正常，颌下淋巴结未及肿大。',
    auxiliary: 'X 线示{tooth}根周骨质情况，与邻近结构（下牙槽神经管 / 上颌窦）关系见片。',
    diagnosis: '{tooth} 残根 / 残冠 / 阻生牙（依据检查结果最终确认）',
    treatment: '局部消毒，{tooth}局部浸润 / 阻滞麻醉下，行{items}，术后处理创面，压迫止血。',
    advice: '24 小时内勿刷牙漱口、勿吸吮创面；冷敷减轻肿胀；勿食过热食物；如出血不止、疼痛加剧请及时复诊；1 周后复查；' + COMMON_ADVICE
  },
  prostho: {
    chiefComplaint: '牙体缺损 / 牙列缺损，要求修复。',
    presentIllness: '患者因{tooth}牙体 / 牙列缺损影响咀嚼，要求修复。否认相关禁忌证。',
    examination: '{tooth}牙体缺损 / 缺失，基牙稳固，咬合关系可，余牙情况见检查记录。',
    auxiliary: 'X 线示{tooth}及基牙牙根、牙周情况可。',
    diagnosis: '{tooth} 牙体缺损 / 牙列缺损（依据检查结果最终确认）',
    treatment: '行{items}（含基牙预备、取模、试戴、粘接 / 戴入等步骤），调改咬合。',
    advice: '修复体初戴适应期内避免咬硬物；注意清洁修复体与基牙；如出现咬合不适、修复体松动请及时复诊；' + COMMON_ADVICE
  },
  ortho: {
    chiefComplaint: '牙齿排列不齐 / 咬合关系异常，要求矫治。',
    presentIllness: '患者自述牙齿排列不齐 / 前突 / 反合，影响美观与咬合，要求正畸矫治。否认正畸治疗史。',
    examination: '面型基本对称 / 见异常，口内见{tooth}错位 / 拥挤，磨牙关系与覆合覆盖情况见检查记录。',
    auxiliary: '模型分析与影像学检查示牙量骨量关系及颌骨发育情况。',
    diagnosis: '错合畸形（依据头颅定位与模型分析结果最终确认）',
    treatment: '行{items}，交代矫治方案、疗程、费用及注意事项，患者知情同意。',
    advice: '严格按约复诊；注意口腔卫生、避免矫治器损坏；矫治结束后需佩戴保持器；' + COMMON_ADVICE
  },
  prevent: {
    chiefComplaint: '要求口腔预防保健处理。',
    presentIllness: '患者为预防龋病 / 牙体敏感，要求行预防性处理。',
    examination: '口腔卫生一般，{tooth}牙面见窝沟较深 / 牙颈部暴露，未见明显龋损。',
    diagnosis: '{tooth} 龋易感 / 牙本质敏感（依据检查结果最终确认）',
    treatment: '行{items}。',
    advice: '控制含糖饮食频次；使用含氟牙膏；' + COMMON_ADVICE
  },
  esthetic: {
    chiefComplaint: '牙齿色泽不佳，要求美白 / 美学修复。',
    presentIllness: '患者自觉牙齿色泽偏黄，因美观需求要求行牙齿美白 / 美学修复。患者知悉该项目为美容类，医保基金不予支付。',
    examination: '全口牙色偏黄，牙体完整，牙龈健康，无敏感症状。',
    diagnosis: '牙齿外源性 / 内源性着色（依据检查结果最终确认）',
    treatment: '行{items}，术中、术后观察牙齿反应。',
    advice: '术后 24 小时内避免深色食物与饮料（咖啡、茶水、红酒、酱油等）；个别患者术后可能出现短暂牙敏感，多可自行缓解；' + COMMON_ADVICE
  },
  other: {
    chiefComplaint: '因口腔不适就诊。',
    presentIllness: '患者自述口腔不适，未行系统诊治，今来我院就诊。',
    examination: '{tooth}区情况见检查记录，余未见明显异常。',
    diagnosis: '待明确（依据检查结果完善诊断）。',
    treatment: '行{items}。',
    advice: COMMON_ADVICE
  }
};

/** 旧版分类别名 → 新分类（旧库里有 implant / consumables 两个额外分类） */
export const RECORD_CATEGORY_ALIAS = {
  implant: 'surgery',
  consumables: 'other',
  imaging: 'exam'
};

/** 取某分类的病历草稿模板（带别名兜底） */
export function recordTemplateOf(category) {
  const key = RECORD_CATEGORY_ALIAS[category] || category;
  return RECORD_CATEGORY_TEMPLATES[key] || RECORD_CATEGORY_TEMPLATES.other;
}
