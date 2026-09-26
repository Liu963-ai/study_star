/* ============================================================
   「汉字小星球」内容总控 · data.js
   ------------------------------------------------------------
   所有内容数据都在这里，改内容只动这个文件。
   依据教材：统编版《语文》一年级上册（2024 版，教育部组织编写）。
   · pinyin     拼音全表：23 声母 / 24 韵母 / 16 整体认读（与教材
                第二～四单元 14 课一致）。read＝呼读音（点击大卡朗读
                时按小学呼读标准读出；汉字无歧义用汉字，如 玻/坡/基/
                欺/希，多音字或无规范汉字的韵母用带调拼音串，如
                ēi/ēng/ōng/yūn，朗读时路由到拼音安全音色保证中文音
                节读法）；chars＝该拼音可组成的汉字与常用词语（生字
                均出自本册识字表/写字表或一年级常用字），供拼音页右
                侧组字卡逐字逐词朗读。
   · shengzi    生字 100 字＝教材写字表（共 100 个字），unit 为每
                10 字一组的学习顺序。strokes＝手绘 SVG 笔顺
                （人/大/天/口），其余字由生字站用 assets/hanzi-data
                离线笔顺数据渲染。
   · langdu     朗读 15 篇＝教材全部阅读课文 + 语文园地日积月累
                古诗（《画》《风》）。text 为全文，拼音在朗读页用
                pinyin-pro 逐字标注。
   · jushi      词语 20 轮，每轮三类词（who/where/what）× 2 个候选，
                8 种组合均须读得通：允许拟人，不得违反常识（改词时
                须遵守，规则详见 jushi 上方注释）；img＝该轮句子成句
                后展示的 AI 生成场景插图（assets/jushi/，由生图工具生成）。
   · shop/badges 奖励中心数据；parent 仅保留门禁算术题
     （家长报告数值已改为 js/report.js 计算真实数据，不再使用假数据）
   ============================================================ */
