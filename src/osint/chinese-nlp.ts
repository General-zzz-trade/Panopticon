/**
 * Chinese NLP — person/org/location extraction, relationship discovery, timeline building
 * Pure regex + pattern matching, no external dependencies
 */

export interface ChineseEntity {
  text: string;
  type: "person" | "organization" | "location" | "title" | "date" | "event" | "money";
  confidence: number;
  context: string;
}

export interface PersonRelation {
  person1: string;
  person2: string;
  relationType: string;
  evidence: string;
  confidence: number;
}

export interface TimelineEvent {
  date: string;
  sortDate: string;  // ISO for sorting
  event: string;
  people: string[];
  organizations: string[];
  locations: string[];
  source: string;
  significance: "high" | "medium" | "low";
}

// ── Chinese Name Patterns ───────────────────────────────

// Common Chinese surnames (top 100)
const CN_SURNAMES = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庚终暨居衡步都耿满弘匡国文寇广禄阙东殴殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾母沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";

const CN_SURNAME_SET = new Set(CN_SURNAMES.split(""));

// Two-char surnames
const CN_TWO_CHAR_SURNAMES = new Set([
  "欧阳", "太史", "端木", "上官", "司马", "东方", "独孤", "南宫",
  "万俟", "闻人", "夏侯", "诸葛", "尉迟", "公羊", "赫连", "澹台",
  "皇甫", "宗政", "濮阳", "公冶", "太叔", "申屠", "公孙", "慕容",
  "仲孙", "钟离", "长孙", "宇文", "司徒", "鲜于", "司空", "令狐",
]);

// ── Title/Position Patterns ─────────────────────────────

const TITLE_PATTERNS = [
  /(?:总统|主席|总理|首相|总书记|部长|局长|院长|市长|省长|县长|区长|镇长|村长|校长|董事长|理事长|会长|社长|署长|厅长|处长|科长|组长|队长|班长)/g,
  /(?:副总统|副主席|副总理|副部长|副局长|副院长|副市长|副省长|副县长|秘书长|发言人|委员|代表|议员|立法委员|参议员|众议员)/g,
  /(?:将军|上将|中将|少将|大校|上校|中校|少校|司令|参谋长|政委)/g,
  /(?:教授|博士|院士|研究员|专家|学者|医生|律师|法官|检察官)/g,
  /(?:CEO|CTO|CFO|COO|总裁|执行长|创始人|联合创始人)/g,
];

// ── Organization Patterns ───────────────────────────────

const ORG_PATTERNS = [
  /(?:民进党|国民党|民众党|共产党|自民党|工党|共和党|民主党)/g,
  /(?:联合国|北约|NATO|ASEAN|东盟|欧盟|EU|WHO|WTO|IMF|世界银行)/g,
  /(?:立法院|行政院|司法院|监察院|考试院|国务院|外交部|国防部|财政部)/g,
  /台积电|华为|腾讯|阿里巴巴|百度|字节跳动|小米|京东|美团|拼多多/g,
  /(?:[\u4e00-\u9fff]{2,4})大学/g,
  /(?:[\u4e00-\u9fff]{2,6})(?:公司|集团|银行)/g,
  /(?:[\u4e00-\u9fff]{2,4})(?:日报|时报|周刊|新闻网)/g,
];

// ── Location Patterns ───────────────────────────────────

const KNOWN_LOCATIONS = [
  // Countries
  "中国", "美国", "日本", "韩国", "朝鲜", "俄罗斯", "英国", "法国", "德国", "印度",
  "巴西", "澳大利亚", "加拿大", "新加坡", "马来西亚", "印尼", "越南", "菲律宾", "泰国",
  "台湾", "香港", "澳门", "以色列", "伊朗", "沙特", "土耳其", "乌克兰",
  // Major cities
  "北京", "上海", "深圳", "广州", "杭州", "成都", "武汉", "南京", "重庆", "天津",
  "台北", "高雄", "台南", "台中", "新北",
  "东京", "首尔", "华盛顿", "纽约", "伦敦", "巴黎", "柏林", "莫斯科", "新德里",
  // Regions
  "亚太", "中东", "欧洲", "东亚", "东南亚", "南亚", "中亚", "太平洋", "大西洋",
  "台湾海峡", "南海", "东海", "黄海",
];

// ── Chinese Sentiment Lexicon (expanded) ────────────────

const CN_POSITIVE: Record<string, number> = {
  "好": 2, "优秀": 3, "出色": 3, "成功": 3, "增长": 2, "上涨": 2, "利好": 2,
  "突破": 2, "创新": 2, "领先": 2, "稳定": 1, "改善": 2, "提升": 2, "盈利": 2,
  "反弹": 1, "强劲": 2, "看好": 2, "推荐": 2, "合作": 1, "发展": 1, "进步": 2,
  "繁荣": 3, "和平": 2, "团结": 2, "支持": 1, "胜利": 3, "当选": 2, "就任": 1,
  "访问": 1, "会谈": 1, "协议": 1, "友好": 2, "互利": 2, "共赢": 2,
};

