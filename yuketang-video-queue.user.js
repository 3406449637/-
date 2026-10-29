// ==UserScript==
// @name         雨课堂视频串行队列（2 倍速）+ 自动讨论 + 作业助手
// @namespace    https://changjiang.yuketang.cn/
// @version      2.1.0
// @description  读取雨课堂课程中未完成的视频，按顺序在独立标签页中逐个播放（2 倍速）；支持读取未发言的讨论并调用 AI 生成答案；支持读取未完成作业、自动解码题目、由 AI 作答并等待人工审核后再提交。
// @author       ZCode
// @match        https://changjiang.yuketang.cn/pro/lms/*/studycontent*
// @match        https://changjiang.yuketang.cn/v2/web/studentLog*
// @match        https://changjiang.yuketang.cn/ai-workspace/lms-graph/*/video/*
// @match        https://changjiang.yuketang.cn/ai-workspace/lms-graph/*/forum/*
// @match        https://changjiang.yuketang.cn/ai-workspace/lms-graph/*/exercise/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const VERSION = '2.1.0';
  const STORAGE_PREFIX = 'ykt-video-queue-v1';
  const WORKER_NAME = 'ykt-video-queue-worker';
  const WORKER_HASH = 'ykt-video-queue';
  const WORKER_SESSION_KEY = 'ykt-video-queue-worker-mode';
  const CHANNEL_NAME = 'ykt-video-queue-channel';
  const SPEED = 2;
  const SUPPORTED_SPEEDS = [2];
  const COMPLETE_THRESHOLD = 0.999;
  const HEARTBEAT_MS = 5000;
  const STALE_MS = 45000;
  const MAX_CHECK_MS = 10 * 60 * 1000;
  const MIN_CHECK_MS = 2000;
  const PER_VIDEO_OVERHEAD_SECONDS = 6;

  const DISCUSSION_STORAGE_PREFIX = 'ykt-discussion-queue-v1';
  const DISCUSSION_CONFIG_KEY = 'ykt-discussion-config-v1';
  const DISCUSSION_WORKER_NAME = 'ykt-discussion-queue-worker';
  const DISCUSSION_WORKER_HASH = 'ykt-discussion-queue';
  const DISCUSSION_WORKER_SESSION_KEY = 'ykt-discussion-queue-worker-mode';
  const DISCUSSION_CHANNEL_NAME = 'ykt-discussion-queue-channel';
  const DISCUSSION_LEAF_TYPE = 4;
  const AI_TIMEOUT_MS = 120000;
  const AI_FORMATS = ['openai', 'openai-responses', 'anthropic', 'gemini'];
  const DEFAULT_PROMPT_TEMPLATE = '【题目】\n{题目}\n\n读题，读题要求，直接给出符合题目要求的解答，解答不能包含任何分析内容，要直接复制就能成为最终答案。';
  const DEFAULT_AI_CONFIG = {
    format: 'openai',
    apiUrl: '',
    apiKey: '',
    model: '',
    autoSubmit: true,
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    homeworkMode: 'screenshot',
    stopOnWrongAnswer: true,
    homeworkAutoSubmit: false,
    homeworkDoubleCheck: true,
    extraHeaders: '',
  };

  const HOMEWORK_STORAGE_PREFIX = 'ykt-homework-queue-v1';
  const HOMEWORK_WORKER_NAME = 'ykt-homework-queue-worker';
  const HOMEWORK_WORKER_HASH = 'ykt-homework-queue';
  const HOMEWORK_WORKER_SESSION_KEY = 'ykt-homework-queue-worker-mode';
  const HOMEWORK_CHANNEL_NAME = 'ykt-homework-queue-channel';
  const HOMEWORK_LEAF_TYPE = 6;
  const HOMEWORK_FONT_STACK = '"Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","PingFang SC","WenQuanYi Micro Hei",sans-serif';
  const GLYPH_GRID = 16;
  const GLYPH_CELL = 40;
  const GLYPH_COLS = 96;
  const GLYPH_MIN_SCORE = 0.5;

  const GLYPH_CHARS = [
    '啊阿埃挨哎唉哀皑癌蔼矮艾碍爱隘鞍氨安俺按暗岸胺案肮昂盎凹敖熬翱袄傲奥懊澳芭捌扒叭吧笆八疤巴拔跋靶把耙坝霸罢爸白柏百摆佰败拜稗斑班搬扳般颁板版扮拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑傍谤苞胞包褒剥薄雹',
    '保堡饱宝抱报暴豹鲍爆杯碑悲卑北辈背贝钡倍狈备惫焙被奔苯本笨崩绷甭泵蹦迸逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛鞭边编贬扁便变卞辨辩辫遍标彪膘表鳖憋别瘪彬斌濒滨宾摈兵冰柄丙秉饼炳病并玻菠',
    '播拨钵波博勃搏铂箔伯帛舶脖膊渤泊驳捕卜哺补埠不布步簿部怖擦猜裁材才财睬踩采彩菜蔡餐参蚕残惭惨灿苍舱仓沧藏操糙槽曹草厕策侧册测层蹭插叉茬茶查碴搽察岔差诧拆柴豺搀掺蝉馋谗缠铲产阐颤昌猖场尝常长偿肠',
    '厂敞畅唱倡超抄钞朝嘲潮巢吵炒车扯撤掣彻澈郴臣辰尘晨忱沉陈趁衬撑称城橙成呈乘程惩澄诚承逞骋秤吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽充冲虫崇宠抽酬畴踌稠愁筹仇绸瞅丑臭初出橱厨躇锄雏滁除楚础储矗搐触处揣川',
    '穿椽传船喘串疮窗幢床闯创吹炊捶锤垂春椿醇唇淳纯蠢戳绰疵茨磁雌辞慈瓷词此刺赐次聪葱囱匆从丛凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错搭达答瘩打大呆歹傣戴带殆代贷袋待逮怠耽担丹单郸掸胆旦氮',
    '但惮淡诞弹蛋当挡党荡档刀捣蹈倒岛祷导到稻悼道盗德得的蹬灯登等瞪凳邓堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔颠掂滇碘点典靛垫电佃甸店惦奠淀殿碉叼雕凋刁掉吊钓调跌爹碟蝶迭谍叠丁盯叮钉顶鼎锭定订丢东冬',
    '董懂动栋侗恫冻洞兜抖斗陡豆逗痘都督毒犊独读堵睹赌杜镀肚度渡妒端短锻段断缎堆兑队对墩吨蹲敦顿囤钝盾遁掇哆多夺垛躲朵跺舵剁惰堕蛾峨鹅俄额讹娥恶厄扼遏鄂饿恩而儿耳尔饵洱二贰发罚筏伐乏阀法珐藩帆番翻樊',
    '矾钒繁凡烦反返范贩犯饭泛坊芳方肪房防妨仿访纺放菲非啡飞肥匪诽吠肺废沸费芬酚吩氛分纷坟焚汾粉奋份忿愤粪丰封枫蜂峰锋风疯烽逢冯缝讽奉凤佛否夫敷肤孵扶拂辐幅氟符伏俘服浮涪福袱弗甫抚辅俯釜斧脯腑府腐赴',
    '副覆赋复傅付阜父腹负富讣附妇缚咐噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣冈刚钢缸肛纲岗港杠篙皋高膏羔糕搞镐稿告哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各给根跟耕更庚羹埂耿梗工攻功恭龚供躬公宫弓巩汞拱贡共',
    '钩勾沟苟狗垢构购够辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯光广逛瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽辊滚棍锅郭国果裹过哈骸孩海氦亥害骇酣憨邯韩含涵寒函喊罕翰撼捍',
    '旱憾悍焊汗汉夯杭航壕嚎豪毫郝好耗号浩呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红喉侯猴吼厚候后呼乎忽瑚壶葫胡蝴狐糊湖弧虎唬护互沪户花哗华猾滑画划化话槐徊怀淮坏欢',
    '环桓还缓换患唤痪豢焕涣宦幻荒慌黄磺蝗簧皇凰惶煌晃幌恍谎灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘荤昏婚魂浑混豁活伙火获或惑霍货祸击圾基机畸稽积箕肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几',
    '脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件健舰剑饯渐溅涧建僵姜将浆江疆蒋桨奖讲匠酱降蕉椒礁焦胶',
    '交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸尽劲荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净炯',
    '窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝均菌钧军君峻俊竣浚郡骏喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤',
    '靠坷苛柯棵磕颗科壳咳可渴克刻客课肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀馈愧溃坤昆捆困括扩廓阔垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览',
    '懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝勒乐雷镭蕾磊累儡垒擂肋类泪棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐痢立粒沥隶力璃哩俩联莲连镰廉怜涟帘敛脸链恋炼练粮凉梁粱良两辆量晾亮谅',
    '撩聊僚疗燎寥辽潦了撂镣廖料列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎玲菱零龄铃伶羚凌灵陵岭领另令溜琉榴硫馏留刘瘤流柳六龙聋咙笼窿隆垄拢陇楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履',
    '屡缕虑氯律率滤绿峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么玫枚梅酶霉煤没眉媒镁每美昧寐妹媚门闷',
    '们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬摸摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某拇牡亩姆母墓暮幕募慕木目睦牧穆拿哪呐钠那娜',
    '纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺哦欧鸥殴藕呕偶沤啪趴爬帕怕琶拍排牌徘湃派攀',
    '潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺',
    '仆莆葡菩蒲埔朴圃普浦谱曝瀑期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫掐恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉枪呛腔羌墙蔷强抢橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏',
    '窍切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁青轻氢倾卿清擎晴氰情顷请庆琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃',
    '妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱撒洒萨腮鳃塞赛三叁伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢',
    '捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试',
    '收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥',
    '俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所塌他它她塔獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特',
    '藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉天添填田甜恬舔腆挑条迢眺跳贴铁帖厅听烃汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾挖',
    '哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬',
    '屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误昔熙析西硒矽晰嘻吸锡牺稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细瞎虾匣霞辖暇峡侠狭下厦夏吓掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限',
    '线相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象萧硝霄削哮嚣销消宵淆晓小孝校肖啸笑效楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑薪芯锌欣辛新忻心信衅星腥猩惺兴刑型形邢行醒幸杏性姓兄凶胸匈汹雄熊休修羞朽',
    '嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚',
    '雁唁彦焰宴谚验殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾邀腰妖瑶摇尧遥窑谣姚咬舀药要耀椰噎耶爷野冶也页掖业叶曳腋夜液一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆',
    '义益溢诣议谊译异翼翌绎茵荫因殷音阴姻吟银淫寅饮尹引隐印英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔',
    '隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡',
    '蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞',
    '针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒中盅忠钟衷终种肿重仲众舟周州洲诌粥轴肘帚咒皱宙昼骤珠株蛛朱',
    '猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最',
    '罪尊遵昨左佐柞做作坐座亍丌兀丐廿卅丕亘丞鬲孬噩丨禺丿匕乇夭爻卮氐囟胤馗毓睾鼗丶亟鼐乜乩亓芈孛啬嘏仄厍厝厣厥厮靥赝匚叵匦匮匾赜卦卣刂刈刎刭刳刿剀剌剞剡剜蒯剽劂劁劐劓冂罔亻仃仉仂仨仡仫仞伛仳伢佤仵',
    '伥伧伉伫佞佧攸佚佝佟佗伲伽佶佴侑侉侃侏佾佻侪佼侬侔俦俨俪俅俚俣俜俑俟俸倩偌俳倬倏倮倭俾倜倌倥倨偾偃偕偈偎偬偻傥傧傩傺僖儆僭僬僦僮儇儋仝氽佘佥俎龠汆籴兮巽黉馘冁夔勹匍訇匐凫夙兕亠兖亳衮袤亵脔裒禀',
    '嬴蠃羸冫冱冽冼凇冖冢冥讠讦讧讪讴讵讷诂诃诋诏诎诒诓诔诖诘诙诜诟诠诤诨诩诮诰诳诶诹诼诿谀谂谄谇谌谏谑谒谔谕谖谙谛谘谝谟谠谡谥谧谪谫谮谯谲谳谵谶卩卺阝阢阡阱阪阽阼陂陉陔陟陧陬陲陴隈隍隗隰邗邛邝邙邬',
    '邡邴邳邶邺邸邰郏郅邾郐郄郇郓郦郢郜郗郛郫郯郾鄄鄢鄞鄣鄱鄯鄹酃酆刍奂劢劬劭劾哿勐勖勰叟燮矍廴凵凼鬯厶弁畚巯坌垩垡塾墼壅壑圩圬圪圳圹圮圯坜圻坂坩垅坫垆坼坻坨坭坶坳垭垤垌垲埏垧垴垓垠埕埘埚埙埒垸埴埯',
    '埸埤埝堋堍埽埭堀堞堙塄堠塥塬墁墉墚墀馨鼙懿艹艽艿芏芊芨芄芎芑芗芙芫芸芾芰苈苊苣芘芷芮苋苌苁芩芴芡芪芟苄苎芤苡茉苷苤茏茇苜苴苒苘茌苻苓茑茚茆茔茕苠苕茜荑荛荜茈莒茼茴茱莛荞茯荏荇荃荟荀茗荠茭茺茳荦',
    '荥荨茛荩荬荪荭荮莰荸莳莴莠莪莓莜莅荼莶莩荽莸荻莘莞莨莺莼菁萁菥菘堇萘萋菝菽菖萜萸萑萆菔菟萏萃菸菹菪菅菀萦菰菡葜葑葚葙葳蒇蒈葺蒉葸萼葆葩葶蒌蒎萱葭蓁蓍蓐蓦蒽蓓蓊蒿蒺蓠蒡蒹蒴蒗蓥蓣蔌甍蔸蓰蔹蔟蔺蕖',
    '蔻蓿蓼蕙蕈蕨蕤蕞蕺瞢蕃蕲蕻薤薨薇薏蕹薮薜薅薹薷薰藓藁藜藿蘧蘅蘩蘖蘼廾弈夼奁耷奕奚奘匏尢尥尬尴扌扪抟抻拊拚拗拮挢拶挹捋捃掭揶捱捺掎掴捭掬掊捩掮掼揲揸揠揿揄揞揎摒揆掾摅摁搋搛搠搌搦搡摞撄摭撖摺撷撸',
    '撙撺擀擐擗擤擢攉攥攮弋忒甙弑卟叱叽叩叨叻吒吖吆呋呒呓呔呖呃吡呗呙吣吲咂咔呷呱呤咚咛咄呶呦咝哐咭哂咴哒咧咦哓哔呲咣哕咻咿哌哙哚哜咩咪咤哝哏哞唛哧唠哽唔哳唢唣唏唑唧唪啧喏喵啉啭啁啕唿啐唼唷啖啵啶啷',
    '唳唰啜喋嗒喃喱喹喈喁喟啾嗖喑啻嗟喽喾喔喙嗪嗷嗉嘟嗑嗫嗬嗔嗦嗝嗄嗯嗥嗲嗳嗌嗍嗨嗵嗤辔嘞嘈嘌嘁嘤嘣嗾嘀嘧嘭噘嘹噗嘬噍噢噙噜噌噔嚆噤噱噫噻噼嚅嚓嚯囔囗囝囡囵囫囹囿圄圊圉圜帏帙帔帑帱帻帼帷幄幔幛幞幡岌',
    '屺岍岐岖岈岘岙岑岚岜岵岢岽岬岫岱岣峁岷峄峒峤峋峥崂崃崧崦崮崤崞崆崛嵘崾崴崽嵬嵛嵯嵝嵫嵋嵊嵩嵴嶂嶙嶝豳嶷巅彳彷徂徇徉後徕徙徜徨徭徵徼衢彡犭犰犴犷犸狃狁狎狍狒狨狯狩狲狴狷猁狳猃狺狻猗猓猡猊猞猝猕猢',
    '猹猥猬猸猱獐獍獗獠獬獯獾舛夥飧夤夂饣饧饨饩饪饫饬饴饷饽馀馄馇馊馍馐馑馓馔馕庀庑庋庖庥庠庹庵庾庳赓廒廑廛廨廪膺忄忉忖忏怃忮怄忡忤忾怅怆忪忭忸怙怵怦怛怏怍怩怫怊怿怡恸恹恻恺恂恪恽悖悚悭悝悃悒悌悛惬',
    '悻悱惝惘惆惚悴愠愦愕愣惴愀愎愫慊慵憬憔憧憷懔懵忝隳闩闫闱闳闵闶闼闾阃阄阆阈阊阋阌阍阏阒阕阖阗阙阚丬爿戕氵汔汜汊沣沅沐沔沌汨汩汴汶沆沩泐泔沭泷泸泱泗沲泠泖泺泫泮沱泓泯泾洹洧洌浃浈洇洄洙洎洫浍洮洵',
    '洚浏浒浔洳涑浯涞涠浞涓涔浜浠浼浣渚淇淅淞渎涿淠渑淦淝淙渖涫渌涮渫湮湎湫溲湟溆湓湔渲渥湄滟溱溘滠漭滢溥溧溽溻溷滗溴滏溏滂溟潢潆潇漤漕滹漯漶潋潴漪漉漩澉澍澌潸潲潼潺濑濉澧澹澶濂濡濮濞濠濯瀚瀣瀛瀹瀵',
    '灏灞宀宄宕宓宥宸甯骞搴寤寮褰寰蹇謇辶迓迕迥迮迤迩迦迳迨逅逄逋逦逑逍逖逡逵逶逭逯遄遑遒遐遨遘遢遛暹遴遽邂邈邃邋彐彗彖彘尻咫屐屙孱屣屦羼弪弩弭艴弼鬻屮妁妃妍妩妪妣妗姊妫妞妤姒妲妯姗妾娅娆姝娈姣姘姹',
    '娌娉娲娴娑娣娓婀婧婊婕娼婢婵胬媪媛婷婺媾嫫媲嫒嫔媸嫠嫣嫱嫖嫦嫘嫜嬉嬗嬖嬲嬷孀尕尜孚孥孳孑孓孢驵驷驸驺驿驽骀骁骅骈骊骐骒骓骖骘骛骜骝骟骠骢骣骥骧纟纡纣纥纨纩纭纰纾绀绁绂绉绋绌绐绔绗绛绠绡绨绫绮绯',
    '绱绲缍绶绺绻绾缁缂缃缇缈缋缌缏缑缒缗缙缜缛缟缡缢缣缤缥缦缧缪缫缬缭缯缰缱缲缳缵幺畿巛甾邕玎玑玮玢玟珏珂珑玷玳珀珉珈珥珙顼琊珩珧珞玺珲琏琪瑛琦琥琨琰琮琬琛琚瑁瑜瑗瑕瑙瑷瑭瑾璜璎璀璁璇璋璞璨璩璐璧',
    '瓒璺韪韫韬杌杓杞杈杩枥枇杪杳枘枧杵枨枞枭枋杷杼柰栉柘栊柩枰栌柙枵柚枳柝栀柃枸柢栎柁柽栲栳桠桡桎桢桄桤梃栝桕桦桁桧桀栾桊桉栩梵梏桴桷梓桫棂楮棼椟椠棹椤棰椋椁楗棣椐楱椹楠楂楝榄楫榀榘楸椴槌榇榈槎榉',
    '楦楣楹榛榧榻榫榭槔榱槁槊槟榕槠榍槿樯槭樗樘橥槲橄樾檠橐橛樵檎橹樽樨橘橼檑檐檩檗檫猷獒殁殂殇殄殒殓殍殚殛殡殪轫轭轱轲轳轵轶轸轷轹轺轼轾辁辂辄辇辋辍辎辏辘辚軎戋戗戛戟戢戡戥戤戬臧瓯瓴瓿甏甑甓攴旮旯',
    '旰昊昙杲昃昕昀炅曷昝昴昱昶昵耆晟晔晁晏晖晡晗晷暄暌暧暝暾曛曜曦曩贲贳贶贻贽赀赅赆赈赉赇赍赕赙觇觊觋觌觎觏觐觑牮犟牝牦牯牾牿犄犋犍犏犒挈挲掰搿擘耄毪毳毽毵毹氅氇氆氍氕氘氙氚氡氩氤氪氲攵敕敫牍牒牖',
    '爰虢刖肟肜肓肼朊肽肱肫肭肴肷胧胨胩胪胛胂胄胙胍胗朐胝胫胱胴胭脍脎胲胼朕脒豚脶脞脬脘脲腈腌腓腴腙腚腱腠腩腼腽腭腧塍媵膈膂膑滕膣膪臌朦臊膻臁膦欤欷欹歃歆歙飑飒飓飕飙飚殳彀毂觳斐齑斓於旆旄旃旌旎旒旖',
    '炀炜炖炝炻烀炷炫炱烨烊焐焓焖焯焱煳煜煨煅煲煊煸煺熘熳熵熨熠燠燔燧燹爝爨灬焘煦熹戾戽扃扈扉礻祀祆祉祛祜祓祚祢祗祠祯祧祺禅禊禚禧禳忑忐怼恝恚恧恁恙恣悫愆愍慝憩憝懋懑戆肀聿沓泶淼矶矸砀砉砗砘砑斫砭砜',
    '砝砹砺砻砟砼砥砬砣砩硎硭硖硗砦硐硇硌硪碛碓碚碇碜碡碣碲碹碥磔磙磉磬磲礅磴礓礤礞礴龛黹黻黼盱眄眍盹眇眈眚眢眙眭眦眵眸睐睑睇睃睚睨睢睥睿瞍睽瞀瞌瞑瞟瞠瞰瞵瞽町畀畎畋畈畛畲畹疃罘罡罟詈罨罴罱罹羁罾盍',
    '盥蠲钅钆钇钋钊钌钍钏钐钔钗钕钚钛钜钣钤钫钪钭钬钯钰钲钴钶钷钸钹钺钼钽钿铄铈铉铊铋铌铍铎铐铑铒铕铖铗铙铘铛铞铟铠铢铤铥铧铨铪铩铫铮铯铳铴铵铷铹铼铽铿锃锂锆锇锉锊锍锎锏锒锓锔锕锖锘锛锝锞锟锢锪锫锩',
    '锬锱锲锴锶锷锸锼锾锿镂锵镄镅镆镉镌镎镏镒镓镔镖镗镘镙镛镞镟镝镡镢镤镥镦镧镨镩镪镫镬镯镱镲镳锺矧矬雉秕秭秣秫稆嵇稃稂稞稔稹稷穑黏馥穰皈皎皓皙皤瓞瓠甬鸠鸢鸨鸩鸪鸫鸬鸲鸱鸶鸸鸷鸹鸺鸾鹁鹂鹄鹆鹇鹈鹉鹋',
    '鹌鹎鹑鹕鹗鹚鹛鹜鹞鹣鹦鹧鹨鹩鹪鹫鹬鹱鹭鹳疒疔疖疠疝疬疣疳疴疸痄疱疰痃痂痖痍痣痨痦痤痫痧瘃痱痼痿瘐瘀瘅瘌瘗瘊瘥瘘瘕瘙瘛瘼瘢瘠癀瘭瘰瘿瘵癃瘾瘳癍癞癔癜癖癫癯翊竦穸穹窀窆窈窕窦窠窬窨窭窳衤衩衲衽衿袂',
    '袢裆袷袼裉裢裎裣裥裱褚裼裨裾裰褡褙褓褛褊褴褫褶襁襦襻疋胥皲皴矜耒耔耖耜耠耢耥耦耧耩耨耱耋耵聃聆聍聒聩聱覃顸颀颃颉颌颍颏颔颚颛颞颟颡颢颥颦虍虔虬虮虿虺虼虻蚨蚍蚋蚬蚝蚧蚣蚪蚓蚩蚶蛄蚵蛎蚰蚺蚱蚯蛉蛏',
    '蚴蛩蛱蛲蛭蛳蛐蜓蛞蛴蛟蛘蛑蜃蜇蛸蜈蜊蜍蜉蜣蜻蜞蜥蜮蜚蜾蝈蜴蜱蜩蜷蜿螂蜢蝽蝾蝻蝠蝰蝌蝮螋蝓蝣蝼蝤蝙蝥螓螯螨蟒蟆螈螅螭螗螃螫蟥螬螵螳蟋蟓螽蟑蟀蟊蟛蟪蟠蟮蠖蠓蟾蠊蠛蠡蠹蠼缶罂罄罅舐竺竽笈笃笄笕笊笫笏',
    '筇笸笪笙笮笱笠笥笤笳笾笞筘筚筅筵筌筝筠筮筻筢筲筱箐箦箧箸箬箝箨箅箪箜箢箫箴篑篁篌篝篚篥篦篪簌篾篼簏簖簋簟簪簦簸籁籀臾舁舂舄臬衄舡舢舣舭舯舨舫舸舻舳舴舾艄艉艋艏艚艟艨衾袅袈裘裟襞羝羟羧羯羰羲籼敉',
    '粑粝粜粞粢粲粼粽糁糇糌糍糈糅糗糨艮暨羿翎翕翥翡翦翩翮翳糸絷綦綮繇纛麸麴赳趄趔趑趱赧赭豇豉酊酐酎酏酤酢酡酰酩酯酽酾酲酴酹醌醅醐醍醑醢醣醪醭醮醯醵醴醺豕鹾趸跫踅蹙蹩趵趿趼趺跄跖跗跚跞跎跏跛跆跬跷跸',
    '跣跹跻跤踉跽踔踝踟踬踮踣踯踺蹀踹踵踽踱蹉蹁蹂蹑蹒蹊蹰蹶蹼蹯蹴躅躏躔躐躜躞豸貂貊貅貘貔斛觖觞觚觜觥觫觯訾謦靓雩雳雯霆霁霈霏霎霪霭霰霾龀龃龅龆龇龈龉龊龌黾鼋鼍隹隼隽雎雒瞿雠銎銮鋈錾鍪鏊鎏鐾鑫鱿鲂鲅',
    '鲆鲇鲈稣鲋鲎鲐鲑鲒鲔鲕鲚鲛鲞鲟鲠鲡鲢鲣鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲺鲻鲼鲽鳄鳅鳆鳇鳊鳋鳌鳍鳎鳏鳐鳓鳔鳕鳗鳘鳙鳜鳝鳟鳢靼鞅鞑鞒鞔鞯鞫鞣鞲鞴骱骰骷鹘骶骺骼髁髀髅髂髋髌髑魅魃魇魉魈魍魑飨餍餮饕饔',
    '髟髡髦髯髫髻髭髹鬈鬏鬓鬟鬣麽麾縻麂麇麈麋麒鏖麝麟黛黜黝黠黟黢黩黧黥黪黯鼢鼬鼯鼹鼷鼽鼾齄，。？！、《》“”‘’；：（）—…·【】',
  ].join('');

  try {
    console.info(`[雨课堂视频队列] v${VERSION} 已加载：${location.href}`);
  } catch (_) {}

  const page = detectPage();
  if (!page) return;

  if (page.kind === 'course') {
    initCoursePage(page);
    initDiscussionCoursePage(page);
    initHomeworkCoursePage(page);
  } else if (page.kind === 'video' && isWorkerTab()) {
    initWorkerPage(page);
  } else if (page.kind === 'forum' && isDiscussionWorkerTab()) {
    initDiscussionWorkerPage(page);
  } else if (page.kind === 'exercise' && isHomeworkWorkerTab()) {
    initHomeworkWorkerPage(page);
  }

  // ---------------------------------------------------------------------------
  // Common helpers
  // ---------------------------------------------------------------------------

  function detectPage() {
    const courseMatch = location.pathname.match(/^\/pro\/lms\/([^/]+)\/(\d+)\/studycontent(?:\/|$)/);
    if (courseMatch) {
      let sign = courseMatch[1];
      try { sign = decodeURIComponent(sign); } catch (_) {}
      return { kind: 'course', courseSign: sign, classroomId: String(courseMatch[2]) };
    }

    const logMatch = location.pathname.match(/^\/v2\/web\/studentLog(?:\/(\d+))?(?:\/|$)/);
    if (logMatch) {
      const classroomId = logMatch[1] || new URLSearchParams(location.search).get('classroom_id');
      if (classroomId) {
        return { kind: 'course', courseSign: '', classroomId: String(classroomId) };
      }
    }

    const videoMatch = location.pathname.match(/^\/ai-workspace\/lms-graph\/(\d+)\/video\/(\d+)(?:\/|$)/);
    if (videoMatch) {
      return { kind: 'video', classroomId: String(videoMatch[1]), leafId: Number(videoMatch[2]) };
    }

    const forumMatch = location.pathname.match(/^\/ai-workspace\/lms-graph\/(\d+)\/forum\/(\d+)(?:\/|$)/);
    if (forumMatch) {
      return { kind: 'forum', classroomId: String(forumMatch[1]), leafId: Number(forumMatch[2]) };
    }

    const exerciseMatch = location.pathname.match(/^\/ai-workspace\/lms-graph\/(\d+)\/exercise\/(\d+)(?:\/|$)/);
    if (exerciseMatch) {
      return { kind: 'exercise', classroomId: String(exerciseMatch[1]), leafId: Number(exerciseMatch[2]) };
    }

    return null;
  }

  function isHomeworkWorkerTab() {
    if (window.name === HOMEWORK_WORKER_NAME) return true;
    try {
      if (location.hash.replace(/^#/, '') === HOMEWORK_WORKER_HASH) return true;
      if (sessionStorage.getItem(HOMEWORK_WORKER_SESSION_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function isDiscussionWorkerTab() {
    if (window.name === DISCUSSION_WORKER_NAME) return true;
    try {
      if (location.hash.replace(/^#/, '') === DISCUSSION_WORKER_HASH) return true;
      if (sessionStorage.getItem(DISCUSSION_WORKER_SESSION_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function isWorkerTab() {
    if (window.name === WORKER_NAME) return true;
    try {
      if (location.hash.replace(/^#/, '') === WORKER_HASH) return true;
      if (sessionStorage.getItem(WORKER_SESSION_KEY) === '1') return true;
    } catch (_) {}
    return false;
  }

  function storageKey(classroomId) {
    return `${STORAGE_PREFIX}:${classroomId}`;
  }

  function loadState(classroomId) {
    try {
      const raw = localStorage.getItem(storageKey(classroomId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    if (!state) return;
    state.updatedAt = Date.now();
    state.completedVideos = countCompleted(state);
    try {
      localStorage.setItem(storageKey(state.classroomId), JSON.stringify(state));
    } catch (_) {}
  }

  function countCompleted(state) {
    if (!state) return 0;
    const queueDone = state.queue.filter(isItemDone).length;
    return Math.min(state.totalVideos || 0, (state.baseCompleted || 0) + queueDone);
  }

  function isItemDone(item) {
    return !!item && (item.playedToEnd === true || Number(item.progress) >= COMPLETE_THRESHOLD);
  }

  function normalizeProgress(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function pct(value) {
    return `${Math.round(normalizeProgress(value) * 100)}%`;
  }

  function formatTime(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function videoPageUrl(classroomId, leafId, chapterId) {
    const url = new URL(`/ai-workspace/lms-graph/${classroomId}/video/${leafId}`, location.origin);
    url.searchParams.set('is_chapter', '1');
    if (chapterId != null) url.searchParams.set('node_id', String(chapterId));
    return url.href;
  }

  function withWorkerHash(url) {
    const parsed = new URL(url, location.origin);
    parsed.hash = WORKER_HASH;
    return parsed.href;
  }

  function truncate(value, max) {
    const text = cleanText(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  async function apiGet(path, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          XTBZ: 'ykt',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (body && body.success === false) throw new Error(body.msg || '接口返回失败');
      return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('接口请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchProgressData(classroomId) {
    return apiGet(`/c27/online_courseware/schedule/course/progress/?classroom_id=${encodeURIComponent(classroomId)}`);
  }

  function extractVideos(progressData, classroomId) {
    const chapters = progressData && progressData.course_progress;
    if (!Array.isArray(chapters)) throw new Error('课程进度数据结构异常');

    const videos = [];
    const seen = new Set();

    for (const chapter of chapters) {
      const chapterId = chapter.id;
      const chapterName = cleanText(chapter.name);
      const sectionEntries = Array.isArray(chapter.section_leaf_list) ? chapter.section_leaf_list : [];

      for (const section of sectionEntries) {
        const sectionName = cleanText(section.name);
        const leaves = Array.isArray(section.leaf_list) ? section.leaf_list : [];
        const directLeaf = !leaves.length && Number(section.leaf_type) === 0 ? [section] : [];

        for (const leaf of [...leaves, ...directLeaf]) {
          if (!leaf || Number(leaf.leaf_type) !== 0) continue;
          if (seen.has(leaf.id)) continue;
          seen.add(leaf.id);

          const rawName = cleanText(leaf.name);
          const title = !rawName || /^video$/i.test(rawName)
            ? (sectionName || `视频 ${leaf.id}`)
            : rawName;
          const chapterLabel = chapterName && chapterName !== title ? `${chapterName} / ${title}` : title;

          videos.push({
            leafId: Number(leaf.id),
            chapterId: Number(chapterId),
            sectionId: Number(section.id || 0),
            chapterName,
            sectionName,
            title,
            label: chapterLabel,
            progress: normalizeProgress(leaf.progress),
            playedToEnd: false,
            completedAt: 0,
            url: videoPageUrl(classroomId, leaf.id, chapterId),
          });
        }
      }
    }

    return videos;
  }

  async function getLeafProgress(classroomId, leafId) {
    try {
      const data = await fetchProgressData(classroomId);
      const videos = extractVideos(data, classroomId);
      const item = videos.find((video) => video.leafId === Number(leafId));
      return item ? item.progress : null;
    } catch (_) {
      return null;
    }
  }

  function durationCacheKey(classroomId) {
    return `ykt-video-durations-v1:${classroomId}`;
  }

  function loadDurationCache(classroomId) {
    try {
      const raw = localStorage.getItem(durationCacheKey(classroomId));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.durations) return {};
      const clean = {};
      for (const [leafId, duration] of Object.entries(parsed.durations)) {
        const value = Number(duration);
        if (Number.isFinite(value) && value > 0) clean[leafId] = value;
      }
      return clean;
    } catch (_) {
      return {};
    }
  }

  function saveDurationCache(classroomId, durations) {
    try {
      localStorage.setItem(durationCacheKey(classroomId), JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        durations,
      }));
    } catch (_) {}
  }

  function normalizeTargetSpeed(value) {
    const numeric = Number(value);
    return SUPPORTED_SPEEDS.includes(numeric) ? numeric : SPEED;
  }

  async function fetchVideoDuration(classroomId, leafId) {
    try {
      const data = await apiGet(
        `/mooc-api/v1/lms/learn/leaf_info/${classroomId}/${leafId}/?classroom_id=${classroomId}`,
        8000,
      );
      const media = data && data.content_info && data.content_info.media;
      const duration = Number(media && media.duration);
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (_) {
      return null;
    }
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = await fn(items[index], index);
        } catch (_) {
          results[index] = null;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  function formatEstimate(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    if (total < 60) return `${Math.max(1, total)} 秒`;
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  function estimateQueueSeconds(state, durations, targetSpeed = SPEED) {
    if (!state || !Array.isArray(state.queue) || !state.queue.length) {
      return { seconds: 0, known: 0, estimated: 0, unknown: 0, pending: 0 };
    }

    const pending = state.queue.filter((item) => !isItemDone(item));
    if (!pending.length) return { seconds: 0, known: 0, estimated: 0, unknown: 0, pending: 0 };

    const baseSpeed = normalizeTargetSpeed(targetSpeed);
    const current = currentItem(state);
    const liveDuration = Number(state.duration) || 0;
    const rows = pending.map((item) => {
      const isCurrent = !!(current && current.leafId === item.leafId);
      const exactDuration = isCurrent && liveDuration > 0
        ? liveDuration
        : Number(durations && durations[item.leafId]) || 0;
      return { item, isCurrent, exactDuration };
    });

    const exactValues = rows.map((row) => row.exactDuration).filter((value) => value > 0);
    const averageDuration = exactValues.length
      ? exactValues.reduce((sum, value) => sum + value, 0) / exactValues.length
      : 0;

    let seconds = pending.length * PER_VIDEO_OVERHEAD_SECONDS;
    let known = 0;
    let estimated = 0;
    let unknown = 0;

    for (const row of rows) {
      let duration = row.exactDuration;
      if (duration > 0) {
        known += 1;
      } else if (averageDuration > 0) {
        duration = averageDuration;
        estimated += 1;
      } else {
        unknown += 1;
        continue;
      }

      if (row.isCurrent && liveDuration > 0) {
        const actualRate = Number(state.speed) > 0 ? Number(state.speed) : baseSpeed;
        seconds += Math.max(0, liveDuration - (Number(state.currentTime) || 0)) / actualRate;
      } else {
        seconds += (duration * (1 - normalizeProgress(row.item.progress))) / baseSpeed;
      }
    }

    return { seconds, known, estimated, unknown, pending: pending.length };
  }

  // ---------------------------------------------------------------------------
  // Discussion helpers
  // ---------------------------------------------------------------------------

  function getCookie(name) {
    try {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function uvId() {
    const value = cleanText(getCookie('uv_id') || getCookie('university_id'));
    return value || '0';
  }

  function platformId() {
    const value = cleanText(getCookie('platform_id'));
    return value || '0';
  }

  function normalizeMultiline(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function htmlToText(html) {
    const source = String(html == null ? '' : html);
    if (!source) return '';
    if (!/<[a-z!/]/i.test(source)) return normalizeMultiline(source);
    const withBreaks = source
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    let text = withBreaks;
    try {
      const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
      text = doc.body ? (doc.body.textContent || '') : withBreaks;
    } catch (_) {
      text = withBreaks.replace(/<[^>]*>/g, ' ');
    }
    return normalizeMultiline(text.replace(/\u00a0/g, ' '));
  }

  function discussionStorageKey(classroomId) {
    return `${DISCUSSION_STORAGE_PREFIX}:${classroomId}`;
  }

  function loadDiscussionState(classroomId) {
    try {
      const raw = localStorage.getItem(discussionStorageKey(classroomId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveDiscussionState(state) {
    if (!state) return;
    state.updatedAt = Date.now();
    state.completedDiscussions = discussionDoneCount(state);
    try {
      localStorage.setItem(discussionStorageKey(state.classroomId), JSON.stringify(state));
    } catch (_) {}
  }

  function discussionDoneCount(state) {
    if (!state) return 0;
    const queueDone = state.queue.filter((item) => item && item.done).length;
    return Math.min(state.totalDiscussions || 0, (state.baseCompleted || 0) + queueDone);
  }

  function isDiscussionPending(item) {
    return !!item && !item.done && !item.skipped;
  }

  function loadDiscussionConfig() {
    try {
      const raw = localStorage.getItem(DISCUSSION_CONFIG_KEY);
      if (!raw) return { ...DEFAULT_AI_CONFIG };
      const parsed = JSON.parse(raw);
      return normalizeDiscussionConfig(parsed);
    } catch (_) {
      return { ...DEFAULT_AI_CONFIG };
    }
  }

  function normalizeDiscussionConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      format: AI_FORMATS.includes(source.format) ? source.format : DEFAULT_AI_CONFIG.format,
      apiUrl: cleanText(source.apiUrl),
      apiKey: String(source.apiKey == null ? '' : source.apiKey).trim(),
      model: cleanText(source.model),
      autoSubmit: source.autoSubmit === true,
      promptTemplate: normalizeMultiline(source.promptTemplate) || DEFAULT_PROMPT_TEMPLATE,
      homeworkMode: source.homeworkMode === 'text' ? 'text' : 'screenshot',
      stopOnWrongAnswer: source.stopOnWrongAnswer !== false,
      homeworkAutoSubmit: source.homeworkAutoSubmit === true,
      homeworkDoubleCheck: source.homeworkDoubleCheck !== false,
      extraHeaders: String(source.extraHeaders == null ? '' : source.extraHeaders),
    };
  }

  function saveDiscussionConfig(config) {
    try {
      localStorage.setItem(DISCUSSION_CONFIG_KEY, JSON.stringify(normalizeDiscussionConfig(config)));
    } catch (_) {}
  }

  function discussionPageUrl(classroomId, leafId, chapterId) {
    const url = new URL(`/ai-workspace/lms-graph/${classroomId}/forum/${leafId}`, location.origin);
    url.searchParams.set('is_chapter', '1');
    if (chapterId != null && Number(chapterId) > 0) url.searchParams.set('node_id', String(chapterId));
    return url.href;
  }

  function withDiscussionWorkerHash(url) {
    const parsed = new URL(url, location.origin);
    parsed.hash = DISCUSSION_WORKER_HASH;
    return parsed.href;
  }

  async function fetchCourseSign(page) {
    if (page.courseSign) return page.courseSign;
    const data = await apiGet(
      `/c27/online_courseware/course/classroom/${page.classroomId}/get_basic_info/?classroom_id=${page.classroomId}&notSetParamsUvId=true`,
    );
    return cleanText(data && data.course_sign);
  }

  async function fetchChapterData(classroomId, courseSign) {
    const params = new URLSearchParams({
      cid: String(classroomId),
      sign: courseSign || '',
      term: 'latest',
      classroom_id: String(classroomId),
    });
    const uv = uvId();
    if (uv && uv !== '0') params.set('uv_id', uv);
    return apiGet(`/mooc-api/v1/lms/learn/course/chapter?${params.toString()}`);
  }

  function extractDiscussionLeaves(chapterData, classroomId) {
    const chapters = chapterData && chapterData.course_chapter;
    if (!Array.isArray(chapters)) throw new Error('课程结构数据结构异常');

    const items = [];
    const seen = new Set();

    const pushLeaf = (leaf, chapterId, chapterName, sectionName) => {
      if (!leaf || Number(leaf.leaf_type) !== DISCUSSION_LEAF_TYPE) return;
      if (leaf.is_show === false) return;
      if (seen.has(leaf.id)) return;
      seen.add(leaf.id);

      const rawName = cleanText(leaf.name);
      const title = rawName || `讨论 ${leaf.id}`;
      const label = chapterName && chapterName !== title ? `${chapterName} / ${title}` : title;
      const leafChapterId = Number(leaf.chapter_id || chapterId || 0);

      items.push({
        leafId: Number(leaf.id),
        chapterId: leafChapterId,
        title,
        label,
        chapterName,
        sectionName,
        isLocked: leaf.is_locked === true,
        done: false,
        skipped: false,
        submittedAt: 0,
        url: discussionPageUrl(classroomId, leaf.id, leafChapterId),
      });
    };

    for (const chapter of chapters) {
      const chapterId = Number(chapter.id);
      const chapterName = cleanText(chapter.name);
      const entries = Array.isArray(chapter.section_leaf_list) ? chapter.section_leaf_list : [];
      for (const entry of entries) {
        if (!entry) continue;
        if (Array.isArray(entry.leaf_list)) {
          const sectionName = cleanText(entry.name);
          for (const leaf of entry.leaf_list) pushLeaf(leaf, chapterId, chapterName, sectionName);
        } else if (entry.leaf_type != null) {
          pushLeaf(entry, chapterId, chapterName, '');
        }
      }
    }

    return items;
  }

  async function fetchDiscussionCommented(classroomId, leafId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        `/v/discussion/v2/student/comment/status/?leaf_id=${encodeURIComponent(leafId)}&classroom_id=${encodeURIComponent(classroomId)}`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            XTBZ: 'ykt',
            'X-Requested-With': 'XMLHttpRequest',
            'classroom-id': String(classroomId),
          },
          signal: controller.signal,
        },
      );
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch (_) {}
      if (!response.ok || !body) return false;
      return body.data === true || (body.data && body.data.commented === true);
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchDiscussionTopic(classroomId, leafId) {
    const data = await apiGet(
      `/v/discussion/v2/unit/discussion/?classroom_id=${encodeURIComponent(classroomId)}&leaf_id=${encodeURIComponent(leafId)}&topic_type=4&channel=xt`,
      15000,
    );
    if (!data || !data.id) throw new Error('未找到讨论主题数据');
    return {
      topicId: Number(data.id),
      toUser: Number(data.user_id) || 0,
      question: htmlToText(data.content && data.content.text) || '（题目内容为空）',
      commentCount: Number(data.commented) || 0,
      userCommentNum: Number(data.user_comment_num) || 0,
    };
  }

  function buildAIPrompt(config, question) {
    const template = normalizeMultiline(config.promptTemplate) || DEFAULT_PROMPT_TEMPLATE;
    const text = normalizeMultiline(question);
    if (template.includes('{题目}')) return template.replace(/\{题目\}/g, text);
    return `${template}\n\n【题目】\n${text}`;
  }

  function extractApiError(json) {
    if (!json) return '未知错误';
    if (json.error) {
      if (typeof json.error === 'string') return json.error;
      if (json.error.message) return String(json.error.message);
      try { return JSON.stringify(json.error).slice(0, 200); } catch (_) {}
    }
    if (json.msg) return String(json.msg);
    try { return JSON.stringify(json).slice(0, 200); } catch (_) {}
    return '未知错误';
  }

  function extractAIAnswer(format, json) {
    if (format === 'anthropic') {
      const parts = json && Array.isArray(json.content) ? json.content : [];
      return parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('').trim();
    }
    if (format === 'gemini') {
      const candidates = json && json.candidates;
      const parts = candidates && candidates[0] && candidates[0].content && candidates[0].content.parts;
      if (!Array.isArray(parts)) return '';
      return parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('').trim();
    }
    if (format === 'openai-responses') {
      if (json && typeof json.output_text === 'string') return json.output_text.trim();
      const parts = [];
      for (const item of (json && json.output) || []) {
        for (const part of (item && item.content) || []) {
          if (part && typeof part.text === 'string') parts.push(part.text);
        }
      }
      return parts.join('').trim();
    }
    const choice = json && json.choices && json.choices[0];
    const message = choice && (choice.message || choice.delta);
    if (message && typeof message.content === 'string') return message.content.trim();
    if (choice && typeof choice.text === 'string') return choice.text.trim();
    return '';
  }

  function splitImageDataUrl(dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ''));
    if (!match) return null;
    return { mime: match[1], base64: match[2] };
  }

  function parseExtraHeaders(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return {};
    try {
      const json = JSON.parse(text);
      if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
      const headers = {};
      for (const key of Object.keys(json)) {
        if (key && json[key] != null) headers[key] = String(json[key]);
      }
      return headers;
    } catch (_) {
      return {};
    }
  }

  function ensureOpencodeSessionHeader(headers, url) {
    try {
      const host = new URL(url, location.origin).hostname;
      if (!/(^|\.)opencode\.ai$/i.test(host)) return;
      const has = Object.keys(headers).some((key) => key.toLowerCase() === 'x-opencode-session');
      if (has) return;
      let session = '';
      try { session = localStorage.getItem('ykt-opencode-session') || ''; } catch (_) {}
      if (!session) {
        session = `ykt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        try { localStorage.setItem('ykt-opencode-session', session); } catch (_) {}
      }
      headers['x-opencode-session'] = session;
    } catch (_) {}
  }

  async function callAI(config, question) {
    return callAIWithPrompt(config, buildAIPrompt(config, question));
  }

  function gmHttpRequest(options) {
    const details = {
      method: options.method || 'POST',
      url: options.url,
      headers: options.headers || {},
      data: options.body,
      timeout: options.timeout || 180000,
    };
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        try {
          GM_xmlhttpRequest({
            ...details,
            onload: (res) => resolve({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              text: res.responseText || '',
            }),
            onerror: () => reject(new TypeError('GM 请求失败')),
            ontimeout: () => {
              const error = new Error('timeout');
              error.name = 'AbortError';
              reject(error);
            },
          });
        } catch (error) {
          reject(error);
        }
      });
    }
    if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') {
      return Promise.resolve(GM.xmlHttpRequest(details)).then((res) => ({
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        text: res.responseText || '',
      }));
    }
    return null;
  }

  function normalizeChatUrl(format, apiUrl) {
    let url = String(apiUrl || '').trim();
    if (!url) return url;
    if (format === 'anthropic') {
      if (/\/v1\/?$/.test(url) && !/\/v1\/messages\/?$/.test(url)) {
        url = url.replace(/\/?$/, '/messages');
      }
      return url;
    }
    if (format === 'gemini') return url;
    if (format === 'openai-responses') {
      if (/\/v1\/?$/.test(url) && !/\/v1\/responses\/?$/.test(url)) {
        url = url.replace(/\/?$/, '/responses');
      } else if (/\/chat\/completions\/?$/.test(url)) {
        url = url.replace(/\/chat\/completions\/?$/, '/responses');
      }
      return url;
    }
    if (/\/v1\/?$/.test(url) && !/\/v1\/chat\/completions\/?$/.test(url)) {
      url = url.replace(/\/?$/, '/chat/completions');
    }
    return url;
  }

  function deriveModelsUrl(format, apiUrl) {
    const value = String(apiUrl || '').trim();
    if (!value) return '';
    if (format === 'anthropic') {
      if (/\/v1\/messages\/?$/.test(value)) return value.replace(/\/v1\/messages\/?$/, '/v1/models');
      if (/\/v1\/?$/.test(value)) return value.replace(/\/?$/, '/models');
      return value;
    }
    if (format === 'gemini') {
      const match = value.match(/^(.*)\/v1beta\/models\/[^/:]+:generateContent.*$/);
      if (match) return `${match[1]}/v1beta/models`;
      if (/\/v1beta\/models\/?$/.test(value)) return value;
      return value;
    }
    if (/\/chat\/completions\/?$/.test(value)) return value.replace(/\/chat\/completions\/?$/, '/models');
    if (/\/responses\/?$/.test(value)) return value.replace(/\/responses\/?$/, '/models');
    if (/\/v1\/?$/.test(value)) return value.replace(/\/?$/, '/models');
    if (/\/models\/?$/.test(value)) return value;
    try {
      const parsed = new URL(value);
      return `${parsed.origin}/v1/models`;
    } catch (_) {
      return '';
    }
  }

  async function fetchModelList(config) {
    let url = deriveModelsUrl(config.format, config.apiUrl);
    if (!url) throw new Error('请先填写有效的请求地址');
    const headers = { Accept: 'application/json' };
    Object.assign(headers, parseExtraHeaders(config.extraHeaders));
    if (config.format === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (config.format === 'gemini') {
      if (config.apiKey) headers['x-goog-api-key'] = config.apiKey;
      if (config.apiKey && !/[?&]key=/.test(url)) {
        url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(config.apiKey)}`;
      }
    } else if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    let text = '';
    let ok = false;
    let status = 0;
    const gmPromise = gmHttpRequest({ url, method: 'GET', headers, timeout: 30000 });
    if (gmPromise) {
      const result = await gmPromise;
      text = result.text;
      ok = result.ok;
      status = result.status;
    } else {
      const response = await fetch(url, { headers, credentials: 'omit' });
      text = await response.text();
      ok = response.ok;
      status = response.status;
    }

    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}
    if (!ok) throw new Error(`HTTP ${status}：${extractApiError(json) || text.slice(0, 120)}`);

    const ids = [];
    const push = (id) => {
      const model = cleanText(id);
      if (model) ids.push(model.replace(/^models\//, ''));
    };
    if (Array.isArray(json && json.data)) {
      for (const item of json.data) {
        if (typeof item === 'string') push(item);
        else if (item) push(item.id || item.name);
      }
    }
    if (Array.isArray(json && json.models)) {
      for (const item of json.models) push(item && (item.name || item.id));
    }
    const unique = [...new Set(ids)].sort();
    if (!unique.length) throw new Error('接口没有返回可识别的模型列表');
    return unique;
  }

  function fillModelOptions(datalist, models) {
    if (!datalist) return;
    datalist.textContent = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      datalist.appendChild(option);
    }
  }

  async function handleFetchModels(ui, showMessage) {
    const button = ui.refs.fetchModels;
    if (!button || button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '获取中…';
    try {
      const models = await fetchModelList({
        format: ui.refs.format.value,
        apiUrl: ui.refs.apiUrl.value,
        apiKey: ui.refs.apiKey.value,
      });
      fillModelOptions(ui.refs.modelList, models);
      showMessage(`已获取 ${models.length} 个模型，点击模型输入框即可选择。`, 'ok');
    } catch (error) {
      showMessage(`获取模型列表失败：${truncate(error.message, 120)}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function callAIWithPrompt(config, prompt, imageDataUrl) {
    if (!config.apiUrl) throw new Error('尚未配置 AI 请求地址，请先在课程页面板保存 AI 设置');
    if (!AI_FORMATS.includes(config.format)) throw new Error('未知的 AI 接口格式');

    const image = imageDataUrl ? splitImageDataUrl(imageDataUrl) : null;

    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, parseExtraHeaders(config.extraHeaders));
    let body;
    if (config.format === 'anthropic') {
      if (!config.model) throw new Error('尚未填写模型名称');
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const content = [];
      if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } });
      content.push({ type: 'text', text: prompt });
      body = {
        model: config.model,
        max_tokens: 1200,
        temperature: 0,
        messages: [{ role: 'user', content }],
      };
    } else if (config.format === 'gemini') {
      if (config.apiKey) headers['x-goog-api-key'] = config.apiKey;
      const parts = [];
      if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.base64 } });
      parts.push({ text: prompt });
      body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0 },
      };
    } else if (config.format === 'openai-responses') {
      if (!config.model) throw new Error('尚未填写模型名称');
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const content = [];
      if (image) content.push({ type: 'input_image', image_url: imageDataUrl });
      content.push({ type: 'input_text', text: prompt });
      body = {
        model: config.model,
        temperature: 0,
        input: [{ role: 'user', content }],
      };
    } else {
      if (!config.model) throw new Error('尚未填写模型名称');
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const content = image
        ? [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ]
        : prompt;
      body = {
        model: config.model,
        temperature: 0,
        messages: [{ role: 'user', content }],
        stream: false,
      };
    }

    try {
      const requestBody = JSON.stringify(body);
      const requestUrl = normalizeChatUrl(config.format, config.apiUrl);
      ensureOpencodeSessionHeader(headers, requestUrl);

      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let raw = '';
        let ok = false;
        let status = 0;
        const gmPromise = gmHttpRequest({
          url: requestUrl,
          method: 'POST',
          headers,
          body: requestBody,
          timeout: AI_TIMEOUT_MS,
        });
        if (gmPromise) {
          const result = await gmPromise;
          raw = result.text;
          ok = result.ok;
          status = result.status;
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
          try {
            const response = await fetch(requestUrl, {
              method: 'POST',
              headers,
              body: requestBody,
              signal: controller.signal,
            });
            raw = await response.text();
            ok = response.ok;
            status = response.status;
          } finally {
            clearTimeout(timer);
          }
        }

        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
        if (!ok) {
          const error = new Error(`AI 接口返回 HTTP ${status}：${extractApiError(json) || raw.slice(0, 160)}`);
          if (attempt === 0 && status >= 500) {
            lastError = error;
            await sleep(800);
            continue;
          }
          throw error;
        }
        if (!json) {
          const error = new Error('AI 接口返回了非 JSON 内容');
          if (attempt === 0) {
            lastError = error;
            await sleep(800);
            continue;
          }
          throw error;
        }
        const answer = extractAIAnswer(config.format, json);
        if (cleanText(answer)) return answer;
        const error = new Error('AI 返回了空答案，请检查模型或接口设置');
        if (attempt === 0) {
          lastError = error;
          await sleep(800);
          continue;
        }
        throw error;
      }
      throw lastError || new Error('AI 请求失败');
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('AI 请求超时（120 秒）');
      if (error instanceof TypeError) {
        throw new Error('AI 请求失败：接口可能不允许浏览器跨域（CORS）。安装 Tampermonkey 时会自动使用 GM_xmlhttpRequest 绕过；当前环境若没有该能力，请更换允许 CORS 的接口或使用本地代理');
      }
      throw error;
    }
  }

  async function submitDiscussionComment(topic, text) {
    const uv = uvId();
    const classroomId = Number(topic.classroomId) || 0;
    const headers = {
      'Content-Type': 'application/json;charset=utf-8',
      Accept: 'application/json, text/plain, */*',
      XTBZ: 'ykt',
      'Xt-Agent': 'web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRFToken': getCookie('csrftoken'),
    };
    if (uv && uv !== '0') {
      headers['uv-id'] = uv;
      headers['university-id'] = uv;
    }
    if (classroomId > 0) {
      headers['classroom-id'] = String(classroomId);
    }

    const payload = {
      to_user: Number(topic.toUser) || 0,
      topic_id: Number(topic.topicId),
      content: {
        text: String(text),
        upload_images: [],
        accessory_list: [],
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/v/discussion/v2/comment/', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const raw = await response.text();
      let json = null;
      try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!response.ok) {
        throw new Error(`提交接口返回 HTTP ${response.status}`);
      }
      if (json && (json.success === false || (typeof json.code === 'number' && json.code !== 0))) {
        const code = json.error_code || json.code;
        if (Number(code) === 500600) {
          throw new Error('平台认为内容可能包含敏感词，提交被拒绝，请修改答案后重试');
        }
        throw new Error(extractApiError(json) || '提交接口返回失败');
      }
      return json;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('提交请求超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyDiscussionCommented(classroomId, leafId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        if (await fetchDiscussionCommented(classroomId, leafId)) return true;
      } catch (_) {}
      if (attempt < 4) await sleep(2000);
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Homework helpers
  // ---------------------------------------------------------------------------

  function homeworkStorageKey(classroomId) {
    return `${HOMEWORK_STORAGE_PREFIX}:${classroomId}`;
  }

  function loadHomeworkState(classroomId) {
    try {
      const raw = localStorage.getItem(homeworkStorageKey(classroomId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveHomeworkState(state) {
    if (!state) return;
    state.updatedAt = Date.now();
    state.completedHomeworks = homeworkDoneCount(state);
    try {
      localStorage.setItem(homeworkStorageKey(state.classroomId), JSON.stringify(state));
    } catch (_) {}
  }

  function homeworkDoneCount(state) {
    if (!state) return 0;
    const queueDone = state.queue.filter((item) => item && item.done).length;
    return Math.min(state.totalHomeworks || 0, (state.baseCompleted || 0) + queueDone);
  }

  function isHomeworkPending(item) {
    return !!item && !item.done && !item.skipped;
  }

  function homeworkPageUrl(classroomId, leafId, chapterId) {
    const url = new URL(`/ai-workspace/lms-graph/${classroomId}/exercise/${leafId}`, location.origin);
    url.searchParams.set('is_chapter', '1');
    if (chapterId != null && Number(chapterId) > 0) url.searchParams.set('node_id', String(chapterId));
    return url.href;
  }

  function withHomeworkWorkerHash(url) {
    const parsed = new URL(url, location.origin);
    parsed.hash = HOMEWORK_WORKER_HASH;
    return parsed.href;
  }

  function createHomeworkChannel() {
    try {
      return new BroadcastChannel(HOMEWORK_CHANNEL_NAME);
    } catch (_) {
      return null;
    }
  }

  function classroomHeaders(classroomId) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      XTBZ: 'ykt',
      'X-Requested-With': 'XMLHttpRequest',
    };
    const uv = uvId();
    if (uv && uv !== '0') {
      headers['uv-id'] = uv;
      headers['university-id'] = uv;
    }
    if (classroomId) headers['classroom-id'] = String(classroomId);
    return headers;
  }

  async function fetchHomeworkSchedule(classroomId, courseSign) {
    const params = new URLSearchParams({
      cid: String(classroomId),
      sign: courseSign || '',
      term: 'latest',
      classroom_id: String(classroomId),
    });
    const uv = uvId();
    if (uv && uv !== '0') params.set('uv_id', uv);
    const data = await apiGet(`/mooc-api/v1/lms/learn/course/schedule?${params.toString()}`);
    return (data && data.leaf_schedules) || {};
  }

  async function fetchCourseName(classroomId) {
    try {
      const info = await apiGet(`/mooc-api/v1/lms/learn/classroom_info/?classroom_id=${classroomId}`);
      return cleanText(info && (info.course_name || info.name));
    } catch (_) {
      return '';
    }
  }

  async function fetchLeafInfoData(classroomId, leafId) {
    const data = await apiGet(
      `/mooc-api/v1/lms/learn/leaf_info/${classroomId}/${leafId}/?classroom_id=${classroomId}`,
    );
    if (!data) throw new Error('未读取到作业信息');
    return data;
  }

  async function fetchExerciseData(classroomId, exerciseId, skuId) {
    const uv = uvId();
    const url = `/mooc-api/v1/lms/exercise/get_exercise_list/${exerciseId}/${skuId}/?classroom_id=${encodeURIComponent(classroomId)}&uv_id=${encodeURIComponent(uv)}&_=${Date.now()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: classroomHeaders(classroomId),
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) {}
      if (!response.ok) throw new Error(`读取作业题目失败（HTTP ${response.status}）`);
      if (!body || body.success === false || !body.data) {
        throw new Error(extractApiError(body) || '读取作业题目失败');
      }
      return body.data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('读取作业题目超时');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  let glyphReferencePromise = null;

  function getGlyphReference() {
    if (!glyphReferencePromise) {
      glyphReferencePromise = buildGlyphReference().catch((error) => {
        glyphReferencePromise = null;
        throw error;
      });
    }
    return glyphReferencePromise;
  }

  function renderGlyphChunk(chars, fontSpec) {
    const R = GLYPH_GRID;
    const CELL = GLYPH_CELL;
    const COLS = GLYPH_COLS;
    const rows = Math.max(1, Math.ceil(chars.length / COLS));
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CELL;
    canvas.height = rows * CELL;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.font = `32px ${fontSpec}`;
    for (let i = 0; i < chars.length; i += 1) {
      const x = (i % COLS) * CELL + CELL / 2;
      const y = Math.floor(i / COLS) * CELL + 4;
      ctx.fillText(chars[i], x, y);
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = canvas.width;
    const results = [];

    for (let i = 0; i < chars.length; i += 1) {
      const ox = (i % COLS) * CELL;
      const oy = Math.floor(i / COLS) * CELL;
      let minX = CELL;
      let minY = CELL;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < CELL; y += 1) {
        for (let x = 0; x < CELL; x += 1) {
          const idx = ((oy + y) * width + (ox + x)) * 4;
          if (data[idx] < 128) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) {
        results.push(null);
        continue;
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const bits = new Uint8Array(R * R);
      for (let gy = 0; gy < R; gy += 1) {
        for (let gx = 0; gx < R; gx += 1) {
          const x0 = minX + Math.floor((gx * w) / R);
          const x1 = minX + Math.max(Math.floor(((gx + 1) * w) / R) - 1, Math.floor((gx * w) / R));
          const y0 = minY + Math.floor((gy * h) / R);
          const y1 = minY + Math.max(Math.floor(((gy + 1) * h) / R) - 1, Math.floor((gy * h) / R));
          let sum = 0;
          let count = 0;
          for (let y = y0; y <= y1; y += 1) {
            for (let x = x0; x <= x1; x += 1) {
              const idx = ((oy + y) * width + (ox + x)) * 4;
              const lum = data[idx];
              sum += (255 - lum) / 255;
              count += 1;
            }
          }
          bits[gy * R + gx] = count ? Math.round((sum / count) * 255) : 0;
        }
      }
      results.push(bits);
    }
    return results;
  }

  async function buildGlyphReference() {
    const entries = [];
    for (let start = 0; start < GLYPH_CHARS.length; start += 960) {
      const chunk = GLYPH_CHARS.slice(start, start + 960);
      const hashes = renderGlyphChunk(chunk, HOMEWORK_FONT_STACK);
      for (let i = 0; i < hashes.length; i += 1) {
        if (hashes[i]) entries.push({ ch: chunk[i], bits: hashes[i] });
      }
      if (start % 3840 === 0) await sleep(0);
    }
    return entries;
  }

  function glyphIoU(a, b) {
    if (!a || !b) return 0;
    let inter = 0;
    let union = 0;
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i];
      const y = b[i];
      inter += Math.min(x, y);
      union += Math.max(x, y);
    }
    return union ? inter / union : 0;
  }

  function renderSingleGlyph(ch, fontSpec) {
    const R = GLYPH_GRID;
    const CELL = GLYPH_CELL;
    const hashes = renderGlyphChunk([ch], fontSpec);
    return hashes[0] || null;
  }

  async function loadExamFont(fontUrl) {
    if (!fontUrl) throw new Error('题目字体地址为空，无法解码题目');
    const family = `ykt-exam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const face = new FontFace(family, `url("${fontUrl}")`);
    await face.load();
    document.fonts.add(face);
    return `"${family}"`;
  }

  async function decodeExerciseQuestions(problems, fontUrl) {
    const fontSpec = await loadExamFont(fontUrl);
    const reference = await getGlyphReference();
    const cache = new Map();

    const decodeChar = (ch) => {
      if (cache.has(ch)) return cache.get(ch);
      const bits = renderSingleGlyph(ch, fontSpec);
      let best = null;
      if (bits) {
        for (const ref of reference) {
          const score = glyphIoU(bits, ref.bits);
          if (!best || score > best.score) best = { ch: ref.ch, score };
        }
      }
      const value = best && best.score >= GLYPH_MIN_SCORE ? best.ch : ch;
      cache.set(ch, value);
      return value;
    };

    const decodeHtml = (html) => {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('.xuetangx-com-encrypted-font').forEach((el) => {
        el.textContent = Array.from(el.textContent).map(decodeChar).join('');
      });
      const text = doc.body ? (doc.body.textContent || '') : '';
      return normalizeMultiline(text);
    };

    return problems.map((problem, index) => {
      const content = problem.content || {};
      const options = Array.isArray(content.Options) ? content.Options : [];
      const user = problem.user || {};
      return {
        index,
        problemId: Number(problem.problem_id),
        type: Number(content.ProblemType),
        typeText: cleanText(content.TypeText) || '题目',
        body: decodeHtml(content.Body),
        options: options.map((option) => ({
          key: String(option.key || '').trim(),
          text: decodeHtml(option.value),
        })),
        answered: Number(user.my_count) > 0,
        userAnswer: Array.isArray(user.my_answer) ? user.my_answer.join('') : '',
      };
    });
  }

  function collectHomeworkRuns(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const runs = [];
    const push = (text, encrypted, bold) => {
      if (text) runs.push({ text, encrypted: !!encrypted, bold: !!bold });
    };
    const walk = (node, encrypted, bold) => {
      if (node.nodeType === 3) {
        push(node.textContent, encrypted, bold);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        push('\n', false, bold);
        return;
      }
      const isEncrypted = !!(node.classList && node.classList.contains('xuetangx-com-encrypted-font'));
      const isBold = bold || tag === 'b' || tag === 'strong';
      for (const child of node.childNodes) walk(child, encrypted || isEncrypted, isBold);
      if (/^(p|div|li|h[1-6]|tr)$/.test(tag)) push('\n', false, bold);
    };
    walk(doc.body, false, false);

    const normalized = [];
    for (const run of runs) {
      const text = String(run.text || '').replace(/\u00a0/g, ' ');
      if (!text) continue;
      if (text.indexOf('\n') >= 0) {
        const parts = text.split('\n');
        parts.forEach((part, index) => {
          if (part) normalized.push({ text: part, encrypted: run.encrypted, bold: run.bold });
          if (index < parts.length - 1) normalized.push({ text: '\n', encrypted: false, bold: false });
        });
      } else {
        normalized.push({ text, encrypted: run.encrypted, bold: run.bold });
      }
    }

    const out = [];
    let newlines = 0;
    for (const run of normalized) {
      if (run.text === '\n') {
        newlines += 1;
        if (newlines <= 2) out.push(run);
      } else {
        newlines = 0;
        out.push(run);
      }
    }
    while (out.length && out[0].text === '\n') out.shift();
    while (out.length && out[out.length - 1].text === '\n') out.pop();
    return out;
  }

  async function renderHomeworkImage(problems, fontUrl) {
    const examFamily = await loadExamFont(fontUrl);
    const SIZE = 23;
    const LINE = 36;
    const PAD = 28;
    const WIDTH = 1000;
    const stack = '"Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
    const normalFont = `${SIZE}px ${stack}`;
    const boldFont = `bold ${SIZE}px ${stack}`;
    const examFont = `${SIZE}px ${examFamily}`;
    const examBold = `bold ${SIZE}px ${examFamily}`;
    const fontFor = (run) => {
      if (run.encrypted) return run.bold ? examBold : examFont;
      return run.bold ? boldFont : normalFont;
    };

    const blocks = [];
    problems.forEach((problem, index) => {
      const content = problem.content || {};
      blocks.push({
        runs: [{ text: `第 ${index + 1} 题（${cleanText(content.TypeText) || '题目'}）`, encrypted: false, bold: true }],
      });
      blocks.push({ runs: collectHomeworkRuns(content.Body) });
      blocks.push({ runs: [] });
      (content.Options || []).forEach((option) => {
        blocks.push({
          runs: [
            { text: `${option.key}. `, encrypted: false, bold: false },
            ...collectHomeworkRuns(option.value),
          ],
        });
      });
      blocks.push({ runs: [] });
    });

    const measure = document.createElement('canvas').getContext('2d');
    const maxWidth = WIDTH - PAD * 2;
    const lines = [];
    for (const block of blocks) {
      let line = [];
      let x = 0;
      for (const run of block.runs) {
        const font = fontFor(run);
        measure.font = font;
        for (const ch of run.text) {
          if (ch === '\n') {
            lines.push(line);
            line = [];
            x = 0;
            continue;
          }
          const width = measure.measureText(ch).width;
          if (x + width > maxWidth && line.length) {
            lines.push(line);
            line = [];
            x = 0;
          }
          line.push({ ch, font });
          x += width;
        }
      }
      if (line.length) lines.push(line);
      if (!block.runs.length) lines.push([]);
    }
    while (lines.length && !lines[lines.length - 1].length) lines.pop();

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = PAD * 2 + Math.max(1, lines.length) * LINE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';
    let y = PAD;
    for (const line of lines) {
      let x = PAD;
      for (const cell of line) {
        ctx.font = cell.font;
        ctx.fillText(cell.ch, x, y);
        x += ctx.measureText(cell.ch).width;
      }
      y += LINE;
    }
    return canvas.toDataURL('image/png');
  }

  function buildHomeworkScreenshotPrompt(count, context) {
    const location = context ? [context.courseName, context.chapterName].filter(Boolean).join(' ') : '';
    const lines = [];
    if (location) {
      lines.push(`这是 ${location} 的题目。`);
      lines.push('');
    }
    lines.push('题目是选择题，读题，读题要求，直接给出符合题目要求的选项。遇到不确定的文学常识或诗句理解问题，请先查找相关资料，优先依据学界普遍公认的结论和文学史定评，进行多轮核对后再作答，不要凭个人语感臆测。');
    lines.push('');
    lines.push('请只输出 JSON，不要输出任何解释，不要使用代码块。格式如下：');
    lines.push('{"answers":[{"index":1,"answer":"A"},{"index":2,"answer":"C"}]}');
    lines.push(`index 为题号（从 1 开始），共 ${count} 题，answer 只能是 A/B/C/D 这样的选项字母。`);
    return lines.join('\n');
  }

  function buildHomeworkPrompt(questions, context) {
    const location = context ? [context.courseName, context.chapterName].filter(Boolean).join(' ') : '';
    const lines = [];
    if (location) {
      lines.push(`这是 ${location} 的题目。`);
      lines.push('');
    }
    lines.push('题目是选择题，读题，读题要求，直接给出符合题目要求的选项。遇到不确定的文学常识或诗句理解问题，请先查找相关资料，优先依据学界普遍公认的结论和文学史定评，进行多轮核对后再作答，不要凭个人语感臆测。');
    lines.push('');
    lines.push('请只输出 JSON，不要输出任何解释，不要使用代码块。格式如下：');
    lines.push('{"answers":[{"index":1,"answer":"A"},{"index":2,"answer":"C"}]}');
    lines.push('index 为题号（从 1 开始），answer 只能是 A/B/C/D 这样的选项字母。');
    lines.push('');
    lines.push('题目：');
    questions.forEach((question, index) => {
      lines.push(`第 ${index + 1} 题：[单选题] ${question.body}`);
      question.options.forEach((option) => {
        lines.push(`${option.key}. ${option.text}`);
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function parseHomeworkAnswers(raw, count) {
    const text = String(raw == null ? '' : raw).trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let json = null;
    try {
      json = JSON.parse(text.slice(start, end + 1));
    } catch (_) {
      return null;
    }
    const list = Array.isArray(json && json.answers) ? json.answers : null;
    if (!list) return null;
    const answers = new Array(count).fill('');
    for (const entry of list) {
      const index = Number(entry && entry.index) - 1;
      if (index < 0 || index >= count) continue;
      let answer = entry.answer;
      if (Array.isArray(answer)) answer = answer.join('');
      answers[index] = String(answer == null ? '' : answer).toUpperCase().replace(/[^A-Z]/g, '');
    }
    return answers;
  }

  function sameHomeworkAnswers(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => (
      cleanText(value).toUpperCase() === cleanText(b[index]).toUpperCase()
    ));
  }

  async function applyHomeworkProblem(classroomId, question, answer) {
    const type = Number(question.type);
    const payload = {
      classroom_id: Number(classroomId),
      problem_id: Number(question.problemId),
    };
    if (type === 1 || type === 6) {
      payload.answer = [String(answer)];
    } else if (type === 2 || type === 3) {
      payload.answer = String(answer).split('');
    } else {
      throw new Error(`第 ${question.index + 1} 题（${question.typeText}）暂不支持自动提交，请手动完成`);
    }

    const headers = classroomHeaders(classroomId);
    headers['Content-Type'] = 'application/json;charset=utf-8';
    headers['X-CSRFToken'] = getCookie('csrftoken');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/mooc-api/v1/lms/exercise/problem_apply/', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const raw = await response.text();
      let json = null;
      try { json = raw ? JSON.parse(raw) : null; } catch (_) {}
      if (!response.ok) {
        throw new Error(`提交第 ${question.index + 1} 题失败（HTTP ${response.status}）`);
      }
      if (json && (json.success === false || (typeof json.code === 'number' && json.code !== 0))) {
        throw new Error(extractApiError(json) || `提交第 ${question.index + 1} 题失败`);
      }
      return json;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(`提交第 ${question.index + 1} 题超时`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyHomeworkDone(classroomId, courseSign, leafId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const schedules = await fetchHomeworkSchedule(classroomId, courseSign);
        const value = schedules[String(leafId)];
        if (value && typeof value === 'object' && Number(value.done) >= Number(value.total)) {
          return true;
        }
      } catch (_) {}
      if (attempt < 4) await sleep(2000);
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Course page
  // ---------------------------------------------------------------------------

  function initCoursePage(coursePage) {
    let state = loadState(coursePage.classroomId);
    let loading = false;
    let messageTimer = null;
    let lastListSignature = '';
    let workerWindow = null;
    let durationCache = loadDurationCache(coursePage.classroomId);
    let durationLoading = false;
    let durationFetchPromise = null;
    let targetSpeed = SPEED;
    const durationAttempted = new Set();

    const ui = createCoursePanel();
    const channel = createChannel();

    bindCourseEvents();
    renderCourse();

    if (!state) {
      refreshQueue({ automatic: true });
    } else if (state.running && Date.now() - Number(state.heartbeatAt || 0) > STALE_MS) {
      state.status = 'interrupted';
      saveState(state);
      renderCourse();
    }

    if (state && state.queue.length) {
      ensureDurations(state.queue);
    }

    setInterval(() => {
      if (loading) return;
      const fresh = loadState(coursePage.classroomId);
      const changed = (fresh && fresh.updatedAt) !== (state && state.updatedAt);
      if (changed) state = fresh;
      renderCourse();
    }, 2000);

    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey(coursePage.classroomId)) return;
      const fresh = loadState(coursePage.classroomId);
      if (fresh) {
        state = fresh;
        renderCourse();
      }
    });

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== coursePage.classroomId) return;
        if (event.data.type === 'state-changed' || event.data.type === 'worker-ready') {
          const fresh = loadState(coursePage.classroomId);
          if (fresh) state = fresh;
          renderCourse();
        }
      };
    }

    function bindCourseEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-course-panel-collapsed');
          return;
        }
        if (action === 'refresh') {
          if (loading) return;
          if (state && state.running) {
            showMessage('请先停止当前队列，再刷新课程进度。', 'warn');
            return;
          }
          durationAttempted.clear();
          await refreshQueue({ manual: true });
          return;
        }
        if (action === 'primary') {
          await handlePrimary();
          return;
        }
        if (action === 'stop') {
          handleStop();
        }
      });
    }

    function ensureDurations(items) {
      if (!items || !items.length) return Promise.resolve();
      if (durationFetchPromise) return durationFetchPromise;

      const missing = items.filter((item) => (
        !isItemDone(item)
        && !Number(durationCache[item.leafId])
        && !durationAttempted.has(item.leafId)
      ));
      if (!missing.length) return Promise.resolve();

      for (const item of missing) durationAttempted.add(item.leafId);
      durationLoading = true;
      renderCourse();

      durationFetchPromise = (async () => {
        await mapLimit(missing, 4, async (item) => {
          const duration = await fetchVideoDuration(coursePage.classroomId, item.leafId);
          if (duration) {
            durationCache[item.leafId] = duration;
            saveDurationCache(coursePage.classroomId, durationCache);
            renderCourse();
          }
        });
        saveDurationCache(coursePage.classroomId, durationCache);
      })().finally(() => {
        durationLoading = false;
        durationFetchPromise = null;
        renderCourse();

        const stillMissing = (state && state.queue || []).some((item) => (
          !isItemDone(item)
          && !Number(durationCache[item.leafId])
          && !durationAttempted.has(item.leafId)
        ));
        if (stillMissing) ensureDurations(state.queue);
      });

      return durationFetchPromise;
    }

    async function refreshQueue(options = {}) {
      if (loading) return;
      loading = true;
      renderCourse();
      try {
        const data = await fetchProgressData(coursePage.classroomId);
        const videos = extractVideos(data, coursePage.classroomId);
        const pending = videos.filter((item) => !isItemDone(item));
        const snapshot = {
          videos,
          pending,
          total: videos.length,
          completed: videos.length - pending.length,
        };

        state = makeFreshState(coursePage, snapshot);
        state.targetSpeed = targetSpeed;
        state.speed = targetSpeed;
        saveState(state);
        ensureDurations(state.queue);
        if (options.manual) showMessage(`已读取课程进度：${pending.length} 个视频待看。`, 'ok');
      } catch (error) {
        if (!state) {
          showMessage(`读取失败：${truncate(error.message, 140)}`, 'error');
        } else if (options.manual) {
          showMessage(`刷新失败：${truncate(error.message, 140)}`, 'error');
        }
      } finally {
        loading = false;
        renderCourse();
      }
    }

    async function handlePrimary() {
      if (loading) return;

      const hasCurrent = !!(state && currentItem(state));

      if (state && hasCurrent && state.status === 'attention') {
        focusWorker();
        return;
      }

      if (state && hasCurrent && (state.status === 'error' || state.status === 'paused' || state.userPaused)) {
        resumeQueue();
        return;
      }

      if (state && state.running) {
        if (isAlive(state)) {
          showMessage('队列正在运行，视频会在旁边的标签页中继续播放。', 'ok');
          return;
        }
        resumeQueue();
        return;
      }

      if (state && ['paused', 'error', 'interrupted'].includes(state.status)) {
        if (hasCurrent) {
          resumeQueue();
        } else {
          await startFresh();
        }
        return;
      }

      if (state && state.status === 'stopped' && hasCurrent) {
        resumeQueue();
        return;
      }

      if (state && state.status === 'idle' && state.queue.length && Date.now() - Number(state.createdAt || 0) < 5 * 60 * 1000) {
        startFromPreparedState();
        return;
      }

      await startFresh();
    }

    function startFromPreparedState() {
      if (!state || !state.queue.length) {
        startFresh();
        return;
      }
      state.index = findFirstPendingIndex(state);
      if (state.index < 0) {
        showMessage('待看队列为空，请点击“刷新”重新扫描。', 'warn');
        return;
      }
      state.running = true;
      state.status = 'watching';
      state.userPaused = false;
      state.targetSpeed = targetSpeed;
      state.speed = targetSpeed;
      state.startedAt = state.startedAt || Date.now();
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      saveState(state);
      ensureDurations(state.queue);
      renderCourse();

      const item = state.queue[state.index];
      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) {
        showPopupBlocked(item);
      }
    }

    async function startFresh() {
      if (loading) return;
      const blank = openWorker('about:blank');
      if (!blank) {
        showMessage('浏览器拦截了新标签页。请允许本站弹窗后，再点一次“开始”。', 'error');
        return;
      }

      loading = true;
      renderCourse();
      try {
        const data = await fetchProgressData(coursePage.classroomId);
        const videos = extractVideos(data, coursePage.classroomId);
        const pending = videos.filter((item) => !isItemDone(item));
        const snapshot = {
          videos,
          pending,
          total: videos.length,
          completed: videos.length - pending.length,
        };

        state = makeFreshState(coursePage, snapshot);
        state.targetSpeed = targetSpeed;
        state.speed = targetSpeed;
        if (!pending.length) {
          state.status = 'done';
          state.completedVideos = state.totalVideos;
          saveState(state);
          try { blank.close(); } catch (_) {}
          showMessage('课程中的视频都已标记为完成，没有待看队列。', 'ok');
          return;
        }

        state.running = true;
        state.status = 'watching';
        state.startedAt = Date.now();
        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = 0;
        saveState(state);
        ensureDurations(state.queue);
        renderCourse();

        const first = pending[0];
        try {
          blank.location.replace(withWorkerHash(first.url));
          blank.focus();
        } catch (_) {
          try { blank.close(); } catch (_) {}
          showMessage('打开视频标签页失败，请重试。', 'error');
          state.running = false;
          state.status = 'error';
          state.lastError = '打开视频标签页失败';
          saveState(state);
          renderCourse();
        }
      } catch (error) {
        try { blank.close(); } catch (_) {}
        state = state || null;
        showMessage(`读取课程进度失败：${truncate(error.message, 140)}`, 'error');
      } finally {
        loading = false;
        renderCourse();
      }
    }

    function resumeQueue() {
      if (!state) return;
      const item = currentItem(state);
      if (!item) {
        startFresh();
        return;
      }
      state.running = true;
      state.status = 'watching';
      state.userPaused = false;
      state.targetSpeed = targetSpeed;
      state.speed = targetSpeed;
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      saveState(state);
      renderCourse();

      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) showPopupBlocked(item);
    }

    function openWorker(url) {
      try {
        return window.open(url, WORKER_NAME);
      } catch (_) {
        return null;
      }
    }

    function focusWorker() {
      if (workerWindow && !workerWindow.closed) {
        try {
          workerWindow.focus();
          return;
        } catch (_) {}
      }
      const item = currentItem(state);
      if (!item) return;
      workerWindow = openWorker(withWorkerHash(item.url));
      if (!workerWindow) showPopupBlocked(item);
    }

    function showPopupBlocked(item) {
      showMessage(
        '浏览器拦截了新标签页。请允许本站弹窗后重试，或点击这里手动打开视频标签页。',
        'warn',
        withWorkerHash(item.url),
      );
    }

    function handleStop() {
      if (!state) return;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      if (channel) {
        channel.postMessage({ type: 'stop', classroomId: coursePage.classroomId });
      }
      showMessage('队列已停止。再次点击“继续观看”会从当前视频恢复。', 'warn');
      renderCourse();
    }

    function renderCourse() {
      if (state && state.running) {
        targetSpeed = normalizeTargetSpeed(state.targetSpeed || targetSpeed);
      }

      const pending = state ? Math.max(0, (state.totalVideos || 0) - countCompleted(state)) : null;
      ui.refs.pending.textContent = pending == null ? '—' : String(pending);
      ui.refs.total.textContent = state ? String(state.totalVideos || 0) : '—';
      ui.refs.done.textContent = state ? String(countCompleted(state)) : '—';
      ui.refs.estimateHint.textContent = `${targetSpeed.toFixed(1)}× · 含切换`;

      const estimate = estimateQueueSeconds(state, durationCache, targetSpeed);
      if (!state) {
        ui.refs.estimate.textContent = '—';
      } else if (!estimate.pending) {
        ui.refs.estimate.textContent = '0 分钟';
      } else if (estimate.known === 0 && estimate.estimated === 0) {
        ui.refs.estimate.textContent = durationLoading ? '计算中…' : '暂时无法估算';
      } else {
        let estimateText = `约 ${formatEstimate(estimate.seconds)}`;
        if (durationLoading) {
          estimateText += '（更新中）';
        } else if (estimate.estimated > 0) {
          estimateText += `（含 ${estimate.estimated} 条估算）`;
        } else if (estimate.unknown > 0) {
          estimateText += `（${estimate.unknown} 条无法估算）`;
        }
        ui.refs.estimate.textContent = estimateText;
      }

      const item = state ? currentItem(state) : null;
      const alive = state ? isAlive(state) : false;
      const status = getCourseStatus(state, alive);

      ui.refs.status.textContent = status.text;
      ui.refs.dot.className = `dot ${status.tone}`;

      if (state && state.workerHeartbeatAt && ui.refs.message.querySelector('.manualLink')) {
        ui.refs.message.hidden = true;
        ui.refs.message.textContent = '';
      }

      if (item && state && (state.running || ['paused', 'error', 'interrupted', 'transitioning'].includes(state.status))) {
        ui.refs.current.hidden = false;
        ui.refs.curTitle.textContent = item.label;
        const progress = Math.max(normalizeProgress(item.progress), normalizeProgress(state.serverProgress));
        ui.refs.curFill.style.width = `${Math.round(progress * 100)}%`;
        const pieces = [
          `平台 ${pct(item.progress)}`,
          `队列 ${state.index + 1}/${state.queue.length}`,
        ];
        if (state.duration > 0) {
          pieces.push(`本地 ${formatTime(state.currentTime)} / ${formatTime(state.duration)}`);
        }
        if (state.speed) pieces.push(`${Number(state.speed).toFixed(2)}×`);
        ui.refs.curMeta.textContent = pieces.join(' · ');
      } else {
        ui.refs.current.hidden = true;
      }

      const primary = ui.refs.primary;
      const refresh = ui.refs.refresh;
      const stop = ui.refs.stop;

      if (loading) {
        primary.textContent = '读取中…';
        primary.disabled = true;
      } else if (!state) {
        primary.textContent = '读取队列';
        primary.disabled = false;
      } else if (state.status === 'error' && item) {
        primary.textContent = '重新打开视频页';
        primary.disabled = false;
      } else if (state.status === 'attention' && item) {
        primary.textContent = '切换到视频页';
        primary.disabled = false;
      } else if ((state.userPaused || state.status === 'paused') && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.running && alive) {
        primary.textContent = '队列运行中';
        primary.disabled = true;
      } else if (state.running && !alive) {
        primary.textContent = '重新打开视频页';
        primary.disabled = false;
      } else if (['interrupted'].includes(state.status) && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.status === 'stopped' && item) {
        primary.textContent = '继续观看';
        primary.disabled = false;
      } else if (state.status === 'done') {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      } else {
        primary.textContent = state.queue.length ? '开始队列' : '重新扫描';
        primary.disabled = false;
      }

      refresh.disabled = loading || !!(state && state.running && alive);
      stop.hidden = !(state && (state.running || ['paused', 'error', 'interrupted'].includes(state.status)));

      ui.refs.queueCount.textContent = state ? `(${state.queue.length})` : '';
      ui.refs.queueBox.hidden = !state || !state.queue.length;

      const listSignature = state
        ? `${state.index}|${state.currentLeafId}|${state.queue.map((q) => `${q.leafId}:${q.progress}:${q.playedToEnd ? 1 : 0}`).join(',')}`
        : 'empty';
      if (listSignature !== lastListSignature) {
        lastListSignature = listSignature;
        renderQueueList();
      }
    }

    function renderQueueList() {
      const list = ui.refs.queueList;
      list.textContent = '';
      if (!state) return;

      state.queue.forEach((item, index) => {
        const row = document.createElement('li');
        if (index === state.index || item.leafId === state.currentLeafId) row.classList.add('current');
        if (isItemDone(item)) row.classList.add('done');

        const indexEl = document.createElement('span');
        indexEl.className = 'idx';
        indexEl.textContent = String(index + 1);

        const textEl = document.createElement('span');
        textEl.className = 'itemText';
        const titleEl = document.createElement('span');
        titleEl.className = 'itemTitle';
        titleEl.textContent = item.title || item.label;
        const chapterEl = document.createElement('span');
        chapterEl.className = 'itemChapter';
        chapterEl.textContent = item.chapterName || '';
        textEl.append(titleEl, chapterEl);

        const progressEl = document.createElement('span');
        progressEl.className = 'itemProgress';
        progressEl.textContent = item.playedToEnd ? '已播完' : pct(item.progress);

        row.append(indexEl, textEl, progressEl);
        list.appendChild(row);
      });
    }

    function getCourseStatus(currentState, alive) {
      if (loading) return { text: '正在读取课程进度…', tone: 'busy' };
      if (!currentState) return { text: '尚未读取课程进度', tone: 'idle' };

      if (currentState.status === 'error') {
        return { text: `需要处理：${truncate(currentState.lastError || '未知错误', 80)}`, tone: 'error' };
      }
      if (currentState.status === 'attention') {
        return { text: '视频已暂停；请切回视频页继续', tone: 'warn' };
      }
      if (currentState.userPaused || currentState.status === 'paused') {
        return { text: '已暂停', tone: 'warn' };
      }
      if (currentState.running && alive) {
        if (currentState.status === 'transitioning') return { text: '正在切换到下一条视频…', tone: 'busy' };
        if (!currentState.workerHeartbeatAt) return { text: '正在连接视频标签页…', tone: 'busy' };
        return { text: '观看中 · 视频标签页正在运行', tone: 'active' };
      }
      if (currentState.running && !alive) {
        return { text: '视频标签页未连接（可能已关闭）', tone: 'warn' };
      }
      if (currentState.status === 'stopped') return { text: '队列已停止', tone: 'idle' };
      if (currentState.status === 'done') return { text: '队列完成', tone: 'active' };
      if (currentState.status === 'interrupted') return { text: '上次的视频标签页已断开', tone: 'warn' };
      return { text: '等待开始', tone: 'idle' };
    }

    function showMessage(text, tone = 'ok', manualUrl = '') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = '';
      box.className = `message ${tone}`;
      box.hidden = false;

      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);

      if (manualUrl) {
        const link = document.createElement('a');
        link.href = manualUrl;
        link.target = WORKER_NAME;
        link.textContent = '手动打开';
        link.className = 'manualLink';
        box.appendChild(link);
        return;
      }

      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 12000 : 8000);
    }
  }

  function makeFreshState(coursePage, snapshot) {
    const now = Date.now();
    return {
      version: 1,
      classroomId: String(coursePage.classroomId),
      courseSign: coursePage.courseSign || '',
      createdAt: now,
      updatedAt: now,
      queue: snapshot.pending,
      totalVideos: snapshot.total,
      baseCompleted: snapshot.completed,
      completedVideos: snapshot.completed,
      index: 0,
      running: false,
      status: 'idle',
      currentLeafId: null,
      currentTitle: '',
      currentTime: 0,
      duration: 0,
      speed: SPEED,
      targetSpeed: SPEED,
      serverProgress: 0,
      userPaused: false,
      startedAt: 0,
      heartbeatAt: 0,
      workerHeartbeatAt: 0,
      lastError: '',
    };
  }

  function findFirstPendingIndex(state) {
    return state.queue.findIndex((item) => !isItemDone(item));
  }

  function currentItem(state) {
    if (!state || !state.queue.length) return null;
    if (state.currentLeafId != null) {
      const byId = state.queue.find((item) => item.leafId === Number(state.currentLeafId));
      if (byId) return byId;
    }
    return state.queue[state.index] || null;
  }

  function isAlive(state) {
    return !!state && state.running && Date.now() - Number(state.heartbeatAt || 0) < STALE_MS;
  }

  // ---------------------------------------------------------------------------
  // Video worker page
  // ---------------------------------------------------------------------------

  function initWorkerPage(videoPage) {
    try { sessionStorage.setItem(WORKER_SESSION_KEY, '1'); } catch (_) {}

    let state = loadState(videoPage.classroomId);
    if (!state || !state.running || !state.queue.length) return;

    if (state.index >= state.queue.length) {
      state.running = false;
      state.status = 'done';
      saveState(state);
      return;
    }

    let item = state.queue[state.index];
    const redirectTarget = withWorkerHash(item.url);

    if (Number(item.leafId) !== Number(videoPage.leafId)) {
      try {
        const redirectKey = `ykt-last-redirect:${videoPage.leafId}`;
        const previous = Number(sessionStorage.getItem(redirectKey) || 0);
        if (Date.now() - previous > 5000) {
          sessionStorage.setItem(redirectKey, String(Date.now()));
          location.replace(redirectTarget);
        }
      } catch (_) {
        location.replace(redirectTarget);
      }
      return;
    }

    const targetSpeed = normalizeTargetSpeed(state.targetSpeed);
    state.targetSpeed = targetSpeed;

    let video = null;
    let checkTimer = null;
    let heartbeatTimer = null;
    let uiTimer = null;
    let speedTimer = null;
    let finishing = false;
    let stopped = false;
    let internalPause = false;
    let attentionPaused = false;
    let attentionReason = '';
    let pauseProbeTimer = null;
    let pauseGraceUntil = 0;
    let lastAttentionResumeAttempt = 0;
    let lastStateWrite = 0;
    let messageTimer = null;
    let speedFailures = 0;

    const ui = createWorkerPanel();
    const channel = createChannel();

    state.status = 'watching';
    state.currentLeafId = item.leafId;
    state.currentTitle = item.label;
    state.heartbeatAt = Date.now();
    state.workerHeartbeatAt = Date.now();
    state.lastError = '';
    saveState(state);
    updateWorkerUi();

    bindWorkerEvents();
    startHeartbeat();
    startUiTicker();

    boot().catch(handleFatalError);

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== videoPage.classroomId) return;
        if (event.data.type === 'stop') stopByExternalRequest();
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey(videoPage.classroomId)) return;
      const fresh = loadState(videoPage.classroomId);
      if (fresh && !fresh.running && state.running && !stopped) {
        stopByExternalRequest();
      }
    });

    window.addEventListener('beforeunload', () => {
      clearTimeout(checkTimer);
      clearInterval(heartbeatTimer);
      clearInterval(uiTimer);
      clearInterval(speedTimer);
    });

    async function boot() {
      video = await waitForVideo(30000);
      if (!video) {
        throw new Error('超过 30 秒仍未找到播放器，请刷新页面重试');
      }

      await waitForMetadata(video, 12000);

      video.addEventListener('ended', () => {
        if (stopped || !state.running || state.userPaused || finishing) return;
        finishing = true;
        confirmCompletion().catch(handleFatalError);
      });

      video.addEventListener('play', () => {
        internalPause = false;
        if (attentionPaused && !isPageActive()) {
          enforceAttentionPause();
          return;
        }
        if (state.running && !state.userPaused && isPageActive()) {
          const wasAttention = attentionPaused;
          attentionPaused = false;
          attentionReason = '';
          state.status = 'watching';
          saveWorkerState();
          scheduleCheck();
          updateWorkerUi();
          if (wasAttention) {
            ensureTargetSpeed()
              .then((ok) => { if (ok) startSpeedGuard(); })
              .catch(() => {});
          }
        }
      });

      video.addEventListener('pause', onVideoPause);
      video.addEventListener('waiting', () => {
        updateWorkerUi();
      });
      video.addEventListener('playing', () => {
        updateWorkerUi();
      });

      window.addEventListener('focus', onWindowFocus);
      window.addEventListener('blur', onWindowBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);

      pauseGraceUntil = Date.now() + 2500;

      if (!isPageActive()) {
        enterAttention('focus');
        return;
      }

      await ensurePlaying();
      const speedOk = await ensureTargetSpeed();
      if (!speedOk) {
        setWorkerMessage(`未能自动切换到 ${targetSpeed.toFixed(2)} 倍速，将按播放器当前速度计时。`, 'warn');
      }

      state.currentTime = video.currentTime || 0;
      state.duration = Number.isFinite(video.duration) ? video.duration : 0;
      state.speed = video.playbackRate || 1;
      saveWorkerState();
      updateWorkerUi();
      scheduleCheck();
      startSpeedGuard();
    }

    function isPageActive() {
      return !document.hidden && document.hasFocus();
    }

    function enforceAttentionPause() {
      if (!attentionPaused || state.userPaused || stopped || !video || video.paused) return;
      internalPause = true;
      try { video.pause(); } catch (_) {}
    }

    function onVideoPause() {
      if (internalPause || stopped || !state.running || state.userPaused || finishing) return;
      if (!video || video.ended) return;
      if (Date.now() < pauseGraceUntil) return;

      clearTimeout(pauseProbeTimer);
      pauseProbeTimer = setTimeout(() => {
        if (internalPause || stopped || !state.running || state.userPaused || finishing) return;
        if (!video || !video.paused || video.ended) return;
        if (document.hidden || !document.hasFocus()) {
          enterAttention('focus');
        } else {
          enterAttention('paused');
        }
      }, 450);
    }

    function onWindowBlur() {
      if (stopped || !state.running || state.userPaused) return;
      setTimeout(() => {
        if (!document.hasFocus()) enterAttention('focus');
      }, 250);
    }

    function onWindowFocus() {
      if (!attentionPaused || attentionReason !== 'focus') return;
      setTimeout(() => {
        if (isPageActive()) resumeFromAttention();
      }, 350);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (stopped || !state.running || state.userPaused) return;
        enterAttention('focus');
        return;
      }
      if (attentionPaused && attentionReason === 'focus' && isPageActive()) {
        setTimeout(() => {
          if (isPageActive()) resumeFromAttention();
        }, 350);
      }
    }

    function enterAttention(reason) {
      if (stopped || !state.running || state.userPaused) return;

      attentionPaused = true;
      attentionReason = reason;
      state.status = 'attention';
      state.userPaused = false;
      clearTimeout(checkTimer);
      clearTimeout(pauseProbeTimer);
      internalPause = true;
      if (video && !video.paused) {
        try { video.pause(); } catch (_) {}
      }
      saveWorkerState();
      updateWorkerUi();

      if (reason === 'focus') {
        setWorkerMessage('视频页失去焦点或切到后台，站点已暂停。请保持视频标签页在前台，队列会自动继续。', 'warn');
      } else {
        setWorkerMessage('播放器已暂停。请点击播放器中的播放按钮，或点本面板的“继续”。', 'warn');
      }
    }

    async function resumeFromAttention() {
      if (stopped || !state.running || state.userPaused) return;
      if (!isPageActive()) {
        setWorkerMessage('请先切回视频标签页并让它保持前台。', 'warn');
        return;
      }

      attentionPaused = false;
      attentionReason = '';
      state.status = 'watching';
      pauseGraceUntil = Date.now() + 2000;
      saveWorkerState();
      const ok = await ensurePlaying();
      if (ok) {
        const speedOk = await ensureTargetSpeed();
        startSpeedGuard();
        scheduleCheck();
        setWorkerMessage(
          speedOk ? '已恢复播放。' : `已恢复播放，但未能切换到 ${targetSpeed.toFixed(2)} 倍速。`,
          speedOk ? 'ok' : 'warn',
        );
      } else {
        enterAttention('paused');
      }
      updateWorkerUi();
    }

    function bindWorkerEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-worker-panel-collapsed');
          return;
        }
        if (action === 'pause') {
          if (!video) return;
          if (video.paused) {
            state.userPaused = false;
            state.status = 'watching';
            saveWorkerState();
            if (attentionPaused) {
              await resumeFromAttention();
            } else {
              await ensurePlaying();
              scheduleCheck();
            }
          } else {
            internalPause = true;
            video.pause();
            state.userPaused = true;
            attentionPaused = false;
            attentionReason = '';
            state.status = 'paused';
            saveWorkerState();
          }
          updateWorkerUi();
          return;
        }
        if (action === 'stop') {
          stopQueue();
          return;
        }
        if (action === 'retry') {
          location.reload();
        }
      });
    }

    async function waitForVideo(timeoutMs) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const found = document.querySelector('video');
        if (found) return found;
        await sleep(500);
      }
      return null;
    }

    async function waitForMetadata(target, timeoutMs) {
      if (Number.isFinite(target.duration) && target.duration > 0) return;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (Number.isFinite(target.duration) && target.duration > 0) return;
        await sleep(300);
      }
    }

    async function ensurePlaying() {
      if (!video) return false;
      if (!video.paused) return true;
      if (!isPageActive()) {
        enterAttention('focus');
        return false;
      }
      try {
        const promise = video.play();
        if (promise && typeof promise.then === 'function') await promise;
        return !video.paused;
      } catch (_) {
        setWorkerMessage('浏览器阻止了自动播放。请在播放器中点一次播放，队列会在开始后继续。', 'warn');
        return false;
      }
    }

    async function ensureTargetSpeed() {
      if (!video) return false;
      if (Math.abs(video.playbackRate - targetSpeed) < 0.01) {
        state.speed = targetSpeed;
        return true;
      }

      for (let attempt = 0; attempt < 20; attempt++) {
        applyTargetSpeedEvents();
        await sleep(400);
        if (Math.abs(video.playbackRate - targetSpeed) < 0.01) {
          state.speed = targetSpeed;
          saveWorkerState();
          return true;
        }
      }

      speedFailures += 1;
      state.speed = video.playbackRate || 1;
      saveWorkerState();
      return false;
    }

    function applyTargetSpeedEvents() {
      const button = document.querySelector('xt-speedbutton');
      if (!button) return;
      const list = button.querySelector('ul');
      if (!list) return;

      let option = button.querySelector('li[data-ykt-speed-option="1"]');
      if (!option) {
        option = button.querySelector('li[data-speed="2"]')
          || button.querySelector('li[data-speed="1"]')
          || button.querySelector('li');
      }
      if (!option) return;

      option.setAttribute('data-ykt-speed-option', '1');
      option.setAttribute('data-speed', String(targetSpeed));
      option.setAttribute('keyt', targetSpeed.toFixed(2));
      option.textContent = `${targetSpeed.toFixed(2)}X`;
      option.classList.remove('xt_video_player_common_active');

      try {
        button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 1000, clientY: 400 }));
        button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1040, clientY: 350 }));
        option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}

      if (!video || Math.abs(video.playbackRate - targetSpeed) >= 0.01) {
        const $ = window.jQuery;
        if ($) {
          try {
            const $button = $('xt-speedbutton');
            $button.trigger($.Event('mouseover', { clientX: 1000, clientY: 400 }));
            $button.trigger($.Event('mousemove', { clientX: 1040, clientY: 350 }));
            $(option).trigger('click');
          } catch (_) {}
        }
      }
    }

    function startSpeedGuard() {
      clearInterval(speedTimer);
      speedTimer = setInterval(async () => {
        if (stopped || !state.running || state.userPaused || !video) return;
        if (Math.abs(video.playbackRate - targetSpeed) > 0.01 && speedFailures < 5) {
          const ok = await ensureTargetSpeed();
          if (!ok) {
            state.speed = video.playbackRate || 1;
            saveWorkerState();
            updateWorkerUi();
          }
        }
      }, 15000);
    }

    function scheduleCheck() {
      clearTimeout(checkTimer);
      if (stopped || !state.running || state.userPaused || attentionPaused || state.status === 'attention') return;

      const target = Number.isFinite(video && video.duration) && video.duration > 0
        ? Math.max(0, video.duration - (video.currentTime || 0))
        : null;
      const rate = video && video.playbackRate > 0 ? video.playbackRate : targetSpeed;
      const waitMs = target == null
        ? 5000
        : Math.max(MIN_CHECK_MS, Math.min(MAX_CHECK_MS, (target / rate + 2) * 1000));

      checkTimer = setTimeout(() => {
        checkProgress().catch(handleFatalError);
      }, waitMs);
    }

    async function checkProgress() {
      if (stopped || !state.running || state.userPaused || finishing || attentionPaused) return;

      if (!video) {
        scheduleCheck();
        return;
      }

      if (video.paused && !video.ended) {
        enterAttention(isPageActive() ? 'paused' : 'focus');
        return;
      }

      const ended = video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 1.5);
      if (!ended) {
        scheduleCheck();
        return;
      }

      finishing = true;
      await confirmCompletion();
    }

    async function confirmCompletion() {
      let serverProgress = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        serverProgress = await getLeafProgress(videoPage.classroomId, item.leafId);
        if (serverProgress != null && serverProgress >= COMPLETE_THRESHOLD) break;
        if (attempt < 4) await sleep(2000);
      }

      if (serverProgress != null && serverProgress >= COMPLETE_THRESHOLD) {
        completeCurrent(serverProgress, false);
        return;
      }

      if (video && video.ended) {
        const detail = serverProgress == null
          ? '平台进度暂时查询不到'
          : `平台进度为 ${pct(serverProgress)}`;
        setWorkerMessage(`${detail}；视频已实际播放到结尾，继续下一条。`, 'warn');
        completeCurrent(serverProgress, true);
        return;
      }

      finishing = false;
      scheduleCheck();
    }

    function completeCurrent(serverProgress, playedToEnd) {
      if (stopped) return;

      const current = state.queue[state.index];
      if (current) {
        current.progress = Math.max(normalizeProgress(current.progress), normalizeProgress(serverProgress));
        current.playedToEnd = !!playedToEnd || current.progress >= COMPLETE_THRESHOLD;
        current.completedAt = Date.now();
      }

      state.serverProgress = normalizeProgress(serverProgress);
      saveState(state);

      const nextIndex = state.index + 1;
      if (nextIndex < state.queue.length) {
        state.index = nextIndex;
        state.status = 'transitioning';
        state.currentLeafId = state.queue[nextIndex].leafId;
        state.currentTitle = state.queue[nextIndex].label;
        state.currentTime = 0;
        state.duration = 0;
        state.serverProgress = 0;
        state.heartbeatAt = Date.now();
        saveState(state);
        updateWorkerUi();
        setWorkerMessage(`已完成，正在打开下一条：${state.queue[nextIndex].title}`, 'ok');
        setTimeout(() => {
          location.replace(withWorkerHash(state.queue[nextIndex].url));
        }, 1600);
        return;
      }

      state.running = false;
      state.status = 'done';
      state.currentLeafId = null;
      state.currentTitle = '';
      state.serverProgress = 0;
      state.heartbeatAt = Date.now();
      saveState(state);
      stopped = true;
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      updateWorkerUi();
      setWorkerMessage('队列已完成：所有待看视频都已处理。', 'ok');
    }

    function startHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (stopped) return;

        const fresh = loadState(videoPage.classroomId);
        if (!fresh || !fresh.running) {
          stopByExternalRequest();
          return;
        }

        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = state.heartbeatAt;
        state.currentLeafId = item.leafId;
        state.currentTitle = item.label;
        state.currentTime = video ? video.currentTime || 0 : state.currentTime;
        state.duration = video && Number.isFinite(video.duration) ? video.duration : state.duration;
        state.speed = video && video.playbackRate ? video.playbackRate : state.speed;
        state.serverProgress = Math.max(
          normalizeProgress(state.serverProgress),
          normalizeProgress(state.queue[state.index] && state.queue[state.index].progress),
        );
        if (state.status === 'error') {
          // Keep the error visible until the page is retried.
        } else if (state.status === 'transitioning') {
          // Keep the transition state until navigation.
        } else if (attentionPaused) {
          state.status = 'attention';
        } else if (state.userPaused) {
          state.status = 'paused';
        } else {
          state.status = 'watching';
        }

        const latest = loadState(videoPage.classroomId);
        if (!latest || !latest.running) {
          stopByExternalRequest();
          return;
        }
        saveState(state);
        updateWorkerUi();
      }, HEARTBEAT_MS);
    }

    function startUiTicker() {
      clearInterval(uiTimer);
      uiTimer = setInterval(updateWorkerUi, 1000);
    }

    function saveWorkerState() {
      if (stopped) return;
      lastStateWrite = Date.now();
      state.heartbeatAt = lastStateWrite;
      state.workerHeartbeatAt = lastStateWrite;
      if (video) {
        state.currentTime = video.currentTime || 0;
        state.duration = Number.isFinite(video.duration) ? video.duration : 0;
        state.speed = video.playbackRate || state.speed;
      }
      saveState(state);
    }

    function stopByExternalRequest() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      clearInterval(speedTimer);
      updateWorkerUi();
      setWorkerMessage('队列已被课程页停止。', 'warn');
    }

    function stopQueue() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      saveState(state);
      if (channel) {
        channel.postMessage({ type: 'state-changed', classroomId: videoPage.classroomId });
      }
      internalPause = true;
      if (video) {
        try { video.pause(); } catch (_) {}
      }
      clearTimeout(checkTimer);
      clearInterval(speedTimer);
      updateWorkerUi();
      setWorkerMessage('队列已停止。回到课程页可以继续。', 'warn');
    }

    function handleFatalError(error) {
      if (stopped) return;
      state.status = 'error';
      state.running = true;
      state.lastError = truncate(error && error.message ? error.message : error, 160);
      saveState(state);
      updateWorkerUi();
      setWorkerMessage(`播放失败：${state.lastError}`, 'error');
    }

    function updateWorkerUi() {
      enforceAttentionPause();

      if (
        attentionPaused
        && attentionReason === 'focus'
        && isPageActive()
        && !stopped
        && state.running
        && !state.userPaused
        && Date.now() - lastAttentionResumeAttempt > 2500
      ) {
        lastAttentionResumeAttempt = Date.now();
        resumeFromAttention();
      }

      const alive = state.running && !stopped;
      const queuePos = alive ? `第 ${state.index + 1} / ${state.queue.length} 条` : '队列';

      ui.refs.qpos.textContent = queuePos;
      ui.refs.speedLogo.textContent = `${targetSpeed.toFixed(1)}×`;
      ui.refs.title.textContent = item.label;

      const localTime = video ? video.currentTime || 0 : state.currentTime || 0;
      const duration = video && Number.isFinite(video.duration) ? video.duration : state.duration || 0;
      const rate = video && video.playbackRate ? video.playbackRate : state.speed || targetSpeed;
      const remaining = duration > 0 ? Math.max(0, (duration - localTime) / rate) : null;
      const serverProgress = Math.max(
        normalizeProgress(state.serverProgress),
        normalizeProgress(state.queue[state.index] && state.queue[state.index].progress),
      );

      let tone = 'active';
      let statusText = '观看中';
      if (state.status === 'error') {
        tone = 'error';
        statusText = '需要处理';
      } else if (stopped || !state.running) {
        tone = state.status === 'done' ? 'active' : 'idle';
        statusText = state.status === 'done' ? '队列完成' : '已停止';
      } else if (state.status === 'transitioning') {
        tone = 'busy';
        statusText = '正在切换下一条';
      } else if (attentionPaused || state.status === 'attention') {
        tone = 'warn';
        statusText = attentionReason === 'focus' ? '等待回到视频页' : '播放器已暂停';
      } else if (state.userPaused) {
        tone = 'warn';
        statusText = '已暂停';
      } else if (video && video.readyState < 3 && !video.paused) {
        tone = 'busy';
        statusText = '缓冲中';
      } else if (video && video.paused) {
        tone = 'warn';
        statusText = '播放器已暂停';
      }

      ui.refs.status.textContent = statusText;
      ui.refs.dot.className = `dot ${tone}`;
      ui.refs.fill.style.width = `${Math.round(serverProgress * 100)}%`;
      ui.refs.time.textContent = `本地 ${formatTime(localTime)} / ${formatTime(duration)}`;
      ui.refs.pct.textContent = `平台 ${pct(serverProgress)}`;
      ui.refs.meta.textContent = remaining == null
        ? `${Number(rate).toFixed(2)}×`
        : `${Number(rate).toFixed(2)}× · 预计剩余 ${formatTime(remaining)}`;

      const pauseButton = ui.refs.pause;
      pauseButton.hidden = !alive || state.status === 'error';
      pauseButton.textContent = video && video.paused ? '继续' : '暂停';
      pauseButton.disabled = !alive || state.status === 'transitioning';

      ui.refs.stop.hidden = !alive;
      ui.refs.retry.hidden = state.status !== 'error';
    }

    function setWorkerMessage(text, tone = 'ok') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = text;
      box.className = `message ${tone}`;
      box.hidden = false;
      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 15000 : 8000);
    }
  }

  // ---------------------------------------------------------------------------
  // Discussion queue (course page)
  // ---------------------------------------------------------------------------

  function initDiscussionCoursePage(coursePage) {
    let state = loadDiscussionState(coursePage.classroomId);
    let config = loadDiscussionConfig();
    let loading = false;
    let messageTimer = null;
    let lastListSignature = '';
    let workerWindow = null;

    const ui = createDiscussionCoursePanel();
    const channel = createDiscussionChannel();

    bindDiscussionCourseEvents();
    fillDiscussionConfigForm();
    renderDiscussionCourse();

    if (!state) {
      refreshDiscussionQueue({ automatic: true });
    } else if (state.running && Date.now() - Number(state.heartbeatAt || 0) > STALE_MS) {
      state.status = 'interrupted';
      saveDiscussionState(state);
      renderDiscussionCourse();
    }

    setInterval(() => {
      if (loading) return;
      const fresh = loadDiscussionState(coursePage.classroomId);
      const changed = (fresh && fresh.updatedAt) !== (state && state.updatedAt);
      if (changed) state = fresh;
      renderDiscussionCourse();
    }, 2000);

    window.addEventListener('storage', (event) => {
      if (event.key !== discussionStorageKey(coursePage.classroomId)) return;
      const fresh = loadDiscussionState(coursePage.classroomId);
      if (fresh) {
        state = fresh;
        renderDiscussionCourse();
      }
    });

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== coursePage.classroomId) return;
        if (event.data.type === 'state-changed' || event.data.type === 'worker-ready') {
          const fresh = loadDiscussionState(coursePage.classroomId);
          if (fresh) state = fresh;
          renderDiscussionCourse();
        }
      };
    }

    function bindDiscussionCourseEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-discussion-course-panel-collapsed');
          return;
        }
        if (action === 'refresh') {
          if (loading) return;
          if (state && state.running) {
            showDiscussionMessage('请先停止讨论队列，再刷新课程讨论。', 'warn');
            return;
          }
          await refreshDiscussionQueue({ manual: true });
          return;
        }
        if (action === 'primary') {
          await handleDiscussionPrimary();
          return;
        }
        if (action === 'stop') {
          handleDiscussionStop();
          return;
        }
        if (action === 'save-config') {
          saveConfigFromForm();
          return;
        }
        if (action === 'fetch-models') {
          await handleFetchModels(ui, showDiscussionMessage);
          return;
        }
      });

      ui.refs.format.addEventListener('change', updateDiscussionFormatHint);
    }

    function fillDiscussionConfigForm() {
      ui.refs.format.value = config.format;
      ui.refs.apiUrl.value = config.apiUrl;
      ui.refs.apiKey.value = config.apiKey;
      ui.refs.model.value = config.model;
      ui.refs.extraHeaders.value = config.extraHeaders || '';
      ui.refs.autoSubmit.checked = config.autoSubmit === true;
      ui.refs.prompt.value = config.promptTemplate;
      updateDiscussionFormatHint();
    }

    function updateDiscussionFormatHint() {
      const hints = {
        openai: {
          url: 'https://api.deepseek.com/chat/completions',
          model: '例如 deepseek-chat',
          modelDisabled: false,
        },
        'openai-responses': {
          url: 'https://api.openai.com/v1/responses',
          model: '例如 gpt-5.1',
          modelDisabled: false,
        },
        anthropic: {
          url: 'https://api.anthropic.com/v1/messages',
          model: '例如 claude-sonnet-4-5',
          modelDisabled: false,
        },
        gemini: {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          model: '模型写在地址中，可留空',
          modelDisabled: true,
        },
      };
      const hint = hints[ui.refs.format.value] || hints.openai;
      ui.refs.apiUrl.placeholder = hint.url;
      ui.refs.model.placeholder = hint.model;
      ui.refs.model.disabled = hint.modelDisabled;
    }

    function saveConfigFromForm() {
      const current = loadDiscussionConfig();
      config = normalizeDiscussionConfig({
        ...current,
        format: ui.refs.format.value,
        apiUrl: ui.refs.apiUrl.value,
        apiKey: ui.refs.apiKey.value,
        model: ui.refs.model.value,
        extraHeaders: ui.refs.extraHeaders.value,
        autoSubmit: ui.refs.autoSubmit.checked,
        promptTemplate: ui.refs.prompt.value,
      });
      saveDiscussionConfig(config);
      const enabled = config.autoSubmit ? '已开启自动提交' : '当前为审核模式（生成后等你确认）';
      showDiscussionMessage(`AI 设置已保存。${enabled}。`, 'ok');
    }

    async function buildDiscussionSnapshot() {
      const sign = await fetchCourseSign(coursePage);
      const chapterData = await fetchChapterData(coursePage.classroomId, sign);
      const discussions = extractDiscussionLeaves(chapterData, coursePage.classroomId);
      const statuses = await mapLimit(discussions, 4, async (item) => {
        try {
          return await fetchDiscussionCommented(coursePage.classroomId, item.leafId);
        } catch (_) {
          return false;
        }
      });
      const enriched = discussions.map((item, index) => ({
        ...item,
        done: statuses[index] === true,
      }));
      return {
        sign,
        total: enriched.length,
        completed: enriched.filter((item) => item.done).length,
        pending: enriched.filter(isDiscussionPending),
      };
    }

    async function refreshDiscussionQueue(options = {}) {
      if (loading) return;
      loading = true;
      renderDiscussionCourse();
      try {
        const snapshot = await buildDiscussionSnapshot();
        state = makeFreshDiscussionState(coursePage, snapshot.sign, snapshot);
        saveDiscussionState(state);
        if (options.manual) {
          showDiscussionMessage(`已读取课程讨论：${snapshot.pending.length} 条待发言。`, 'ok');
        }
      } catch (error) {
        if (!state) {
          showDiscussionMessage(`读取失败：${truncate(error.message, 140)}`, 'error');
        } else if (options.manual) {
          showDiscussionMessage(`刷新失败：${truncate(error.message, 140)}`, 'error');
        }
      } finally {
        loading = false;
        renderDiscussionCourse();
      }
    }

    async function handleDiscussionPrimary() {
      if (loading) return;

      const item = state ? discussionCurrentItem(state) : null;

      if (state && state.running && state.phase === 'review' && isDiscussionAlive(state)) {
        focusDiscussionWorker();
        return;
      }
      if (state && state.running && state.phase === 'error' && isDiscussionAlive(state)) {
        focusDiscussionWorker();
        return;
      }
      if (state && state.running && isDiscussionAlive(state)) {
        showDiscussionMessage('讨论队列正在运行，请在讨论标签页中查看和审核。', 'ok');
        return;
      }
      if (state && ['stopped', 'error', 'interrupted'].includes(state.status) && item) {
        resumeDiscussionQueue(item);
        return;
      }
      if (state && state.running && !isDiscussionAlive(state) && item) {
        resumeDiscussionQueue(item);
        return;
      }
      if (state && state.status === 'idle' && state.queue.length && Date.now() - Number(state.createdAt || 0) < 5 * 60 * 1000) {
        resumeDiscussionQueue(item || state.queue[0]);
        return;
      }
      await startFreshDiscussionQueue();
    }

    function resumeDiscussionQueue(item) {
      if (!state || !item) return;
      state.running = true;
      state.status = 'running';
      state.userPaused = false;
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      if (state.phase !== 'review') state.phase = 'idle';
      saveDiscussionState(state);
      renderDiscussionCourse();

      workerWindow = openDiscussionWorker(withDiscussionWorkerHash(item.url));
      if (!workerWindow) showDiscussionPopupBlocked(item);
    }

    async function startFreshDiscussionQueue() {
      if (loading) return;
      const blank = openDiscussionWorker('about:blank');
      if (!blank) {
        showDiscussionMessage('浏览器拦截了新标签页。请允许本站弹窗后，再点一次“开始讨论队列”。', 'error');
        return;
      }

      loading = true;
      renderDiscussionCourse();
      try {
        const snapshot = await buildDiscussionSnapshot();
        state = makeFreshDiscussionState(coursePage, snapshot.sign, snapshot);

        if (!snapshot.pending.length) {
          state.status = 'done';
          state.completedDiscussions = snapshot.total;
          saveDiscussionState(state);
          try { blank.close(); } catch (_) {}
          showDiscussionMessage('所有讨论都已发言，没有待处理队列。', 'ok');
          return;
        }

        state.running = true;
        state.status = 'running';
        state.phase = 'idle';
        state.startedAt = Date.now();
        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = 0;
        saveDiscussionState(state);
        renderDiscussionCourse();

        const first = snapshot.pending[0];
        try {
          blank.location.replace(withDiscussionWorkerHash(first.url));
          blank.focus();
        } catch (_) {
          try { blank.close(); } catch (_) {}
          state.running = false;
          state.status = 'error';
          state.lastError = '打开讨论标签页失败';
          saveDiscussionState(state);
          renderDiscussionCourse();
          showDiscussionMessage('打开讨论标签页失败，请重试。', 'error');
        }
      } catch (error) {
        try { blank.close(); } catch (_) {}
        showDiscussionMessage(`读取课程讨论失败：${truncate(error.message, 140)}`, 'error');
      } finally {
        loading = false;
        renderDiscussionCourse();
      }
    }

    function openDiscussionWorker(url) {
      try {
        return window.open(url, DISCUSSION_WORKER_NAME);
      } catch (_) {
        return null;
      }
    }

    function focusDiscussionWorker() {
      if (workerWindow && !workerWindow.closed) {
        try {
          workerWindow.focus();
          return;
        } catch (_) {}
      }
      const item = state ? discussionCurrentItem(state) : null;
      if (!item) return;
      workerWindow = openDiscussionWorker(withDiscussionWorkerHash(item.url));
      if (!workerWindow) showDiscussionPopupBlocked(item);
    }

    function showDiscussionPopupBlocked(item) {
      showDiscussionMessage(
        '浏览器拦截了新标签页。请允许本站弹窗后重试，或点击这里手动打开讨论标签页。',
        'warn',
        withDiscussionWorkerHash(item.url),
      );
    }

    function handleDiscussionStop() {
      if (!state) return;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveDiscussionState(state);
      if (channel) {
        channel.postMessage({ type: 'stop', classroomId: coursePage.classroomId });
      }
      showDiscussionMessage('讨论队列已停止。再次点击“继续讨论”会从当前条恢复。', 'warn');
      renderDiscussionCourse();
    }

    function renderDiscussionCourse() {
      const pending = state ? state.queue.filter(isDiscussionPending).length : null;
      ui.refs.pending.textContent = pending == null ? '—' : String(pending);
      ui.refs.total.textContent = state ? String(state.totalDiscussions || 0) : '—';
      ui.refs.done.textContent = state ? String(discussionDoneCount(state)) : '—';

      const item = state ? discussionCurrentItem(state) : null;
      const alive = state ? isDiscussionAlive(state) : false;
      const status = getDiscussionCourseStatus(state, alive);
      ui.refs.status.textContent = status.text;
      ui.refs.dot.className = `dot ${status.tone}`;

      if (item && state && (state.running || ['stopped', 'error', 'interrupted'].includes(state.status))) {
        ui.refs.current.hidden = false;
        ui.refs.curTitle.textContent = item.label;
        const pieces = [`第 ${state.index + 1} / ${state.queue.length} 条`];
        if (state.phase === 'review') pieces.push('等待审核');
        else if (state.phase === 'generating') pieces.push('AI 生成中');
        else if (state.phase === 'fetching') pieces.push('读取题目中');
        else if (state.phase === 'submitting' || state.phase === 'verifying') pieces.push('提交中');
        else if (state.phase === 'error') pieces.push('需要处理');
        ui.refs.curMeta.textContent = pieces.join(' · ');
      } else {
        ui.refs.current.hidden = true;
      }

      const primary = ui.refs.primary;
      const refresh = ui.refs.refresh;
      const stop = ui.refs.stop;

      if (loading) {
        primary.textContent = '读取中…';
        primary.disabled = true;
      } else if (!state) {
        primary.textContent = '读取队列';
        primary.disabled = false;
      } else if (state.running && alive && state.phase === 'review') {
        primary.textContent = '去审核';
        primary.disabled = false;
      } else if (state.running && alive && state.phase === 'error') {
        primary.textContent = '去处理';
        primary.disabled = false;
      } else if (state.running && alive) {
        primary.textContent = '队列运行中';
        primary.disabled = true;
      } else if (state.running && !alive && item) {
        primary.textContent = '重新打开讨论页';
        primary.disabled = false;
      } else if (['stopped', 'error', 'interrupted'].includes(state.status) && item) {
        primary.textContent = '继续讨论';
        primary.disabled = false;
      } else if (state.status === 'done') {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      } else if (state.queue.length) {
        primary.textContent = '开始讨论队列';
        primary.disabled = false;
      } else {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      }

      refresh.disabled = loading || !!(state && state.running);
      stop.hidden = !(state && (state.running || ['stopped', 'error', 'interrupted'].includes(state.status)));

      ui.refs.queueCount.textContent = state ? `(${state.queue.filter(isDiscussionPending).length})` : '';
      ui.refs.queueBox.hidden = !state || !state.queue.length;

      const listSignature = state
        ? `${state.index}|${state.currentLeafId}|${state.queue.map((q) => `${q.leafId}:${q.done ? 1 : 0}:${q.skipped ? 1 : 0}`).join(',')}`
        : 'empty';
      if (listSignature !== lastListSignature) {
        lastListSignature = listSignature;
        renderDiscussionQueueList();
      }
    }

    function renderDiscussionQueueList() {
      const list = ui.refs.queueList;
      list.textContent = '';
      if (!state) return;

      state.queue.forEach((item, index) => {
        const row = document.createElement('li');
        if (index === state.index || item.leafId === state.currentLeafId) row.classList.add('current');
        if (item.done) row.classList.add('done');
        if (item.skipped) row.classList.add('skipped');

        const indexEl = document.createElement('span');
        indexEl.className = 'idx';
        indexEl.textContent = String(index + 1);

        const textEl = document.createElement('span');
        textEl.className = 'itemText';
        const titleEl = document.createElement('span');
        titleEl.className = 'itemTitle';
        titleEl.textContent = item.title || item.label;
        const chapterEl = document.createElement('span');
        chapterEl.className = 'itemChapter';
        chapterEl.textContent = item.chapterName || '';
        textEl.append(titleEl, chapterEl);

        const stateEl = document.createElement('span');
        stateEl.className = 'itemProgress';
        stateEl.textContent = item.done ? '已发言' : (item.skipped ? '已跳过' : '待发言');

        row.append(indexEl, textEl, stateEl);
        list.appendChild(row);
      });
    }

    function getDiscussionCourseStatus(currentState, alive) {
      if (loading) return { text: '正在读取课程讨论…', tone: 'busy' };
      if (!currentState) return { text: '尚未读取课程讨论', tone: 'idle' };

      if (currentState.status === 'error' || currentState.phase === 'error') {
        return { text: `需要处理：${truncate(currentState.lastError || '未知错误', 80)}`, tone: 'error' };
      }
      if (currentState.running && alive) {
        if (currentState.phase === 'fetching') return { text: '正在读取讨论题目…', tone: 'busy' };
        if (currentState.phase === 'generating') return { text: 'AI 正在生成答案…', tone: 'busy' };
        if (currentState.phase === 'review') return { text: '等待你在讨论页审核并提交答案', tone: 'warn' };
        if (currentState.phase === 'submitting') return { text: '正在提交答案…', tone: 'busy' };
        if (currentState.phase === 'verifying') return { text: '正在验证发言状态…', tone: 'busy' };
        if (currentState.phase === 'transitioning') return { text: '正在切换到下一条讨论…', tone: 'busy' };
        return { text: '讨论队列运行中', tone: 'active' };
      }
      if (currentState.running && !alive) {
        return { text: '讨论标签页未连接（可能已关闭）', tone: 'warn' };
      }
      if (currentState.status === 'stopped') return { text: '讨论队列已停止', tone: 'idle' };
      if (currentState.status === 'done') return { text: '讨论队列完成', tone: 'active' };
      if (currentState.status === 'interrupted') return { text: '上次的讨论标签页已断开', tone: 'warn' };
      if (currentState.userPaused) return { text: '已暂停', tone: 'warn' };
      return { text: '等待开始', tone: 'idle' };
    }

    function showDiscussionMessage(text, tone = 'ok', manualUrl = '') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = '';
      box.className = `message ${tone}`;
      box.hidden = false;

      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);

      if (manualUrl) {
        const link = document.createElement('a');
        link.href = manualUrl;
        link.target = DISCUSSION_WORKER_NAME;
        link.textContent = '手动打开';
        link.className = 'manualLink';
        box.appendChild(link);
        return;
      }

      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 12000 : 8000);
    }
  }

  function makeFreshDiscussionState(coursePage, courseSign, snapshot) {
    const now = Date.now();
    return {
      version: 1,
      classroomId: String(coursePage.classroomId),
      courseSign: courseSign || coursePage.courseSign || '',
      createdAt: now,
      updatedAt: now,
      queue: snapshot.pending,
      totalDiscussions: snapshot.total,
      baseCompleted: snapshot.completed,
      completedDiscussions: snapshot.completed,
      index: 0,
      running: false,
      status: 'idle',
      phase: 'idle',
      userPaused: false,
      currentLeafId: null,
      question: '',
      answer: '',
      topicId: null,
      toUser: null,
      lastError: '',
      startedAt: 0,
      heartbeatAt: 0,
      workerHeartbeatAt: 0,
    };
  }

  function discussionCurrentItem(state) {
    if (!state || !state.queue.length) return null;
    if (state.currentLeafId != null) {
      const byId = state.queue.find((item) => Number(item.leafId) === Number(state.currentLeafId));
      if (byId) return byId;
    }
    return state.queue[state.index] || null;
  }

  function isDiscussionAlive(state) {
    return !!state && state.running && Date.now() - Number(state.heartbeatAt || 0) < STALE_MS;
  }

  function createDiscussionChannel() {
    try {
      return new BroadcastChannel(DISCUSSION_CHANNEL_NAME);
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Discussion worker page
  // ---------------------------------------------------------------------------

  function initDiscussionWorkerPage(forumPage) {
    try { sessionStorage.setItem(DISCUSSION_WORKER_SESSION_KEY, '1'); } catch (_) {}

    let state = loadDiscussionState(forumPage.classroomId);
    if (!state || !state.running || !state.queue.length) return;

    if (state.index >= state.queue.length) {
      state.running = false;
      state.status = 'done';
      saveDiscussionState(state);
      return;
    }

    const item = state.queue[state.index];
    if (Number(item.leafId) !== Number(forumPage.leafId)) {
      try {
        const redirectKey = `ykt-discussion-last-redirect:${forumPage.leafId}`;
        const previous = Number(sessionStorage.getItem(redirectKey) || 0);
        if (Date.now() - previous > 5000) {
          sessionStorage.setItem(redirectKey, String(Date.now()));
          location.replace(withDiscussionWorkerHash(item.url));
        }
      } catch (_) {
        location.replace(withDiscussionWorkerHash(item.url));
      }
      return;
    }

    let stopped = false;
    let busy = false;
    let heartbeatTimer = null;
    let uiTimer = null;
    let messageTimer = null;

    const ui = createDiscussionWorkerPanel();
    const channel = createDiscussionChannel();

    state.currentLeafId = item.leafId;
    state.status = 'running';
    state.heartbeatAt = Date.now();
    state.workerHeartbeatAt = Date.now();
    saveDiscussionState(state);
    updateDiscussionWorkerUi();

    bindDiscussionWorkerEvents();
    startDiscussionHeartbeat();
    startDiscussionUiTicker();
    bootDiscussion();

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== forumPage.classroomId) return;
        if (event.data.type === 'stop') stopDiscussionByExternalRequest();
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== discussionStorageKey(forumPage.classroomId)) return;
      const fresh = loadDiscussionState(forumPage.classroomId);
      if (fresh && !fresh.running && state.running && !stopped) {
        stopDiscussionByExternalRequest();
      }
    });

    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeatTimer);
      clearInterval(uiTimer);
    });

    async function bootDiscussion() {
      const savedPhase = state.phase;
      try {
        if (await safeCommented()) {
          finishDiscussionItem('该讨论此前已发言，自动跳过');
          return;
        }

        if ((savedPhase === 'review' || state.phase === 'error') && cleanText(state.answer) && cleanText(state.question)) {
          renderDiscussionReview();
          return;
        }

        setDiscussionPhase('fetching');
        if (!cleanText(state.question) || state.topicId == null) {
          const topic = await fetchDiscussionTopic(forumPage.classroomId, item.leafId);
          state.question = topic.question;
          state.topicId = topic.topicId;
          state.toUser = topic.toUser;
          saveDiscussionState(state);
          updateDiscussionWorkerUi();
        }

        await generateDiscussionAnswer();
      } catch (error) {
        handleDiscussionWorkerError(error);
      }
    }

    async function safeCommented() {
      try {
        return await fetchDiscussionCommented(forumPage.classroomId, item.leafId);
      } catch (_) {
        return false;
      }
    }

    async function generateDiscussionAnswer() {
      setDiscussionPhase('generating');
      const config = loadDiscussionConfig();
      try {
        const answer = await callAI(config, state.question);
        if (stopped) return;
        state.answer = answer;
        saveDiscussionState(state);
        if (config.autoSubmit) {
          await submitCurrentDiscussion();
        } else {
          renderDiscussionReview();
        }
      } catch (error) {
        handleDiscussionWorkerError(error);
      }
    }

    function renderDiscussionReview() {
      setDiscussionPhase('review');
      ui.refs.answer.value = state.answer || '';
      updateDiscussionWorkerUi();
    }

    async function submitEditedAnswer() {
      if (busy || stopped) return;
      const text = normalizeMultiline(ui.refs.answer.value);
      if (!text) {
        setDiscussionWorkerMessage('答案不能为空，请先填写或重新生成。', 'warn');
        return;
      }
      state.answer = text;
      saveDiscussionState(state);
      await submitCurrentDiscussion();
    }

    async function submitCurrentDiscussion() {
      if (busy || stopped) return;
      if (state.topicId == null) {
        handleDiscussionWorkerError(new Error('缺少讨论主题 ID，请点“重新加载”再试'));
        return;
      }
      busy = true;
      setDiscussionPhase('submitting');
      try {
        await submitDiscussionComment(
          { topicId: state.topicId, toUser: state.toUser, classroomId: forumPage.classroomId },
          state.answer,
        );
      } catch (error) {
        busy = false;
        handleDiscussionWorkerError(error);
        return;
      }
      setDiscussionPhase('verifying');
      const ok = await verifyDiscussionCommented(forumPage.classroomId, item.leafId);
      busy = false;
      if (!ok) {
        handleDiscussionWorkerError(new Error('提交后未检测到发言状态，可能未提交成功，请重试或手动检查'));
        return;
      }
      finishDiscussionItem('已提交');
    }

    async function regenerateDiscussionAnswer() {
      if (busy || stopped) return;
      state.answer = '';
      saveDiscussionState(state);
      if (cleanText(state.question)) {
        await generateDiscussionAnswer();
      } else {
        await bootDiscussion();
      }
    }

    function skipDiscussionItem() {
      if (busy || stopped) return;
      finishDiscussionItem('已跳过', { skipped: true });
    }

    function finishDiscussionItem(message, options = {}) {
      if (stopped) return;
      const current = state.queue[state.index];
      if (current) {
        if (options.skipped) {
          current.skipped = true;
        } else {
          current.done = true;
          current.skipped = false;
          current.submittedAt = Date.now();
        }
      }

      state.phase = 'transitioning';
      state.status = 'transitioning';
      state.lastError = '';
      state.question = '';
      state.answer = '';
      state.topicId = null;
      state.toUser = null;

      const nextIndex = state.index + 1;
      if (nextIndex < state.queue.length) {
        state.index = nextIndex;
        state.currentLeafId = state.queue[nextIndex].leafId;
        state.heartbeatAt = Date.now();
        saveDiscussionState(state);
        updateDiscussionWorkerUi();
        setDiscussionWorkerMessage(`${message}，正在打开下一条：${state.queue[nextIndex].title}`, 'ok');
        setTimeout(() => {
          location.replace(withDiscussionWorkerHash(state.queue[nextIndex].url));
        }, 1600);
        return;
      }

      state.running = false;
      state.status = 'done';
      state.phase = 'idle';
      state.currentLeafId = null;
      state.heartbeatAt = Date.now();
      saveDiscussionState(state);
      stopped = true;
      updateDiscussionWorkerUi();
      setDiscussionWorkerMessage('讨论队列已完成：所有待发言讨论都已处理。', 'ok');
    }

    function bindDiscussionWorkerEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-discussion-worker-panel-collapsed');
          return;
        }
        if (action === 'submit') {
          await submitEditedAnswer();
          return;
        }
        if (action === 'regenerate') {
          await regenerateDiscussionAnswer();
          return;
        }
        if (action === 'skip') {
          skipDiscussionItem();
          return;
        }
        if (action === 'stop') {
          stopDiscussionQueue();
          return;
        }
        if (action === 'retry') {
          location.reload();
        }
      });
    }

    function setDiscussionPhase(phase) {
      state.phase = phase;
      if (state.status !== 'transitioning') state.status = 'running';
      state.heartbeatAt = Date.now();
      saveDiscussionState(state);
      updateDiscussionWorkerUi();
    }

    function startDiscussionHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (stopped) return;

        const fresh = loadDiscussionState(forumPage.classroomId);
        if (!fresh || !fresh.running) {
          stopDiscussionByExternalRequest();
          return;
        }

        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = state.heartbeatAt;
        state.currentLeafId = item.leafId;
        if (state.status !== 'error' && state.status !== 'transitioning') {
          state.status = 'running';
        }
        saveDiscussionState(state);
        updateDiscussionWorkerUi();
      }, HEARTBEAT_MS);
    }

    function startDiscussionUiTicker() {
      clearInterval(uiTimer);
      uiTimer = setInterval(updateDiscussionWorkerUi, 1000);
    }

    function stopDiscussionByExternalRequest() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveDiscussionState(state);
      updateDiscussionWorkerUi();
      setDiscussionWorkerMessage('讨论队列已被课程页停止。', 'warn');
    }

    function stopDiscussionQueue() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveDiscussionState(state);
      if (channel) {
        channel.postMessage({ type: 'state-changed', classroomId: forumPage.classroomId });
      }
      updateDiscussionWorkerUi();
      setDiscussionWorkerMessage('讨论队列已停止。回到课程页可以继续。', 'warn');
    }

    function handleDiscussionWorkerError(error) {
      if (stopped) return;
      state.status = 'error';
      state.running = true;
      state.phase = 'error';
      state.lastError = truncate(error && error.message ? error.message : error, 200);
      saveDiscussionState(state);
      updateDiscussionWorkerUi();
      setDiscussionWorkerMessage(`处理失败：${state.lastError}`, 'error');
    }

    function updateDiscussionWorkerUi() {
      const alive = state.running && !stopped;
      ui.refs.qpos.textContent = alive ? `第 ${state.index + 1} / ${state.queue.length} 条` : '讨论队列';
      ui.refs.title.textContent = item.title || item.label;

      let tone = 'active';
      let statusText = '运行中';
      if (state.status === 'error' || state.phase === 'error') {
        tone = 'error';
        statusText = '需要处理';
      } else if (stopped || !state.running) {
        tone = state.status === 'done' ? 'active' : 'idle';
        statusText = state.status === 'done' ? '队列完成' : '已停止';
      } else if (state.phase === 'transitioning') {
        tone = 'busy';
        statusText = '正在切换下一条';
      } else if (state.phase === 'fetching') {
        tone = 'busy';
        statusText = '正在读取题目';
      } else if (state.phase === 'generating') {
        tone = 'busy';
        statusText = 'AI 正在生成答案';
      } else if (state.phase === 'review') {
        tone = 'warn';
        statusText = '等待审核';
      } else if (state.phase === 'submitting') {
        tone = 'busy';
        statusText = '正在提交';
      } else if (state.phase === 'verifying') {
        tone = 'busy';
        statusText = '正在验证';
      }

      ui.refs.status.textContent = statusText;
      ui.refs.dot.className = `dot ${tone}`;

      ui.refs.question.textContent = state.question || '（正在读取题目…）';
      ui.refs.questionBox.hidden = !state.question && state.phase !== 'fetching';

      const showAnswer = ['review', 'submitting', 'verifying'].includes(state.phase)
        || (state.phase === 'error' && !!state.answer);
      ui.refs.answerRow.hidden = !showAnswer;
      const answerEl = ui.refs.answer;
      const locked = state.phase === 'submitting' || state.phase === 'verifying';
      if (document.activeElement !== answerEl && answerEl.value !== (state.answer || '')) {
        answerEl.value = state.answer || '';
      }
      answerEl.disabled = locked;
      answerEl.readOnly = locked;

      const isReview = state.phase === 'review' && alive;
      const canSubmit = alive && (state.phase === 'review' || (state.phase === 'error' && !!state.answer));
      ui.refs.submit.hidden = !canSubmit;
      ui.refs.submit.disabled = busy;
      ui.refs.regenerate.hidden = !(alive && (isReview || state.phase === 'error'));
      ui.refs.regenerate.disabled = busy;
      ui.refs.skip.hidden = !alive || state.phase === 'transitioning';
      ui.refs.skip.disabled = busy;
      ui.refs.stop.hidden = !alive;
      ui.refs.retry.hidden = !(state.status === 'error' || state.phase === 'error');
    }

    function setDiscussionWorkerMessage(text, tone = 'ok') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = text;
      box.className = `message ${tone}`;
      box.hidden = false;
      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 15000 : 8000);
    }
  }

  // ---------------------------------------------------------------------------
  // Homework queue (course page)
  // ---------------------------------------------------------------------------

  function initHomeworkCoursePage(coursePage) {
    let state = loadHomeworkState(coursePage.classroomId);
    let config = loadDiscussionConfig();
    let loading = false;
    let messageTimer = null;
    let lastListSignature = '';
    let workerWindow = null;

    const ui = createHomeworkCoursePanel();
    const channel = createHomeworkChannel();

    bindHomeworkCourseEvents();
    fillHomeworkConfigForm();
    renderHomeworkCourse();

    if (!state) {
      refreshHomeworkQueue({ automatic: true });
    } else if (state.running && Date.now() - Number(state.heartbeatAt || 0) > STALE_MS) {
      state.status = 'interrupted';
      saveHomeworkState(state);
      renderHomeworkCourse();
    }

    setInterval(() => {
      if (loading) return;
      const fresh = loadHomeworkState(coursePage.classroomId);
      const changed = (fresh && fresh.updatedAt) !== (state && state.updatedAt);
      if (changed) state = fresh;
      renderHomeworkCourse();
    }, 2000);

    window.addEventListener('storage', (event) => {
      if (event.key !== homeworkStorageKey(coursePage.classroomId)) return;
      const fresh = loadHomeworkState(coursePage.classroomId);
      if (fresh) {
        state = fresh;
        renderHomeworkCourse();
      }
    });

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== coursePage.classroomId) return;
        if (event.data.type === 'state-changed' || event.data.type === 'worker-ready') {
          const fresh = loadHomeworkState(coursePage.classroomId);
          if (fresh) state = fresh;
          renderHomeworkCourse();
        }
      };
    }

    function bindHomeworkCourseEvents() {
      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-homework-course-panel-collapsed');
          return;
        }
        if (action === 'refresh') {
          if (loading) return;
          if (state && state.running) {
            showHomeworkMessage('请先停止作业队列，再刷新课程作业。', 'warn');
            return;
          }
          await refreshHomeworkQueue({ manual: true });
          return;
        }
        if (action === 'primary') {
          await handleHomeworkPrimary();
          return;
        }
        if (action === 'stop') {
          handleHomeworkStop();
          return;
        }
        if (action === 'save-config') {
          saveHomeworkConfigFromForm();
          return;
        }
        if (action === 'fetch-models') {
          await handleFetchModels(ui, showHomeworkMessage);
          return;
        }
      });

      ui.refs.format.addEventListener('change', updateHomeworkFormatHint);
    }

    function fillHomeworkConfigForm() {
      ui.refs.homeworkMode.value = config.homeworkMode === 'text' ? 'text' : 'screenshot';
      ui.refs.format.value = config.format;
      ui.refs.apiUrl.value = config.apiUrl;
      ui.refs.apiKey.value = config.apiKey;
      ui.refs.model.value = config.model;
      ui.refs.extraHeaders.value = config.extraHeaders || '';
      ui.refs.stopOnWrong.checked = config.stopOnWrongAnswer !== false;
      ui.refs.doubleCheck.checked = config.homeworkDoubleCheck !== false;
      ui.refs.homeworkAuto.checked = config.homeworkAutoSubmit === true;
      updateHomeworkFormatHint();
    }

    function updateHomeworkFormatHint() {
      const hints = {
        openai: {
          url: 'https://api.deepseek.com/chat/completions',
          model: '例如 deepseek-chat',
          modelDisabled: false,
        },
        'openai-responses': {
          url: 'https://api.openai.com/v1/responses',
          model: '例如 gpt-5.1',
          modelDisabled: false,
        },
        anthropic: {
          url: 'https://api.anthropic.com/v1/messages',
          model: '例如 claude-sonnet-4-5',
          modelDisabled: false,
        },
        gemini: {
          url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          model: '模型写在地址中，可留空',
          modelDisabled: true,
        },
      };
      const hint = hints[ui.refs.format.value] || hints.openai;
      ui.refs.apiUrl.placeholder = hint.url;
      ui.refs.model.placeholder = hint.model;
      ui.refs.model.disabled = hint.modelDisabled;
    }

    function saveHomeworkConfigFromForm() {
      const current = loadDiscussionConfig();
      config = normalizeDiscussionConfig({
        ...current,
        homeworkMode: ui.refs.homeworkMode.value,
        format: ui.refs.format.value,
        apiUrl: ui.refs.apiUrl.value,
        apiKey: ui.refs.apiKey.value,
        model: ui.refs.model.value,
        extraHeaders: ui.refs.extraHeaders.value,
        stopOnWrongAnswer: ui.refs.stopOnWrong.checked,
        homeworkDoubleCheck: ui.refs.doubleCheck.checked,
        homeworkAutoSubmit: ui.refs.homeworkAuto.checked,
      });
      saveDiscussionConfig(config);
      showHomeworkMessage('AI 设置已保存（与讨论队列共用）。', 'ok');
    }

    function extractHomeworkLeaves(chapterData, classroomId) {
      const chapters = chapterData && chapterData.course_chapter;
      if (!Array.isArray(chapters)) throw new Error('课程结构数据结构异常');

      const items = [];
      const seen = new Set();

      const pushLeaf = (leaf, chapterId, chapterName) => {
        if (!leaf || Number(leaf.leaf_type) !== HOMEWORK_LEAF_TYPE) return;
        if (leaf.is_show === false) return;
        if (seen.has(leaf.id)) return;
        seen.add(leaf.id);

        const rawName = cleanText(leaf.name);
        const title = rawName || `作业 ${leaf.id}`;
        const label = chapterName && chapterName !== title ? `${chapterName} / ${title}` : title;
        const leafChapterId = Number(leaf.chapter_id || chapterId || 0);

        items.push({
          leafId: Number(leaf.id),
          chapterId: leafChapterId,
          title,
          label,
          chapterName,
          isLocked: leaf.is_locked === true,
          done: false,
          skipped: false,
          submittedAt: 0,
          totalProblems: 0,
          doneProblems: 0,
          url: homeworkPageUrl(classroomId, leaf.id, leafChapterId),
        });
      };

      for (const chapter of chapters) {
        const chapterId = Number(chapter.id);
        const chapterName = cleanText(chapter.name);
        const entries = Array.isArray(chapter.section_leaf_list) ? chapter.section_leaf_list : [];
        for (const entry of entries) {
          if (!entry) continue;
          if (Array.isArray(entry.leaf_list)) {
            for (const leaf of entry.leaf_list) pushLeaf(leaf, chapterId, chapterName);
          } else if (entry.leaf_type != null) {
            pushLeaf(entry, chapterId, chapterName);
          }
        }
      }

      return items;
    }

    async function buildHomeworkSnapshot() {
      const sign = await fetchCourseSign(coursePage);
      const chapterData = await fetchChapterData(coursePage.classroomId, sign);
      const leaves = extractHomeworkLeaves(chapterData, coursePage.classroomId);
      const schedules = await fetchHomeworkSchedule(coursePage.classroomId, sign);
      const enriched = leaves.map((item) => {
        const value = schedules[String(item.leafId)];
        const total = value && typeof value === 'object' ? Number(value.total) || 0 : 0;
        const done = value && typeof value === 'object' ? Number(value.done) || 0 : 0;
        return {
          ...item,
          totalProblems: total,
          doneProblems: done,
          done: total > 0 && done >= total,
        };
      });
      const completed = enriched.filter((item) => item.done).length;
      return {
        sign,
        total: enriched.length,
        completed,
        pending: enriched.filter((item) => isHomeworkPending(item) && !item.isLocked),
      };
    }

    async function refreshHomeworkQueue(options = {}) {
      if (loading) return;
      loading = true;
      renderHomeworkCourse();
      try {
        const snapshot = await buildHomeworkSnapshot();
        state = makeFreshHomeworkState(coursePage, snapshot.sign, snapshot);
        saveHomeworkState(state);
        if (options.manual) {
          showHomeworkMessage(`已读取课程作业：${snapshot.pending.length} 个待完成。`, 'ok');
        }
      } catch (error) {
        if (!state) {
          showHomeworkMessage(`读取失败：${truncate(error.message, 140)}`, 'error');
        } else if (options.manual) {
          showHomeworkMessage(`刷新失败：${truncate(error.message, 140)}`, 'error');
        }
      } finally {
        loading = false;
        renderHomeworkCourse();
      }
    }

    async function handleHomeworkPrimary() {
      if (loading) return;

      const item = state ? homeworkCurrentItem(state) : null;

      if (state && state.running && state.phase === 'review' && isHomeworkAlive(state)) {
        focusHomeworkWorker();
        return;
      }
      if (state && state.running && state.phase === 'attention' && isHomeworkAlive(state)) {
        focusHomeworkWorker();
        return;
      }
      if (state && state.running && state.phase === 'error' && isHomeworkAlive(state)) {
        focusHomeworkWorker();
        return;
      }
      if (state && state.running && isHomeworkAlive(state)) {
        showHomeworkMessage('作业队列正在运行，请在作业标签页中查看和审核。', 'ok');
        return;
      }
      if (state && ['stopped', 'error', 'interrupted'].includes(state.status) && item) {
        resumeHomeworkQueue(item);
        return;
      }
      if (state && state.running && !isHomeworkAlive(state) && item) {
        resumeHomeworkQueue(item);
        return;
      }
      if (state && state.status === 'idle' && state.queue.length && Date.now() - Number(state.createdAt || 0) < 5 * 60 * 1000) {
        resumeHomeworkQueue(item || state.queue[0]);
        return;
      }
      await startFreshHomeworkQueue();
    }

    function resumeHomeworkQueue(item) {
      if (!state || !item) return;
      state.running = true;
      state.status = 'running';
      state.userPaused = false;
      state.heartbeatAt = Date.now();
      state.workerHeartbeatAt = 0;
      state.lastError = '';
      if (state.phase !== 'review') state.phase = 'idle';
      saveHomeworkState(state);
      renderHomeworkCourse();

      workerWindow = openHomeworkWorker(withHomeworkWorkerHash(item.url));
      if (!workerWindow) showHomeworkPopupBlocked(item);
    }

    async function startFreshHomeworkQueue() {
      if (loading) return;
      const blank = openHomeworkWorker('about:blank');
      if (!blank) {
        showHomeworkMessage('浏览器拦截了新标签页。请允许本站弹窗后，再点一次“开始作业队列”。', 'error');
        return;
      }
      try { blank.resizeTo(1280, 800); } catch (_) {}

      loading = true;
      renderHomeworkCourse();
      try {
        const snapshot = await buildHomeworkSnapshot();
        state = makeFreshHomeworkState(coursePage, snapshot.sign, snapshot);

        if (!snapshot.pending.length) {
          state.status = 'done';
          state.completedHomeworks = snapshot.total;
          saveHomeworkState(state);
          try { blank.close(); } catch (_) {}
          showHomeworkMessage('所有作业都已完成，没有待处理队列。', 'ok');
          return;
        }

        state.running = true;
        state.status = 'running';
        state.phase = 'idle';
        state.startedAt = Date.now();
        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = 0;
        saveHomeworkState(state);
        renderHomeworkCourse();

        const first = snapshot.pending[0];
        try {
          blank.location.replace(withHomeworkWorkerHash(first.url));
          blank.focus();
        } catch (_) {
          try { blank.close(); } catch (_) {}
          state.running = false;
          state.status = 'error';
          state.lastError = '打开作业标签页失败';
          saveHomeworkState(state);
          renderHomeworkCourse();
          showHomeworkMessage('打开作业标签页失败，请重试。', 'error');
        }
      } catch (error) {
        try { blank.close(); } catch (_) {}
        showHomeworkMessage(`读取课程作业失败：${truncate(error.message, 140)}`, 'error');
      } finally {
        loading = false;
        renderHomeworkCourse();
      }
    }

    function openHomeworkWorker(url) {
      try {
        return window.open(url, HOMEWORK_WORKER_NAME);
      } catch (_) {
        return null;
      }
    }

    function focusHomeworkWorker() {
      if (workerWindow && !workerWindow.closed) {
        try {
          workerWindow.focus();
          return;
        } catch (_) {}
      }
      const item = state ? homeworkCurrentItem(state) : null;
      if (!item) return;
      workerWindow = openHomeworkWorker(withHomeworkWorkerHash(item.url));
      if (!workerWindow) showHomeworkPopupBlocked(item);
    }

    function showHomeworkPopupBlocked(item) {
      showHomeworkMessage(
        '浏览器拦截了新标签页。请允许本站弹窗后重试，或点击这里手动打开作业标签页。',
        'warn',
        withHomeworkWorkerHash(item.url),
      );
    }

    function handleHomeworkStop() {
      if (!state) return;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveHomeworkState(state);
      if (channel) {
        channel.postMessage({ type: 'stop', classroomId: coursePage.classroomId });
      }
      showHomeworkMessage('作业队列已停止。再次点击“继续作业”会从当前条恢复。', 'warn');
      renderHomeworkCourse();
    }

    function renderHomeworkCourse() {
      const pending = state ? state.queue.filter(isHomeworkPending).length : null;
      ui.refs.pending.textContent = pending == null ? '—' : String(pending);
      ui.refs.total.textContent = state ? String(state.totalHomeworks || 0) : '—';
      ui.refs.done.textContent = state ? String(homeworkDoneCount(state)) : '—';

      const item = state ? homeworkCurrentItem(state) : null;
      const alive = state ? isHomeworkAlive(state) : false;
      const status = getHomeworkCourseStatus(state, alive);
      ui.refs.status.textContent = status.text;
      ui.refs.dot.className = `dot ${status.tone}`;

      if (item && state && (state.running || ['stopped', 'error', 'interrupted'].includes(state.status))) {
        ui.refs.current.hidden = false;
        ui.refs.curTitle.textContent = item.label;
        const pieces = [`第 ${state.index + 1} / ${state.queue.length} 条`];
        if (state.phase === 'review') pieces.push('等待审核');
        else if (state.phase === 'generating') pieces.push('AI 生成中');
        else if (state.phase === 'fetching') pieces.push('读取题目中');
        else if (state.phase === 'submitting' || state.phase === 'verifying') pieces.push('提交中');
        else if (state.phase === 'error') pieces.push('需要处理');
        ui.refs.curMeta.textContent = pieces.join(' · ');
      } else {
        ui.refs.current.hidden = true;
      }

      const primary = ui.refs.primary;
      const refresh = ui.refs.refresh;
      const stop = ui.refs.stop;

      if (loading) {
        primary.textContent = '读取中…';
        primary.disabled = true;
      } else if (!state) {
        primary.textContent = '读取队列';
        primary.disabled = false;
      } else if (state.running && alive && state.phase === 'review') {
        primary.textContent = '去审核';
        primary.disabled = false;
      } else if (state.running && alive && state.phase === 'attention') {
        primary.textContent = '去处理';
        primary.disabled = false;
      } else if (state.running && alive && state.phase === 'error') {
        primary.textContent = '去处理';
        primary.disabled = false;
      } else if (state.running && alive) {
        primary.textContent = '队列运行中';
        primary.disabled = true;
      } else if (state.running && !alive && item) {
        primary.textContent = '重新打开作业页';
        primary.disabled = false;
      } else if (['stopped', 'error', 'interrupted'].includes(state.status) && item) {
        primary.textContent = '继续作业';
        primary.disabled = false;
      } else if (state.status === 'done') {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      } else if (state.queue.length) {
        primary.textContent = '开始作业队列';
        primary.disabled = false;
      } else {
        primary.textContent = '重新扫描';
        primary.disabled = false;
      }

      refresh.disabled = loading || !!(state && state.running);
      stop.hidden = !(state && (state.running || ['stopped', 'error', 'interrupted'].includes(state.status)));

      ui.refs.queueCount.textContent = state ? `(${state.queue.filter(isHomeworkPending).length})` : '';
      ui.refs.queueBox.hidden = !state || !state.queue.length;

      const listSignature = state
        ? `${state.index}|${state.currentLeafId}|${state.queue.map((q) => `${q.leafId}:${q.done ? 1 : 0}:${q.skipped ? 1 : 0}`).join(',')}`
        : 'empty';
      if (listSignature !== lastListSignature) {
        lastListSignature = listSignature;
        renderHomeworkQueueList();
      }
    }

    function renderHomeworkQueueList() {
      const list = ui.refs.queueList;
      list.textContent = '';
      if (!state) return;

      state.queue.forEach((item, index) => {
        const row = document.createElement('li');
        if (index === state.index || item.leafId === state.currentLeafId) row.classList.add('current');
        if (item.done) row.classList.add('done');
        if (item.skipped) row.classList.add('skipped');

        const indexEl = document.createElement('span');
        indexEl.className = 'idx';
        indexEl.textContent = String(index + 1);

        const textEl = document.createElement('span');
        textEl.className = 'itemText';
        const titleEl = document.createElement('span');
        titleEl.className = 'itemTitle';
        titleEl.textContent = item.title || item.label;
        const chapterEl = document.createElement('span');
        chapterEl.className = 'itemChapter';
        chapterEl.textContent = item.chapterName || '';
        textEl.append(titleEl, chapterEl);

        const progressEl = document.createElement('span');
        progressEl.className = 'itemProgress';
        const total = Number(item.totalProblems) || 0;
        const done = Number(item.doneProblems) || 0;
        progressEl.textContent = item.done ? '已完成' : (total ? `${done}/${total} 题` : '待完成');

        row.append(indexEl, textEl, progressEl);
        list.appendChild(row);
      });
    }

    function getHomeworkCourseStatus(currentState, alive) {
      if (loading) return { text: '正在读取课程作业…', tone: 'busy' };
      if (!currentState) return { text: '尚未读取课程作业', tone: 'idle' };

      if (currentState.status === 'error' || currentState.phase === 'error') {
        return { text: `需要处理：${truncate(currentState.lastError || '未知错误', 80)}`, tone: 'error' };
      }
      if (currentState.phase === 'attention') {
        return { text: '答案错误，等待人工确认（请在作业页点“继续下一条”）', tone: 'error' };
      }
      if (currentState.running && alive) {
        if (currentState.phase === 'fetching') return { text: '正在读取并解码作业题目…', tone: 'busy' };
        if (currentState.phase === 'generating') return { text: 'AI 正在作答…', tone: 'busy' };
        if (currentState.phase === 'review') return { text: '等待你在作业页核对答案（不会自动提交）', tone: 'warn' };
        if (currentState.phase === 'submitting') return { text: '正在提交答案…', tone: 'busy' };
        if (currentState.phase === 'verifying') return { text: '正在验证作业完成状态…', tone: 'busy' };
        if (currentState.phase === 'transitioning') return { text: '正在切换到下一条作业…', tone: 'busy' };
        return { text: '作业队列运行中', tone: 'active' };
      }
      if (currentState.running && !alive) {
        return { text: '作业标签页未连接（可能已关闭）', tone: 'warn' };
      }
      if (currentState.status === 'stopped') return { text: '作业队列已停止', tone: 'idle' };
      if (currentState.status === 'done') return { text: '作业队列完成', tone: 'active' };
      if (currentState.status === 'interrupted') return { text: '上次的作业标签页已断开', tone: 'warn' };
      if (currentState.userPaused) return { text: '已暂停', tone: 'warn' };
      return { text: '等待开始', tone: 'idle' };
    }

    function showHomeworkMessage(text, tone = 'ok', manualUrl = '') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = '';
      box.className = `message ${tone}`;
      box.hidden = false;

      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);

      if (manualUrl) {
        const link = document.createElement('a');
        link.href = manualUrl;
        link.target = HOMEWORK_WORKER_NAME;
        link.textContent = '手动打开';
        link.className = 'manualLink';
        box.appendChild(link);
        return;
      }

      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 12000 : 8000);
    }
  }

  function makeFreshHomeworkState(coursePage, courseSign, snapshot) {
    const now = Date.now();
    return {
      version: 1,
      classroomId: String(coursePage.classroomId),
      courseSign: courseSign || coursePage.courseSign || '',
      createdAt: now,
      updatedAt: now,
      queue: snapshot.pending,
      totalHomeworks: snapshot.total,
      baseCompleted: snapshot.completed,
      completedHomeworks: snapshot.completed,
      index: 0,
      running: false,
      status: 'idle',
      phase: 'idle',
      userPaused: false,
      currentLeafId: null,
      exerciseId: null,
      skuId: null,
      homeworkMode: 'screenshot',
      courseName: '',
      fontUrl: '',
      rawProblems: [],
      questions: [],
      pendingIndexes: [],
      answers: [],
      secondAnswers: [],
      rawAnswer: '',
      awaitingContinue: false,
      wrongAnswers: [],
      lastError: '',
      startedAt: 0,
      heartbeatAt: 0,
      workerHeartbeatAt: 0,
    };
  }

  function homeworkCurrentItem(state) {
    if (!state || !state.queue.length) return null;
    if (state.currentLeafId != null) {
      const byId = state.queue.find((item) => Number(item.leafId) === Number(state.currentLeafId));
      if (byId) return byId;
    }
    return state.queue[state.index] || null;
  }

  function isHomeworkAlive(state) {
    return !!state && state.running && Date.now() - Number(state.heartbeatAt || 0) < STALE_MS;
  }

  // ---------------------------------------------------------------------------
  // Homework worker page
  // ---------------------------------------------------------------------------

  function initHomeworkWorkerPage(exercisePage) {
    try { sessionStorage.setItem(HOMEWORK_WORKER_SESSION_KEY, '1'); } catch (_) {}
    try { window.resizeTo(1280, 800); } catch (_) {}

    let state = loadHomeworkState(exercisePage.classroomId);
    if (!state || !state.running || !state.queue.length) return;

    if (state.index >= state.queue.length) {
      state.running = false;
      state.status = 'done';
      saveHomeworkState(state);
      return;
    }

    let item = state.queue[state.index];

    let stopped = false;
    let busy = false;
    let confirmPending = false;
    let confirmTimer = null;
    let heartbeatTimer = null;
    let uiTimer = null;
    let messageTimer = null;
    let questionImage = '';

    const ui = createHomeworkWorkerPanel();
    const channel = createHomeworkChannel();

    state.currentLeafId = item.leafId;
    state.status = 'running';
    state.heartbeatAt = Date.now();
    state.workerHeartbeatAt = Date.now();
    saveHomeworkState(state);
    updateHomeworkWorkerUi();

    bindHomeworkWorkerEvents();
    startHomeworkHeartbeat();
    startHomeworkUiTicker();
    bootHomework();

    if (channel) {
      channel.onmessage = (event) => {
        if (!event.data || event.data.classroomId !== exercisePage.classroomId) return;
        if (event.data.type === 'stop') stopHomeworkByExternalRequest();
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== homeworkStorageKey(exercisePage.classroomId)) return;
      const fresh = loadHomeworkState(exercisePage.classroomId);
      if (fresh && !fresh.running && state.running && !stopped) {
        stopHomeworkByExternalRequest();
      }
    });

    window.addEventListener('beforeunload', () => {
      clearInterval(heartbeatTimer);
      clearInterval(uiTimer);
      clearTimeout(confirmTimer);
    });

    async function bootHomework() {
      const config = loadDiscussionConfig();
      const mode = config.homeworkMode === 'text' ? 'text' : 'screenshot';
      try {
        if (await safeHomeworkComplete()) {
          finishHomeworkItem('该作业此前已完成，自动跳过');
          return;
        }

        if (state.homeworkMode && state.homeworkMode !== mode) {
          clearHomeworkData();
          state.phase = 'idle';
          saveHomeworkState(state);
        }
        state.homeworkMode = mode;

        if (state.phase === 'review' && Array.isArray(state.questions) && state.questions.length) {
          if (mode === 'screenshot') {
            try {
              await ensureHomeworkImage();
            } catch (_) {
              clearHomeworkData();
              state.phase = 'idle';
              saveHomeworkState(state);
            }
          }
          if (Array.isArray(state.questions) && state.questions.length) {
            renderHomeworkReview();
            return;
          }
        }

        setHomeworkPhase('fetching');
        if (!Array.isArray(state.questions) || !state.questions.length) {
          const leaf = await fetchLeafInfoData(exercisePage.classroomId, item.leafId);
          const contentInfo = leaf.content_info || {};
          const exerciseId = Number(contentInfo.leaf_type_id);
          const skuId = Number(leaf.sku_id);
          if (!exerciseId) throw new Error('未找到作业内容 ID');
          const data = await fetchExerciseData(exercisePage.classroomId, exerciseId, skuId);
          if (!Array.isArray(data.problems) || !data.problems.length) throw new Error('作业题目为空');
          state.exerciseId = exerciseId;
          state.skuId = skuId;
          state.fontUrl = data.font || '';
          state.rawProblems = data.problems;
          if (mode === 'screenshot') {
            state.questions = data.problems.map((problem, index) => ({
              index,
              problemId: Number(problem.problem_id),
              type: Number(problem.content && problem.content.ProblemType),
              typeText: cleanText(problem.content && problem.content.TypeText) || '题目',
              answered: !!(problem.user && Number(problem.user.my_count) > 0),
              userAnswer: problem.user && Array.isArray(problem.user.my_answer)
                ? problem.user.my_answer.join('') : '',
            }));
          } else {
            state.questions = await decodeExerciseQuestions(data.problems, data.font);
          }
          saveHomeworkState(state);
          updateHomeworkWorkerUi();
        }

        if (mode === 'screenshot') await ensureHomeworkImage();
        await generateHomeworkAnswers();
      } catch (error) {
        handleHomeworkWorkerError(error);
      }
    }

    function clearHomeworkData() {
      state.questions = [];
      state.pendingIndexes = [];
      state.answers = [];
      state.rawAnswer = '';
      state.rawProblems = [];
      state.fontUrl = '';
      questionImage = '';
    }

    async function ensureHomeworkImage() {
      if (questionImage) return questionImage;
      const indexes = Array.isArray(state.pendingIndexes) && state.pendingIndexes.length
        ? state.pendingIndexes
        : (state.questions || []).filter((question) => !question.answered).map((question) => question.index);
      const problems = indexes.map((index) => (state.rawProblems || [])[index]).filter(Boolean);
      if (!problems.length) throw new Error('题目截图数据缺失，请点“重新加载”');
      questionImage = await renderHomeworkImage(problems, state.fontUrl);
      return questionImage;
    }

    async function safeHomeworkComplete() {
      try {
        const schedules = await fetchHomeworkSchedule(
          exercisePage.classroomId,
          state.courseSign || exercisePage.courseSign || '',
        );
        const value = schedules[String(item.leafId)];
        return !!(value && typeof value === 'object' && Number(value.total) > 0
          && Number(value.done) >= Number(value.total));
      } catch (_) {
        return false;
      }
    }

    async function generateHomeworkAnswers() {
      const pending = (state.questions || []).filter((question) => !question.answered);
      if (!pending.length) {
        finishHomeworkItem('作业已全部作答');
        return;
      }
      state.pendingIndexes = pending.map((question) => question.index);

      setHomeworkPhase('generating');
      const config = loadDiscussionConfig();
      try {
        if (!state.courseName) {
          state.courseName = await fetchCourseName(exercisePage.classroomId);
          if (state.courseName) saveHomeworkState(state);
        }
        const context = {
          courseName: state.courseName || '',
          chapterName: item.chapterName || '',
        };
        const prompt = state.homeworkMode === 'screenshot'
          ? buildHomeworkScreenshotPrompt(pending.length, context)
          : buildHomeworkPrompt(pending, context);
        const image = state.homeworkMode === 'screenshot'
          ? (questionImage || await ensureHomeworkImage())
          : null;

        const firstRaw = await callAIWithPrompt(config, prompt, image);
        if (stopped) return;
        const first = parseHomeworkAnswers(firstRaw, pending.length);
        state.rawAnswer = String(firstRaw || '').slice(0, 4000);
        if (!first) {
          state.answers = pending.map(() => '');
          state.secondAnswers = [];
          saveHomeworkState(state);
          renderHomeworkReview();
          setHomeworkWorkerMessage(
            state.homeworkMode === 'screenshot'
              ? 'AI 未返回可解析的 JSON，请对照上方截图手动填写答案，核对后再提交。'
              : 'AI 未返回可解析的 JSON，请在题目下方手动填写答案，核对后再提交。',
            'warn',
          );
          return;
        }

        let second = [];
        let secondRaw = '';
        let consistent = true;
        if (config.homeworkDoubleCheck !== false) {
          try {
            secondRaw = await callAIWithPrompt(config, prompt, image);
            second = parseHomeworkAnswers(secondRaw, pending.length) || [];
          } catch (_) {
            second = [];
            secondRaw = '';
          }
          if (stopped) return;
          if (!second.length || !sameHomeworkAnswers(first, second)) {
            consistent = false;
          }
        }

        state.answers = first;
        state.secondAnswers = second;
        if (secondRaw) {
          state.rawAnswer = `${state.rawAnswer}\n\n[第二次]\n${String(secondRaw).slice(0, 2000)}`;
        }
        saveHomeworkState(state);
        renderHomeworkReview();

        if (!consistent) {
          const detail = first
            .map((answer, index) => `第${index + 1}题 第一次 ${answer || '?'} / 第二次 ${second[index] || '?'}`)
            .join('；');
          setHomeworkWorkerMessage(
            `两次作答不一致：${detail}。已停下，请人工核对后手动提交。`,
            'warn',
          );
          return;
        }

        if (config.homeworkAutoSubmit === true) {
          await submitHomeworkAnswers();
        }
      } catch (error) {
        handleHomeworkWorkerError(error);
      }
    }

    function renderHomeworkReview() {
      setHomeworkPhase('review');
      ui.refs.questions.textContent = '';
      renderHomeworkQuestions();
      updateHomeworkWorkerUi();
    }

    function renderHomeworkQuestions() {
      const box = ui.refs.questions;
      box.textContent = '';
      if (!state.questions || !state.questions.length) return;

      const indexes = Array.isArray(state.pendingIndexes) && state.pendingIndexes.length
        ? state.pendingIndexes
        : state.questions.map((question) => question.index);

      indexes.forEach((questionIndex, position) => {
        const question = state.questions[questionIndex];
        if (!question) return;

        const card = document.createElement('div');
        card.className = 'hwQuestion';

        const title = document.createElement('div');
        title.className = 'hwQTitle';
        title.textContent = `第 ${position + 1} 题 · ${question.typeText}`;
        card.appendChild(title);

        if (state.homeworkMode !== 'screenshot') {
          const body = document.createElement('div');
          body.className = 'hwQBody';
          body.textContent = question.body || '（题目解码为空）';
          card.appendChild(body);

          if (question.options.length) {
            const options = document.createElement('div');
            options.className = 'hwOptions';
            question.options.forEach((option) => {
              const line = document.createElement('div');
              line.className = 'hwOption';
              line.textContent = `${option.key}. ${option.text}`;
              options.appendChild(line);
            });
            card.appendChild(options);
          }
        }

        const answerRow = document.createElement('div');
        answerRow.className = 'hwAnswerRow';
        const label = document.createElement('span');
        label.textContent = 'AI 答案';
        const input = document.createElement('input');
        input.className = 'hwAnswerInput';
        input.setAttribute('data-hw-answer', String(position));
        input.setAttribute('maxlength', '8');
        input.value = cleanText(state.answers[position]).toUpperCase();
        const hint = document.createElement('span');
        hint.textContent = '（可修改）';
        answerRow.append(label, input, hint);
        card.appendChild(answerRow);

        const secondAnswer = state.secondAnswers && state.secondAnswers[position];
        if (secondAnswer) {
          const secondNote = document.createElement('div');
          secondNote.className = 'hwSecondNote';
          const first = cleanText(state.answers[position]).toUpperCase();
          const second = cleanText(secondAnswer).toUpperCase();
          secondNote.textContent = `第二次作答：${second || '?'}${first !== second ? '（两次不一致）' : ''}`;
          card.appendChild(secondNote);
        }

        if (question.answered) {
          const note = document.createElement('div');
          note.className = 'hwAnsweredNote';
          note.textContent = `平台已有作答：${question.userAnswer || '已作答'}，本条不会重复提交。`;
          card.appendChild(note);
        }

        box.appendChild(card);
      });
    }

    async function submitHomeworkAnswers() {
      if (busy || stopped) return;
      if (!Array.isArray(state.pendingIndexes) || !state.pendingIndexes.length) {
        setHomeworkWorkerMessage('没有可提交的题目。', 'warn');
        return;
      }

      const inputs = [...ui.refs.questions.querySelectorAll('[data-hw-answer]')];
      const values = inputs.map((input) => cleanText(input.value).toUpperCase().replace(/[^A-Z]/g, ''));
      for (let i = 0; i < values.length; i += 1) {
        if (!values[i]) {
          setHomeworkWorkerMessage(`第 ${i + 1} 题的答案为空，请先填写。`, 'warn');
          return;
        }
      }

      busy = true;
      let confirmed = false;
      setHomeworkPhase('submitting');
      const errors = [];
      const wrong = [];
      for (let i = 0; i < state.pendingIndexes.length; i += 1) {
        const question = state.questions[state.pendingIndexes[i]];
        if (!question) continue;
        if (question.answered) continue;
        try {
          const response = await applyHomeworkProblem(
            exercisePage.classroomId,
            { ...question, index: i },
            values[i],
          );
          const result = response && response.data ? response.data : {};
          const correct = result.is_correct !== undefined ? result.is_correct : result.is_right;
          if (correct === false) {
            let correctAnswer = result.answer;
            if (Array.isArray(correctAnswer)) correctAnswer = correctAnswer.join('');
            wrong.push({
              position: i + 1,
              answer: values[i],
              correct: cleanText(correctAnswer),
            });
          }
          question.answered = true;
          question.userAnswer = values[i];
          state.answers[i] = values[i];
          saveHomeworkState(state);
          confirmed = true;
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          if (/chance to answer/i.test(message)) {
            question.answered = true;
            question.userAnswer = question.userAnswer || values[i];
            state.answers[i] = values[i];
            saveHomeworkState(state);
            confirmed = true;
            continue;
          }
          errors.push(message);
        }
      }
      busy = false;

      if (errors.length) {
        const done = await verifyHomeworkDone(
          exercisePage.classroomId,
          state.courseSign || exercisePage.courseSign || '',
          item.leafId,
        );
        if (done) {
          setHomeworkWorkerMessage(
            `部分题目提交时提示：${errors.join('；')}；但作业已完成，继续下一条。`,
            'warn',
          );
          finishHomeworkItem('已提交');
          return;
        }
        handleHomeworkWorkerError(new Error(errors.join('；')));
        return;
      }
      if (!confirmed) {
        handleHomeworkWorkerError(new Error('没有提交任何题目'));
        return;
      }

      const config = loadDiscussionConfig();
      if (wrong.length && config.stopOnWrongAnswer !== false) {
        state.awaitingContinue = true;
        state.wrongAnswers = wrong;
        state.status = 'attention';
        state.phase = 'attention';
        saveHomeworkState(state);
        updateHomeworkWorkerUi();
        const detail = wrong
          .map((entry) => `第 ${entry.position} 题（你答 ${entry.answer}${entry.correct ? `，正确答案 ${entry.correct}` : ''}）`)
          .join('；');
        setHomeworkWorkerMessage(
          `检测到答案错误：${detail}。已暂停，请人工确认后点“继续下一条”。`,
          'error',
        );
        return;
      }
      if (wrong.length) {
        setHomeworkWorkerMessage('检测到答案错误，但“答案错误时暂停”已关闭，继续下一条。', 'warn');
      }

      setHomeworkPhase('verifying');
      const ok = await verifyHomeworkDone(
        exercisePage.classroomId,
        state.courseSign || exercisePage.courseSign || '',
        item.leafId,
      );
      if (!ok) {
        handleHomeworkWorkerError(new Error('提交后未检测到作业完成状态，请手动检查'));
        return;
      }
      finishHomeworkItem('已提交');
    }

    async function regenerateHomeworkAnswers() {
      if (busy || stopped) return;
      state.answers = [];
      state.secondAnswers = [];
      state.rawAnswer = '';
      saveHomeworkState(state);
      await generateHomeworkAnswers();
    }

    function skipHomeworkItem() {
      if (busy || stopped) return;
      finishHomeworkItem('已跳过', { skipped: true });
    }

    function finishHomeworkItem(message, options = {}) {
      if (stopped) return;
      const current = state.queue[state.index];
      if (current) {
        if (options.skipped) {
          current.skipped = true;
        } else {
          current.done = true;
          current.skipped = false;
          current.submittedAt = Date.now();
        }
      }

      state.phase = 'transitioning';
      state.status = 'transitioning';
      state.lastError = '';
      state.awaitingContinue = false;
      state.wrongAnswers = [];
      state.questions = [];
      state.pendingIndexes = [];
      state.answers = [];
      state.secondAnswers = [];
      state.rawAnswer = '';
      state.exerciseId = null;
      state.skuId = null;
      state.fontUrl = '';
      state.rawProblems = [];
      questionImage = '';

      const nextIndex = state.index + 1;
      if (nextIndex < state.queue.length) {
        const next = state.queue[nextIndex];
        state.index = nextIndex;
        state.currentLeafId = next.leafId;
        state.phase = 'idle';
        state.status = 'running';
        state.heartbeatAt = Date.now();
        saveHomeworkState(state);
        updateHomeworkWorkerUi();
        setHomeworkWorkerMessage(`${message}，正在处理下一条：${next.title}`, 'ok');
        setTimeout(() => {
          if (stopped) return;
          item = next;
          bootHomework();
        }, 1200);
        return;
      }

      state.running = false;
      state.status = 'done';
      state.phase = 'idle';
      state.currentLeafId = null;
      state.heartbeatAt = Date.now();
      saveHomeworkState(state);
      stopped = true;
      updateHomeworkWorkerUi();
      setHomeworkWorkerMessage('作业队列已完成：所有待完成作业都已处理。', 'ok');
    }

    function bindHomeworkWorkerEvents() {
      ui.refs.questions.addEventListener('input', (event) => {
        const input = event.target.closest('[data-hw-answer]');
        if (!input) return;
        const position = Number(input.getAttribute('data-hw-answer'));
        if (Number.isFinite(position)) {
          state.answers[position] = input.value;
        }
      });

      ui.shadow.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-act]');
        if (!button) return;
        const action = button.getAttribute('data-act');

        if (action === 'collapse') {
          toggleCollapse(ui, 'ykt-homework-worker-panel-collapsed');
          return;
        }
        if (action === 'submit') {
          if (state.phase !== 'review' || busy || stopped) return;
          if (!confirmPending) {
            confirmPending = true;
            ui.refs.submit.textContent = '再次点击确认提交';
            setHomeworkWorkerMessage('请先逐题核对题目和答案，再次点击“确认提交”才会真正提交。', 'warn');
            clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => {
              confirmPending = false;
              ui.refs.submit.textContent = '提交作业';
            }, 5000);
            return;
          }
          confirmPending = false;
          clearTimeout(confirmTimer);
          await submitHomeworkAnswers();
          return;
        }
        if (action === 'regenerate') {
          await regenerateHomeworkAnswers();
          return;
        }
        if (action === 'skip') {
          skipHomeworkItem();
          return;
        }
        if (action === 'continue') {
          if (!state.awaitingContinue) return;
          state.awaitingContinue = false;
          state.wrongAnswers = [];
          finishHomeworkItem('人工确认继续');
          return;
        }
        if (action === 'stop') {
          stopHomeworkQueue();
          return;
        }
        if (action === 'retry') {
          location.reload();
        }
      });
    }

    function setHomeworkPhase(phase) {
      state.phase = phase;
      if (state.status !== 'transitioning') state.status = 'running';
      state.heartbeatAt = Date.now();
      saveHomeworkState(state);
      updateHomeworkWorkerUi();
    }

    function startHomeworkHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (stopped) return;

        const fresh = loadHomeworkState(exercisePage.classroomId);
        if (!fresh || !fresh.running) {
          stopHomeworkByExternalRequest();
          return;
        }

        state.heartbeatAt = Date.now();
        state.workerHeartbeatAt = state.heartbeatAt;
        state.currentLeafId = item.leafId;
        if (state.status !== 'error' && state.status !== 'transitioning' && state.status !== 'attention') {
          state.status = 'running';
        }
        saveHomeworkState(state);
        updateHomeworkWorkerUi();
      }, HEARTBEAT_MS);
    }

    function startHomeworkUiTicker() {
      clearInterval(uiTimer);
      uiTimer = setInterval(updateHomeworkWorkerUi, 1000);
    }

    function stopHomeworkByExternalRequest() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveHomeworkState(state);
      updateHomeworkWorkerUi();
      setHomeworkWorkerMessage('作业队列已被课程页停止。', 'warn');
    }

    function stopHomeworkQueue() {
      if (stopped) return;
      stopped = true;
      state.running = false;
      state.status = 'stopped';
      state.userPaused = true;
      if (state.phase === 'error') state.phase = 'idle';
      saveHomeworkState(state);
      if (channel) {
        channel.postMessage({ type: 'state-changed', classroomId: exercisePage.classroomId });
      }
      updateHomeworkWorkerUi();
      setHomeworkWorkerMessage('作业队列已停止。回到课程页可以继续。', 'warn');
    }

    function handleHomeworkWorkerError(error) {
      if (stopped) return;
      state.status = 'error';
      state.running = true;
      state.phase = 'error';
      state.lastError = truncate(error && error.message ? error.message : error, 240);
      saveHomeworkState(state);
      updateHomeworkWorkerUi();
      setHomeworkWorkerMessage(`处理失败：${state.lastError}`, 'error');
    }

    function updateHomeworkWorkerUi() {
      const alive = state.running && !stopped;
      ui.refs.qpos.textContent = alive ? `第 ${state.index + 1} / ${state.queue.length} 条` : '作业队列';
      ui.refs.title.textContent = item.title || item.label;

      let tone = 'active';
      let statusText = '运行中';
      if (state.status === 'error' || state.phase === 'error') {
        tone = 'error';
        statusText = '需要处理';
      } else if (stopped || !state.running) {
        tone = state.status === 'done' ? 'active' : 'idle';
        statusText = state.status === 'done' ? '队列完成' : '已停止';
      } else if (state.phase === 'attention') {
        tone = 'error';
        statusText = '答案错误，等待人工确认';
      } else if (state.phase === 'transitioning') {
        tone = 'busy';
        statusText = '正在切换下一条';
      } else if (state.phase === 'fetching') {
        tone = 'busy';
        statusText = '正在读取并解码题目';
      } else if (state.phase === 'generating') {
        tone = 'busy';
        statusText = 'AI 正在作答';
      } else if (state.phase === 'review') {
        tone = 'warn';
        statusText = '等待审核（不会自动提交）';
      } else if (state.phase === 'submitting') {
        tone = 'busy';
        statusText = '正在提交';
      } else if (state.phase === 'verifying') {
        tone = 'busy';
        statusText = '正在验证';
      }

      ui.refs.status.textContent = statusText;
      ui.refs.dot.className = `dot ${tone}`;

      const showReview = ['review', 'submitting', 'verifying', 'attention'].includes(state.phase)
        || (state.phase === 'error' && Array.isArray(state.questions) && state.questions.length);
      ui.refs.review.hidden = !showReview;
      ui.refs.shot.hidden = !questionImage;
      if (questionImage && ui.refs.shot.getAttribute('src') !== questionImage) {
        ui.refs.shot.src = questionImage;
      }
      if (showReview && !ui.refs.questions.childNodes.length) {
        renderHomeworkQuestions();
      }

      const isReview = state.phase === 'review' && alive;
      const canSubmit = alive && (state.phase === 'review' || (state.phase === 'error' && state.questions.length));
      ui.refs.submit.hidden = !canSubmit;
      ui.refs.submit.disabled = busy;
      if (!confirmPending) ui.refs.submit.textContent = '提交作业';
      ui.refs.continueBtn.hidden = !state.awaitingContinue;
      ui.refs.regenerate.hidden = !(alive && (isReview || state.phase === 'error'));
      ui.refs.regenerate.disabled = busy;
      ui.refs.skip.hidden = !alive || state.phase === 'transitioning';
      ui.refs.skip.disabled = busy;
      ui.refs.stop.hidden = !alive;
      ui.refs.retry.hidden = !(state.status === 'error' || state.phase === 'error');

      if (showReview) {
        const inputs = [...ui.refs.questions.querySelectorAll('[data-hw-answer]')];
        inputs.forEach((input, index) => {
          if (document.activeElement !== input && !busy) {
            const value = cleanText(state.answers[index]).toUpperCase();
            if (input.value !== value) input.value = value;
          }
        });
      }
    }

    function setHomeworkWorkerMessage(text, tone = 'ok') {
      if (messageTimer) clearTimeout(messageTimer);
      const box = ui.refs.message;
      box.textContent = text;
      box.className = `message ${tone}`;
      box.hidden = false;
      messageTimer = setTimeout(() => {
        if (!box.hidden) box.hidden = true;
      }, tone === 'error' ? 15000 : 8000);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function createCoursePanel() {
    const host = document.createElement('div');
    host.id = 'ykt-video-queue-course-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(344px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo">YT</span><span>雨课堂视频队列</span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="summary">
            <div><b data-ref="pending">—</b><span>待看</span></div>
            <div><b data-ref="total">—</b><span>总计</span></div>
            <div><b data-ref="done">—</b><span>已完成</span></div>
          </div>
          <div class="speedRow">
            <span>倍速</span>
            <b class="speedFixed">2.00×</b>
            <small>平台上限，超过会被回滚</small>
          </div>
          <div class="estimate" title="按所选目标倍速、当前进度和每条约 6 秒切换时间估算；未返回时长的视频按平均值估算；不含暂停、缓冲和网络等待">
            <span>预计剩余</span>
            <b data-ref="estimate">计算中…</b>
            <small data-ref="estimateHint">2× · 含切换</small>
          </div>
          <div class="statusline"><span class="dot idle" data-ref="dot"></span><span data-ref="status">正在初始化…</span></div>
          <div class="current" data-ref="current" hidden>
            <div class="currentTitle" data-ref="curTitle"></div>
            <div class="track"><div class="fill" data-ref="curFill"></div></div>
            <div class="meta" data-ref="curMeta"></div>
          </div>
          <div class="actions">
            <button class="primary" data-act="primary" data-ref="primary">读取队列</button>
            <button data-act="refresh" data-ref="refresh">刷新</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <details class="queueBox" data-ref="queueBox" hidden>
            <summary>待看队列 <span data-ref="queueCount"></span></summary>
            <ol class="queueList" data-ref="queueList"></ol>
          </details>
          <div class="hint">会固定在一个新标签页中逐条播放；请保持该标签页前台并聚焦。站点失焦会暂停，脚本不会绕过防挂机检查。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-course-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createWorkerPanel() {
    const host = document.createElement('div');
    host.id = 'ykt-video-queue-worker-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(340px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo accent" data-ref="speedLogo">2.0×</span><span>队列观看中</span><span class="qpos" data-ref="qpos"></span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="statusline"><span class="dot active" data-ref="dot"></span><span data-ref="status">准备播放…</span></div>
          <div class="videoTitle" data-ref="title"></div>
          <div class="track"><div class="fill" data-ref="fill"></div></div>
          <div class="timerow"><span data-ref="time"></span><span data-ref="pct"></span></div>
          <div class="meta" data-ref="meta"></div>
          <div class="actions">
            <button class="primary" data-act="pause" data-ref="pause">暂停</button>
            <button class="danger" data-act="stop" data-ref="stop">停止队列</button>
            <button data-act="retry" data-ref="retry" hidden>重新加载</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <div class="hint">保持本标签页前台并聚焦；失焦会暂停，播放结束后自动进入下一条。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-worker-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createDiscussionCoursePanel() {
    const host = document.createElement('div');
    host.id = 'ykt-discussion-queue-course-host';
    host.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:2147483647;width:min(352px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo discuss">论</span><span>雨课堂讨论队列</span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="summary">
            <div><b data-ref="pending">—</b><span>待发言</span></div>
            <div><b data-ref="total">—</b><span>讨论</span></div>
            <div><b data-ref="done">—</b><span>已发言</span></div>
          </div>
          <div class="statusline"><span class="dot idle" data-ref="dot"></span><span data-ref="status">正在初始化…</span></div>
          <div class="current" data-ref="current" hidden>
            <div class="currentTitle" data-ref="curTitle"></div>
            <div class="meta" data-ref="curMeta"></div>
          </div>
          <div class="actions">
            <button class="primary" data-act="primary" data-ref="primary">读取队列</button>
            <button data-act="refresh" data-ref="refresh">刷新</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <details class="queueBox" data-ref="queueBox" hidden>
            <summary>待发言队列 <span data-ref="queueCount"></span></summary>
            <ol class="queueList" data-ref="queueList"></ol>
          </details>
          <details class="configBox" data-ref="configBox">
            <summary>AI 设置</summary>
            <div class="configGrid">
              <label><span>接口格式</span>
                <select data-ref="format">
                  <option value="openai">OpenAI 兼容</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label><span>请求地址</span><input type="text" data-ref="apiUrl" placeholder="https://api.deepseek.com/chat/completions" spellcheck="false"></label>
              <label><span>API Key</span><input type="password" data-ref="apiKey" placeholder="sk-..." spellcheck="false"></label>
              <label><span>模型</span>
                <span class="modelRow">
                  <input type="text" data-ref="model" list="ykt-model-list-discussion" placeholder="deepseek-chat" spellcheck="false">
                  <button class="miniBtn" type="button" data-act="fetch-models" data-ref="fetchModels">获取模型</button>
                </span>
                <datalist id="ykt-model-list-discussion" data-ref="modelList"></datalist>
              </label>
              <label><span>额外请求头（JSON，可选）</span><textarea data-ref="extraHeaders" rows="2" spellcheck="false" placeholder='{"x-opencode-session":"ykt-session"}'></textarea></label>
              <label class="checkRow"><input type="checkbox" data-ref="autoSubmit"><span>自动提交（关闭时先生成答案，等你审核后再提交）</span></label>
              <label><span>提示词模板</span><textarea data-ref="prompt" rows="4" spellcheck="false"></textarea></label>
              <button class="primary" data-act="save-config" data-ref="saveConfig">保存设置</button>
            </div>
          </details>
          <div class="hint">默认由脚本自动提交 AI 答案（无需任何点击）；取消勾选“自动提交”后会停在讨论页等你审核。API Key 只保存在本机浏览器，请求直接发往你填写的接口。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-discussion-course-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createDiscussionWorkerPanel() {
    const host = document.createElement('div');
    host.id = 'ykt-discussion-queue-worker-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(352px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo discuss">论</span><span>讨论队列</span><span class="qpos" data-ref="qpos"></span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="statusline"><span class="dot active" data-ref="dot"></span><span data-ref="status">准备中…</span></div>
          <div class="videoTitle" data-ref="title"></div>
          <div class="questionBox" data-ref="questionBox" hidden>
            <div class="boxLabel">题目</div>
            <div class="questionText" data-ref="question"></div>
          </div>
          <div class="answerRow" data-ref="answerRow" hidden>
            <div class="boxLabel">AI 答案（可直接修改）</div>
            <textarea class="answerInput" data-ref="answer" rows="5" spellcheck="false"></textarea>
          </div>
          <div class="actions">
            <button class="primary" data-act="submit" data-ref="submit" hidden>提交答案</button>
            <button data-act="regenerate" data-ref="regenerate" hidden>重新生成</button>
            <button data-act="skip" data-ref="skip" hidden>跳过</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止队列</button>
            <button data-act="retry" data-ref="retry" hidden>重新加载</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <div class="hint">请先审核题目与答案，确认无误后再点“提交答案”。提交会直接以你的账号在讨论区发言。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-discussion-worker-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createHomeworkCoursePanel() {
    const host = document.createElement('div');
    host.id = 'ykt-homework-queue-course-host';
    host.style.cssText = 'position:fixed;left:18px;top:18px;z-index:2147483647;width:min(352px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo homework">作</span><span>雨课堂作业队列</span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="summary">
            <div><b data-ref="pending">—</b><span>待做</span></div>
            <div><b data-ref="total">—</b><span>作业</span></div>
            <div><b data-ref="done">—</b><span>已完成</span></div>
          </div>
          <div class="statusline"><span class="dot idle" data-ref="dot"></span><span data-ref="status">正在初始化…</span></div>
          <div class="current" data-ref="current" hidden>
            <div class="currentTitle" data-ref="curTitle"></div>
            <div class="meta" data-ref="curMeta"></div>
          </div>
          <div class="actions">
            <button class="primary" data-act="primary" data-ref="primary">读取队列</button>
            <button data-act="refresh" data-ref="refresh">刷新</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <details class="queueBox" data-ref="queueBox" hidden>
            <summary>待做作业 <span data-ref="queueCount"></span></summary>
            <ol class="queueList" data-ref="queueList"></ol>
          </details>
          <details class="configBox" data-ref="configBox">
            <summary>AI 设置（与讨论队列共用）</summary>
            <div class="configGrid">
              <label><span>答题方式</span>
                <select data-ref="homeworkMode">
                  <option value="screenshot">题目截图 + 视觉模型（推荐）</option>
                  <option value="text">本地解码 + 文本模型</option>
                </select>
              </label>
              <label><span>接口格式</span>
                <select data-ref="format">
                  <option value="openai">OpenAI 兼容</option>
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label><span>请求地址</span><input type="text" data-ref="apiUrl" placeholder="https://api.deepseek.com/chat/completions" spellcheck="false"></label>
              <label><span>API Key</span><input type="password" data-ref="apiKey" placeholder="sk-..." spellcheck="false"></label>
              <label><span>模型</span>
                <span class="modelRow">
                  <input type="text" data-ref="model" list="ykt-model-list-homework" placeholder="deepseek-chat" spellcheck="false">
                  <button class="miniBtn" type="button" data-act="fetch-models" data-ref="fetchModels">获取模型</button>
                </span>
                <datalist id="ykt-model-list-homework" data-ref="modelList"></datalist>
              </label>
              <label><span>额外请求头（JSON，可选）</span><textarea data-ref="extraHeaders" rows="2" spellcheck="false" placeholder='{"x-opencode-session":"ykt-session"}'></textarea></label>
              <label class="checkRow"><input type="checkbox" data-ref="stopOnWrong"><span>答案错误时暂停，等待人工确认（推荐）</span></label>
              <label class="checkRow"><input type="checkbox" data-ref="doubleCheck"><span>提交前双次作答一致性检查（可选，推荐开启）</span></label>
              <label class="checkRow"><input type="checkbox" data-ref="homeworkAuto"><span>自动提交作业（跳过二次确认；答案错误仍会暂停）</span></label>
              <button class="primary" data-act="save-config" data-ref="saveConfig">保存设置</button>
            </div>
          </details>
          <div class="hint">默认把题目渲染成截图交给视觉模型作答（模型需支持图片输入）；也可切换为本地字体解码 + 文本模型。<b>脚本不会自动提交作业</b>，每次提交都必须由你核对后手动确认。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-homework-course-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function createHomeworkWorkerPanel() {
    const host = document.createElement('div');
    host.id = 'ykt-homework-queue-worker-host';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(392px,calc(100vw - 24px));';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${panelCss()}</style>
      <section class="panel">
        <div class="header">
          <div class="brand"><span class="logo homework">作</span><span>作业队列</span><span class="qpos" data-ref="qpos"></span></div>
          <button class="iconBtn" data-act="collapse" title="收起">−</button>
        </div>
        <div class="body">
          <div class="statusline"><span class="dot active" data-ref="dot"></span><span data-ref="status">准备中…</span></div>
          <div class="videoTitle" data-ref="title"></div>
          <div class="hwReview" data-ref="review" hidden>
            <div class="boxLabel">题目与 AI 答案（提交前请逐题核对）</div>
            <img class="hwShot" data-ref="shot" hidden alt="作业题目截图">
            <div class="hwQuestions" data-ref="questions"></div>
          </div>
          <div class="actions">
            <button class="primary" data-act="submit" data-ref="submit" hidden>提交作业</button>
            <button class="primary" data-act="continue" data-ref="continueBtn" hidden>继续下一条</button>
            <button data-act="regenerate" data-ref="regenerate" hidden>重新生成</button>
            <button data-act="skip" data-ref="skip" hidden>跳过</button>
            <button class="danger" data-act="stop" data-ref="stop" hidden>停止队列</button>
            <button data-act="retry" data-ref="retry" hidden>重新加载</button>
          </div>
          <div class="message" data-ref="message" hidden></div>
          <div class="hint">脚本不会自动提交作业：请核对题目和答案，点“提交作业”后再点一次确认，才会真正提交。</div>
        </div>
      </section>
    `;
    document.documentElement.appendChild(host);

    const refs = {};
    shadow.querySelectorAll('[data-ref]').forEach((node) => {
      refs[node.getAttribute('data-ref')] = node;
    });

    let collapsed = false;
    try { collapsed = sessionStorage.getItem('ykt-homework-worker-panel-collapsed') === '1'; } catch (_) {}
    const panel = shadow.querySelector('.panel');
    if (collapsed) {
      panel.classList.add('collapsed');
      shadow.querySelector('[data-act="collapse"]').textContent = '+';
    }

    return { host, shadow, panel, refs };
  }

  function toggleCollapse(ui, storageKeyName) {
    const collapsed = ui.panel.classList.toggle('collapsed');
    const button = ui.shadow.querySelector('[data-act="collapse"]');
    if (button) button.textContent = collapsed ? '+' : '−';
    try {
      sessionStorage.setItem(storageKeyName, collapsed ? '1' : '0');
    } catch (_) {}
  }

  function createChannel() {
    try {
      return new BroadcastChannel(CHANNEL_NAME);
    } catch (_) {
      return null;
    }
  }

  function panelCss() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        width: 100%;
        color: #e9eef8;
        background: rgba(18, 23, 34, 0.97);
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 14px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        overflow: hidden;
        backdrop-filter: blur(12px);
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 11px 12px;
        background: rgba(255, 255, 255, 0.045);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        user-select: none;
      }
      .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: .01em; }
      .logo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; border-radius: 7px;
        background: #4f8cff; color: #fff; font-size: 11px; font-weight: 800;
      }
      .logo.accent { background: #25c08a; }
      .logo.discuss { background: #a06bff; font-size: 12px; }
      .logo.homework { background: #ff8c42; font-size: 12px; }
      .qpos { color: #8f9bb0; font-size: 11px; font-weight: 500; margin-left: 2px; }
      .iconBtn {
        appearance: none; border: 0; background: rgba(255,255,255,.08); color: #c9d4e7;
        width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 16px; line-height: 1;
      }
      .iconBtn:hover { background: rgba(255,255,255,.15); }
      .body { padding: 12px; max-height: calc(100vh - 90px); overflow-y: auto; }
      .panel.collapsed .body { display: none; }
      .summary {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;
      }
      .summary > div {
        background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06);
        border-radius: 10px; padding: 7px 8px; text-align: center;
      }
      .summary b { display: block; font-size: 18px; line-height: 1.2; font-weight: 700; color: #f5f8ff; }
      .summary span { display: block; font-size: 11px; color: #8492a8; margin-top: 2px; }
      .speedRow {
        display: flex; align-items: center; gap: 7px;
        padding: 7px 9px; margin-bottom: 9px;
        border: 1px solid rgba(255,255,255,.08); border-radius: 9px;
        background: rgba(255,255,255,.035);
      }
      .speedRow > span { color: #91a0b5; font-size: 11px; flex: 0 0 auto; }
      .speedFixed { color: #e8eef8; font-size: 12px; font-weight: 650; }
      .speedRow small { color: #74849a; font-size: 10px; margin-left: auto; text-align: right; }
      .estimate {
        display: flex; align-items: baseline; gap: 8px;
        padding: 8px 10px; margin-bottom: 9px;
        border: 1px solid rgba(57,217,138,.2); border-radius: 10px;
        background: rgba(57,217,138,.07);
      }
      .estimate span { color: #8fa4b8; font-size: 11px; flex: 0 0 auto; }
      .estimate b { color: #a8f0cf; font-size: 14px; font-weight: 650; flex: 1; min-width: 0; }
      .estimate small { color: #708097; font-size: 10px; flex: 0 0 auto; }
      .statusline { display: flex; align-items: center; gap: 7px; color: #aebbd0; font-size: 12px; margin: 7px 0 10px; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #6d7a8f; flex: 0 0 auto; }
      .dot.active { background: #39d98a; box-shadow: 0 0 0 3px rgba(57,217,138,.12); }
      .dot.busy { background: #5aa4ff; box-shadow: 0 0 0 3px rgba(90,164,255,.13); }
      .dot.warn { background: #ffc247; box-shadow: 0 0 0 3px rgba(255,194,71,.12); }
      .dot.error { background: #ff6b6b; box-shadow: 0 0 0 3px rgba(255,107,107,.12); }
      .current {
        background: rgba(79,140,255,.09); border: 1px solid rgba(79,140,255,.22);
        border-radius: 11px; padding: 9px 10px; margin-bottom: 10px;
      }
      .currentTitle, .videoTitle {
        color: #f4f7ff; font-weight: 650; font-size: 13px; line-height: 1.4;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .videoTitle { margin: 2px 0 9px; }
      .track { height: 6px; border-radius: 999px; background: rgba(255,255,255,.09); overflow: hidden; margin: 7px 0 5px; }
      .fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4f8cff, #39d98a); border-radius: inherit; transition: width .3s ease; }
      .meta, .timerow { color: #8e9cb2; font-size: 11px; }
      .timerow { display: flex; justify-content: space-between; gap: 8px; }
      .actions { display: flex; gap: 7px; margin-top: 11px; flex-wrap: wrap; }
      button {
        appearance: none; border: 1px solid rgba(255,255,255,.11); background: rgba(255,255,255,.055);
        color: #dce5f5; border-radius: 9px; padding: 7px 12px; font-size: 12px; font-weight: 600;
        cursor: pointer; font-family: inherit;
      }
      button:hover:not(:disabled) { background: rgba(255,255,255,.1); }
      button:disabled { opacity: .48; cursor: default; }
      button.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; flex: 1 1 120px; }
      button.primary:hover:not(:disabled) { background: #3f7ef5; }
      button.danger { color: #ffb7b7; border-color: rgba(255,107,107,.28); background: rgba(255,107,107,.08); }
      button.danger:hover:not(:disabled) { background: rgba(255,107,107,.14); }
      .message {
        margin-top: 10px; padding: 8px 10px; border-radius: 9px; font-size: 11.5px; line-height: 1.45;
        background: rgba(79,140,255,.1); border: 1px solid rgba(79,140,255,.22); color: #bdd4ff;
      }
      .message.ok { background: rgba(57,217,138,.09); border-color: rgba(57,217,138,.22); color: #b8f3d8; }
      .message.warn { background: rgba(255,194,71,.09); border-color: rgba(255,194,71,.22); color: #ffe1a1; }
      .message.error { background: rgba(255,107,107,.09); border-color: rgba(255,107,107,.25); color: #ffc4c4; }
      .manualLink { color: #bcd4ff; margin-left: 6px; text-decoration: underline; }
      .queueBox { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.07); padding-top: 8px; }
      .queueBox summary { cursor: pointer; color: #aab7cc; font-size: 12px; user-select: none; }
      .queueList { list-style: none; margin: 7px 0 0; padding: 0; max-height: 220px; overflow: auto; }
      .queueList li {
        display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px;
        border-bottom: 1px solid rgba(255,255,255,.045); color: #d8e1f0;
      }
      .queueList li:last-child { border-bottom: 0; }
      .queueList li.current { background: rgba(79,140,255,.09); border-radius: 6px; }
      .queueList li.done { opacity: .55; }
      .idx { width: 17px; flex: 0 0 auto; color: #718096; font-size: 10px; text-align: right; padding-top: 1px; }
      .itemText { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .itemTitle { color: #e8eef8; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .itemChapter { color: #77859a; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .itemProgress { flex: 0 0 auto; color: #8fc2ff; font-size: 10px; padding-top: 1px; }
      .queueList li.skipped { opacity: .45; }
      .questionBox {
        background: rgba(160,107,255,.09); border: 1px solid rgba(160,107,255,.24);
        border-radius: 11px; padding: 9px 10px; margin-bottom: 9px;
      }
      .boxLabel { color: #9aabc2; font-size: 10.5px; margin-bottom: 4px; letter-spacing: .02em; }
      .questionText {
        color: #f0eaff; font-size: 12.5px; line-height: 1.55;
        max-height: 150px; overflow: auto; white-space: pre-wrap; word-break: break-word;
      }
      .answerRow { margin-bottom: 9px; }
      .answerInput {
        width: 100%; resize: vertical; min-height: 90px; max-height: 260px;
        background: rgba(255,255,255,.06); color: #eaf1ff;
        border: 1px solid rgba(255,255,255,.14); border-radius: 9px; padding: 8px 9px;
        font-size: 12.5px; line-height: 1.55; font-family: inherit;
      }
      .answerInput:focus { outline: none; border-color: rgba(79,140,255,.55); }
      .answerInput:disabled { opacity: .6; }
      .configBox { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.07); padding-top: 8px; }
      .configBox summary { cursor: pointer; color: #aab7cc; font-size: 12px; user-select: none; }
      .configGrid { display: grid; gap: 7px; margin-top: 8px; }
      .configGrid label { display: grid; gap: 4px; color: #91a0b5; font-size: 11px; }
      .configGrid label > span { line-height: 1.35; }
      .configGrid input[type="text"], .configGrid input[type="password"],
      .configGrid select, .configGrid textarea {
        width: 100%; background: rgba(255,255,255,.06); color: #eaf1ff;
        border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
        padding: 6px 8px; font-size: 11.5px; line-height: 1.45; font-family: inherit;
      }
      .configGrid textarea { resize: vertical; min-height: 70px; }
      .configGrid select { appearance: auto; }
      .configGrid input:focus, .configGrid select:focus, .configGrid textarea:focus {
        outline: none; border-color: rgba(79,140,255,.55);
      }
      .configGrid .checkRow { display: flex; align-items: flex-start; gap: 7px; }
      .configGrid .checkRow input { margin-top: 2px; }
      .configBox button { justify-self: start; }
      .modelRow { display: flex; align-items: center; gap: 6px; }
      .modelRow input { flex: 1; min-width: 0; }
      .miniBtn { flex: 0 0 auto; padding: 5px 8px; font-size: 11px; white-space: nowrap; }
      .hwReview { margin-bottom: 9px; }
      .hwShot {
        display: block; width: 100%; height: auto; margin-bottom: 8px;
        border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: #fff;
      }
      .hwQuestions { display: grid; gap: 8px; max-height: 46vh; overflow: auto; padding-right: 2px; }
      .hwQuestion {
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
        border-radius: 9px; padding: 8px 9px;
      }
      .hwQTitle { color: #ffb27a; font-size: 11px; margin-bottom: 5px; }
      .hwQBody {
        color: #eef3ff; font-size: 12.5px; line-height: 1.55;
        white-space: pre-wrap; word-break: break-word; margin-bottom: 5px;
      }
      .hwOptions { display: grid; gap: 2px; margin-bottom: 6px; }
      .hwOption { color: #b9c6da; font-size: 11.5px; line-height: 1.45; white-space: pre-wrap; }
      .hwAnswerRow { display: flex; align-items: center; gap: 6px; }
      .hwAnswerRow > span { color: #91a0b5; font-size: 11px; }
      .hwAnswerInput {
        width: 64px; background: rgba(255,255,255,.06); color: #eaf1ff;
        border: 1px solid rgba(255,255,255,.16); border-radius: 7px;
        padding: 4px 7px; font-size: 12px; font-family: inherit; text-transform: uppercase;
      }
      .hwAnswerInput:focus { outline: none; border-color: rgba(79,140,255,.55); }
      .hwAnsweredNote { color: #7f8ca1; font-size: 10.5px; margin-top: 4px; }
      .hwSecondNote { color: #ffc247; font-size: 10.5px; margin-top: 4px; }
      .hint { color: #718096; font-size: 10.5px; line-height: 1.45; margin-top: 10px; }
      @media (max-width: 520px) {
        .panel { border-radius: 12px; }
        .body { padding: 10px; }
      }
    `;
  }
})();