const DATA = {

  /* ================= 开关区（改行为只改这里） ================= */

  /* 官方拼音录音包：把官方录音（人教社 / 国家中小学智慧教育平台）按
     「拼音标注.mp3」放进 assets/pinyin-audio/ 后，把下面这行改成 true。
     详见 assets/pinyin-audio/README.txt。
     为什么需要显式开关：目录里只有说明文件时，代码无从得知「用户还没装」
     还是「装了但路径写错」，只能发一次探测请求去问——那会稳定产生一次
     404，控制台留一条红色报错、每次首访白跑一个网络往返。默认 false
     时完全不探测该目录，装好后置 true 才启用。 */
  pinyinAudioPack: false,

  /* ---- 拼音全表（分组）----
     p=拼音  read=呼读音（点击大卡朗读它，TTS 读汉字而非英文字母）
     chars=组字卡：{ c:汉字, py:字的拼音, w:组成的词语 } */
  pinyin: {
    shengmu: [
      { p:"b",  read:"玻", chars:[ {c:"爸",py:"bà",w:"爸爸"}, {c:"白",py:"bái",w:"白云"}, {c:"不",py:"bù",w:"不用"} ] },
      { p:"p",  read:"坡", chars:[ {c:"皮",py:"pí",w:"果皮"}, {c:"跑",py:"pǎo",w:"跑步"}, {c:"朋",py:"péng",w:"朋友"} ] },
      { p:"m",  read:"摸", chars:[ {c:"妈",py:"mā",w:"妈妈"}, {c:"马",py:"mǎ",w:"小马"}, {c:"木",py:"mù",w:"木头"} ] },
      { p:"f",  read:"佛", chars:[ {c:"风",py:"fēng",w:"大风"}, {c:"飞",py:"fēi",w:"飞机"}, {c:"放",py:"fàng",w:"放学"} ] },
      { p:"d",  read:"得", chars:[ {c:"大",py:"dà",w:"大人"}, {c:"地",py:"dì",w:"土地"}, {c:"读",py:"dú",w:"读书"} ] },
      { p:"t",  read:"特", chars:[ {c:"土",py:"tǔ",w:"泥土"}, {c:"天",py:"tiān",w:"天空"}, {c:"兔",py:"tù",w:"白兔"} ] },
      { p:"n",  read:"讷", chars:[ {c:"鸟",py:"niǎo",w:"小鸟"}, {c:"牛",py:"niú",w:"小牛"}, {c:"女",py:"nǚ",w:"女孩"} ] },
      { p:"l",  read:"勒", chars:[ {c:"老",py:"lǎo",w:"老师"}, {c:"来",py:"lái",w:"回来"}, {c:"柳",py:"liǔ",w:"柳树"} ] },
      { p:"g",  read:"哥", chars:[ {c:"哥",py:"gē",w:"哥哥"}, {c:"果",py:"guǒ",w:"苹果"}, {c:"国",py:"guó",w:"国旗"} ] },
      { p:"k",  read:"科", chars:[ {c:"口",py:"kǒu",w:"门口"}, {c:"可",py:"kě",w:"可爱"}, {c:"课",py:"kè",w:"上课"} ] },
      { p:"h",  read:"喝", chars:[ {c:"花",py:"huā",w:"花朵"}, {c:"火",py:"huǒ",w:"火车"}, {c:"河",py:"hé",w:"小河"} ] },
      { p:"j",  read:"基", chars:[ {c:"鸡",py:"jī",w:"小鸡"}, {c:"家",py:"jiā",w:"家人"}, {c:"见",py:"jiàn",w:"看见"} ] },
      { p:"q",  read:"欺", chars:[ {c:"七",py:"qī",w:"七个"}, {c:"青",py:"qīng",w:"青蛙"}, {c:"桥",py:"qiáo",w:"小桥"} ] },
      { p:"x",  read:"希", chars:[ {c:"小",py:"xiǎo",w:"大小"}, {c:"星",py:"xīng",w:"星星"}, {c:"雪",py:"xuě",w:"雪花"} ] },
      { p:"zh", read:"知", chars:[ {c:"中",py:"zhōng",w:"中国"}, {c:"竹",py:"zhú",w:"竹子"}, {c:"纸",py:"zhǐ",w:"白纸"} ] },
      { p:"ch", read:"吃", chars:[ {c:"车",py:"chē",w:"汽车"}, {c:"吃",py:"chī",w:"吃饭"}, {c:"虫",py:"chóng",w:"虫子"} ] },
      { p:"sh", read:"诗", chars:[ {c:"山",py:"shān",w:"大山"}, {c:"水",py:"shuǐ",w:"河水"}, {c:"书",py:"shū",w:"书本"} ] },
      { p:"r",  read:"日", chars:[ {c:"日",py:"rì",w:"日子"}, {c:"人",py:"rén",w:"大人"}, {c:"肉",py:"ròu",w:"牛肉"} ] },
      { p:"z",  read:"资", chars:[ {c:"字",py:"zì",w:"写字"}, {c:"自",py:"zì",w:"自己"}, {c:"子",py:"zǐ",w:"孩子"} ] },
      { p:"c",  read:"雌", chars:[ {c:"草",py:"cǎo",w:"草地"}, {c:"从",py:"cóng",w:"从来"}, {c:"彩",py:"cǎi",w:"彩色"} ] },
      { p:"s",  read:"思", chars:[ {c:"三",py:"sān",w:"三个"}, {c:"四",py:"sì",w:"四季"}, {c:"松",py:"sōng",w:"松鼠"} ] },
      { p:"y",  read:"衣", chars:[ {c:"一",py:"yī",w:"一个"}, {c:"月",py:"yuè",w:"月亮"}, {c:"鱼",py:"yú",w:"小鱼"} ] },
      { p:"w",  read:"乌", chars:[ {c:"五",py:"wǔ",w:"五个"}, {c:"我",py:"wǒ",w:"我们"}, {c:"乌",py:"wū",w:"乌鸦"} ] }
    ],
    yunmu: [
      { p:"a",   read:"啊", chars:[ {c:"花",py:"huā",w:"花朵"}, {c:"马",py:"mǎ",w:"小马"}, {c:"大",py:"dà",w:"大人"} ] },
      { p:"o",   read:"喔", chars:[ {c:"波",py:"bō",w:"波浪"}, {c:"坡",py:"pō",w:"山坡"}, {c:"婆",py:"pó",w:"外婆"} ] },
      { p:"e",   read:"鹅", chars:[ {c:"鹅",py:"é",w:"白鹅"}, {c:"喝",py:"hē",w:"喝水"}, {c:"车",py:"chē",w:"汽车"} ] },
      { p:"i",   read:"衣", chars:[ {c:"米",py:"mǐ",w:"大米"}, {c:"你",py:"nǐ",w:"你好"}, {c:"地",py:"dì",w:"土地"} ] },
      { p:"u",   read:"乌", chars:[ {c:"木",py:"mù",w:"木头"}, {c:"书",py:"shū",w:"书本"}, {c:"五",py:"wǔ",w:"五个"} ] },
      { p:"ü",   read:"迂", chars:[ {c:"鱼",py:"yú",w:"小鱼"}, {c:"雨",py:"yǔ",w:"下雨"}, {c:"玉",py:"yù",w:"玉米"} ] },
      { p:"ai",  read:"爱", chars:[ {c:"白",py:"bái",w:"白云"}, {c:"开",py:"kāi",w:"开门"}, {c:"采",py:"cǎi",w:"采花"} ] },
      { p:"ei",  read:"ēi", chars:[ {c:"飞",py:"fēi",w:"飞机"}, {c:"美",py:"měi",w:"美丽"}, {c:"黑",py:"hēi",w:"黑板"} ] },
      { p:"ui",  read:"威", chars:[ {c:"水",py:"shuǐ",w:"河水"}, {c:"回",py:"huí",w:"回家"}, {c:"嘴",py:"zuǐ",w:"嘴巴"} ] },
      { p:"ao",  read:"凹", chars:[ {c:"鸟",py:"niǎo",w:"小鸟"}, {c:"草",py:"cǎo",w:"草地"}, {c:"早",py:"zǎo",w:"早上"} ] },
      { p:"ou",  read:"欧", chars:[ {c:"口",py:"kǒu",w:"门口"}, {c:"狗",py:"gǒu",w:"小狗"}, {c:"走",py:"zǒu",w:"走路"} ] },
      { p:"iu",  read:"优", chars:[ {c:"六",py:"liù",w:"六个"}, {c:"九",py:"jiǔ",w:"九个"}, {c:"球",py:"qiú",w:"皮球"} ] },
      { p:"ie",  read:"耶", chars:[ {c:"叶",py:"yè",w:"树叶"}, {c:"爷",py:"yé",w:"爷爷"}, {c:"姐",py:"jiě",w:"姐姐"} ] },
      { p:"üe",  read:"约", chars:[ {c:"月",py:"yuè",w:"月亮"}, {c:"雪",py:"xuě",w:"雪花"}, {c:"学",py:"xué",w:"上学"} ] },
      { p:"er",  read:"耳", chars:[ {c:"耳",py:"ěr",w:"耳朵"}, {c:"儿",py:"ér",w:"儿子"}, {c:"二",py:"èr",w:"二十"} ] },
      { p:"an",  read:"安", chars:[ {c:"山",py:"shān",w:"大山"}, {c:"三",py:"sān",w:"三个"}, {c:"蓝",py:"lán",w:"蓝天"} ] },
      { p:"en",  read:"恩", chars:[ {c:"门",py:"mén",w:"大门"}, {c:"人",py:"rén",w:"大人"}, {c:"本",py:"běn",w:"课本"} ] },
      { p:"in",  read:"因", chars:[ {c:"心",py:"xīn",w:"小心"}, {c:"林",py:"lín",w:"树林"}, {c:"金",py:"jīn",w:"金鱼"} ] },
      { p:"un",  read:"温", chars:[ {c:"春",py:"chūn",w:"春天"}, {c:"问",py:"wèn",w:"问好"}, {c:"村",py:"cūn",w:"村子"} ] },
      { p:"ün",  read:"yūn", chars:[ {c:"云",py:"yún",w:"白云"}, {c:"军",py:"jūn",w:"军人"}, {c:"裙",py:"qún",w:"裙子"} ] },
      { p:"ang", read:"昂", chars:[ {c:"上",py:"shàng",w:"上学"}, {c:"房",py:"fáng",w:"房子"}, {c:"长",py:"cháng",w:"长江"} ] },
      { p:"eng", read:"ēng", chars:[ {c:"风",py:"fēng",w:"大风"}, {c:"灯",py:"dēng",w:"电灯"}, {c:"朋",py:"péng",w:"朋友"} ] },
      { p:"ing", read:"英", chars:[ {c:"星",py:"xīng",w:"星星"}, {c:"明",py:"míng",w:"明天"}, {c:"听",py:"tīng",w:"听话"} ] },
      { p:"ong", read:"ōng", chars:[ {c:"虫",py:"chóng",w:"虫子"}, {c:"红",py:"hóng",w:"红花"}, {c:"空",py:"kōng",w:"天空"} ] }
    ],
    zhengti: [
      { p:"zhi",  read:"知", chars:[ {c:"枝",py:"zhī",w:"树枝"}, {c:"纸",py:"zhǐ",w:"白纸"}, {c:"直",py:"zhí",w:"笔直"} ] },
      { p:"chi",  read:"吃", chars:[ {c:"吃",py:"chī",w:"吃饭"}, {c:"池",py:"chí",w:"池塘"}, {c:"翅",py:"chì",w:"翅膀"} ] },
      { p:"shi",  read:"诗", chars:[ {c:"狮",py:"shī",w:"狮子"}, {c:"十",py:"shí",w:"十个"}, {c:"石",py:"shí",w:"石头"} ] },
      { p:"ri",   read:"日", chars:[ {c:"日",py:"rì",w:"日子"} ] },
      { p:"zi",   read:"字", chars:[ {c:"字",py:"zì",w:"写字"}, {c:"自",py:"zì",w:"自己"}, {c:"子",py:"zǐ",w:"孩子"} ] },
      { p:"ci",   read:"刺", chars:[ {c:"刺",py:"cì",w:"刺猬"}, {c:"词",py:"cí",w:"词语"} ] },
      { p:"si",   read:"四", chars:[ {c:"四",py:"sì",w:"四季"}, {c:"丝",py:"sī",w:"蚕丝"} ] },
      { p:"yi",   read:"一", chars:[ {c:"一",py:"yī",w:"一个"}, {c:"衣",py:"yī",w:"上衣"}, {c:"医",py:"yī",w:"医院"} ] },
      { p:"wu",   read:"五", chars:[ {c:"五",py:"wǔ",w:"五个"}, {c:"乌",py:"wū",w:"乌鸦"}, {c:"舞",py:"wǔ",w:"跳舞"} ] },
      { p:"yu",   read:"鱼", chars:[ {c:"鱼",py:"yú",w:"小鱼"}, {c:"雨",py:"yǔ",w:"下雨"}, {c:"玉",py:"yù",w:"玉米"} ] },
      { p:"ye",   read:"叶", chars:[ {c:"叶",py:"yè",w:"树叶"}, {c:"夜",py:"yè",w:"夜晚"}, {c:"爷",py:"yé",w:"爷爷"} ] },
      { p:"yue",  read:"月", chars:[ {c:"月",py:"yuè",w:"月亮"}, {c:"乐",py:"yuè",w:"音乐"} ] },
      { p:"yuan", read:"圆", chars:[ {c:"园",py:"yuán",w:"公园"}, {c:"圆",py:"yuán",w:"圆圈"}, {c:"远",py:"yuǎn",w:"远近"} ] },
      { p:"yin",  read:"音", chars:[ {c:"音",py:"yīn",w:"音乐"}, {c:"银",py:"yín",w:"银河"}, {c:"因",py:"yīn",w:"因为"} ] },
      { p:"yun",  read:"云", chars:[ {c:"云",py:"yún",w:"白云"}, {c:"运",py:"yùn",w:"运动"} ] },
      { p:"ying", read:"鹰", chars:[ {c:"鹰",py:"yīng",w:"老鹰"}, {c:"影",py:"yǐng",w:"影子"}, {c:"迎",py:"yíng",w:"欢迎"} ] }
    ]
  },

  /* ---- 生字 100 字（统编版一上写字表，unit = 每 10 字一组） ----
     strokes：手绘 SVG 笔顺路径（100×100 坐标）；无此字段的字用 Hanzi Writer 渲染 */
  shengzi: [
    { char:"一", pinyin:"yī",    words:["一个","一天"], unit:1 },
    { char:"二", pinyin:"èr",    words:["二十","第二"], unit:1 },
    { char:"三", pinyin:"sān",   words:["三个","三天"], unit:1 },
    { char:"上", pinyin:"shàng", words:["上学","山上"], unit:1 },
    { char:"口", pinyin:"kǒu",   words:["门口","口水"], unit:1,
      strokes:[ { d:"M32,24 L32,74", name:"竖" },
                { d:"M32,24 L70,24 L70,74", name:"横折" },
                { d:"M32,74 L70,74", name:"横" } ] },
    { char:"耳", pinyin:"ěr",    words:["耳朵","木耳"], unit:1 },
    { char:"目", pinyin:"mù",    words:["耳目","目光"], unit:1 },
    { char:"手", pinyin:"shǒu",  words:["小手","双手"], unit:1 },
    { char:"日", pinyin:"rì",    words:["日子","日光"], unit:1 },
    { char:"火", pinyin:"huǒ",   words:["火车","灯火"], unit:1 },

    { char:"田", pinyin:"tián",  words:["水田","田里"], unit:2 },
    { char:"禾", pinyin:"hé",    words:["禾苗"],        unit:2 },
    { char:"六", pinyin:"liù",   words:["六个"],        unit:2 },
    { char:"七", pinyin:"qī",    words:["七个","七天"], unit:2 },
    { char:"八", pinyin:"bā",    words:["八个","八十"], unit:2 },
    { char:"十", pinyin:"shí",   words:["十个","十天"], unit:2 },
    { char:"九", pinyin:"jiǔ",   words:["九个","九十"], unit:2 },
    { char:"王", pinyin:"wáng",  words:["大王","王子"], unit:2 },
    { char:"午", pinyin:"wǔ",    words:["中午","上午"], unit:2 },
    { char:"下", pinyin:"xià",   words:["下雨","山下"], unit:2 },

    { char:"个", pinyin:"gè",    words:["一个","个人"], unit:3 },
    { char:"去", pinyin:"qù",    words:["来去","回去"], unit:3 },
    { char:"了", pinyin:"le",    words:["好了","来了"], unit:3 },
    { char:"子", pinyin:"zǐ",    words:["孩子","子女"], unit:3 },
    { char:"大", pinyin:"dà",    words:["大人","大小"], unit:3,
      strokes:[ { d:"M16,30 L84,30", name:"横" },
                { d:"M56,12 C50,36 36,62 18,84", name:"撇" },
                { d:"M48,42 C62,58 76,72 90,84", name:"捺" } ] },
    { char:"人", pinyin:"rén",   words:["大人","人们"], unit:3,
      strokes:[ { d:"M56,16 C50,38 36,62 16,82", name:"撇" },
                { d:"M44,40 C58,55 72,70 88,84", name:"捺" } ] },
    { char:"可", pinyin:"kě",    words:["可爱","可是"], unit:3 },
    { char:"叶", pinyin:"yè",    words:["树叶","叶子"], unit:3 },
    { char:"东", pinyin:"dōng",  words:["东西","东方"], unit:3 },
    { char:"西", pinyin:"xī",    words:["西方","东西"], unit:3 },

    { char:"竹", pinyin:"zhú",   words:["竹子","竹叶"], unit:4 },
    { char:"马", pinyin:"mǎ",    words:["小马","白马"], unit:4 },
    { char:"牙", pinyin:"yá",    words:["牙齿","月牙"], unit:4 },
    { char:"用", pinyin:"yòng",  words:["有用","用心"], unit:4 },
    { char:"几", pinyin:"jǐ",    words:["几个","几天"], unit:4 },
    { char:"四", pinyin:"sì",    words:["四个","四季"], unit:4 },
    { char:"小", pinyin:"xiǎo",  words:["小鸟","大小"], unit:4 },
    { char:"鸟", pinyin:"niǎo",  words:["小鸟","飞鸟"], unit:4 },
    { char:"是", pinyin:"shì",   words:["就是","是的"], unit:4 },
    { char:"天", pinyin:"tiān",  words:["白天","天空"], unit:4,
      strokes:[ { d:"M22,16 L78,16", name:"横" },
                { d:"M14,40 L86,40", name:"横" },
                { d:"M56,42 C50,60 36,74 18,86", name:"撇" },
                { d:"M50,56 C64,68 78,78 92,84", name:"捺" } ] },

    { char:"女", pinyin:"nǚ",    words:["女孩","女生"], unit:5 },
    { char:"开", pinyin:"kāi",   words:["开门","开水"], unit:5 },
    { char:"关", pinyin:"guān",  words:["关门","关心"], unit:5 },
    { char:"先", pinyin:"xiān",  words:["先后","先生"], unit:5 },
    { char:"云", pinyin:"yún",   words:["白云","乌云"], unit:5 },
    { char:"雨", pinyin:"yǔ",    words:["下雨","雨水"], unit:5 },
    { char:"虫", pinyin:"chóng", words:["虫子","益虫"], unit:5 },
    { char:"山", pinyin:"shān",  words:["大山","上山"], unit:5 },
    { char:"水", pinyin:"shuǐ",  words:["河水","开水"], unit:5 },
    { char:"力", pinyin:"lì",    words:["用力","力气"], unit:5 },

    { char:"男", pinyin:"nán",   words:["男生","男孩"], unit:6 },
    { char:"土", pinyin:"tǔ",    words:["泥土","土地"], unit:6 },
    { char:"木", pinyin:"mù",    words:["木头","林木"], unit:6 },
    { char:"心", pinyin:"xīn",   words:["小心","开心"], unit:6 },
    { char:"尺", pinyin:"chǐ",   words:["尺子"],        unit:6 },
    { char:"本", pinyin:"běn",   words:["本子","课本"], unit:6 },
    { char:"刀", pinyin:"dāo",   words:["小刀","剪刀"], unit:6 },
    { char:"不", pinyin:"bù",    words:["不用","不好"], unit:6 },
    { char:"少", pinyin:"shǎo",  words:["多少","少见"], unit:6 },
    { char:"中", pinyin:"zhōng", words:["中间","中国"], unit:6 },

    { char:"五", pinyin:"wǔ",    words:["五个","五星"], unit:7 },
    { char:"风", pinyin:"fēng",  words:["大风","风雨"], unit:7 },
    { char:"立", pinyin:"lì",    words:["立正","起立"], unit:7 },
    { char:"正", pinyin:"zhèng", words:["立正","正好"], unit:7 },
    { char:"工", pinyin:"gōng",  words:["工人","工厂"], unit:7 },
    { char:"厂", pinyin:"chǎng", words:["工厂","厂房"], unit:7 },
    { char:"门", pinyin:"mén",   words:["大门","门口"], unit:7 },
    { char:"卫", pinyin:"wèi",   words:["卫生","门卫"], unit:7 },
    { char:"月", pinyin:"yuè",   words:["月亮","月儿"], unit:7 },
    { char:"儿", pinyin:"ér",    words:["儿子","月儿"], unit:7 },

    { char:"头", pinyin:"tóu",   words:["头上","石头"], unit:8 },
    { char:"里", pinyin:"lǐ",    words:["家里","里头"], unit:8 },
    { char:"见", pinyin:"jiàn",  words:["看见","再见"], unit:8 },
    { char:"在", pinyin:"zài",   words:["现在","在家"], unit:8 },
    { char:"我", pinyin:"wǒ",    words:["我们","自我"], unit:8 },
    { char:"左", pinyin:"zuǒ",   words:["左手","左边"], unit:8 },
    { char:"右", pinyin:"yòu",   words:["右手","右边"], unit:8 },
    { char:"和", pinyin:"hé",    words:["和好","温和"], unit:8 },
    { char:"也", pinyin:"yě",    words:["也许","也好"], unit:8 },
    { char:"又", pinyin:"yòu",   words:["又大又圆"],    unit:8 },

    { char:"才", pinyin:"cái",   words:["才能","刚才"], unit:9 },
    { char:"爸", pinyin:"bà",    words:["爸爸"],        unit:9 },
    { char:"妈", pinyin:"mā",    words:["妈妈"],        unit:9 },
    { char:"比", pinyin:"bǐ",    words:["比一比"],      unit:9 },
    { char:"巴", pinyin:"bā",    words:["尾巴","嘴巴"], unit:9 },
    { char:"长", pinyin:"cháng", words:["长短","长江"], unit:9 },
    { char:"公", pinyin:"gōng",  words:["公园","公路"], unit:9 },
    { char:"只", pinyin:"zhī",   words:["一只","只有"], unit:9 },
    { char:"多", pinyin:"duō",   words:["多少","许多"], unit:9 },
    { char:"办", pinyin:"bàn",   words:["办法","办好"], unit:9 },

    { char:"石", pinyin:"shí",   words:["石头","石子"], unit:10 },
    { char:"出", pinyin:"chū",   words:["出门","日出"], unit:10 },
    { char:"来", pinyin:"lái",   words:["回来","来去"], unit:10 },
    { char:"半", pinyin:"bàn",   words:["一半","半天"], unit:10 },
    { char:"你", pinyin:"nǐ",    words:["你们","你好"], unit:10 },
    { char:"有", pinyin:"yǒu",   words:["有用","没有"], unit:10 },
    { char:"牛", pinyin:"niú",   words:["小牛","水牛"], unit:10 },
    { char:"羊", pinyin:"yáng",  words:["山羊","小羊"], unit:10 },
    { char:"爪", pinyin:"zhuǎ",  words:["爪子","鸡爪"], unit:10 },
    { char:"白", pinyin:"bái",   words:["白云","白色"], unit:10 }
  ],

  /* ---- 朗读剧场：统编版一上全部阅读课文 + 园地日积月累古诗（15 篇） ----
     text 为全文，朗读页用 pinyin-pro 逐字标注拼音，按标点切句呈现；
     img＝该篇配图（生图工具按课文场景预生成，见 assets/langdu-img/） */
  langdu: {
    list: [
      { img:"assets/langdu-img/l01.jpg", title:"秋天",
        text:"天气凉了，树叶黄了，一片片叶子从树上落下来。天空那么蓝，那么高。一群大雁往南飞，一会儿排成个“人”字，一会儿排成个“一”字。啊！秋天来了！" },
      { img:"assets/langdu-img/l02.jpg", title:"江南",
        text:"江南可采莲，莲叶何田田。鱼戏莲叶间。鱼戏莲叶东，鱼戏莲叶西，鱼戏莲叶南，鱼戏莲叶北。" },
      { img:"assets/langdu-img/l03.jpg", title:"雪地里的小画家",
        text:"下雪啦，下雪啦！雪地里来了一群小画家。小鸡画竹叶，小狗画梅花，小鸭画枫叶，小马画月牙。不用颜料不用笔，几步就成一幅画。青蛙为什么没参加？他在洞里睡着啦。" },
      { img:"assets/langdu-img/l04.jpg", title:"四季",
        text:"草芽尖尖，他对小鸟说：“我是春天。”荷叶圆圆，他对青蛙说：“我是夏天。”谷穗弯弯，他鞠着躬说：“我是秋天。”雪人大肚子一挺，他顽皮地说：“我就是冬天。”" },
      { img:"assets/langdu-img/l05.jpg", title:"对韵歌",
        text:"云对雨，雪对风。花对树，鸟对虫。山清对水秀，柳绿对桃红。" },
      { img:"assets/langdu-img/l06.jpg", title:"小书包",
        text:"橡皮、尺子、作业本，笔袋、铅笔、转笔刀。我的小书包，宝贝真不少。课本作业本，铅笔转笔刀。上课静悄悄，下课不乱跑。天天起得早，陪我上学校。" },
      { img:"assets/langdu-img/l07.jpg", title:"升国旗",
        text:"五星红旗，我们的国旗。国歌声中，徐徐升起。迎风飘扬，多么美丽。向着国旗，我们立正。望着国旗，我们敬礼。" },
      { img:"assets/langdu-img/l08.jpg", title:"小小的船",
        text:"弯弯的月儿小小的船，小小的船儿两头尖。我在小小的船里坐，只看见闪闪的星星蓝蓝的天。" },
      { img:"assets/langdu-img/l09.jpg", title:"影子",
        text:"影子在前，影子在后，影子常常跟着我，就像一条小黑狗。影子在左，影子在右，影子常常陪着我，它是我的好朋友。" },
      { img:"assets/langdu-img/l10.jpg", title:"两件宝",
        text:"人有两件宝，双手和大脑。双手会做工，大脑会思考。用手不用脑，事情做不好。用脑不用手，啥也办不到。用手又用脑，才能有创造。" },
      { img:"assets/langdu-img/l11.jpg", title:"比尾巴",
        text:"谁的尾巴长？谁的尾巴短？谁的尾巴好像一把伞？猴子的尾巴长，兔子的尾巴短，松鼠的尾巴好像一把伞。谁的尾巴弯？谁的尾巴扁？谁的尾巴最好看？公鸡的尾巴弯，鸭子的尾巴扁，孔雀的尾巴最好看。" },
      { img:"assets/langdu-img/l12.jpg", title:"乌鸦喝水",
        text:"一只乌鸦口渴了，到处找水喝。乌鸦看见一个瓶子，瓶子里有水。可是，瓶子里水不多，瓶口又小，乌鸦喝不着水。怎么办呢？乌鸦看见旁边有许多小石子，想出办法来了。乌鸦把小石子一颗一颗地放进瓶子里。瓶子里的水渐渐升高，乌鸦就喝着水了。" },
      { img:"assets/langdu-img/l13.jpg", title:"雨点儿",
        text:"数不清的雨点儿，从云彩里落下来。半空中，大雨点儿问小雨点儿：你要到哪里去？小雨点儿回答：我要去有花有草的地方。你呢？大雨点儿说：我要去没有花没有草的地方。不久，有花有草的地方，花更红了，草更绿了。没有花没有草的地方，开出了红的花，长出了绿的草。" },
      { img:"assets/langdu-img/l14.jpg", title:"画",
        text:"远看山有色，近听水无声。春去花还在，人来鸟不惊。" },
      { img:"assets/langdu-img/l15.jpg", title:"风",
        text:"解落三秋叶，能开二月花。过江千尺浪，入竹万竿斜。" }
    ]
  },

  /* ---- 词语乐园：20 轮，每轮三类词 × 2 个候选 ----
     约束（v21 收紧）：每轮的 2×2×2＝8 种组合都必须读得通——允许拟人
     （「蜜蜂在花上跳舞」），但不得违反基本常识。原先存在「熊猫在云上
     打滚」「小狗在树上」「小鱼在沙坑」「爸爸在厨房买菜」这类组合，
     小朋友照着念出来是错的，故按「同一轮的 who 必须是同类、where 与
     what 对两个 who 都成立」的口径重新配词。
     用词全部取自 assets/jushi-words/ 已有词卡（未新增卡片）。
     img＝本轮成句后的场景插图（生图工具预生成，见 assets/jushi/）。
     注意：当前 jushi.js 用 assets/jushi-words/ 的词卡 + emoji 兜底渲染，
     img 字段暂无消费者；资源已移出版本库（磁盘保留），恢复旧版成句配图时再用。 */
  jushi: [
    { img:"assets/jushi/r01.jpg",
      who:[["小猫","🐱"],["小狗","🐶"]], where:[["在屋里","🏠"],["在院子里","🏡"]], what:[["打滚","🎨"],["晒太阳","☀️"]] },
    { img:"assets/jushi/r02.jpg",
      who:[["小鸟","🐦"],["蝴蝶","🦋"]], where:[["在云上","☁️"],["在花丛中","🌼"]], what:[["飞翔","🪁"],["跳舞","💃"]] },
    { img:"assets/jushi/r03.jpg",
      who:[["青蛙","🐸"],["鸭子","🦆"]], where:[["在池塘里","💦"],["在河边","🌊"]], what:[["游泳","🏊"],["喝水","💧"]] },
    { img:"assets/jushi/r04.jpg",
      who:[["小鱼","🐟"],["乌龟","🐢"]], where:[["在水里","💦"],["在大海里","🌊"]], what:[["吹泡泡","🫧"],["游泳","🏊"]] },
    { img:"assets/jushi/r05.jpg",
      who:[["蜜蜂","🐝"],["蝴蝶","🦋"]], where:[["在花上","🌸"],["在花丛中","🌼"]], what:[["采蜜","🍯"],["跳舞","💃"]] },
    { img:"assets/jushi/r06.jpg",
      who:[["小兔","🐰"],["熊猫","🐼"]], where:[["在草地上","🌿"],["在公园里","🎡"]], what:[["吃萝卜","🥕"],["荡秋千","🎪"]] },
    { img:"assets/jushi/r07.jpg",
      who:[["爷爷","👴"],["奶奶","👵"]], where:[["在超市","🛒"],["在门口","🚪"]], what:[["买菜","🥬"],["喝茶","🍵"]] },
    { img:"assets/jushi/r08.jpg",
      who:[["妹妹","👧"],["哥哥","👦"]], where:[["在花园里","🌷"],["在广场上","🎡"]], what:[["跳舞","💃"],["画画","🖍️"]] },
    { img:"assets/jushi/r09.jpg",
      who:[["大象","🐘"],["老虎","🐯"]], where:[["在山里","⛰️"],["在河边","🌊"]], what:[["走路","🚶"],["喝水","💧"]] },
    { img:"assets/jushi/r10.jpg",
      who:[["妈妈","👩"],["爸爸","👨"]], where:[["在厨房","🍳"],["在屋里","🏠"]], what:[["做饭","🍚"],["讲故事","📖"]] },
    { img:"assets/jushi/r11.jpg",
      who:[["小鸭","🦆"],["小鸡","🐔"]], where:[["在草地上","🌿"],["在沙坑","🏖️"]], what:[["捉虫","🐛"],["跑步","🏃"]] },
    { img:"assets/jushi/r12.jpg",
      who:[["马儿","🐎"],["羊儿","🐐"]], where:[["在山坡上","⛰️"],["在草原上","🌾"]], what:[["奔跑","🏃"],["吃草","🌿"]] },
    { img:"assets/jushi/r13.jpg",
      who:[["星星","⭐"],["月亮","🌙"]], where:[["在天上","🌌"],["在云里","☁️"]], what:[["眨眼","👁️"],["捉迷藏","🙈"]] },
    { img:"assets/jushi/r14.jpg",
      who:[["爸爸","👨"],["我","🧒"]], where:[["在公园里","🎡"],["在球场上","⚽"]], what:[["打球","🏀"],["放风筝","🪁"]] },
    { img:"assets/jushi/r15.jpg",
      who:[["小鱼","🐟"],["海豚","🐬"]], where:[["在大海里","🌊"],["在浪花里","💦"]], what:[["跳舞","💃"],["唱歌","🎵"]] },
    { img:"assets/jushi/r16.jpg",
      who:[["小鸟","🐦"],["松鼠","🐿️"]], where:[["在枝头","🌳"],["在树上","🌳"]], what:[["唱歌","🎵"],["捉迷藏","🙈"]] },
    { img:"assets/jushi/r17.jpg",
      who:[["娃娃","🪆"],["小熊","🧸"]], where:[["在床上","🛏️"],["在椅子上","🪑"]], what:[["睡觉","😴"],["看书","📚"]] },
    { img:"assets/jushi/r18.jpg",
      who:[["雨点","🌧️"],["雪花","❄️"]], where:[["从天上","🌌"],["在空中","🌐"]], what:[["跳舞","💃"],["飘落","🍂"]] },
    { img:"assets/jushi/r19.jpg",
      who:[["同学","🧑‍🎓"],["老师","🧑‍🏫"]], where:[["在教室里","🏫"],["在操场上","🏃"]], what:[["读书","📚"],["做操","🤸"]] },
    { img:"assets/jushi/r20.jpg",
      who:[["宝宝","👶"],["妈妈","👩"]], where:[["在床上","🛏️"],["在怀里","🤗"]], what:[["睡觉","😴"],["唱歌","🎵"]] }
  ],

  /* ---- 家长门禁算术题（报告数值已改为 report.js 计算真实数据） ---- */
  parent: {
    gate: { a: 7, b: 5, answer: 12 }
  },

  /* ---- 奖励中心 · 商店（4 件装饰商品，星星兑换；jiangli.js 使用） ---- */
  shop: [
    { id: "leaf",  name: "小树叶", emoji: "🍃", price: 10 },
    { id: "flower",name: "小红花", emoji: "🌸", price: 20 },
    { id: "fruit", name: "甜果子", emoji: "🍎", price: 30 },
    { id: "hat",   name: "小草帽", emoji: "👒", price: 40 }
  ]
};