const CN_NEGATIVE: Record<string, number> = {
  "差": -2, "失败": -3, "下跌": -2, "暴跌": -3, "亏损": -3, "危机": -3,
  "风险": -2, "问题": -2, "担忧": -2, "警告": -2, "崩盘": -4, "违规": -3,
  "处罚": -2, "罚款": -2, "诈骗": -4, "泄露": -2, "攻击": -3, "漏洞": -2,
  "裁员": -2, "破产": -4, "造假": -4, "丑闻": -3, "调查": -1, "诉讼": -2,
  "冲突": -2, "紧张": -2, "威胁": -3, "制裁": -2, "抗议": -2, "反对": -1,
  "施压": -2, "军演": -2, "挑衅": -3, "争议": -2, "分裂": -3, "打压": -3,
  "逮捕": -3, "拘留": -3, "侵犯": -3, "暴力": -4, "战争": -4,
};

// ── Extract Chinese Entities ────────────────────────────

export function extractChineseEntities(text: string): ChineseEntity[] {
  const entities: ChineseEntity[] = [];
  const seen = new Set<string>();

  const addEntity = (value: string, type: ChineseEntity["type"], confidence: number, context: string) => {
    const key = `${type}:${value}`;
    if (seen.has(key) || value.length < 2) return;
    seen.add(key);
    entities.push({ text: value, type, confidence, context: context.slice(0, 80) });
  };

  // Extract Chinese person names (surname + 1-2 given name chars)
  for (const twoSurname of CN_TWO_CHAR_SURNAMES) {
    const regex = new RegExp(`${twoSurname}[\\u4e00-\\u9fff]{1,2}`, "g");
    for (const match of text.matchAll(regex)) {
      const idx = match.index || 0;
      addEntity(match[0], "person", 0.8, text.slice(Math.max(0, idx - 20), idx + match[0].length + 20));
    }
  }

  // Single-char surname + 1-2 given name chars (with title context for higher confidence)
  for (const titlePattern of TITLE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(titlePattern.source, titlePattern.flags))) {
      const idx = (match.index || 0);
      // Look for name before or after title
      const before = text.slice(Math.max(0, idx - 6), idx);
      const after = text.slice(idx + match[0].length, idx + match[0].length + 6);

      // Name before title: "赖清德总统"
      const nameBeforeMatch = before.match(/([\u4e00-\u9fff]{2,3})$/);
      if (nameBeforeMatch && CN_SURNAME_SET.has(nameBeforeMatch[1][0])) {
        addEntity(nameBeforeMatch[1], "person", 0.9, text.slice(Math.max(0, idx - 10), idx + match[0].length + 10));
        addEntity(match[0], "title", 0.9, text.slice(Math.max(0, idx - 10), idx + match[0].length + 10));
      }

      // Name after title: "总统赖清德"
      const nameAfterMatch = after.match(/^([\u4e00-\u9fff]{2,3})/);
      if (nameAfterMatch && CN_SURNAME_SET.has(nameAfterMatch[1][0])) {
        addEntity(nameAfterMatch[1], "person", 0.9, text.slice(Math.max(0, idx - 5), idx + match[0].length + 10));
        addEntity(match[0], "title", 0.9, text.slice(Math.max(0, idx - 5), idx + match[0].length + 10));
      }
    }
  }

  // Organizations
  for (const pattern of ORG_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const idx = match.index || 0;
      addEntity(match[0], "organization", 0.85, text.slice(Math.max(0, idx - 10), idx + match[0].length + 10));
    }
  }

  // Locations
  for (const loc of KNOWN_LOCATIONS) {
    if (text.includes(loc)) {
      const idx = text.indexOf(loc);
      addEntity(loc, "location", 0.9, text.slice(Math.max(0, idx - 10), idx + loc.length + 10));
    }
  }

  // Dates
  const datePatterns = [
    /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
    /(\d{4})年(\d{1,2})月/g,
    /(\d{1,2})月(\d{1,2})日/g,
  ];
  for (const dp of datePatterns) {
    for (const match of text.matchAll(new RegExp(dp.source, dp.flags))) {
      const idx = match.index || 0;
      addEntity(match[0], "date", 0.95, text.slice(Math.max(0, idx - 10), idx + match[0].length + 10));
    }
  }

  // Money
  const moneyPatterns = [
    /[\d,.]+\s*(?:亿|万|千万|百万|兆)\s*(?:美元|人民币|台币|新台币|日元|欧元|英镑|元)/g,
    /(?:美元|人民币|台币)[\d,.]+\s*(?:亿|万|千万|百万|兆)?/g,
  ];
  for (const mp of moneyPatterns) {
    for (const match of text.matchAll(new RegExp(mp.source, mp.flags))) {
      addEntity(match[0], "money", 0.9, "");
    }
  }

  return entities;
}

