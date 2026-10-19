/**
 * 五大核心城市最新口腔门诊医保政策知识库
 * 覆盖：四川成都、广州、深圳、上海、重庆
 */
export const CITIES_POLICY = {
  chengdu: {
    id: 'chengdu',
    name: '四川成都',
    province: '四川省',
    description: '严格执行门诊共济保障机制及口腔种植体医疗服务全流程调控限价（三级公立不超4400元/颗，民营自愿参与限价）',
    implantMaxGuidancePrice: 4400, // 种植全流程调控上限
    patientTypes: [
      {
        id: 'employee_active',
        name: '职工医保 - 在职人员',
        deductible: 200, // 起付线 (一级及基层门诊200，二级400，三级800)
        deductibleLevels: { primary: 200, secondary: 400, tertiary: 800 },
        reimbursementRate: 0.60, // 基层60%，二级55%，三级50%
        ratesByLevel: { primary: 0.60, secondary: 0.55, tertiary: 0.50 },
        maxAnnualLimit: 2000, // 年度封顶
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_retired',
        name: '职工医保 - 退休人员',
        deductible: 150,
        deductibleLevels: { primary: 150, secondary: 300, tertiary: 600 },
        reimbursementRate: 0.70,
        ratesByLevel: { primary: 0.70, secondary: 0.65, tertiary: 0.60 },
        maxAnnualLimit: 2500,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'resident',
        name: '城乡居民医保',
        deductible: 50,
        deductibleLevels: { primary: 50, secondary: 100, tertiary: 200 },
        reimbursementRate: 0.60,
        ratesByLevel: { primary: 0.60, secondary: 0.50, tertiary: 0.40 },
        maxAnnualLimit: 300,
        personalAccountEligible: false,
        familySharing: false
      }
    ],
    features: [
      '口腔种植全流程调控单颗限额 4400 元',
      '甲类项目100%纳入报销范围，乙类项目个人先行自付10%~20%',
      '支持家庭共济个账支付患者自付及自费部分'
    ]
  },

  guangzhou: {
    id: 'guangzhou',
    name: '广东广州',
    province: '广东省',
    description: '广州普通门诊统筹实行“选点就医”制度，基层一类门诊统筹报销比例高达80%~85%，按月或按年滚动管理',
    implantMaxGuidancePrice: 4320,
    patientTypes: [
      {
        id: 'employee_active',
        name: '职工医保 - 在职人员 (选点一类门诊)',
        deductible: 0, // 基层选点门诊通常无起付线
        deductibleLevels: { primary: 0, secondary: 100, tertiary: 200 },
        reimbursementRate: 0.80, // 基层选点80%，二类门诊65%，三类门诊50%
        ratesByLevel: { primary: 0.80, secondary: 0.65, tertiary: 0.50 },
        maxAnnualLimit: 7200, // 上年度月平均工资的固定比例折算
        monthlyLimit: 400,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_retired',
        name: '职工医保 - 退休人员 (选点一类门诊)',
        deductible: 0,
        deductibleLevels: { primary: 0, secondary: 80, tertiary: 160 },
        reimbursementRate: 0.85,
        ratesByLevel: { primary: 0.85, secondary: 0.75, tertiary: 0.60 },
        maxAnnualLimit: 8400,
        monthlyLimit: 500,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'resident',
        name: '城乡居民医保 (选点门诊)',
        deductible: 0,
        deductibleLevels: { primary: 0, secondary: 100, tertiary: 200 },
        reimbursementRate: 0.70,
        ratesByLevel: { primary: 0.70, secondary: 0.60, tertiary: 0.50 },
        maxAnnualLimit: 3000,
        monthlyLimit: 300,
        personalAccountEligible: false,
        familySharing: false
      }
    ],
    features: [
      '必须办理普通门诊选点（定点门诊）方可享受最高80-85%统筹报销',
      '月度额度与年度额度联动管理',
      '口腔修复与正畸等纯美容项目严格自费'
    ]
  },

  shenzhen: {
    id: 'shenzhen',
    name: '广东深圳',
    province: '广东省',
    description: '深圳医保一档/二档体系健全，一级以下社康与定点门诊报销75%起，年统筹额度与在岗社平工资挂钩',
    implantMaxGuidancePrice: 4320,
    patientTypes: [
      {
        id: 'employee_first_active',
        name: '职工一档 - 在职人员 (定点门诊/社康)',
        deductible: 0, // 社康及一级以下无起付线
        deductibleLevels: { primary: 0, secondary: 200, tertiary: 400 },
        reimbursementRate: 0.75, // 一级及社康75%，二级65%，三级55%
        ratesByLevel: { primary: 0.75, secondary: 0.65, tertiary: 0.55 },
        maxAnnualLimit: 9800, // 约上年度社平工资5%
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_first_retired',
        name: '职工一档 - 退休人员 (定点门诊/社康)',
        deductible: 0,
        deductibleLevels: { primary: 0, secondary: 150, tertiary: 300 },
        reimbursementRate: 0.80,
        ratesByLevel: { primary: 0.80, secondary: 0.70, tertiary: 0.60 },
        maxAnnualLimit: 11000,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'resident_second',
        name: '二档/居民医保 (定点社康门诊)',
        deductible: 0,
        deductibleLevels: { primary: 0, secondary: 100, tertiary: 200 },
        reimbursementRate: 0.75,
        ratesByLevel: { primary: 0.75, secondary: 0.60, tertiary: 0.50 },
        maxAnnualLimit: 2600,
        personalAccountEligible: false,
        familySharing: false
      }
    ],
    features: [
      '一级以下社康或定点口腔门诊无起付线直接享受报销',
      '一档个账可用于支付近亲属在定点医疗机构的自付医疗费用',
      '严格限制非治疗性口腔美容项目套刷医保'
    ]
  },

  shanghai: {
    id: 'shanghai',
    name: '上海市',
    province: '直辖市',
    description: '上海特色门急诊“自负段”制度，起付线后根据年龄段享受65%~90%高比例统筹，上不封顶',
    implantMaxGuidancePrice: 4300,
    patientTypes: [
      {
        id: 'employee_young',
        name: '在职职工 (44岁及以下)',
        deductible: 1500, // 门诊自负段 1500 元
        deductibleLevels: { primary: 1500, secondary: 1500, tertiary: 1500 },
        reimbursementRate: 0.75, // 一级门诊75%，二级65%，三级50%
        ratesByLevel: { primary: 0.75, secondary: 0.65, tertiary: 0.50 },
        maxAnnualLimit: 999999, // 统筹段上不封顶
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_middle',
        name: '在职职工 (45岁至退休)',
        deductible: 1000, // 门诊自负段 1000 元
        deductibleLevels: { primary: 1000, secondary: 1000, tertiary: 1000 },
        reimbursementRate: 0.80, // 一级门诊80%，二级70%，三级60%
        ratesByLevel: { primary: 0.80, secondary: 0.70, tertiary: 0.60 },
        maxAnnualLimit: 999999,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_retired',
        name: '退休人员',
        deductible: 700, // 门诊自负段 700 元
        deductibleLevels: { primary: 700, secondary: 700, tertiary: 700 },
        reimbursementRate: 0.85, // 一级门诊85%~90%
        ratesByLevel: { primary: 0.85, secondary: 0.80, tertiary: 0.70 },
        maxAnnualLimit: 999999,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'resident',
        name: '城乡居民医保 (18-60岁)',
        deductible: 500,
        deductibleLevels: { primary: 500, secondary: 500, tertiary: 500 },
        reimbursementRate: 0.70,
        ratesByLevel: { primary: 0.70, secondary: 0.60, tertiary: 0.50 },
        maxAnnualLimit: 4000,
        personalAccountEligible: false,
        familySharing: false
      }
    ],
    features: [
      '门诊起付线为自负段（可用历年账户资金支付）',
      '超出自负段后统筹基金支付比例高且在职/退休不设最高封顶线',
      '组建家庭共济网可直接抵扣家属自负费用'
    ]
  },

  chongqing: {
    id: 'chongqing',
    name: '重庆市',
    province: '直辖市',
    description: '建立健全门诊共济保障，基层定点医疗机构起付线低（在职100/退休50），报销比例达60%~70%',
    implantMaxGuidancePrice: 4300,
    patientTypes: [
      {
        id: 'employee_active',
        name: '职工医保 - 在职人员',
        deductible: 100, // 一级及基层100，二级200，三级300
        deductibleLevels: { primary: 100, secondary: 200, tertiary: 300 },
        reimbursementRate: 0.60, // 一级60%，二级55%，三级50%
        ratesByLevel: { primary: 0.60, secondary: 0.55, tertiary: 0.50 },
        maxAnnualLimit: 1500, // 每年1500元封顶
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'employee_retired',
        name: '职工医保 - 退休人员',
        deductible: 50,
        deductibleLevels: { primary: 50, secondary: 100, tertiary: 150 },
        reimbursementRate: 0.70, // 一级70%，二级65%，三级60%
        ratesByLevel: { primary: 0.70, secondary: 0.65, tertiary: 0.60 },
        maxAnnualLimit: 2000,
        personalAccountEligible: true,
        familySharing: true
      },
      {
        id: 'resident',
        name: '城乡居民医保 (一档/二档)',
        deductible: 50,
        deductibleLevels: { primary: 50, secondary: 100, tertiary: 150 },
        reimbursementRate: 0.60,
        ratesByLevel: { primary: 0.60, secondary: 0.50, tertiary: 0.40 },
        maxAnnualLimit: 300,
        personalAccountEligible: false,
        familySharing: false
      }
    ],
    features: [
      '基层定点门诊统筹起付门槛极低（50~100元）',
      '实行定点就医结算与个账共济绑定',
      '口腔种植调控总价三级不超4300元'
    ]
  }
};
