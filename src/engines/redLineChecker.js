/**
 * 口腔门诊医保飞行检查合规与违规红线实时预警引擎
 * 参照国家医保局《医疗保障基金使用监督管理条例》、飞行检查工作指引及地方医保稽核规范
 */

/** 114 版（立项指南）项目名快捷判定：按名称前缀匹配，避免硬编码 15 位编码 */
function names114(selectedItems) {
  return selectedItems.map(i => i.item.name || '');
}
function has114(names, list) {
  return list.some(k => names.some(n => n.startsWith(k)));
}

/**
 * 校验处方选单是否存在医保红线风险
 * @param {Object} params
 * @param {Array} params.selectedItems 选中的项目列表 [{ item: {...}, quantity: number, customPrice?: number }]
 * @param {Object} params.cityPolicy 当前选中的城市医保政策
 * @returns {Object} 检查结果 { hasViolations: boolean, violations: Array, riskScore: number, safetyGrade: string }
 */
export function checkInsuranceRedLines({ selectedItems = [], cityPolicy, version = 'legacy', institutionLevel = 'tertiary' }) {
  const violations = [];

  // ============================================================
  // 114 版（《口腔类医疗服务价格项目立项指南》医保价采函〔2025〕18号）专属红线
  // ============================================================
  if (version === 'gg114') {
    const nm = names114(selectedItems);

    // 114-1 牙体开髓引流费：仅限牙髓急症应急处置，其他牙髓治疗中作为价格构成不得单收
    const hasDrainage114 = has114(nm, ['牙体开髓引流费']);
    const hasEndoCourse114 = has114(nm, ['根管预备费', '根管冲洗费', '根管充填费', '牙髓失活费', '干髓治疗费']);
    if (hasDrainage114 && hasEndoCourse114) {
      violations.push({
        ruleId: 'GG114_OPENING_DRAINAGE_EMERGENCY_ONLY',
        level: 'FATAL_RISK',
        title: '🔴 严重红线：牙体开髓引流费与根管治疗项目重复计费',
        involvedCodes: selectedItems.filter(i => (i.item.name || '').startsWith('牙体开髓引流费')).map(i => i.item.code),
        category: '重复收费 / 分解项目',
        description: '114 版官方计价说明明确：牙体开髓引流费「仅限于牙髓急症患者应急处置时收费，在其他牙髓治疗中作为相关项目的价格构成，不单独收费」。已开具根管预备费/冲洗费/充填费等牙髓治疗项目时，再加收开髓引流费属于重复计费。',
        actionAdvice: '删除「牙体开髓引流费」；仅当本次就诊为牙髓急症应急处置、未进入根管治疗流程时才可单收。',
        penalty: '医保基金拒付并追回，属飞行检查高频扣分项。'
      });
    }

    // 114-2 错合矫治：方案设计属诊查治疗应尽事项，不得同时收取设计费
    const hasOrthoDesign = has114(nm, ['错合畸形治疗设计费']);
    const hasOrthoCourse = has114(nm, [
      '乳牙期错合矫治费', '替牙期Ⅰ类错合矫治费', '替牙期Ⅱ类错合矫治费', '替牙期Ⅲ类错合矫治费',
      '恒牙期Ⅰ类错合矫治费', '恒牙期Ⅱ类错合矫治费', '恒牙期Ⅲ类错合矫治费',
      '恒牙期Ⅰ类错合矫形功能治疗费', '恒牙期Ⅱ类错合矫形功能治疗费', '恒牙期Ⅲ类错合矫形功能治疗费',
      '局部正畸矫治费'
    ]);
    if (hasOrthoDesign && hasOrthoCourse) {
      violations.push({
        ruleId: 'GG114_ORTHO_DESIGN_FEE_FORBIDDEN',
        level: 'FATAL_RISK',
        title: '🔴 严重红线：错合矫治不得同时收取「错合畸形治疗设计费」',
        involvedCodes: selectedItems.filter(i => (i.item.name || '').startsWith('错合畸形治疗设计费')).map(i => i.item.code),
        category: '分解收费 / 内涵重复',
        description: '114 版官方使用说明第 10 条：「在本医疗机构开展错合矫治治疗时，方案设计属诊查治疗应尽事项，不得同时收取设计费」。矫治疗程费已涵盖方案设计。',
        actionAdvice: '删除「错合畸形治疗设计费」。仅当患者只做设计评估、不开展矫治疗程时才可单收。',
        penalty: '按分解收费处理，全额退还并处罚款。'
      });
    }

    // 114-3 复杂情形不得累计叠加收费
    const complexHits = nm.filter(n => n.includes('（复杂）'));
    const sameSeries = {};
    complexHits.forEach(n => {
      const key = n.replace('（复杂）', '');
      sameSeries[key] = (sameSeries[key] || 0) + 1;
    });
    if (complexHits.length > 1) {
      violations.push({
        ruleId: 'GG114_COMPLEX_NO_STACKING',
        level: 'HIGH_RISK',
        title: `⚠️ 违规风险：「复杂」情形不可累计叠加收费（当前 ${complexHits.length} 项）`,
        involvedCodes: selectedItems.filter(i => (i.item.name || '').includes('（复杂）')).map(i => i.item.code),
        category: '叠加收费',
        description: '114 版官方使用说明第 9 条：满足复杂情况中的任意一种即算复杂，不同复杂情况不累计叠加收费。同一矫治疗程只能按一个复杂档计费。',
        actionAdvice: '同一疗程保留一个「（复杂）」项目，其余删除；确有多疗程请按疗程分别开具并留存病历。',
        penalty: '超出部分予以核减。'
      });
    }

    // 114-4 不得超过政府指导价（三级价为最高限价）
    selectedItems.forEach(entry => {
      const it = entry.item;
      if (it.priceLevel3 == null) return;
      const used = entry.customPrice !== undefined ? Number(entry.customPrice)
        : (institutionLevel === 'tertiary' ? it.priceLevel3 : institutionLevel === 'secondary' ? it.priceLevel2 : it.priceLevel1);
      const ceiling = it.priceLevel3;
      if (Number(used) > Number(ceiling)) {
        violations.push({
          ruleId: 'GG114_PRICE_CEILING',
          level: 'FATAL_RISK',
          title: `🔴 价格红线：「${it.name}」收费 ¥${used} 超过政府指导价上限 ¥${ceiling}`,
          involvedCodes: [it.code],
          category: '超政府指导价收费',
          description: `114 版所定价格为政府指导价，属最高限价，医疗机构不得上浮、下浮不限。三级上限 ¥${ceiling}，二级 ¥${it.priceLevel2}，一级 ¥${it.priceLevel1}。`,
          actionAdvice: `将收费调整至 ¥${ceiling} 元或以内（不得上浮）。`,
          penalty: '按价格违法行为处罚，退还多收费用并通报。'
        });
      }
    });

    // 114-5 龈上洁治费为丙类自费，不得纳入统筹
    const cleaning114 = selectedItems.filter(i => (i.item.name || '').startsWith('龈上洁治费'));
    if (cleaning114.length) {
      violations.push({
        ruleId: 'GG114_CLEANING_SELF_PAY',
        level: 'WARNING',
        title: 'ℹ️ 政策提示：114 版「龈上洁治费」为丙类（全自费）项目',
        involvedCodes: cleaning114.map(i => i.item.code),
        category: '医保属性提示',
        description: '114 版立项指南中龈上洁治费医保支付类别为丙类，即完全自费，不得纳入门诊统筹报销。如需医保报销的牙周治疗，应使用甲类的「龈下刮治费」「根面平整费」（须有牙周探诊与骨吸收指征）。',
        actionAdvice: '按自费项目收费并做好患者告知；不要串换为牙周治疗项目套取统筹。',
        penalty: '串换项目即构成欺诈骗保。'
      });
    }

    // 114-6 基本物耗不得另收（出现旧版耗材项立即提示）
    const legacyConsumables = selectedItems.filter(i => ['consumables', 'implant'].includes(i.item.category) || (i.item.code || '').startsWith('HC_'));
    if (legacyConsumables.length) {
      violations.push({
        ruleId: 'GG114_MATERIAL_NOT_BILLABLE',
        level: 'HIGH_RISK',
        title: '⚠️ 114 版红线：基本物质资源消耗不得另行收费',
        involvedCodes: legacyConsumables.map(i => i.item.code),
        category: '违规另收耗材费',
        description: '114 版明确「基本物质资源消耗」成本已计入项目价格，不另行收费，包括但不限于：镍钛锉、棉球(卷)、棉签、纱布(垫)、印模材、咬合纸、引流条、修复体粘接剂、窝沟封闭剂、充填材料、根管封闭剂、盖髓材料、一次性口杯、一次性吸唾管、氟化物等。当前处方中包含耗材类收费项。',
        actionAdvice: '删除耗材类收费项。除基本物耗以外的其他耗材，按实际采购价格零差率销售，不加价。',
        penalty: '属自立项目收费，基金全额拒付并处罚。'
      });
    }

    // 114-7 加收项不得脱离主项目单独收费
    const addonOnly = selectedItems.filter(i => i.item.isAddon);
    if (addonOnly.length && addonOnly.length === selectedItems.length) {
      violations.push({
        ruleId: 'GG114_ADDON_STANDALONE',
        level: 'HIGH_RISK',
        title: '⚠️ 违规风险：加收/分项不得脱离主项目单独收费',
        involvedCodes: addonOnly.map(i => i.item.code),
        category: '自立项目收费',
        description: '加收项（如「-儿童（加收）」「-使用计算机进行三维模型测量加收」等）只有在开展对应主项目时才能同步计费，不能作为独立项目单收。',
        actionAdvice: '补充对应的主项目，或删除这些加收项。',
        penalty: '按自立项目收费核减。'
      });
    }
  }

  // ============================================================
  // 旧版（全国医疗服务项目技术规范 / 各地 330xxxxx 编码）红线
  // ============================================================
  if (version === 'legacy') {
  // 1. 规则一：拆套分解收费 - 根管治疗术并开髓引流术
  const hasRootCanal = selectedItems.some(i => ['330501001', '330501002', '330501003'].includes(i.item.code));
  const hasOpenDrainage = selectedItems.some(i => i.item.code === '330501007');
  const hasPulpDevitalization = selectedItems.some(i => i.item.code === '330501008');

  if (hasRootCanal && hasOpenDrainage) {
    violations.push({
      ruleId: 'UNBUNDLING_ENDO_OPENING',
      level: 'FATAL_RISK',
      title: '🔴 严重红线：根管治疗术已包含开髓，严禁并收“开髓引流术”',
      involvedCodes: ['330501007'],
      category: '分解收费 / 拆套骗保',
      description: '《全国医疗服务项目技术规范》明确规定：前牙/磨牙根管治疗术（330501001-3）内涵中已涵盖开髓、髓腔冲洗与引流。同时开具开髓引流术（330501007）属于医保飞检“一票否决”式重复拆套收费。',
      actionAdvice: '立即在开单系统中删除“开髓引流术”单项，仅保留根管治疗术。',
      penalty: '追回统筹基金，处以本金 2~3 倍行政罚款，相关医师医保工号记分扣款。'
    });
  }

  if (hasRootCanal && hasPulpDevitalization) {
    violations.push({
      ruleId: 'UNBUNDLING_ENDO_PULP_DEV',
      level: 'HIGH_RISK',
      title: '⚠️ 违规风险：根管治疗与“牙髓失活术”重复收费',
      involvedCodes: ['330501008'],
      category: '重复计费 / 诊疗不符',
      description: '实施局部麻醉一次性或分次根管预备中，若无特殊禁忌通常不并列加收牙髓失活术。封失活剂应属于阶段治疗内涵。',
      actionAdvice: '复核病历记录是否确有不可麻醉需单独失活指征，若无建议剔除失活术。',
      penalty: '医保智能审核系统自动拦截拒付并核减费用。'
    });
  }

  // 2. 规则二：分解收费 - 复杂阻生牙拔除术并收“牙龈切开及牙槽外科创口缝合术”
  const hasImpactedTooth = selectedItems.some(i => i.item.code === '330504003');
  const hasSuture = selectedItems.some(i => i.item.code === '330504005');

  if (hasImpactedTooth && hasSuture) {
    violations.push({
      ruleId: 'UNBUNDLING_WISDOM_SUTURE',
      level: 'FATAL_RISK',
      title: '🔴 严重红线：阻生齿拔除术已含缝合，严禁加收“切开缝合术”',
      involvedCodes: ['330504005'],
      category: '分解项目收费',
      description: '复杂阻生下颌第三磨牙拔除术（330504003）的定价标准中，已完整包含软组织切开、翻瓣、去骨、拔除、骨面修整及复位缝合全套工序。单列缝合费加收65元属于国家医保局明文通报的违规分解项目！',
      actionAdvice: '必须移除“牙龈切开及牙槽外科创口缝合术（330504005）”。',
      penalty: '全额退还已报统筹，医保信誉等级由A级降为B级。'
    });
  }

  // 3. 规则三：串换项目/生活美容套取医保基金
  selectedItems.forEach(entry => {
    if (['ZF_ORTHODONTICS', 'ZF_WHITENING'].includes(entry.item.code)) {
      violations.push({
        ruleId: 'BEAUTY_INSURANCE_FORBIDDEN',
        level: 'FATAL_RISK',
        title: `🔴 违法高压线：${entry.item.name} 属于纯美容医疗，绝不可套刷医保统筹`,
        involvedCodes: [entry.item.code],
        category: '串换诊疗项目欺诈骗保',
        description: '正畸矫治、牙齿漂白等纯美学非疾病治疗项目，根据国家医保条例绝不能列入医保统筹或以其他名目串换报销。一旦为患者串换成“牙周病刮治”或“骨髓炎手术”走统筹，构成刑事犯罪立案标准！',
        actionAdvice: '必须严格走自费流程（或符合规定的个人账户历年结余自费支付），签署自费知情同意书。',
        penalty: '解除定点医保协议，处欺诈骗保金额 2~5 倍罚款，依法移交司法机关。'
      });
    }
  });

  // 4. 规则四：超频次 - 全口牙周龈上洁治（洗牙）限制
  const cleaningEntry = selectedItems.find(i => i.item.code === '330503001');
  if (cleaningEntry) {
    if (cleaningEntry.quantity > 1) {
      violations.push({
        ruleId: 'PERIO_CLEANING_FREQUENCY_LIMIT',
        level: 'HIGH_RISK',
        title: '⚠️ 超频次违规：龈上洁治术（洗牙）单次就诊限开具1次',
        involvedCodes: ['330503001'],
        category: '超频次过度诊疗',
        description: '“全口牙周龈上洁治术”单位为“全口”，单次开具数量不得大于1。一人一年内医保纳统报销原则上不超过1次。',
        actionAdvice: '将数量修改为 1，并确认病历记载明确的牙龈炎/牙周炎临床牙石指数诊断。',
        penalty: '超出频次部分医保统筹拒付。'
      });
    } else {
      violations.push({
        ruleId: 'PERIO_DIAGNOSIS_REQUIRED',
        level: 'WARNING',
        title: 'ℹ️ 适应症合规提示：洗牙报销必须具备牙龈炎/牙周炎明确诊断病历',
        involvedCodes: ['330503001'],
        category: '病历指征合规提示',
        description: '超声波洁治走医保报销时，医保飞检查验病历必须看到牙周探诊深度、牙龈出血指数（BOP+）或牙结石度记录，纯健康体检洁牙不得纳统。',
        actionAdvice: '确保电子病历中附有牙龈充血水肿或牙石 II 度以上诊断记录。',
        penalty: '病历无指征者飞检予以扣款追回。'
      });
    }
  }

  // 5. 规则五：检查影像 - 口腔全景片与根尖牙片同日多开超量
  const panoEntry = selectedItems.find(i => i.item.code === '310401001');
  if (panoEntry && panoEntry.quantity > 1) {
    violations.push({
      ruleId: 'EXAM_SAME_DAY_REPEAT',
      level: 'HIGH_RISK',
      title: '⚠️ 检查违规：口腔全景片单次门诊严禁重复计费',
      involvedCodes: ['310401001'],
      category: '重复检查过度诊疗',
      description: '全景曲面断层摄影单次门诊仅限开具1次，单日多次计费属于违规重复收费。',
      actionAdvice: '将全景片计费数量核减为1。',
      penalty: '重复检查项目予以全额核减。'
    });
  }

  const rootXrayEntry = selectedItems.find(i => i.item.code === '310401002');
  if (rootXrayEntry && rootXrayEntry.quantity > 3) {
    violations.push({
      ruleId: 'XRAY_MAX_LIMIT_PER_TOOTH',
      level: 'WARNING',
      title: '⚠️ 影像超量风险：单次根管治疗小牙片数量超标 (>3张)',
      involvedCodes: ['310401002'],
      category: '过度检查预警',
      description: '单颗牙根管治疗术标准质控片通常为术前、主尖、术后充填共3张。单次开单超过3张易触发医保系统大额异常预警。',
      actionAdvice: '复核是否为多牙位治疗，若为多牙位请在病历上详细分别备注牙位（如 16, 26, 46）。',
      penalty: '引发医保抽查病历。'
    });
  }

  // 6. 规则六：国家种植牙集采限价调控目标超限
  const implantServiceEntry = selectedItems.find(i => i.item.code === '330505001');
  if (implantServiceEntry) {
    const servicePrice = implantServiceEntry.customPrice !== undefined 
      ? Number(implantServiceEntry.customPrice) 
      : implantServiceEntry.item.defaultPrice;
    
    const maxGuidance = cityPolicy.implantMaxGuidancePrice || 4300;
    if (servicePrice > maxGuidance) {
      violations.push({
        ruleId: 'IMPLANT_PRICE_CEILING',
        level: 'FATAL_RISK',
        title: `🔴 政策红线：单颗常规种植医疗服务费 (¥${servicePrice}) 超过${cityPolicy.name}政府调控上限 (¥${maxGuidance})`,
        involvedCodes: ['330505001'],
        category: '价格突破政府调控红线',
        description: `国家医保局明确要求全流程医疗服务费不得突破调控目标（${cityPolicy.name}规定最高调控限价为 ¥${maxGuidance} 元）。超越调控限价将被列入集采违约黑名单！`,
        actionAdvice: `将单颗常规种植全流程医疗服务费调整至 ¥${maxGuidance} 元或以内。`,
        penalty: '市场监管部门与医保局联合约谈，取消集采挂网合作资格。'
      });
    }
  }

  // 7. 规则七：集采耗材加成红线 (零差率)
  const implantConsumableEntry = selectedItems.find(i => i.item.code === 'HC_IMPLANT_COLLECTIVE');
  if (implantConsumableEntry) {
    const consumablePrice = implantConsumableEntry.customPrice !== undefined
      ? Number(implantConsumableEntry.customPrice)
      : implantConsumableEntry.item.defaultPrice;
    
    if (consumablePrice > 900) {
      violations.push({
        ruleId: 'IMPLANT_ZERO_MARKUP',
        level: 'HIGH_RISK',
        title: `⚠️ 集采红线：集采中选种植体系统单价 (¥${consumablePrice}) 疑似存在加价销售`,
        involvedCodes: ['HC_IMPLANT_COLLECTIVE'],
        category: '违背零差率销售规定',
        description: '国家集采中选中位价格为约 850~900 元，医疗机构必须严格执行进价销售零差率，不得加收包装选型费。',
        actionAdvice: '严格核对发票进价，按照集采中标价平进平出。',
        penalty: '处以价格违法没收违法所得。'
      });
    }
  }

  // 8. 规则八：麻醉药物单次用量超标
  const anesthesiaEntry = selectedItems.find(i => i.item.code === 'HC_ANESTHESIA_ART');
  if (anesthesiaEntry && anesthesiaEntry.quantity > 3) {
    violations.push({
      ruleId: 'ANESTHESIA_DOSAGE_LIMIT',
      level: 'WARNING',
      title: '⚠️ 用药合规：局部麻醉剂（阿替卡因/碧蓝麻）单次用量偏大 (>3支)',
      involvedCodes: ['HC_ANESTHESIA_ART'],
      category: '用药合理性质疑',
      description: '门诊单次治疗常规用量为 1~2 支，超过 3 支（超 200mg）若无复杂埋伏阻生齿或多牙区手术记录，易触发超适应症过度用药拦截。',
      actionAdvice: '请核实拔牙数量与手术范围，并在病历中补充大剂量麻醉记录。',
      penalty: '药品智能监管系统红灯预警。'
    });
  }
  }

  // 计算安全综合分 (100分制)
  let riskScore = 100;
  let hasFatal = false;
  let hasHigh = false;

  violations.forEach(v => {
    if (v.level === 'FATAL_RISK') {
      riskScore -= 35;
      hasFatal = true;
    } else if (v.level === 'HIGH_RISK') {
      riskScore -= 20;
      hasHigh = true;
    } else if (v.level === 'WARNING') {
      riskScore -= 8;
    }
  });
  riskScore = Math.max(0, Math.min(100, riskScore));

  let safetyGrade = 'SAFE'; // SAFE | WARNING | DANGER | FATAL
  if (hasFatal || riskScore < 50) {
    safetyGrade = 'FATAL'; // 存在严重红线一票否决
  } else if (hasHigh || riskScore < 75) {
    safetyGrade = 'DANGER';
  } else if (violations.length > 0 || riskScore < 95) {
    safetyGrade = 'WARNING';
  }

  return {
    hasViolations: violations.length > 0,
    violationCount: violations.length,
    violations,
    riskScore,
    safetyGrade
  };
}