// ── Discover Relationships from Chinese Text ────────────

const RELATION_PATTERNS_ZH: { pattern: RegExp; type: string }[] = [
  { pattern: /([\u4e00-\u9fff]{2,4})(?:与|和|同|跟)([\u4e00-\u9fff]{2,4})(?:会谈|会面|见面|通话|磋商)/g, type: "diplomatic_meeting" },
  { pattern: /([\u4e00-\u9fff]{2,4})(?:任命|委任|提名)([\u4e00-\u9fff]{2,4})(?:为|担任)/g, type: "appointed" },
  { pattern: /([\u4e00-\u9fff]{2,4})(?:批评|谴责|反对|指责|抨击)([\u4e00-\u9fff]{2,4})/g, type: "opposition" },
  { pattern: /([\u4e00-\u9fff]{2,4})(?:支持|赞同|拥护|力挺)([\u4e00-\u9fff]{2,4})/g, type: "support" },
  { pattern: /([\u4e00-\u9fff]{2,4})(?:访问|出访|到访)([\u4e00-\u9fff]{2,6})/g, type: "visited" },
  { pattern: /([\u4e00-\u9fff]{2,4})(?:是|为|担任)([\u4e00-\u9fff]{2,8})(?:的|之)(?:[\u4e00-\u9fff]{2,4})/g, type: "role" },
];

export function discoverChineseRelations(text: string): PersonRelation[] {
  const relations: PersonRelation[] = [];

  for (const { pattern, type } of RELATION_PATTERNS_ZH) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match[1] && match[2]) {
        relations.push({
          person1: match[1],
          person2: match[2],
          relationType: type,
          evidence: match[0],
          confidence: 0.7,
        });
      }
    }
  }

  return relations;
}

// ── Chinese Sentiment Analysis ──────────────────────────

export function analyzeChineseSentiment(text: string): {
  score: number;
  label: "positive" | "negative" | "neutral";
  positiveWords: string[];
  negativeWords: string[];
} {
  let score = 0;
  const positiveWords: string[] = [];
  const negativeWords: string[] = [];

  for (const [word, s] of Object.entries(CN_POSITIVE)) {
    const count = (text.match(new RegExp(word, "g")) || []).length;
    if (count > 0) { score += s * count; positiveWords.push(word); }
  }

  for (const [word, s] of Object.entries(CN_NEGATIVE)) {
    const count = (text.match(new RegExp(word, "g")) || []).length;
    if (count > 0) { score += s * count; negativeWords.push(word); }
  }

  // Negation: 不/没/未 before positive → negative
  const negated = text.match(/[不没未无][\u4e00-\u9fff]{0,2}([\u4e00-\u9fff]{2})/g) || [];
  for (const neg of negated) {
    const word = neg.slice(-2);
    if (CN_POSITIVE[word]) score -= CN_POSITIVE[word] * 2;
  }

  return {
    score,
    label: score > 1 ? "positive" : score < -1 ? "negative" : "neutral",
    positiveWords: [...new Set(positiveWords)],
    negativeWords: [...new Set(negativeWords)],
  };
}

// ── Build Timeline from Text ────────────────────────────

export function buildChineseTimeline(texts: { content: string; source: string; date?: string }[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const { content, source, date } of texts) {
    const entities = extractChineseEntities(content);
    const dateEntities = entities.filter(e => e.type === "date");
    const people = entities.filter(e => e.type === "person").map(e => e.text);
    const orgs = entities.filter(e => e.type === "organization").map(e => e.text);
    const locs = entities.filter(e => e.type === "location").map(e => e.text);

    // Use extracted dates or fallback to provided date
    const eventDates = dateEntities.length > 0
      ? dateEntities.map(d => d.text)
      : date ? [date] : [];

    for (const eventDate of eventDates) {
      // Convert Chinese date to sortable format
      let sortDate = eventDate;
      const yearMatch = eventDate.match(/(\d{4})年/);
      const monthMatch = eventDate.match(/(\d{1,2})月/);
      const dayMatch = eventDate.match(/(\d{1,2})日/);
      if (yearMatch) {
        sortDate = `${yearMatch[1]}-${(monthMatch?.[1] || "01").padStart(2, "0")}-${(dayMatch?.[1] || "01").padStart(2, "0")}`;
      }

      // Determine significance
      const sentiment = analyzeChineseSentiment(content);
      const significance: TimelineEvent["significance"] =
        Math.abs(sentiment.score) > 5 ? "high" :
        Math.abs(sentiment.score) > 2 ? "medium" : "low";

      events.push({
        date: eventDate,
        sortDate,
        event: content.slice(0, 150),
        people: [...new Set(people)],
        organizations: [...new Set(orgs)],
        locations: [...new Set(locs)],
        source,
        significance,
      });
    }
  }

  return events.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}
