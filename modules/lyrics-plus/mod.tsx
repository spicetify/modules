/*
 * Copyright (C) 2026 spicetify
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ported to the v3 module standard from the classic "lyrics-plus" custom app.
 *
 * The classic app concatenated its subfiles into one shared global scope and
 * mounted through a render() entry point. This module preserves that single
 * shared scope by concatenating the same sources, in dependency order, into
 * one module. render() is replaced by the v3 registrar mounting at the bottom.
 */

// @ts-nocheck — this is a faithful port of ~5.3k lines of upstream lyrics-plus
// JavaScript, maintained untyped across the ecosystem. Hand-annotating it would
// be disproportionate and fragile; correctness is verified live against the
// running client instead. oxlint still lints this file for real defects.

import { createRegistrar } from "/modules/stdlib/mod.ts";
import type { ModuleRuntimeContext } from "/modules/stdlib/mod.ts";
import { NavLink } from "/modules/stdlib/src/registers/navlink.tsx";

const react = Spicetify.React;
const { useState, useEffect, useCallback, useMemo, useRef } = react;
const spotifyVersion = Spicetify.Platform.version;

// Romanization/conversion libraries the Translator injects at runtime via
// <script> tags (kuroshiro / kuromoji / aromanize / opencc). Declared so the
// ported code type-checks and passes no-undef; they only exist once the CDN
// scripts have loaded, exactly as in the classic app.
declare const Kuroshiro: any;
declare const KuromojiAnalyzer: any;
declare const Aromanize: any;
declare const OpenCC: any;

const ROUTE = "/lyrics-plus";
const ICON =
	'<svg viewBox="0 0 256 256" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="m224.9832,74.42656q0,17.80336 -8.28326,33.3279t-22.6169,25.4232t-31.90855,12.31993l-88.73891,102.6898q-4.89793,5.69708 -12.53293,5.69708q-4.46576,0 -8.35529,-2.1364l-15.41406,-8.83047q-5.47415,-3.13339 -7.41892,-9.11532t0.5042,-11.67901l54.74154,-121.34772q-5.18604,-12.81842 -5.18604,-26.34898q0,-29.6248 21.32039,-50.70398t51.28418,-21.07918t51.28418,21.07918t21.32039,50.70398zm-158.46235,167.92132l83.26476,-96.28059q-18.72737,-0.71213 -34.50157,-10.0411t-25.13789,-24.85349l-51.57229,114.65366q-1.15245,2.56368 -0.28811,5.19858t3.3133,4.05917l15.55812,8.97289q2.30491,1.28184 4.96996,0.85456t4.39373,-2.56368zm85.85778,-105.11106q26.21832,0 44.87366,-18.44428t18.65534,-44.36598t-18.65534,-44.36598t-44.87366,-18.44428t-44.87366,18.44428t-18.65534,44.36598t18.65534,44.36598t44.87366,18.44428z"/></svg>';

// ============================================================================
// index.js — constants, CONFIG, module-level state (above LyricsContainer)
// ============================================================================

function getConfig(name, defaultVal = true) {
	const value = localStorage.getItem(name);
	return value ? value === "true" : defaultVal;
}

const APP_NAME = "lyrics-plus";
const MUSIXMATCH_TRANSLATION_PREFIX_DEFAULT = "musixmatchTranslation:";
const MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY = "__lyricsPlusMusixmatchTranslationPrefix";
const MUSIXMATCH_TRANSLATION_FETCH_MESSAGE = "Fetching translation...";
const MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE = "Failed to fetch translation, please try again in a few minutes";
const MUSIXMATCH_TRANSLATION_PREFIX =
	typeof window !== "undefined" && typeof window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY] === "string"
		? window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY]
		: MUSIXMATCH_TRANSLATION_PREFIX_DEFAULT;

if (typeof window !== "undefined") {
	window[MUSIXMATCH_TRANSLATION_PREFIX_GLOBAL_KEY] = MUSIXMATCH_TRANSLATION_PREFIX;
}

const KARAOKE = 0;
const SYNCED = 1;
const UNSYNCED = 2;
const GENIUS = 3;

const CONFIG = {
	visual: {
		"playbar-button": getConfig("lyrics-plus:visual:playbar-button", false),
		colorful: getConfig("lyrics-plus:visual:colorful"),
		noise: getConfig("lyrics-plus:visual:noise"),
		"background-color": localStorage.getItem("lyrics-plus:visual:background-color") || "var(--spice-main)",
		"active-color": localStorage.getItem("lyrics-plus:visual:active-color") || "var(--spice-text)",
		"inactive-color":
			localStorage.getItem("lyrics-plus:visual:inactive-color") || "rgba(var(--spice-rgb-subtext),0.5)",
		"highlight-color": localStorage.getItem("lyrics-plus:visual:highlight-color") || "var(--spice-button)",
		alignment: localStorage.getItem("lyrics-plus:visual:alignment") || "center",
		"lines-before": localStorage.getItem("lyrics-plus:visual:lines-before") || "0",
		"lines-after": localStorage.getItem("lyrics-plus:visual:lines-after") || "2",
		"font-size": localStorage.getItem("lyrics-plus:visual:font-size") || "32",
		"translate:translated-lyrics-source":
			localStorage.getItem("lyrics-plus:visual:translate:translated-lyrics-source") || "none",
		"translate:display-mode": localStorage.getItem("lyrics-plus:visual:translate:display-mode") || "replace",
		"translate:detect-language-override":
			localStorage.getItem("lyrics-plus:visual:translate:detect-language-override") || "off",
		"translation-mode:japanese": localStorage.getItem("lyrics-plus:visual:translation-mode:japanese") || "furigana",
		"translation-mode:korean": localStorage.getItem("lyrics-plus:visual:translation-mode:korean") || "romaja",
		"translation-mode:chinese": localStorage.getItem("lyrics-plus:visual:translation-mode:chinese") || "cn",
		translate: getConfig("lyrics-plus:visual:translate", false),
		"ja-detect-threshold": localStorage.getItem("lyrics-plus:visual:ja-detect-threshold") || "40",
		"hans-detect-threshold": localStorage.getItem("lyrics-plus:visual:hans-detect-threshold") || "40",
		"musixmatch-translation-language":
			localStorage.getItem("lyrics-plus:visual:musixmatch-translation-language") || "none",
		"fade-blur": getConfig("lyrics-plus:visual:fade-blur"),
		"fullscreen-key": localStorage.getItem("lyrics-plus:visual:fullscreen-key") || "f12",
		"show-performers": getConfig("lyrics-plus:visual:show-performers", true),
		"synced-compact": getConfig("lyrics-plus:visual:synced-compact"),
		"dual-genius": getConfig("lyrics-plus:visual:dual-genius"),
		"global-delay": Number(localStorage.getItem("lyrics-plus:visual:global-delay")) || 0,
		delay: 0,
	},
	providers: {
		lrclib: {
			on: getConfig("lyrics-plus:provider:lrclib:on"),
			desc: "Lyrics sourced from lrclib.net. Supports both synced and unsynced lyrics. LRCLIB is a free and open-source lyrics provider.",
			modes: [SYNCED, UNSYNCED],
		},
		musixmatch: {
			on: getConfig("lyrics-plus:provider:musixmatch:on"),
			desc: "Fully compatible with Spotify. Requires a token that can be retrieved from the official Musixmatch app. If you have problems with retrieving lyrics, try refreshing the token by clicking <code>Refresh Token</code> button. You may need to be forced to use your own CORS Proxy to use this provider.",
			token:
				localStorage.getItem("lyrics-plus:provider:musixmatch:token") ||
				"21051986b9886beabe1ce01c3ce94c96319411f8f2c122676365e3",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
		spotify: {
			on: getConfig("lyrics-plus:provider:spotify:on"),
			desc: "Lyrics sourced from official Spotify API.",
			modes: [SYNCED, UNSYNCED],
		},
		netease: {
			on: getConfig("lyrics-plus:provider:netease:on", false),
			desc: "Crowdsourced lyrics provider ran by Chinese developers and users.",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
		genius: {
			on: spotifyVersion >= "1.2.31" ? false : getConfig("lyrics-plus:provider:genius:on"),
			desc: "Provide unsynced lyrics with insights from artists themselves. Genius is disabled and cannot be used as a provider on <code>1.2.31</code> and higher.",
			modes: [GENIUS],
		},
		local: {
			on: getConfig("lyrics-plus:provider:local:on"),
			desc: "Provide lyrics from cache/local files loaded from previous Spotify sessions.",
			modes: [KARAOKE, SYNCED, UNSYNCED],
		},
	},
	providersOrder: localStorage.getItem("lyrics-plus:services-order"),
	modes: ["karaoke", "synced", "unsynced", "genius"],
	locked: localStorage.getItem("lyrics-plus:lock-mode") || "-1",
};

try {
	CONFIG.providersOrder = JSON.parse(CONFIG.providersOrder);
	if (
		!Array.isArray(CONFIG.providersOrder) ||
		Object.keys(CONFIG.providers).length !== CONFIG.providersOrder.length
	) {
		throw "";
	}
} catch {
	CONFIG.providersOrder = Object.keys(CONFIG.providers);
	localStorage.setItem("lyrics-plus:services-order", JSON.stringify(CONFIG.providersOrder));
}

CONFIG.locked = Number.parseInt(CONFIG.locked);
CONFIG.visual["lines-before"] = Number.parseInt(CONFIG.visual["lines-before"]);
CONFIG.visual["lines-after"] = Number.parseInt(CONFIG.visual["lines-after"]);
CONFIG.visual["font-size"] = Number.parseInt(CONFIG.visual["font-size"]);
CONFIG.visual["ja-detect-threshold"] = Number.parseInt(CONFIG.visual["ja-detect-threshold"]);
CONFIG.visual["hans-detect-threshold"] = Number.parseInt(CONFIG.visual["hans-detect-threshold"]);

if (CONFIG.visual["translate:translated-lyrics-source"] === "musixmatchTranslation") {
	const language = CONFIG.visual["musixmatch-translation-language"];
	const normalizedLanguage = language && language !== "none" ? language : "none";
	const upgradedValue =
		normalizedLanguage !== "none" ? `${MUSIXMATCH_TRANSLATION_PREFIX}${normalizedLanguage}` : "none";
	CONFIG.visual["translate:translated-lyrics-source"] = upgradedValue;
	localStorage.setItem(`${APP_NAME}:visual:translate:translated-lyrics-source`, upgradedValue);
}

if (typeof CONFIG.visual["translate:translated-lyrics-source"] === "string") {
	const sourceValue = CONFIG.visual["translate:translated-lyrics-source"];
	if (sourceValue.startsWith(MUSIXMATCH_TRANSLATION_PREFIX)) {
		const language = sourceValue.slice(MUSIXMATCH_TRANSLATION_PREFIX.length) || "none";
		if (CONFIG.visual["musixmatch-translation-language"] !== language) {
			CONFIG.visual["musixmatch-translation-language"] = language;
			localStorage.setItem(`${APP_NAME}:visual:musixmatch-translation-language`, language);
		}
	}
}

if (
	CONFIG.visual.translate &&
	typeof CONFIG.visual["translate:translated-lyrics-source"] === "string" &&
	CONFIG.visual["translate:translated-lyrics-source"] !== "none"
) {
	CONFIG.visual.translate = false;
	localStorage.setItem(`${APP_NAME}:visual:translate`, "false");
}

let CACHE = {};

const emptyState = {
	karaoke: null,
	synced: null,
	unsynced: null,
	genius: null,
	genius2: null,
	currentLyrics: null,
	musixmatchAvailableTranslations: null,
	musixmatchTrackId: null,
	musixmatchTranslationLanguage: null,
};

let lyricContainerUpdate;
let reloadLyrics;

const fontSizeLimit = { min: 16, max: 256, step: 4 };

const thresholdSizeLimit = { min: 0, max: 100, step: 5 };

function resolveTranslationSource(source) {
	if (typeof source !== "string") {
		return { key: source, language: null };
	}

	if (source.startsWith(MUSIXMATCH_TRANSLATION_PREFIX)) {
		const language = source.slice(MUSIXMATCH_TRANSLATION_PREFIX.length) || null;
		return { key: "musixmatchTranslation", language };
	}

	return { key: source, language: null };
}

// ============================================================================
// Utils.js
// ============================================================================

const Utils = {
	addQueueListener(callback) {
		Spicetify.Player.origin._events.addListener("queue_update", callback);
	},
	removeQueueListener(callback) {
		Spicetify.Player.origin._events.removeListener("queue_update", callback);
	},
	convertIntToRGB(colorInt, div = 1) {
		const rgb = {
			r: Math.round(((colorInt >> 16) & 0xff) / div),
			g: Math.round(((colorInt >> 8) & 0xff) / div),
			b: Math.round((colorInt & 0xff) / div),
		};
		return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
	},
	/**
	 * @param {string} s
	 * @param {boolean} emptySymbol
	 * @returns {string}
	 */
	normalize(s, emptySymbol = true) {
		let result = s
			.replace(/（/g, "(")
			.replace(/）/g, ")")
			.replace(/【/g, "[")
			.replace(/】/g, "]")
			.replace(/。/g, ". ")
			.replace(/；/g, "; ")
			.replace(/：/g, ": ")
			.replace(/？/g, "? ")
			.replace(/！/g, "! ")
			.replace(/、|，/g, ", ")
			.replace(/‘|’|′|＇/g, "'")
			.replace(/“|”/g, '"')
			.replace(/〜/g, "~")
			.replace(/·|・/g, "•");
		if (emptySymbol) {
			result = result.replace(/-/g, " ").replace(/\//g, " ");
		}
		return result.replace(/\s+/g, " ").trim();
	},
	/**
	 * Check if the specified string contains Han character.
	 *
	 * @param {string} s
	 * @returns {boolean}
	 */
	containsHanCharacter(s) {
		const hanRegex = /\p{Script=Han}/u;
		return hanRegex.test(s);
	},
	/**
	 * Singleton Translator instance for {@link toSimplifiedChinese}.
	 *
	 * @type {Translator | null}
	 */
	set translator(translator) {
		this._translatorInstance = translator;
	},
	_translatorInstance: null,
	/**
	 * Convert all Han characters to Simplified Chinese.
	 *
	 * Choosing Simplified Chinese makes the converted result more accurate,
	 * as the conversion from SC to TC may have multiple possibilities,
	 * while the conversion from TC to SC usually has only one possibility.
	 *
	 * @param {string} s
	 * @returns {Promise<string>}
	 */
	async toSimplifiedChinese(s) {
		// create a singleton Translator instance
		if (!this._translatorInstance) this.translator = new Translator("zh", true);

		// translate to Simplified Chinese
		// as Traditional Chinese differs between HK and TW, forcing to use OpenCC standard
		return this._translatorInstance.convertChinese(s, "t", "cn");
	},
	removeSongFeat(s) {
		return (
			s
				.replace(/-\s+(feat|with|prod).*/i, "")
				.replace(/(\(|\[)(feat|with|prod)\.?\s+.*(\)|\])$/i, "")
				.trim() || s
		);
	},
	removeExtraInfo(s) {
		return s.replace(/\s-\s.*/, "");
	},
	capitalize(s) {
		return s.replace(/^(\w)/, ($1) => $1.toUpperCase());
	},
	detectLanguage(lyrics) {
		if (!Array.isArray(lyrics)) return;

		// Should return IETF BCP 47 language tags.
		// This should detect the song's main language.
		// Remember there is a possibility of a song referencing something in another language and the lyrics show it in that native language!
		const rawLyrics = lyrics[0].originalText
			? lyrics.map((line) => line.originalText).join(" ")
			: lyrics.map((line) => line.text).join(" ");

		const kanaRegex =
			/[\u3001-\u3003]|[\u3005\u3007]|[\u301d-\u301f]|[\u3021-\u3035]|[\u3038-\u303a]|[\u3040-\u30ff]|[\uff66-\uff9f]/gu;
		const hangulRegex = /(\S*[\u3131-\u314e|\u314f-\u3163|\uac00-\ud7a3]+\S*)/g;
		const simpRegex =
			/[万与丑专业丛东丝丢两严丧个丬丰临为丽举么义乌乐乔习乡书买乱争于亏云亘亚产亩亲亵亸亿仅从仑仓仪们价众优伙会伛伞伟传伤伥伦伧伪伫体余佣佥侠侣侥侦侧侨侩侪侬俣俦俨俩俪俭债倾偬偻偾偿傥傧储傩儿兑兖党兰关兴兹养兽冁内冈册写军农冢冯冲决况冻净凄凉凌减凑凛几凤凫凭凯击凼凿刍划刘则刚创删别刬刭刽刿剀剂剐剑剥剧劝办务劢动励劲劳势勋勐勚匀匦匮区医华协单卖卢卤卧卫却卺厂厅历厉压厌厍厕厢厣厦厨厩厮县参叆叇双发变叙叠叶号叹叽吁后吓吕吗吣吨听启吴呒呓呕呖呗员呙呛呜咏咔咙咛咝咤咴咸哌响哑哒哓哔哕哗哙哜哝哟唛唝唠唡唢唣唤唿啧啬啭啮啰啴啸喷喽喾嗫呵嗳嘘嘤嘱噜噼嚣嚯团园囱围囵国图圆圣圹场坂坏块坚坛坜坝坞坟坠垄垅垆垒垦垧垩垫垭垯垱垲垴埘埙埚埝埯堑堕塆墙壮声壳壶壸处备复够头夸夹夺奁奂奋奖奥妆妇妈妩妪妫姗姜娄娅娆娇娈娱娲娴婳婴婵婶媪嫒嫔嫱嬷孙学孪宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尧尴尸尽层屃屉届属屡屦屿岁岂岖岗岘岙岚岛岭岳岽岿峃峄峡峣峤峥峦崂崃崄崭嵘嵚嵛嵝嵴巅巩巯币帅师帏帐帘帜带帧帮帱帻帼幂幞干并广庄庆庐庑库应庙庞废庼廪开异弃张弥弪弯弹强归当录彟彦彻径徕御忆忏忧忾怀态怂怃怄怅怆怜总怼怿恋恳恶恸恹恺恻恼恽悦悫悬悭悯惊惧惨惩惫惬惭惮惯愍愠愤愦愿慑慭憷懑懒懔戆戋戏戗战戬户扎扑扦执扩扪扫扬扰抚抛抟抠抡抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挢挣挤挥挦捞损捡换捣据捻掳掴掷掸掺掼揸揽揿搀搁搂搅携摄摅摆摇摈摊撄撑撵撷撸撺擞攒敌敛数斋斓斗斩断无旧时旷旸昙昼昽显晋晒晓晔晕晖暂暧札术朴机杀杂权条来杨杩杰极构枞枢枣枥枧枨枪枫枭柜柠柽栀栅标栈栉栊栋栌栎栏树栖样栾桊桠桡桢档桤桥桦桧桨桩梦梼梾检棂椁椟椠椤椭楼榄榇榈榉槚槛槟槠横樯樱橥橱橹橼檐檩欢欤欧歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氇气氢氩氲汇汉污汤汹沓沟没沣沤沥沦沧沨沩沪沵泞泪泶泷泸泺泻泼泽泾洁洒洼浃浅浆浇浈浉浊测浍济浏浐浑浒浓浔浕涂涌涛涝涞涟涠涡涢涣涤润涧涨涩淀渊渌渍渎渐渑渔渖渗温游湾湿溃溅溆溇滗滚滞滟滠满滢滤滥滦滨滩滪漤潆潇潋潍潜潴澜濑濒灏灭灯灵灾灿炀炉炖炜炝点炼炽烁烂烃烛烟烦烧烨烩烫烬热焕焖焘煅煳熘爱爷牍牦牵牺犊犟状犷犸犹狈狍狝狞独狭狮狯狰狱狲猃猎猕猡猪猫猬献獭玑玙玚玛玮环现玱玺珉珏珐珑珰珲琎琏琐琼瑶瑷璇璎瓒瓮瓯电画畅畲畴疖疗疟疠疡疬疮疯疱疴痈痉痒痖痨痪痫痴瘅瘆瘗瘘瘪瘫瘾瘿癞癣癫癯皑皱皲盏盐监盖盗盘眍眦眬着睁睐睑瞒瞩矫矶矾矿砀码砖砗砚砜砺砻砾础硁硅硕硖硗硙硚确硷碍碛碜碱碹磙礼祎祢祯祷祸禀禄禅离秃秆种积称秽秾稆税稣稳穑穷窃窍窑窜窝窥窦窭竖竞笃笋笔笕笺笼笾筑筚筛筜筝筹签简箓箦箧箨箩箪箫篑篓篮篱簖籁籴类籼粜粝粤粪粮糁糇紧絷纟纠纡红纣纤纥约级纨纩纪纫纬纭纮纯纰纱纲纳纴纵纶纷纸纹纺纻纼纽纾线绀绁绂练组绅细织终绉绊绋绌绍绎经绐绑绒结绔绕绖绗绘给绚绛络绝绞统绠绡绢绣绤绥绦继绨绩绪绫绬续绮绯绰绱绲绳维绵绶绷绸绹绺绻综绽绾绿缀缁缂缃缄缅缆缇缈缉缊缋缌缍缎缏缐缑缒缓缔缕编缗缘缙缚缛缜缝缞缟缠缡缢缣缤缥缦缧缨缩缪缫缬缭缮缯缰缱缲缳缴缵罂网罗罚罢罴羁羟羡翘翙翚耢耧耸耻聂聋职聍联聩聪肃肠肤肷肾肿胀胁胆胜胧胨胪胫胶脉脍脏脐脑脓脔脚脱脶脸腊腌腘腭腻腼腽腾膑臜舆舣舰舱舻艰艳艹艺节芈芗芜芦苁苇苈苋苌苍苎苏苘苹茎茏茑茔茕茧荆荐荙荚荛荜荞荟荠荡荣荤荥荦荧荨荩荪荫荬荭荮药莅莜莱莲莳莴莶获莸莹莺莼萚萝萤营萦萧萨葱蒇蒉蒋蒌蓝蓟蓠蓣蓥蓦蔷蔹蔺蔼蕲蕴薮藁藓虏虑虚虫虬虮虽虾虿蚀蚁蚂蚕蚝蚬蛊蛎蛏蛮蛰蛱蛲蛳蛴蜕蜗蜡蝇蝈蝉蝎蝼蝾螀螨蟏衅衔补衬衮袄袅袆袜袭袯装裆裈裢裣裤裥褛褴襁襕见观觃规觅视觇览觉觊觋觌觍觎觏觐觑觞触觯詟誉誊讠计订讣认讥讦讧讨让讪讫训议讯记讱讲讳讴讵讶讷许讹论讻讼讽设访诀证诂诃评诅识诇诈诉诊诋诌词诎诏诐译诒诓诔试诖诗诘诙诚诛诜话诞诟诠诡询诣诤该详诧诨诩诪诫诬语诮误诰诱诲诳说诵诶请诸诹诺读诼诽课诿谀谁谂调谄谅谆谇谈谊谋谌谍谎谏谐谑谒谓谔谕谖谗谘谙谚谛谜谝谞谟谠谡谢谣谤谥谦谧谨谩谪谫谬谭谮谯谰谱谲谳谴谵谶谷豮贝贞负贠贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贳贴贵贶贷贸费贺贻贼贽贾贿赀赁赂赃资赅赆赇赈赉赊赋赌赍赎赏赐赑赒赓赔赕赖赗赘赙赚赛赜赝赞赟赠赡赢赣赪赵赶趋趱趸跃跄跖跞践跶跷跸跹跻踊踌踪踬踯蹑蹒蹰蹿躏躜躯车轧轨轩轪轫转轭轮软轰轱轲轳轴轵轶轷轸轹轺轻轼载轾轿辀辁辂较辄辅辆辇辈辉辊辋辌辍辎辏辐辑辒输辔辕辖辗辘辙辚辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逦逻遗遥邓邝邬邮邹邺邻郁郄郏郐郑郓郦郧郸酝酦酱酽酾酿释里鉅鉴銮錾钆钇针钉钊钋钌钍钎钏钐钑钒钓钔钕钖钗钘钙钚钛钝钞钟钠钡钢钣钤钥钦钧钨钩钪钫钬钭钮钯钰钱钲钳钴钵钶钷钸钹钺钻钼钽钾钿铀铁铂铃铄铅铆铈铉铊铋铍铎铏铐铑铒铕铗铘铙铚铛铜铝铞铟铠铡铢铣铤铥铦铧铨铪铫铬铭铮铯铰铱铲铳铴铵银铷铸铹铺铻铼铽链铿销锁锂锃锄锅锆锇锈锉锊锋锌锍锎锏锐锑锒锓锔锕锖锗错锚锜锞锟锠锡锢锣锤锥锦锨锩锫锬锭键锯锰锱锲锳锴锵锶锷锸锹锺锻锼锽锾锿镀镁镂镃镆镇镈镉镊镌镍镎镏镐镑镒镕镖镗镙镚镛镜镝镞镟镠镡镢镣镤镥镦镧镨镩镪镫镬镭镮镯镰镱镲镳镴镶长门闩闪闫闬闭问闯闰闱闲闳间闵闶闷闸闹闺闻闼闽闾闿阀阁阂阃阄阅阆阇阈阉阊阋阌阍阎阏阐阑阒阓阔阕阖阗阘阙阚阛队阳阴阵阶际陆陇陈陉陕陧陨险随隐隶隽难雏雠雳雾霁霉霭靓静靥鞑鞒鞯鞴韦韧韨韩韪韫韬韵页顶顷顸项顺须顼顽顾顿颀颁颂颃预颅领颇颈颉颊颋颌颍颎颏颐频颒颓颔颕颖颗题颙颚颛颜额颞颟颠颡颢颣颤颥颦颧风飏飐飑飒飓飔飕飖飗飘飙飚飞飨餍饤饥饦饧饨饩饪饫饬饭饮饯饰饱饲饳饴饵饶饷饸饹饺饻饼饽饾饿馀馁馂馃馄馅馆馇馈馉馊馋馌馍馎馏馐馑馒馓馔馕马驭驮驯驰驱驲驳驴驵驶驷驸驹驺驻驼驽驾驿骀骁骂骃骄骅骆骇骈骉骊骋验骍骎骏骐骑骒骓骔骕骖骗骘骙骚骛骜骝骞骟骠骡骢骣骤骥骦骧髅髋髌鬓魇魉鱼鱽鱾鱿鲀鲁鲂鲄鲅鲆鲇鲈鲉鲊鲋鲌鲍鲎鲏鲐鲑鲒鲓鲔鲕鲖鲗鲘鲙鲚鲛鲜鲝鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲪鲫鲬鲭鲮鲯鲰鲱鲲鲳鲴鲵鲶鲷鲸鲹鲺鲻鲼鲽鲾鲿鳀鳁鳂鳃鳄鳅鳆鳇鳈鳉鳊鳋鳌鳍鳎鳏鳐鳑鳒鳓鳔鳕鳖鳗鳘鳙鳛鳜鳝鳞鳟鳠鳡鳢鳣鸟鸠鸡鸢鸣鸤鸥鸦鸧鸨鸩鸪鸫鸬鸭鸮鸯鸰鸱鸲鸳鸴鸵鸶鸷鸸鸹鸺鸻鸼鸽鸾鸿鹀鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹋鹌鹍鹎鹏鹐鹑鹒鹓鹔鹕鹖鹗鹘鹚鹛鹜鹝鹞鹟鹠鹡鹢鹣鹤鹥鹦鹧鹨鹩鹪鹫鹬鹭鹯鹰鹱鹲鹳鹴鹾麦麸黄黉黡黩黪黾鼋鼌鼍鼗鼹齄齐齑齿龀龁龂龃龄龅龆龇龈龉龊龋龌龙龚龛龟志制咨只里系范松没尝尝闹面准钟别闲干尽脏拼]/gu;
		const tradRegex =
			/[萬與醜專業叢東絲丟兩嚴喪個爿豐臨為麗舉麼義烏樂喬習鄉書買亂爭於虧雲亙亞產畝親褻嚲億僅從侖倉儀們價眾優夥會傴傘偉傳傷倀倫傖偽佇體餘傭僉俠侶僥偵側僑儈儕儂俁儔儼倆儷儉債傾傯僂僨償儻儐儲儺兒兌兗黨蘭關興茲養獸囅內岡冊寫軍農塚馮衝決況凍淨淒涼淩減湊凜幾鳳鳧憑凱擊氹鑿芻劃劉則剛創刪別剗剄劊劌剴劑剮劍剝劇勸辦務勱動勵勁勞勢勳猛勩勻匭匱區醫華協單賣盧鹵臥衛卻巹廠廳曆厲壓厭厙廁廂厴廈廚廄廝縣參靉靆雙發變敘疊葉號歎嘰籲後嚇呂嗎唚噸聽啟吳嘸囈嘔嚦唄員咼嗆嗚詠哢嚨嚀噝吒噅鹹呱響啞噠嘵嗶噦嘩噲嚌噥喲嘜嗊嘮啢嗩唕喚呼嘖嗇囀齧囉嘽嘯噴嘍嚳囁嗬噯噓嚶囑嚕劈囂謔團園囪圍圇國圖圓聖壙場阪壞塊堅壇壢壩塢墳墜壟壟壚壘墾坰堊墊埡墶壋塏堖塒塤堝墊垵塹墮壪牆壯聲殼壺壼處備複夠頭誇夾奪奩奐奮獎奧妝婦媽嫵嫗媯姍薑婁婭嬈嬌孌娛媧嫻嫿嬰嬋嬸媼嬡嬪嬙嬤孫學孿寧寶實寵審憲宮寬賓寢對尋導壽將爾塵堯尷屍盡層屭屜屆屬屢屨嶼歲豈嶇崗峴嶴嵐島嶺嶽崠巋嶨嶧峽嶢嶠崢巒嶗崍嶮嶄嶸嶔崳嶁脊巔鞏巰幣帥師幃帳簾幟帶幀幫幬幘幗冪襆幹並廣莊慶廬廡庫應廟龐廢廎廩開異棄張彌弳彎彈強歸當錄彠彥徹徑徠禦憶懺憂愾懷態慫憮慪悵愴憐總懟懌戀懇惡慟懨愷惻惱惲悅愨懸慳憫驚懼慘懲憊愜慚憚慣湣慍憤憒願懾憖怵懣懶懍戇戔戲戧戰戩戶紮撲扡執擴捫掃揚擾撫拋摶摳掄搶護報擔擬攏揀擁攔擰撥擇掛摯攣掗撾撻挾撓擋撟掙擠揮撏撈損撿換搗據撚擄摑擲撣摻摜摣攬撳攙擱摟攪攜攝攄擺搖擯攤攖撐攆擷擼攛擻攢敵斂數齋斕鬥斬斷無舊時曠暘曇晝曨顯晉曬曉曄暈暉暫曖劄術樸機殺雜權條來楊榪傑極構樅樞棗櫪梘棖槍楓梟櫃檸檉梔柵標棧櫛櫳棟櫨櫟欄樹棲樣欒棬椏橈楨檔榿橋樺檜槳樁夢檮棶檢欞槨櫝槧欏橢樓欖櫬櫚櫸檟檻檳櫧橫檣櫻櫫櫥櫓櫞簷檁歡歟歐殲歿殤殘殞殮殫殯毆毀轂畢斃氈毿氌氣氫氬氳彙漢汙湯洶遝溝沒灃漚瀝淪滄渢溈滬濔濘淚澩瀧瀘濼瀉潑澤涇潔灑窪浹淺漿澆湞溮濁測澮濟瀏滻渾滸濃潯濜塗湧濤澇淶漣潿渦溳渙滌潤澗漲澀澱淵淥漬瀆漸澠漁瀋滲溫遊灣濕潰濺漵漊潷滾滯灩灄滿瀅濾濫灤濱灘澦濫瀠瀟瀲濰潛瀦瀾瀨瀕灝滅燈靈災燦煬爐燉煒熗點煉熾爍爛烴燭煙煩燒燁燴燙燼熱煥燜燾煆糊溜愛爺牘犛牽犧犢強狀獷獁猶狽麅獮獰獨狹獅獪猙獄猻獫獵獼玀豬貓蝟獻獺璣璵瑒瑪瑋環現瑲璽瑉玨琺瓏璫琿璡璉瑣瓊瑤璦璿瓔瓚甕甌電畫暢佘疇癤療瘧癘瘍鬁瘡瘋皰屙癰痙癢瘂癆瘓癇癡癉瘮瘞瘺癟癱癮癭癩癬癲臒皚皺皸盞鹽監蓋盜盤瞘眥矓著睜睞瞼瞞矚矯磯礬礦碭碼磚硨硯碸礪礱礫礎硜矽碩硤磽磑礄確鹼礙磧磣堿镟滾禮禕禰禎禱禍稟祿禪離禿稈種積稱穢穠穭稅穌穩穡窮竊竅窯竄窩窺竇窶豎競篤筍筆筧箋籠籩築篳篩簹箏籌簽簡籙簀篋籜籮簞簫簣簍籃籬籪籟糴類秈糶糲粵糞糧糝餱緊縶糸糾紆紅紂纖紇約級紈纊紀紉緯紜紘純紕紗綱納紝縱綸紛紙紋紡紵紖紐紓線紺絏紱練組紳細織終縐絆紼絀紹繹經紿綁絨結絝繞絰絎繪給絢絳絡絕絞統綆綃絹繡綌綏絛繼綈績緒綾緓續綺緋綽緔緄繩維綿綬繃綢綯綹綣綜綻綰綠綴緇緙緗緘緬纜緹緲緝縕繢緦綞緞緶線緱縋緩締縷編緡緣縉縛縟縝縫縗縞纏縭縊縑繽縹縵縲纓縮繆繅纈繚繕繒韁繾繰繯繳纘罌網羅罰罷羆羈羥羨翹翽翬耮耬聳恥聶聾職聹聯聵聰肅腸膚膁腎腫脹脅膽勝朧腖臚脛膠脈膾髒臍腦膿臠腳脫腡臉臘醃膕齶膩靦膃騰臏臢輿艤艦艙艫艱豔艸藝節羋薌蕪蘆蓯葦藶莧萇蒼苧蘇檾蘋莖蘢蔦塋煢繭荊薦薘莢蕘蓽蕎薈薺蕩榮葷滎犖熒蕁藎蓀蔭蕒葒葤藥蒞蓧萊蓮蒔萵薟獲蕕瑩鶯蓴蘀蘿螢營縈蕭薩蔥蕆蕢蔣蔞藍薊蘺蕷鎣驀薔蘞藺藹蘄蘊藪槁蘚虜慮虛蟲虯蟣雖蝦蠆蝕蟻螞蠶蠔蜆蠱蠣蟶蠻蟄蛺蟯螄蠐蛻蝸蠟蠅蟈蟬蠍螻蠑螿蟎蠨釁銜補襯袞襖嫋褘襪襲襏裝襠褌褳襝褲襇褸襤繈襴見觀覎規覓視覘覽覺覬覡覿覥覦覯覲覷觴觸觶讋譽謄訁計訂訃認譏訐訌討讓訕訖訓議訊記訒講諱謳詎訝訥許訛論訩訟諷設訪訣證詁訶評詛識詗詐訴診詆謅詞詘詔詖譯詒誆誄試詿詩詰詼誠誅詵話誕詬詮詭詢詣諍該詳詫諢詡譸誡誣語誚誤誥誘誨誑說誦誒請諸諏諾讀諑誹課諉諛誰諗調諂諒諄誶談誼謀諶諜謊諫諧謔謁謂諤諭諼讒諮諳諺諦謎諞諝謨讜謖謝謠謗諡謙謐謹謾謫譾謬譚譖譙讕譜譎讞譴譫讖穀豶貝貞負貟貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貰貼貴貺貸貿費賀貽賊贄賈賄貲賃賂贓資賅贐賕賑賚賒賦賭齎贖賞賜贔賙賡賠賧賴賵贅賻賺賽賾贗讚贇贈贍贏贛赬趙趕趨趲躉躍蹌蹠躒踐躂蹺蹕躚躋踴躊蹤躓躑躡蹣躕躥躪躦軀車軋軌軒軑軔轉軛輪軟轟軲軻轤軸軹軼軤軫轢軺輕軾載輊轎輈輇輅較輒輔輛輦輩輝輥輞輬輟輜輳輻輯轀輸轡轅轄輾轆轍轔辭辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遜遞邐邏遺遙鄧鄺鄔郵鄒鄴鄰鬱郤郟鄶鄭鄆酈鄖鄲醞醱醬釅釃釀釋裏钜鑒鑾鏨釓釔針釘釗釙釕釷釺釧釤鈒釩釣鍆釹鍚釵鈃鈣鈈鈦鈍鈔鍾鈉鋇鋼鈑鈐鑰欽鈞鎢鉤鈧鈁鈥鈄鈕鈀鈺錢鉦鉗鈷缽鈳鉕鈽鈸鉞鑽鉬鉭鉀鈿鈾鐵鉑鈴鑠鉛鉚鈰鉉鉈鉍鈹鐸鉶銬銠鉺銪鋏鋣鐃銍鐺銅鋁銱銦鎧鍘銖銑鋌銩銛鏵銓鉿銚鉻銘錚銫鉸銥鏟銃鐋銨銀銣鑄鐒鋪鋙錸鋱鏈鏗銷鎖鋰鋥鋤鍋鋯鋨鏽銼鋝鋒鋅鋶鐦鐧銳銻鋃鋟鋦錒錆鍺錯錨錡錁錕錩錫錮鑼錘錐錦鍁錈錇錟錠鍵鋸錳錙鍥鍈鍇鏘鍶鍔鍤鍬鍾鍛鎪鍠鍰鎄鍍鎂鏤鎡鏌鎮鎛鎘鑷鐫鎳鎿鎦鎬鎊鎰鎔鏢鏜鏍鏰鏞鏡鏑鏃鏇鏐鐔钁鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐶鐲鐮鐿鑔鑣鑞鑲長門閂閃閆閈閉問闖閏闈閑閎間閔閌悶閘鬧閨聞闥閩閭闓閥閣閡閫鬮閱閬闍閾閹閶鬩閿閽閻閼闡闌闃闠闊闋闔闐闒闕闞闤隊陽陰陣階際陸隴陳陘陝隉隕險隨隱隸雋難雛讎靂霧霽黴靄靚靜靨韃鞽韉韝韋韌韍韓韙韞韜韻頁頂頃頇項順須頊頑顧頓頎頒頌頏預顱領頗頸頡頰頲頜潁熲頦頤頻頮頹頷頴穎顆題顒顎顓顏額顳顢顛顙顥纇顫顬顰顴風颺颭颮颯颶颸颼颻飀飄飆飆飛饗饜飣饑飥餳飩餼飪飫飭飯飲餞飾飽飼飿飴餌饒餉餄餎餃餏餅餑餖餓餘餒餕餜餛餡館餷饋餶餿饞饁饃餺餾饈饉饅饊饌饢馬馭馱馴馳驅馹駁驢駔駛駟駙駒騶駐駝駑駕驛駘驍罵駰驕驊駱駭駢驫驪騁驗騂駸駿騏騎騍騅騌驌驂騙騭騤騷騖驁騮騫騸驃騾驄驏驟驥驦驤髏髖髕鬢魘魎魚魛魢魷魨魯魴魺鮁鮃鯰鱸鮋鮓鮒鮊鮑鱟鮍鮐鮭鮚鮳鮪鮞鮦鰂鮜鱠鱭鮫鮮鮺鯗鱘鯁鱺鰱鰹鯉鰣鰷鯀鯊鯇鮶鯽鯒鯖鯪鯕鯫鯡鯤鯧鯝鯢鯰鯛鯨鯵鯴鯔鱝鰈鰏鱨鯷鰮鰃鰓鱷鰍鰒鰉鰁鱂鯿鰠鼇鰭鰨鰥鰩鰟鰜鰳鰾鱈鱉鰻鰵鱅鰼鱖鱔鱗鱒鱯鱤鱧鱣鳥鳩雞鳶鳴鳲鷗鴉鶬鴇鴆鴣鶇鸕鴨鴞鴦鴒鴟鴝鴛鴬鴕鷥鷙鴯鴰鵂鴴鵃鴿鸞鴻鵐鵓鸝鵑鵠鵝鵒鷳鵜鵡鵲鶓鵪鶤鵯鵬鵮鶉鶊鵷鷫鶘鶡鶚鶻鶿鶥鶩鷊鷂鶲鶹鶺鷁鶼鶴鷖鸚鷓鷚鷯鷦鷲鷸鷺鸇鷹鸌鸏鸛鸘鹺麥麩黃黌黶黷黲黽黿鼂鼉鞀鼴齇齊齏齒齔齕齗齟齡齙齠齜齦齬齪齲齷龍龔龕龜誌製谘隻裡係範鬆冇嚐嘗鬨麵準鐘彆閒乾儘臟拚]/gu;
		const hanziRegex = /\p{Script=Han}/gu;

		const cjkMatch = rawLyrics.match(
			new RegExp(
				`${kanaRegex.source}|${hanziRegex.source}|${hangulRegex.source}|${/\p{Unified_Ideograph}/gu.source}`,
				"gu",
			),
		);

		if (!cjkMatch) return;

		const kanaCount = cjkMatch.filter((glyph) => kanaRegex.test(glyph)).length;
		const hanziCount = cjkMatch.filter((glyph) => hanziRegex.test(glyph)).length;
		const simpCount = cjkMatch.filter((glyph) => simpRegex.test(glyph)).length;
		const tradCount = cjkMatch.filter((glyph) => tradRegex.test(glyph)).length;

		const kanaPercentage = kanaCount / cjkMatch.length;
		const hanziPercentage = hanziCount / cjkMatch.length;
		const simpPercentage = simpCount / cjkMatch.length;
		const tradPercentage = tradCount / cjkMatch.length;

		if (cjkMatch.filter((glyph) => hangulRegex.test(glyph)).length !== 0) {
			return "ko";
		}

		if (((kanaPercentage - hanziPercentage + 1) / 2) * 100 >= CONFIG.visual["ja-detect-threshold"]) {
			return "ja";
		}

		return ((simpPercentage - tradPercentage + 1) / 2) * 100 >= CONFIG.visual["hans-detect-threshold"]
			? "zh-hans"
			: "zh-hant";
	},
	processTranslatedLyrics(translated, original) {
		return original.map((lyric, index) => ({
			startTime: lyric.startTime || 0,
			text: this.rubyTextToReact(translated[index]),
			originalText: lyric.text,
		}));
	},
	rubyTextToOriginalReact(translated, syncedText) {
		const react = Spicetify.React;
		return react.createElement("p1", null, [
			react.createElement("ruby", {}, syncedText, react.createElement("rt", null, translated)),
		]);
	},
	rubyTextToReact(s) {
		const react = Spicetify.React;
		const rubyElems = s.split("<ruby>");
		const reactChildren = [];

		if (rubyElems[0] !== "") reactChildren.push(rubyElems[0]);
		for (let i = 1; i < rubyElems.length; i++) {
			const kanji = rubyElems[i].split("<rp>")[0];
			const furigana = rubyElems[i].split("<rt>")[1].split("</rt>")[0];
			reactChildren.push(react.createElement("ruby", null, kanji, react.createElement("rt", null, furigana)));

			reactChildren.push(rubyElems[i].split("</ruby>")[1]);
		}
		return react.createElement("p1", null, reactChildren);
	},
	formatTime(timestamp) {
		if (Number.isNaN(timestamp)) return timestamp.toString();
		let minutes = Math.trunc(timestamp / 60000);
		let seconds = ((timestamp - minutes * 60000) / 1000).toFixed(2);

		if (minutes < 10) minutes = `0${minutes}`;
		if (seconds < 10) seconds = `0${seconds}`;

		return `${minutes}:${seconds}`;
	},
	formatTextWithTimestamps(text, startTime = 0) {
		if (text.props?.children) {
			return text.props.children
				.map((child) => {
					if (typeof child === "string") {
						return child;
					}
					if (child.props?.children) {
						return child.props?.children[0];
					}
				})
				.join("");
		}
		if (Array.isArray(text)) {
			let wordTime = startTime;
			return text
				.map((word) => {
					wordTime += word.time;
					return `${word.word}<${this.formatTime(wordTime)}>`;
				})
				.join("");
		}
		return text;
	},
	convertParsedToLRC(lyrics, isBelow) {
		let original = "";
		let conver = "";

		if (isBelow) {
			for (const line of lyrics) {
				original += `[${this.formatTime(line.startTime)}]${this.formatTextWithTimestamps(line.originalText, line.startTime)}\n`;
				conver += `[${this.formatTime(line.startTime)}]${this.formatTextWithTimestamps(line.text, line.startTime)}\n`;
			}
		} else {
			for (const line of lyrics) {
				original += `[${this.formatTime(line.startTime)}]${this.formatTextWithTimestamps(line.text, line.startTime)}\n`;
			}
		}

		return {
			original,
			conver,
		};
	},
	convertParsedToUnsynced(lyrics, isBelow) {
		let original = "";
		let conver = "";

		if (isBelow) {
			for (const line of lyrics) {
				if (typeof line.originalText === "object") {
					original += `${line.originalText?.props?.children?.[0]}\n`;
				} else {
					original += `${line.originalText}\n`;
				}

				if (typeof line.text === "object") {
					conver += `${line.text?.props?.children?.[0]}\n`;
				} else {
					conver += `${line.text}\n`;
				}
			}
		} else {
			for (const line of lyrics) {
				if (typeof line.text === "object") {
					original += `${line.text?.props?.children?.[0]}\n`;
				} else {
					original += `${line.text}\n`;
				}
			}
		}

		return {
			original,
			conver,
		};
	},
	parseLocalLyrics(lyrics) {
		// Preprocess lyrics by removing [tags] and empty lines
		const lines = lyrics
			.replaceAll(/\[[a-zA-Z]+:.+\]/g, "")
			.trim()
			.split("\n");

		const syncedTimestamp = /\[([0-9:.]+)\]/;
		const karaokeTimestamp = /<([0-9:.]+)>/;

		const unsynced = [];

		const isSynced = lines[0].match(syncedTimestamp);
		const synced = isSynced ? [] : null;

		const isKaraoke = lines[0].match(karaokeTimestamp);
		const karaoke = isKaraoke ? [] : null;

		function timestampToMs(timestamp) {
			const [minutes, seconds] = timestamp.replace(/\[\]<>/, "").split(":");
			return Number(minutes) * 60 * 1000 + Number(seconds) * 1000;
		}

		function parseKaraokeLine(line, startTime) {
			let wordTime = timestampToMs(startTime);
			const karaokeLine = [];
			const karaoke = line.matchAll(/(\S+ ?)<([0-9:.]+)>/g);
			for (const match of karaoke) {
				const word = match[1];
				const time = match[2];
				karaokeLine.push({ word, time: timestampToMs(time) - wordTime });
				wordTime = timestampToMs(time);
			}
			return karaokeLine;
		}

		for (const [i, line] of lines.entries()) {
			const time = line.match(syncedTimestamp)?.[1];
			let lyricContent = line.replace(syncedTimestamp, "").trim();
			const lyric = lyricContent.replaceAll(/<([0-9:.]+)>/g, "").trim();

			if (line.trim() !== "") {
				if (isKaraoke) {
					if (!lyricContent.endsWith(">")) {
						// For some reason there are a variety of formats for karaoke lyrics, Wikipedia is also inconsisent in their examples
						const endTime =
							lines[i + 1]?.match(syncedTimestamp)?.[1] ||
							this.formatTime(Number(Spicetify.Player.data.item.metadata.duration));
						lyricContent += `<${endTime}>`;
					}
					const karaokeLine = parseKaraokeLine(lyricContent, time);
					karaoke.push({ text: karaokeLine, startTime: timestampToMs(time) });
				}
				if (isSynced && time) synced.push({ text: lyric || "♪", startTime: timestampToMs(time) });
				unsynced.push({ text: lyric || "♪" });
			}
		}

		return { synced, unsynced, karaoke };
	},
	processLyrics(lyrics) {
		return lyrics
			.replace(/　| /g, "") // Remove space
			.replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~？！，。、《》【】「」]/g, ""); // Remove punctuation
	},
};

// ============================================================================
// Translator.js
// ============================================================================

const kuroshiroPath = "https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js";
const kuromojiPath =
	"https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
const aromanize = "https://cdn.jsdelivr.net/npm/aromanize@0.1.5/aromanize.min.js";
const openCCPath = "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.min.js";

const dictPath = "https:/cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

class Translator {
	constructor(lang, isUsingNetease = false) {
		this.finished = {
			ja: false,
			ko: false,
			zh: false,
		};
		this.isUsingNetease = isUsingNetease;

		this.applyKuromojiFix();
		this.injectExternals(lang);
		this.createTranslator(lang);
	}

	includeExternal(url) {
		if ((CONFIG.visual.translate || this.isUsingNetease) && !document.querySelector(`script[src="${url}"]`)) {
			const script = document.createElement("script");
			script.setAttribute("type", "text/javascript");
			script.setAttribute("src", url);
			document.head.appendChild(script);
		}
	}

	injectExternals(lang) {
		switch (lang?.slice(0, 2)) {
			case "ja":
				this.includeExternal(kuromojiPath);
				this.includeExternal(kuroshiroPath);
				break;
			case "ko":
				this.includeExternal(aromanize);
				break;
			case "zh":
				this.includeExternal(openCCPath);
				break;
		}
	}

	async awaitFinished(language) {
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				this.injectExternals(language);
				this.createTranslator(language);

				const lan = language.slice(0, 2);
				if (this.finished[lan]) {
					clearInterval(interval);
					resolve();
				}
			}, 100);
		});
	}

	/**
	 * Fix an issue with kuromoji when loading dict from external urls
	 * Adapted from: https://github.com/mobilusoss/textlint-browser-runner/pull/7
	 */
	applyKuromojiFix() {
		if (typeof XMLHttpRequest.prototype.realOpen !== "undefined") return;
		XMLHttpRequest.prototype.realOpen = XMLHttpRequest.prototype.open;
		XMLHttpRequest.prototype.open = function (method, url, bool) {
			if (url.indexOf(dictPath.replace("https://", "https:/")) === 0) {
				this.realOpen(method, url.replace("https:/", "https://"), bool);
			} else {
				this.realOpen(method, url, bool);
			}
		};
	}

	async createTranslator(lang) {
		switch (lang.slice(0, 2)) {
			case "ja":
				if (this.kuroshiro) return;
				if (typeof Kuroshiro === "undefined" || typeof KuromojiAnalyzer === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.kuroshiro = new Kuroshiro.default();
				this.kuroshiro.init(new KuromojiAnalyzer({ dictPath })).then(
					function () {
						this.finished.ja = true;
					}.bind(this),
				);

				break;
			case "ko":
				if (this.Aromanize) return;
				if (typeof Aromanize === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.Aromanize = Aromanize;
				this.finished.ko = true;
				break;
			case "zh":
				if (this.OpenCC) return;
				if (typeof OpenCC === "undefined") {
					await Translator.#sleep(50);
					return this.createTranslator(lang);
				}

				this.OpenCC = OpenCC;
				this.finished.zh = true;
				break;
		}
	}

	async romajifyText(text, target = "romaji", mode = "spaced") {
		if (!this.finished.ja) {
			await Translator.#sleep(100);
			return this.romajifyText(text, target, mode);
		}

		return this.kuroshiro.convert(text, {
			to: target,
			mode: mode,
		});
	}

	async convertToRomaja(text, target) {
		if (!this.finished.ko) {
			await Translator.#sleep(100);
			return this.convertToRomaja(text, target);
		}

		if (target === "hangul") return text;
		return Aromanize.hangulToLatin(text, "rr-translit");
	}

	async convertChinese(text, from, target) {
		if (!this.finished.zh) {
			await Translator.#sleep(100);
			return this.convertChinese(text, from, target);
		}

		const converter = this.OpenCC.Converter({
			from: from,
			to: target,
		});

		return converter(text);
	}

	/**
	 * Async wrapper of `setTimeout`.
	 *
	 * @param {number} ms
	 * @returns {Promise<void>}
	 */
	static async #sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ============================================================================
// ProviderMusixmatch.js
// ============================================================================

const ProviderMusixmatch = (() => {
	const headers = {
		Host: "apic-appmobile.musixmatch.com",
		authority: "apic-appmobile.musixmatch.com",
		"X-Cookie": "x-mxm-token-guid=",
		"x-mxm-app-version": "10.1.1",
		"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
		"Accept-Language": "en-US,en;q=0.9",
		Connection: "keep-alive",
		Accept: "application/json",
	};

	function findTranslationStatus(body) {
		if (!body || typeof body !== "object") {
			return null;
		}

		if (Array.isArray(body)) {
			for (const item of body) {
				const result = findTranslationStatus(item);
				if (result) {
					return result;
				}
			}

			return null;
		}

		if (Array.isArray(body.track_lyrics_translation_status)) {
			return body.track_lyrics_translation_status;
		}

		for (const value of Object.values(body)) {
			const result = findTranslationStatus(value);
			if (result) {
				return result;
			}
		}

		return null;
	}

	async function findLyrics(info) {
		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=mac-ios-v2.0&";

		const durr = info.duration / 1000;

		const params = {
			q_album: info.album,
			q_artist: info.artist,
			q_artists: info.artist,
			q_track: info.title,
			track_spotify_id: info.uri,
			q_duration: durr,
			f_subtitle_length: Math.floor(durr),
			usertoken: CONFIG.providers.musixmatch.token,
			part: "track_lyrics_translation_status,track_structure,track_performer_tagging",
		};

		const finalURL =
			baseURL +
			Object.keys(params)
				.map((key) => `${key}=${encodeURIComponent(params[key])}`)
				.join("&");

		let body = await Spicetify.CosmosAsync.get(finalURL, null, headers);

		body = body.message.body.macro_calls;

		if (body["matcher.track.get"].message.header.status_code !== 200) {
			return {
				error: `Requested error: ${body["matcher.track.get"].message.header.mode}`,
				uri: info.uri,
			};
		}
		if (body["track.lyrics.get"]?.message?.body?.lyrics?.restricted) {
			return {
				error: "Unfortunately we're not authorized to show these lyrics.",
				uri: info.uri,
			};
		}

		const translationStatus = findTranslationStatus(body);
		const meta = body?.["matcher.track.get"]?.message?.body;
		const availableTranslations = Array.isArray(translationStatus)
			? [...new Set(translationStatus.map((status) => status?.to).filter(Boolean))]
			: [];

		Object.defineProperties(body, {
			__musixmatchTranslationStatus: {
				value: availableTranslations,
			},
			__musixmatchTrackId: {
				value: meta?.track?.track_id ?? null,
			},
		});

		return body;
	}

	function parsePerformerData(meta) {
		if (!meta || !meta.track || !meta.track.performer_tagging) {
			return [];
		}

		const tagging = meta.track.performer_tagging;
		const miscTags = meta.track.performer_tagging_misc_tags || {};
		let performerMap = [];
		if (tagging && tagging.content && tagging.content.length > 0) {
			const resources = tagging.resources?.artists || [];
			const resourcesList = Array.isArray(resources) ? resources : Object.values(resources);

			performerMap = tagging.content
				.map((c) => {
					if (!c.performers || c.performers.length === 0) return null;

					const resolvedPerformers = c.performers
						.map((p) => {
							let name = "Unknown";
							if (p.type === "artist") {
								const fqid = p.fqid;
								const idFromFqid = fqid ? parseInt(fqid.split(":")[2]) : null;

								const artist = resourcesList.find((r) => r.artist_id === idFromFqid);
								if (artist) name = artist.artist_name;
							} else if (miscTags[p.type]) {
								name = miscTags[p.type];
							}
							return {
								fqid: p.fqid,
								artist_id: p.fqid ? parseInt(p.fqid.split(":")[2]) : null,
								name: name,
							};
						})
						.filter((p) => p.name !== "Unknown");

					const names = resolvedPerformers.map((p) => p.name);
					if (names.length === 0) return null;

					return {
						name: names.join(", "),
						snippet: c.snippet,
						performers: resolvedPerformers,
					};
				})
				.filter(Boolean);
		}

		const normalizeForMatch = (text) => text.replace(/\s+/g, "").toLowerCase();

		const snippetQueue = [];
		if (performerMap.length > 0) {
			for (const tag of performerMap) {
				if (!tag.snippet) continue;
				const snippetLines = tag.snippet
					.split(/\n+/)
					.map((s) => s.trim())
					.filter(Boolean);
				for (const sLine of snippetLines) {
					if (sLine.length < 2 && !/^[\u3131-\uD79D]/.test(sLine)) continue;
					snippetQueue.push({
						text: normalizeForMatch(sLine),
						raw: sLine,
						performers: tag.performers,
					});
				}
			}
		}
		return snippetQueue;
	}

	function matchSequential(lyricsLines, snippetQueue, getTextCallback = (l) => l.text) {
		if (!snippetQueue || snippetQueue.length === 0) return lyricsLines;

		const normalizeForMatch = (text) => text.replace(/\s+/g, "").toLowerCase();
		let queueCursor = 0;
		const LOOKAHEAD = 5;

		return lyricsLines.map((line) => {
			const lineText = getTextCallback(line) || "♪";
			let normalizedLine = normalizeForMatch(lineText);

			let matchedPerformers = [];

			while (queueCursor < snippetQueue.length) {
				let matchFoundAtOffset = -1;

				for (let i = 0; i < LOOKAHEAD && queueCursor + i < snippetQueue.length; i++) {
					const snippet = snippetQueue[queueCursor + i];

					if (normalizedLine.includes(snippet.text) && snippet.text.length > 0) {
						matchFoundAtOffset = i;
						break;
					}
				}

				if (matchFoundAtOffset !== -1) {
					queueCursor += matchFoundAtOffset;
					const matchedSnippet = snippetQueue[queueCursor];
					matchedPerformers.push(...matchedSnippet.performers);
					normalizedLine = normalizedLine.replace(matchedSnippet.text, "");
					queueCursor++;
				} else {
					break;
				}
			}

			const uniquePerformers = [];
			const sawMap = new Set();
			for (const p of matchedPerformers) {
				const key = p.fqid || p.name;
				if (!sawMap.has(key)) {
					sawMap.add(key);
					uniquePerformers.push(p);
				}
			}

			return {
				...line,
				performers: uniquePerformers,
			};
		});
	}

	async function getKaraoke(body) {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta) {
			return null;
		}

		if (!meta.track.has_richsync || meta.track.instrumental) {
			return null;
		}

		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/track.richsync.get?format=json&subtitle_format=mxm&app_id=mac-ios-v2.0&";

		const params = {
			f_subtitle_length: meta.track.track_length,
			q_duration: meta.track.track_length,
			commontrack_id: meta.track.commontrack_id,
			usertoken: CONFIG.providers.musixmatch.token,
		};

		const finalURL =
			baseURL +
			Object.keys(params)
				.map((key) => `${key}=${encodeURIComponent(params[key])}`)
				.join("&");

		let result = await Spicetify.CosmosAsync.get(finalURL, null, headers);

		if (result.message.header.status_code !== 200) {
			return null;
		}

		result = result.message.body;

		const snippetQueue = parsePerformerData(meta);

		const parsedKaraoke = JSON.parse(result.richsync.richsync_body).map((line) => {
			const startTime = line.ts * 1000;
			const endTime = line.te * 1000;
			const words = line.l;

			const text = words.map((word, index, words) => {
				const wordText = word.c;
				const wordStartTime = word.o * 1000;
				const nextWordStartTime = words[index + 1]?.o * 1000;

				const time = !Number.isNaN(nextWordStartTime)
					? nextWordStartTime - wordStartTime
					: endTime - (wordStartTime + startTime);

				return {
					word: wordText,
					time,
				};
			});
			return {
				startTime,
				endTime,
				text,
			};
		});

		return matchSequential(parsedKaraoke, snippetQueue, (line) => {
			if (Array.isArray(line.text)) {
				return line.text.map((t) => t.word).join("");
			}
			return line.text;
		}).map((line) => {
			const performerNames = (line.performers || [])
				.map((p) => p.name)
				.filter(Boolean)
				.join(", ");
			return {
				...line,
				performer: performerNames || null,
			};
		});
	}

	function getSynced(body) {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta) {
			return null;
		}

		const hasSynced = meta?.track?.has_subtitles;

		const isInstrumental = meta?.track?.instrumental;

		if (isInstrumental) {
			return [{ text: "♪ Instrumental ♪", startTime: "0000" }];
		}
		if (hasSynced) {
			const subtitle = body["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle;
			if (!subtitle) {
				return null;
			}

			const snippetQueue = parsePerformerData(meta);
			const rawLines = JSON.parse(subtitle.subtitle_body);

			return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => {
				const lineText = line.text || "♪";
				const performerNames = (line.performers || [])
					.map((p) => p.name)
					.filter(Boolean)
					.join(", ");

				return {
					text: lineText,
					startTime: line.time.total * 1000,
					performer: performerNames || null,
				};
			});
		}

		return null;
	}

	function getUnsynced(body) {
		const meta = body?.["matcher.track.get"]?.message?.body;
		if (!meta) {
			return null;
		}

		const hasUnSynced = meta.track.has_lyrics || meta.track.has_lyrics_crowd;

		const isInstrumental = meta?.track?.instrumental;

		if (isInstrumental) {
			return [{ text: "♪ Instrumental ♪" }];
		}
		if (hasUnSynced) {
			const lyrics = body["track.lyrics.get"]?.message?.body?.lyrics?.lyrics_body;
			if (!lyrics) {
				return null;
			}

			const snippetQueue = parsePerformerData(meta);
			const rawLines = lyrics.split("\n").map((text) => ({ text }));

			return matchSequential(rawLines, snippetQueue, (l) => l.text).map((line) => {
				const performerNames = (line.performers || [])
					.map((p) => p.name)
					.filter(Boolean)
					.join(", ");

				return {
					...line,
					performer: performerNames || null,
				};
			});
		}

		return null;
	}

	async function getTranslation(trackId) {
		if (!trackId) return null;

		const selectedLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		if (selectedLanguage === "none") return null;

		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/crowd.track.translations.get?translation_fields_set=minimal&comment_format=text&format=json&app_id=mac-ios-v2.0&";

		const params = {
			track_id: trackId,
			selected_language: selectedLanguage,
			usertoken: CONFIG.providers.musixmatch.token,
		};

		const finalURL =
			baseURL +
			Object.keys(params)
				.map((key) => `${key}=${encodeURIComponent(params[key])}`)
				.join("&");

		let result = await Spicetify.CosmosAsync.get(finalURL, null, headers);

		if (result.message.header.status_code !== 200) return null;

		result = result.message.body;

		if (!result.translations_list?.length) return null;

		return result.translations_list.map(({ translation }) => ({
			translation: translation.description,
			matchedLine: translation.matched_line,
		}));
	}

	let languageMap = null;
	async function getLanguages() {
		if (languageMap) return languageMap;

		try {
			const cached = localStorage.getItem("lyrics-plus:musixmatch-languages");
			if (cached) {
				const tempMap = JSON.parse(cached);
				// Check cache version
				if (tempMap.__version === 1) {
					delete tempMap.__version;
					languageMap = tempMap;
					return languageMap;
				}
			}
		} catch (e) {
			console.warn("Failed to parse cached languages", e);
		}

		const baseURL =
			"https://apic-appmobile.musixmatch.com/ws/1.1/languages.get?app_id=mac-ios-v2.0&get_romanized_info=1&";

		const params = {
			usertoken: CONFIG.providers.musixmatch.token,
		};

		const finalURL =
			baseURL +
			Object.keys(params)
				.map((key) => `${key}=${encodeURIComponent(params[key])}`)
				.join("&");

		try {
			let body = await Spicetify.CosmosAsync.get(finalURL, null, headers);
			if (body?.message?.body?.language_list) {
				languageMap = {};
				body.message.body.language_list.forEach((item) => {
					const lang = item.language;
					if (lang.language_name) {
						const name = lang.language_name.charAt(0).toUpperCase() + lang.language_name.slice(1);
						if (lang.language_iso_code_1) languageMap[lang.language_iso_code_1] = name;
						if (lang.language_iso_code_3) languageMap[lang.language_iso_code_3] = name;
					}
				});
				localStorage.setItem(
					"lyrics-plus:musixmatch-languages",
					JSON.stringify({ ...languageMap, __version: 1 }),
				);
				return languageMap;
			}
		} catch (e) {
			console.error("Failed to fetch languages", e);
		}
		return {};
	}

	return { findLyrics, getKaraoke, getSynced, getUnsynced, getTranslation, getLanguages };
})();

// ============================================================================
// ProviderLRCLIB.js
// ============================================================================

const ProviderLRCLIB = (() => {
	async function findLyrics(info) {
		const baseURL = "https://lrclib.net/api/get";
		const durr = info.duration / 1000;
		const params = {
			track_name: info.title,
			artist_name: info.artist,
			album_name: info.album,
			duration: durr,
		};

		const finalURL = `${baseURL}?${Object.keys(params)
			.map((key) => `${key}=${encodeURIComponent(params[key])}`)
			.join("&")}`;

		const body = await fetch(finalURL, {
			headers: {
				"x-user-agent": `spicetify v${Spicetify.Config.version} (https://github.com/spicetify/cli)`,
			},
		});

		if (body.status !== 200) {
			return {
				error: "Request error: Track wasn't found",
				uri: info.uri,
			};
		}

		return await body.json();
	}

	function getUnsynced(body) {
		const unsyncedLyrics = body?.plainLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪" }];

		if (!unsyncedLyrics) return null;

		return Utils.parseLocalLyrics(unsyncedLyrics).unsynced;
	}

	function getSynced(body) {
		const syncedLyrics = body?.syncedLyrics;
		const isInstrumental = body.instrumental;
		if (isInstrumental) return [{ text: "♪ Instrumental ♪" }];

		if (!syncedLyrics) return null;

		return Utils.parseLocalLyrics(syncedLyrics).synced;
	}

	return { findLyrics, getSynced, getUnsynced };
})();

// ============================================================================
// ProviderNetease.js
// ============================================================================

const ProviderNetease = (() => {
	const requestHeader = {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0",
	};

	async function findLyrics(info) {
		const searchURL = "https://music.xianqiao.wang/neteaseapiv2/search?limit=10&type=1&keywords=";
		const lyricURL = "https://music.xianqiao.wang/neteaseapiv2/lyric?id=";

		const cleanTitle = Utils.removeExtraInfo(Utils.removeSongFeat(Utils.normalize(info.title)));
		const finalURL = searchURL + encodeURIComponent(`${cleanTitle} ${info.artist}`);

		const searchResults = await Spicetify.CosmosAsync.get(finalURL, null, requestHeader);
		const items = searchResults.result.songs;
		if (!items?.length) {
			throw "Cannot find track";
		}

		// normalized expected album name
		const neAlbumName = Utils.normalize(info.album);
		const expectedAlbumName = Utils.containsHanCharacter(neAlbumName)
			? await Utils.toSimplifiedChinese(neAlbumName)
			: neAlbumName;
		let itemId = items.findIndex((val) => Utils.normalize(val.album.name) === expectedAlbumName);
		if (itemId === -1) itemId = items.findIndex((val) => Math.abs(info.duration - val.duration) < 3000);
		if (itemId === -1) itemId = items.findIndex((val) => val.name === cleanTitle);
		if (itemId === -1) throw "Cannot find track";

		return await Spicetify.CosmosAsync.get(lyricURL + items[itemId].id, null, requestHeader);
	}

	const creditInfo = [
		"\\s?作?\\s*词|\\s?作?\\s*曲|\\s?编\\s*曲?|\\s?监\\s*制?",
		".*编写|.*和音|.*和声|.*合声|.*提琴|.*录|.*工程|.*工作室|.*设计|.*剪辑|.*制作|.*发行|.*出品|.*后期|.*混音|.*缩混",
		"原唱|翻唱|题字|文案|海报|古筝|二胡|钢琴|吉他|贝斯|笛子|鼓|弦乐",
		"lrc|publish|vocal|guitar|program|produce|write|mix",
	];
	const creditInfoRegExp = new RegExp(`^(${creditInfo.join("|")}).*(:|：)`, "i");

	function containCredits(text) {
		return creditInfoRegExp.test(text);
	}

	function parseTimestamp(line) {
		// ["[ar:Beyond]"]
		// ["[03:10]"]
		// ["[03:10]", "lyrics"]
		// ["lyrics"]
		// ["[03:10]", "[03:10]", "lyrics"]
		// ["[1235,300]", "lyrics"]
		const matchResult = line.match(/(\[.*?\])|([^[\]]+)/g);
		if (!matchResult?.length || matchResult.length === 1) {
			return { text: line };
		}

		const textIndex = matchResult.findIndex((slice) => !slice.endsWith("]"));
		let text = "";

		if (textIndex > -1) {
			text = matchResult.splice(textIndex, 1)[0];
			text = Utils.capitalize(Utils.normalize(text, false));
		}

		const time = matchResult[0].replace("[", "").replace("]", "");

		return { time, text };
	}

	function breakdownLine(text) {
		// (0,508)Don't(0,1) (0,151)want(0,1) (0,162)to(0,1) (0,100)be(0,1) (0,157)an(0,1)
		const components = text.split(/\(\d+,(\d+)\)/g);
		// ["", "508", "Don't", "1", " ", "151", "want" , "1" ...]
		const result = [];
		for (let i = 1; i < components.length; i += 2) {
			if (components[i + 1] === " ") continue;
			result.push({
				word: `${components[i + 1]} `,
				time: Number.parseInt(components[i]),
			});
		}
		return result;
	}

	function getKaraoke(list) {
		const lyricStr = list?.klyric?.lyric;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const karaoke = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (!time || !text) return null;

				const [key, value] = time.split(",") || [];
				const [start, durr] = [Number.parseFloat(key), Number.parseFloat(value)];

				if (!Number.isNaN(start) && !Number.isNaN(durr) && !containCredits(text)) {
					return {
						startTime: start,
						// endTime: start + durr,
						text: breakdownLine(text),
					};
				}
				return null;
			})
			.filter(Boolean);

		if (!karaoke.length) {
			return null;
		}

		return karaoke;
	}

	function getSynced(list) {
		const lyricStr = list?.lrc?.lyric;
		let noLyrics = false;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const lyrics = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (text === "纯音乐, 请欣赏") noLyrics = true;
				if (!time || !text) return null;

				const [key, value] = time.split(":") || [];
				const [min, sec] = [Number.parseFloat(key), Number.parseFloat(value)];
				if (!Number.isNaN(min) && !Number.isNaN(sec) && !containCredits(text)) {
					return {
						startTime: (min * 60 + sec) * 1000,
						text: text || "",
					};
				}
				return null;
			})
			.filter(Boolean);

		if (!lyrics.length || noLyrics) {
			return null;
		}
		return lyrics;
	}

	function getTranslation(list) {
		const lyricStr = list?.tlyric?.lyric;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const translation = lines
			.map((line) => {
				const { time, text } = parseTimestamp(line);
				if (!time || !text) return null;

				const [key, value] = time.split(":") || [];
				const [min, sec] = [Number.parseFloat(key), Number.parseFloat(value)];
				if (!Number.isNaN(min) && !Number.isNaN(sec) && !containCredits(text)) {
					return {
						startTime: (min * 60 + sec) * 1000,
						text: text || "",
					};
				}
				return null;
			})
			.filter(Boolean);

		if (!translation.length) {
			return null;
		}
		return translation;
	}

	function getUnsynced(list) {
		const lyricStr = list?.lrc?.lyric;
		let noLyrics = false;

		if (!lyricStr) {
			return null;
		}

		const lines = lyricStr.split(/\r?\n/).map((line) => line.trim());
		const lyrics = lines
			.map((line) => {
				const parsed = parseTimestamp(line);
				if (parsed.text === "纯音乐, 请欣赏") noLyrics = true;
				if (!parsed.text || containCredits(parsed.text)) return null;
				return parsed;
			})
			.filter(Boolean);

		if (!lyrics.length || noLyrics) {
			return null;
		}
		return lyrics;
	}

	return { findLyrics, getKaraoke, getSynced, getUnsynced, getTranslation };
})();

// ============================================================================
// ProviderGenius.js
// ============================================================================

const ProviderGenius = (() => {
	function getChildDeep(parent, isDeep = false) {
		let acc = "";

		if (!parent.children) {
			return acc;
		}

		for (const child of parent.children) {
			if (typeof child === "string") {
				acc += child;
			} else if (child.children) {
				acc += getChildDeep(child, true);
			}
			if (!isDeep) {
				acc += "\n";
			}
		}
		return acc.trim();
	}

	async function getNote(id) {
		const body = await Spicetify.CosmosAsync.get(`https://genius.com/api/annotations/${id}`);
		const response = body.response;
		let note = "";

		// Authors annotations
		if (response.referent && response.referent.classification === "verified") {
			const referentsBody = await Spicetify.CosmosAsync.get(`https://genius.com/api/referents/${id}`);
			const referents = referentsBody.response;
			for (const ref of referents.referent.annotations) {
				note += getChildDeep(ref.body.dom);
			}
		}

		// Users annotations
		if (!note && response.annotation) {
			note = getChildDeep(response.annotation.body.dom);
		}

		// Users comments
		if (!note && response.annotation && response.annotation.top_comment) {
			note += getChildDeep(response.annotation.top_comment.body.dom);
		}
		note = note.replace(/\n\n\n?/, "\n");

		return note;
	}

	function fetchHTML(url) {
		return new Promise((resolve, reject) => {
			const request = JSON.stringify({
				method: "GET",
				uri: url,
			});

			window.sendCosmosRequest({
				request,
				persistent: false,
				onSuccess: resolve,
				onFailure: reject,
			});
		});
	}

	async function fetchLyricsVersion(results, index) {
		const result = results[index];
		if (!result) {
			console.warn(result);
			return;
		}

		const site = await fetchHTML(result.url);
		const body = JSON.parse(site)?.body;
		if (!body) {
			return null;
		}

		let lyrics = "";
		const parser = new DOMParser();
		const htmlDoc = parser.parseFromString(body, "text/html");
		const lyricsDiv = htmlDoc.querySelectorAll('div[data-lyrics-container="true"]');

		for (const i of lyricsDiv) {
			lyrics += `${i.innerHTML}<br>`;
		}

		if (!lyrics?.length) {
			console.warn("forceError");
			return null;
		}

		return lyrics;
	}

	async function fetchLyrics(info) {
		const titles = new Set([info.title]);

		const titleNoExtra = Utils.removeExtraInfo(info.title);
		titles.add(titleNoExtra);
		titles.add(Utils.removeSongFeat(info.title));
		titles.add(Utils.removeSongFeat(titleNoExtra));

		let lyrics;
		let hits;
		for (const title of titles) {
			const query = new URLSearchParams({ per_page: 20, q: `${info.artist} ${title}` });
			const url = `https://genius.com/api/search/song?${query.toString()}`;

			const geniusSearch = await Spicetify.CosmosAsync.get(url);

			hits = geniusSearch.response.sections[0].hits.map((item) => ({
				title: item.result.full_title,
				url: item.result.url,
			}));

			if (!hits.length) {
				continue;
			}

			lyrics = await fetchLyricsVersion(hits, 0);
			break;
		}

		if (!lyrics) {
			return { lyrics: null, versions: [] };
		}

		return { lyrics, versions: hits };
	}

	return { fetchLyrics, getNote, fetchLyricsVersion };
})();

// ============================================================================
// Providers.js
// ============================================================================

const Providers = {
	spotify: async (info) => {
		const result = {
			uri: info.uri,
			karaoke: null,
			synced: null,
			unsynced: null,
			provider: "Spotify",
			copyright: null,
		};

		const baseURL = "https://spclient.wg.spotify.com/color-lyrics/v2/track/";
		const id = info.uri.split(":")[2];
		let body;
		try {
			body = await Spicetify.CosmosAsync.get(`${baseURL + id}?format=json&vocalRemoval=false&market=from_token`);
		} catch {
			return { error: "Request error", uri: info.uri };
		}

		const lyrics = body.lyrics;
		if (!lyrics) {
			return { error: "No lyrics", uri: info.uri };
		}

		const lines = lyrics.lines;
		if (lyrics.syncType === "LINE_SYNCED") {
			result.synced = lines.map((line) => ({
				startTime: line.startTimeMs,
				text: line.words,
			}));
			result.unsynced = result.synced;
		} else {
			result.unsynced = lines.map((line) => ({
				text: line.words,
			}));
		}

		/**
		 * to distinguish it from the existing Musixmatch, the provider will remain as Spotify.
		 * if Spotify official lyrics support multiple providers besides Musixmatch in the future, please uncomment the under section. */
		// result.provider = lyrics.provider;

		return result;
	},
	musixmatch: async (info) => {
		const result = {
			error: null,
			uri: info.uri,
			karaoke: null,
			synced: null,
			unsynced: null,
			musixmatchTranslation: null,
			musixmatchAvailableTranslations: [],
			musixmatchTrackId: null,
			musixmatchTranslationLanguage: null,
			provider: "Musixmatch",
			copyright: null,
		};

		let list;
		try {
			list = await ProviderMusixmatch.findLyrics(info);
			if (list.error) {
				throw "";
			}
		} catch {
			result.error = "No lyrics";
			return result;
		}

		const karaoke = await ProviderMusixmatch.getKaraoke(list);
		if (karaoke) {
			result.karaoke = karaoke;
			result.copyright = list["track.lyrics.get"].message?.body?.lyrics?.lyrics_copyright?.trim();
		}
		const synced = ProviderMusixmatch.getSynced(list);
		if (synced) {
			result.synced = synced;
			result.copyright =
				list["track.subtitles.get"].message?.body?.subtitle_list?.[0]?.subtitle.lyrics_copyright.trim();
		}
		const unsynced = synced || ProviderMusixmatch.getUnsynced(list);
		if (unsynced) {
			result.unsynced = unsynced;
			result.copyright = list["track.lyrics.get"].message?.body?.lyrics?.lyrics_copyright?.trim();
		}
		result.musixmatchAvailableTranslations = Array.isArray(list.__musixmatchTranslationStatus)
			? list.__musixmatchTranslationStatus
			: [];
		result.musixmatchTrackId = list.__musixmatchTrackId ?? null;

		const selectedLanguage = CONFIG.visual["musixmatch-translation-language"];
		const canRequestTranslation =
			selectedLanguage &&
			selectedLanguage !== "none" &&
			result.musixmatchAvailableTranslations.includes(selectedLanguage);

		const translation = canRequestTranslation
			? await ProviderMusixmatch.getTranslation(result.musixmatchTrackId)
			: null;
		if ((synced || unsynced) && Array.isArray(translation) && translation.length) {
			const normalizeLyrics =
				typeof Utils !== "undefined" && typeof Utils.processLyrics === "function"
					? (value) => Utils.processLyrics(value ?? "")
					: (value) =>
							typeof value === "string"
								? value
										.replace(/　| /g, "")
										.replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~？！，。、《》【】「」]/g, "")
								: "";

			const translationMap = new Map();
			for (const entry of translation) {
				const normalizedMatched = normalizeLyrics(entry.matchedLine);
				if (!translationMap.has(normalizedMatched)) {
					translationMap.set(normalizedMatched, entry.translation);
				}
			}

			const baseLyrics = synced ?? unsynced;
			result.musixmatchTranslation = baseLyrics.map((line) => {
				const originalText = line.text;
				const normalizedOriginal = normalizeLyrics(originalText);
				return {
					...line,
					text: translationMap.get(normalizedOriginal) ?? line.text,
					originalText,
				};
			});
			result.musixmatchTranslationLanguage = selectedLanguage;
		}

		return result;
	},
	netease: async (info) => {
		const result = {
			uri: info.uri,
			karaoke: null,
			synced: null,
			unsynced: null,
			neteaseTranslation: null,
			provider: "Netease",
			copyright: null,
		};

		let list;
		try {
			list = await ProviderNetease.findLyrics(info);
		} catch {
			result.error = "No lyrics";
			return result;
		}

		const karaoke = ProviderNetease.getKaraoke(list);
		if (karaoke) {
			result.karaoke = karaoke;
		}
		const synced = ProviderNetease.getSynced(list);
		if (synced) {
			result.synced = synced;
		}
		const unsynced = synced || ProviderNetease.getUnsynced(list);
		if (unsynced) {
			result.unsynced = unsynced;
		}
		const translation = ProviderNetease.getTranslation(list);
		if ((synced || unsynced) && Array.isArray(translation)) {
			const baseLyrics = synced ?? unsynced;
			result.neteaseTranslation = baseLyrics.map((line) => ({
				...line,
				text: translation.find((t) => t.startTime === line.startTime)?.text ?? line.text,
				originalText: line.text,
			}));
		}

		return result;
	},
	lrclib: async (info) => {
		const result = {
			uri: info.uri,
			karaoke: null,
			synced: null,
			unsynced: null,
			provider: "lrclib",
			copyright: null,
		};

		let list;
		try {
			list = await ProviderLRCLIB.findLyrics(info);
		} catch {
			result.error = "No lyrics";
			return result;
		}

		const synced = ProviderLRCLIB.getSynced(list);
		if (synced) {
			result.synced = synced;
		}

		const unsynced = synced || ProviderLRCLIB.getUnsynced(list);

		if (unsynced) {
			result.unsynced = unsynced;
		}

		return result;
	},
	genius: async (info) => {
		const { lyrics, versions } = await ProviderGenius.fetchLyrics(info);

		let versionIndex2 = 0;
		let genius2 = lyrics;
		if (CONFIG.visual["dual-genius"] && versions.length > 1) {
			genius2 = await ProviderGenius.fetchLyricsVersion(versions, 1);
			versionIndex2 = 1;
		}

		return {
			uri: info.uri,
			genius: lyrics,
			provider: "Genius",
			karaoke: null,
			synced: null,
			unsynced: null,
			copyright: null,
			error: null,
			versions,
			versionIndex: 0,
			genius2,
			versionIndex2,
		};
	},
	local: (info) => {
		let result = {
			uri: info.uri,
			karaoke: null,
			synced: null,
			unsynced: null,
			provider: "local",
		};

		try {
			const savedLyrics = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics"));
			const lyrics = savedLyrics[info.uri];
			if (!lyrics) {
				throw "";
			}

			result = {
				...result,
				...lyrics,
			};
		} catch {
			result.error = "No lyrics";
		}

		return result;
	},
};

// ============================================================================
// OptionsMenu.js
// ============================================================================

const OptionsMenuItemIcon = react.createElement(
	"svg",
	{
		width: 16,
		height: 16,
		viewBox: "0 0 16 16",
		fill: "currentColor",
	},
	react.createElement("path", {
		d: "M13.985 2.383L5.127 12.754 1.388 8.375l-.658.77 4.397 5.149 9.618-11.262z",
	}),
);

const OptionsMenuItem = react.memo(({ onSelect, value, isSelected }) => {
	return react.createElement(
		Spicetify.ReactComponent.MenuItem,
		{
			onClick: onSelect,
			icon: isSelected ? OptionsMenuItemIcon : null,
			trailingIcon: isSelected ? OptionsMenuItemIcon : null,
		},
		value,
	);
});

const OptionsMenu = react.memo(({ options, onSelect, selected, defaultValue, bold = false }) => {
	/**
	 * <Spicetify.ReactComponent.ContextMenu
	 *      menu = { options.map(a => <OptionsMenuItem>) }
	 * >
	 *      <button>
	 *          <span> {select.value} </span>
	 *          <svg> arrow icon </svg>
	 *      </button>
	 * </Spicetify.ReactComponent.ContextMenu>
	 */
	const menuRef = react.useRef(null);
	return react.createElement(
		Spicetify.ReactComponent.ContextMenu,
		{
			menu: react.createElement(
				Spicetify.ReactComponent.Menu,
				{},
				options.map(({ key, value }) =>
					react.createElement(OptionsMenuItem, {
						value,
						onSelect: () => {
							onSelect(key);
							// Close menu on item click
							menuRef.current?.click();
						},
						isSelected: selected?.key === key,
					}),
				),
			),
			trigger: "click",
			action: "toggle",
			renderInline: false,
		},
		react.createElement(
			"button",
			{
				className: "optionsMenu-dropBox",
				ref: menuRef,
			},
			react.createElement(
				"span",
				{
					className: bold ? "main-type-mestoBold" : "main-type-mesto",
				},
				selected?.value || defaultValue,
			),
			react.createElement(
				"svg",
				{
					height: "16",
					width: "16",
					fill: "currentColor",
					viewBox: "0 0 16 16",
				},
				react.createElement("path", {
					d: "M3 6l5 5.794L13 6z",
				}),
			),
		),
	);
});

function getMusixmatchTranslationPrefix() {
	if (typeof window !== "undefined" && typeof window.__lyricsPlusMusixmatchTranslationPrefix === "string") {
		return window.__lyricsPlusMusixmatchTranslationPrefix;
	}

	return "musixmatchTranslation:";
}

const TranslationMenu = react.memo(
	({ friendlyLanguage, hasTranslation, musixmatchLanguages, musixmatchSelectedLanguage }) => {
		const musixmatchTranslationPrefix = getMusixmatchTranslationPrefix();

		const [languageMap, setLanguageMap] = react.useState({});

		react.useEffect(() => {
			let cancelled = false;

			if (
				typeof ProviderMusixmatch !== "undefined" &&
				ProviderMusixmatch &&
				typeof ProviderMusixmatch.getLanguages === "function"
			) {
				(async () => {
					try {
						const languages = await ProviderMusixmatch.getLanguages();
						if (!cancelled) {
							setLanguageMap(languages);
						}
					} catch (error) {
						console.error("Failed to fetch Musixmatch languages:", error);
					}
				})();
			}

			return () => {
				cancelled = true;
			};
		}, []);

		const items = useMemo(() => {
			let sourceOptions = {
				none: "None",
			};

			const translationDisplayOptions = {
				replace: "Replace original",
				below: "Below original",
			};

			const languageOptions = {
				off: "Off",
				"zh-hans": "Chinese (Simplified)",
				"zh-hant": "Chinese (Traditional)",
				ja: "Japanese",
				ko: "Korean",
			};

			let modeOptions = {
				none: "None",
			};

			const musixmatchDisplay = new Intl.DisplayNames(["en"], { type: "language" });
			const availableMusixmatchLanguages = Array.isArray(musixmatchLanguages)
				? [...new Set(musixmatchLanguages.filter(Boolean))]
				: [];
			const activeMusixmatchLanguage =
				musixmatchSelectedLanguage && musixmatchSelectedLanguage !== "none" ? musixmatchSelectedLanguage : null;
			if (hasTranslation.musixmatch && activeMusixmatchLanguage) {
				availableMusixmatchLanguages.push(activeMusixmatchLanguage);
			}

			if (availableMusixmatchLanguages.length) {
				const musixmatchOptionsArray = availableMusixmatchLanguages.map((code) => {
					let label = "";
					try {
						if (languageMap && languageMap[code]) {
							label = languageMap[code];
						} else {
							label = musixmatchDisplay.of(code) ?? code.toUpperCase();
						}
					} catch (e) {
						label = code.toUpperCase();
					}
					return {
						key: `${musixmatchTranslationPrefix}${code}`,
						label: `${label} (Musixmatch)`,
					};
				});

				musixmatchOptionsArray.sort((a, b) => a.label.localeCompare(b.label));

				const musixmatchOptions = musixmatchOptionsArray.reduce((acc, { key, label }) => {
					acc[key] = label;
					return acc;
				}, {});
				sourceOptions = { ...sourceOptions, ...musixmatchOptions };
			}

			if (hasTranslation.netease) {
				sourceOptions = {
					...sourceOptions,
					neteaseTranslation: "Chinese (Netease)",
				};
			}

			switch (friendlyLanguage) {
				case "japanese": {
					modeOptions = {
						furigana: "Furigana",
						romaji: "Romaji",
						hiragana: "Hiragana",
						katakana: "Katakana",
					};
					break;
				}
				case "korean": {
					modeOptions = {
						romaja: "Romaja",
					};
					break;
				}
				case "chinese": {
					modeOptions = {
						cn: "Simplified Chinese",
						hk: "Traditional Chinese (Hong Kong)",
						tw: "Traditional Chinese (Taiwan)",
					};
					break;
				}
			}

			const configItems = [
				{
					desc: "Translation Provider",
					key: "translate:translated-lyrics-source",
					type: ConfigSelection,
					options: sourceOptions,
					renderInline: true,
				},
				{
					desc: "Translation Display",
					key: "translate:display-mode",
					type: ConfigSelection,
					options: translationDisplayOptions,
					renderInline: true,
				},
				{
					desc: "Language Override",
					key: "translate:detect-language-override",
					type: ConfigSelection,
					options: languageOptions,
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
				{
					desc: "Display Mode",
					key: `translation-mode:${friendlyLanguage}`,
					type: ConfigSelection,
					options: modeOptions,
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
				{
					desc: "Convert",
					key: "translate",
					type: ConfigSlider,
					trigger: "click",
					action: "toggle",
					renderInline: true,
					// for songs in languages that support translation but not Convert (e.g., English), the option is disabled.
					when: () => friendlyLanguage,
				},
			];

			return configItems;
		}, [
			friendlyLanguage,
			hasTranslation.musixmatch,
			hasTranslation.netease,
			Array.isArray(musixmatchLanguages) ? musixmatchLanguages.join(",") : "",
			musixmatchSelectedLanguage || "",
			musixmatchTranslationPrefix,
			languageMap,
		]);

		useEffect(() => {
			// Currently opened Context Menu does not receive prop changes
			// If we were to use keys the Context Menu would close on re-render
			const event = new CustomEvent("lyrics-plus", {
				detail: {
					type: "translation-menu",
					items,
				},
			});
			document.dispatchEvent(event);
		}, [friendlyLanguage, items]);

		return react.createElement(
			Spicetify.ReactComponent.TooltipWrapper,
			{
				label: "Conversion",
			},
			react.createElement(
				"div",
				{
					className: "lyrics-tooltip-wrapper",
				},
				react.createElement(
					Spicetify.ReactComponent.ContextMenu,
					{
						menu: react.createElement(
							Spicetify.ReactComponent.Menu,
							{},
							react.createElement("h3", null, " Conversions"),
							react.createElement(OptionList, {
								type: "translation-menu",
								items,
								onChange: (name, value) => {
									if (name === "translate") {
										CONFIG.visual["translate:translated-lyrics-source"] = "none";
										localStorage.setItem(
											`${APP_NAME}:visual:translate:translated-lyrics-source`,
											"none",
										);
									}
									if (name === "translate:translated-lyrics-source") {
										const hasTranslationProvider = typeof value === "string" && value !== "none";
										if (hasTranslationProvider && CONFIG.visual.translate) {
											CONFIG.visual.translate = false;
											localStorage.setItem(`${APP_NAME}:visual:translate`, "false");
										}

										let nextMusixmatchLanguage = "none";
										if (
											typeof value === "string" &&
											value.startsWith(musixmatchTranslationPrefix)
										) {
											nextMusixmatchLanguage =
												value.slice(musixmatchTranslationPrefix.length) || "none";
										}

										if (
											CONFIG.visual["musixmatch-translation-language"] !== nextMusixmatchLanguage
										) {
											CONFIG.visual["musixmatch-translation-language"] = nextMusixmatchLanguage;
											localStorage.setItem(
												`${APP_NAME}:visual:musixmatch-translation-language`,
												nextMusixmatchLanguage,
											);
										}
									}

									CONFIG.visual[name] = value;
									localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
									lyricContainerUpdate?.();
								},
							}),
						),
						trigger: "click",
						action: "toggle",
						renderInline: true,
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
						},
						react.createElement(
							"p1",
							{
								width: 16,
								height: 16,
								viewBox: "0 0 16 10.3",
								fill: "currentColor",
							},
							"⇄",
						),
					),
				),
			),
		);
	},
);

const AdjustmentsMenu = react.memo(({ mode, hasPerformer }) => {
	return react.createElement(
		Spicetify.ReactComponent.TooltipWrapper,
		{
			label: "Adjustments",
		},
		react.createElement(
			"div",
			{
				className: "lyrics-tooltip-wrapper",
			},
			react.createElement(
				Spicetify.ReactComponent.ContextMenu,
				{
					menu: react.createElement(
						Spicetify.ReactComponent.Menu,
						{},
						react.createElement("h3", null, " Adjustments"),
						react.createElement(OptionList, {
							items: [
								{
									desc: "Font size",
									key: "font-size",
									type: ConfigAdjust,
									min: fontSizeLimit.min,
									max: fontSizeLimit.max,
									step: fontSizeLimit.step,
								},
								{
									desc: "Track delay",
									key: "delay",
									type: ConfigAdjust,
									min: Number.NEGATIVE_INFINITY,
									max: Number.POSITIVE_INFINITY,
									step: 250,
									when: () => mode === SYNCED || mode === KARAOKE,
								},
								{
									desc: "Compact",
									key: "synced-compact",
									type: ConfigSlider,
									when: () => mode === SYNCED || mode === KARAOKE,
								},
								{
									desc: "Show performers",
									key: "show-performers",
									type: ConfigSlider,
									when: () =>
										hasPerformer && (mode === SYNCED || mode === KARAOKE || mode === UNSYNCED),
								},
								{
									desc: "Dual panel",
									key: "dual-genius",
									type: ConfigSlider,
									when: () => mode === GENIUS,
								},
							],
							onChange: (name, value) => {
								CONFIG.visual[name] = value;
								localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
								if (name === "delay")
									localStorage.setItem(`lyrics-delay:${Spicetify.Player.data.item.uri}`, value);
								lyricContainerUpdate?.();
							},
						}),
					),
					trigger: "click",
					action: "toggle",
					renderInline: true,
				},
				react.createElement(
					"button",
					{
						className: "lyrics-config-button",
					},
					react.createElement(
						"svg",
						{
							width: 16,
							height: 16,
							viewBox: "0 0 16 10.3",
							fill: "currentColor",
						},
						react.createElement("path", {
							d: "M 10.8125,0 C 9.7756347,0 8.8094481,0.30798341 8,0.836792 7.1905519,0.30798341 6.2243653,0 5.1875,0 2.3439941,0 0,2.3081055 0,5.15625 0,8.0001222 2.3393555,10.3125 5.1875,10.3125 6.2243653,10.3125 7.1905519,10.004517 8,9.4757081 8.8094481,10.004517 9.7756347,10.3125 10.8125,10.3125 13.656006,10.3125 16,8.0043944 16,5.15625 16,2.3123779 13.660644,0 10.8125,0 Z M 8,2.0146484 C 8.2629394,2.2503662 8.4963378,2.5183106 8.6936034,2.8125 H 7.3063966 C 7.5036622,2.5183106 7.7370606,2.2503662 8,2.0146484 Z M 6.619995,4.6875 C 6.6560059,4.3625487 6.7292481,4.0485841 6.8350831,3.75 h 2.3298338 c 0.1059572,0.2985841 0.1790772,0.6125487 0.21521,0.9375 z M 9.380005,5.625 C 9.3439941,5.9499512 9.2707519,6.2639159 9.1649169,6.5625 H 6.8350831 C 6.7291259,6.2639159 6.6560059,5.9499512 6.6198731,5.625 Z M 5.1875,9.375 c -2.3435059,0 -4.25,-1.8925781 -4.25,-4.21875 0,-2.3261719 1.9064941,-4.21875 4.25,-4.21875 0.7366944,0 1.4296875,0.1899414 2.0330809,0.5233154 C 6.2563478,2.3981934 5.65625,3.7083741 5.65625,5.15625 c 0,1.4478759 0.6000978,2.7580566 1.5643309,3.6954347 C 6.6171875,9.1850584 5.9241944,9.375 5.1875,9.375 Z M 8,8.2978516 C 7.7370606,8.0621337 7.5036622,7.7938231 7.3063966,7.4996337 H 8.6936034 C 8.4963378,7.7938231 8.2629394,8.0621338 8,8.2978516 Z M 10.8125,9.375 C 10.075806,9.375 9.3828125,9.1850584 8.7794191,8.8516847 9.7436522,7.9143066 10.34375,6.6041259 10.34375,5.15625 10.34375,3.7083741 9.7436522,2.3981934 8.7794191,1.4608154 9.3828125,1.1274414 10.075806,0.9375 10.8125,0.9375 c 2.343506,0 4.25,1.8925781 4.25,4.21875 0,2.3261719 -1.906494,4.21875 -4.25,4.21875 z m 0,0",
						}),
					),
				),
			),
		),
	);
});

// ============================================================================
// TabBar.js
// ============================================================================

class TabBarItem extends react.Component {
	onSelect(event) {
		event.preventDefault();
		this.props.switchTo(this.props.item.key);
	}
	onLock(event) {
		event.preventDefault();
		this.props.lockIn(this.props.item.key);
	}
	render() {
		return react.createElement(
			"li",
			{
				className: "lyrics-tabBar-headerItem",
				onClick: this.onSelect.bind(this),
				onDoubleClick: this.onLock.bind(this),
				onContextMenu: this.onLock.bind(this),
			},
			react.createElement(
				"a",
				{
					"aria-current": "page",
					className: `lyrics-tabBar-headerItemLink ${this.props.item.active ? "lyrics-tabBar-active" : ""}`,
					draggable: "false",
					href: "",
				},
				react.createElement(
					"span",
					{
						className: "main-type-mestoBold",
					},
					this.props.item.value,
				),
			),
		);
	}
}

const TabBarMore = react.memo(({ items, switchTo, lockIn }) => {
	const activeItem = items.find((item) => item.active);

	function onLock(event) {
		event.preventDefault();
		if (activeItem) {
			lockIn(activeItem.key);
		}
	}
	return react.createElement(
		"li",
		{
			className: `lyrics-tabBar-headerItem ${activeItem ? "lyrics-tabBar-active" : ""}`,
			onDoubleClick: onLock,
			onContextMenu: onLock,
		},
		react.createElement(OptionsMenu, {
			options: items,
			onSelect: switchTo,
			selected: activeItem,
			defaultValue: "More",
			bold: true,
		}),
	);
});

const TopBarContent = ({ links, activeLink, lockLink, switchCallback, lockCallback }) => {
	const resizeHost = document.querySelector(
		".Root__main-view .os-resize-observer-host, .Root__main-view .os-size-observer, .Root__main-view .main-view-container__scroll-node",
	);
	const [windowSize, setWindowSize] = useState(resizeHost?.clientWidth ?? window.innerWidth);
	const resizeHandler = () => setWindowSize(resizeHost?.clientWidth ?? window.innerWidth);

	useEffect(() => {
		if (!resizeHost) return;
		const observer = new ResizeObserver(resizeHandler);
		observer.observe(resizeHost);
		return () => {
			observer.disconnect();
		};
	}, [resizeHandler]);

	return react.createElement(
		TabBarContext,
		null,
		react.createElement(TabBar, {
			className: "queue-queueHistoryTopBar-tabBar",
			links,
			activeLink,
			lockLink,
			switchCallback,
			lockCallback,
			windowSize,
		}),
	);
};

const TabBarContext = ({ children }) => {
	const content = react.createElement(
		"div",
		{
			className: "main-topBar-topbarContent lyrics-plus-topbar-content",
		},
		children,
	);
	// The classic app portaled the mode switcher into the client top bar. v3 has
	// no such wrapper, so fall back to rendering it inline within the route.
	const target = document.querySelector(".main-topBar-topbarContentWrapper");
	return target ? Spicetify.ReactDOM.createPortal(content, target) : content;
};

const TabBar = react.memo(
	({ links, activeLink, lockLink, switchCallback, lockCallback, windowSize = Number.POSITIVE_INFINITY }) => {
		const tabBarRef = react.useRef(null);
		const [childrenSizes, setChildrenSizes] = useState([]);
		const [availableSpace, setAvailableSpace] = useState(0);
		const [droplistItem, setDroplistItems] = useState([]);

		const options = [];
		for (let i = 0; i < links.length; i++) {
			const key = links[i];
			if (spotifyVersion >= "1.2.31" && key === "genius") continue;
			let value = key[0].toUpperCase() + key.slice(1);
			if (key === lockLink) value = `• ${value}`;
			const active = key === activeLink;
			options.push({ key, value, active });
		}

		useEffect(() => {
			if (!tabBarRef.current) return;
			setAvailableSpace(tabBarRef.current.clientWidth);
		}, [windowSize]);

		useEffect(() => {
			if (!tabBarRef.current) return;

			const tabbarItemSizes = [];
			for (const child of tabBarRef.current.children) {
				tabbarItemSizes.push(child.clientWidth);
			}

			setChildrenSizes(tabbarItemSizes);
		}, [links]);

		useEffect(() => {
			if (!tabBarRef.current) return;

			const totalSize = childrenSizes.reduce((a, b) => a + b, 0);

			// Can we render everything?
			if (totalSize <= availableSpace) {
				setDroplistItems([]);
				return;
			}

			// The `More` button can be set to _any_ of the children. So we
			// reserve space for the largest item instead of always taking
			// the last item.
			const viewMoreButtonSize = Math.max(...childrenSizes);

			// Figure out how many children we can render while also showing
			// the More button
			const itemsToHide = [];
			let stopWidth = viewMoreButtonSize;

			childrenSizes.forEach((childWidth, i) => {
				if (availableSpace >= stopWidth + childWidth) {
					stopWidth += childWidth;
				} else {
					// First elem is edit button
					itemsToHide.push(i);
				}
			});

			setDroplistItems(itemsToHide);
		}, [availableSpace, childrenSizes]);

		return react.createElement(
			"nav",
			{
				className: "lyrics-tabBar lyrics-tabBar-nav",
			},
			react.createElement(
				"ul",
				{
					className: "lyrics-tabBar-header",
					ref: tabBarRef,
				},
				react.createElement("li", {
					className: "lyrics-tabBar-headerItem",
				}),
				options
					.filter((_, id) => !droplistItem.includes(id))
					.map((item) =>
						react.createElement(TabBarItem, {
							item,
							switchTo: switchCallback,
							lockIn: lockCallback,
						}),
					),
				droplistItem.length || childrenSizes.length === 0
					? react.createElement(TabBarMore, {
							items: droplistItem.map((i) => options[i]).filter(Boolean),
							switchTo: switchCallback,
							lockIn: lockCallback,
						})
					: null,
			),
		);
	},
);

// ============================================================================
// Settings.js
// ============================================================================

const ButtonSVG = ({ icon, active = true, onClick }) => {
	return react.createElement(
		"button",
		{
			className: `switch${active ? "" : " disabled"}`,
			onClick,
		},
		react.createElement("svg", {
			width: 16,
			height: 16,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		}),
	);
};

const SwapButton = ({ icon, disabled, onClick }) => {
	return react.createElement(
		"button",
		{
			className: "switch small",
			onClick,
			disabled,
		},
		react.createElement("svg", {
			width: 10,
			height: 10,
			viewBox: "0 0 16 16",
			fill: "currentColor",
			dangerouslySetInnerHTML: {
				__html: icon,
			},
		}),
	);
};

const CacheButton = () => {
	let lyrics = {};

	try {
		const localLyrics = JSON.parse(localStorage.getItem("lyrics-plus:local-lyrics"));
		if (!localLyrics || typeof localLyrics !== "object") {
			throw "";
		}
		lyrics = localLyrics;
	} catch {
		lyrics = {};
	}

	const [count, setCount] = useState(Object.keys(lyrics).length);
	const text = count ? "Clear all cached lyrics" : "No cached lyrics";

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				localStorage.removeItem("lyrics-plus:local-lyrics");
				setCount(0);
			},
			disabled: !count,
		},
		text,
	);
};

const RefreshTokenButton = ({ setTokenCallback }) => {
	const [buttonText, setButtonText] = useState("Refresh token");

	useEffect(() => {
		if (buttonText === "Refreshing token...") {
			Spicetify.CosmosAsync.get(
				"https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0",
				null,
				{
					Host: "apic-appmobile.musixmatch.com",
					authority: "apic-appmobile.musixmatch.com",
					"X-Cookie": "x-mxm-token-guid=",
					"x-mxm-app-version": "10.1.1",
					"X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
					"Accept-Language": "en-US,en;q=0.9",
					Connection: "keep-alive",
					Accept: "application/json",
				},
			)
				.then(({ message: response }) => {
					if (response.header.status_code === 200 && response.body.user_token) {
						setTokenCallback(response.body.user_token);
						setButtonText("Token refreshed");
					} else if (response.header.status_code === 401) {
						setButtonText("Too many attempts");
					} else {
						setButtonText("Failed to refresh token");
						console.error("Failed to refresh token", response);
					}
				})
				.catch((error) => {
					setButtonText("Failed to refresh token");
					console.error("Failed to refresh token", error);
				});
		}
	}, [buttonText]);

	return react.createElement(
		"button",
		{
			className: "btn",
			onClick: () => {
				setButtonText("Refreshing token...");
			},
			disabled: buttonText !== "Refresh token",
		},
		buttonText,
	);
};

const ConfigButton = ({ name, text, onChange = () => {} }) => {
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"button",
				{
					className: "btn",
					onClick: onChange,
				},
				text,
			),
		),
	);
};

const ConfigSlider = ({ name, defaultValue, onChange = () => {} }) => {
	const [active, setActive] = useState(defaultValue);

	useEffect(() => {
		setActive(defaultValue);
	}, [defaultValue]);

	const toggleState = useCallback(() => {
		const state = !active;
		setActive(state);
		onChange(state);
	}, [active]);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(ButtonSVG, {
				icon: Spicetify.SVGIcons.check,
				active,
				onClick: toggleState,
			}),
		),
	);
};

const ConfigSelection = ({ name, defaultValue, options, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			let value = event.target.value;
			if (!Number.isNaN(Number(value))) {
				value = Number.parseInt(value);
			}
			setValue(value);
			onChange(value);
		},
		[value, options],
	);

	useEffect(() => {
		setValue(defaultValue);
	}, [defaultValue]);

	if (!Object.keys(options).length) return null;

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(
				"select",
				{
					className: "main-dropDown-dropDown",
					value,
					onChange: setValueCallback,
				},
				Object.keys(options).map((item) =>
					react.createElement(
						"option",
						{
							value: item,
						},
						options[item],
					),
				),
			),
		),
	);
};

const ConfigInput = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	const setValueCallback = useCallback(
		(event) => {
			const value = event.target.value;
			setValue(value);
			onChange(value);
		},
		[value],
	);

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onChange: setValueCallback,
			}),
		),
	);
};

const ConfigAdjust = ({ name, defaultValue, step, min, max, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);

	function adjust(dir) {
		let temp = value + dir * step;
		if (temp < min) {
			temp = min;
		} else if (temp > max) {
			temp = max;
		}
		setValue(temp);
		onChange(temp);
	}
	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement(SwapButton, {
				icon: `<path d="M2 7h12v2H0z"/>`,
				onClick: () => adjust(-1),
				disabled: value === min,
			}),
			react.createElement(
				"p",
				{
					className: "adjust-value",
				},
				value,
			),
			react.createElement(SwapButton, {
				icon: Spicetify.SVGIcons.plus2px,
				onClick: () => adjust(1),
				disabled: value === max,
			}),
		),
	);
};

const ConfigHotkey = ({ name, defaultValue, onChange = () => {} }) => {
	const [value, setValue] = useState(defaultValue);
	const [trap] = useState(new Spicetify.Mousetrap());

	function record() {
		trap.handleKey = (character, modifiers, e) => {
			if (e.type === "keydown") {
				const sequence = [...new Set([...modifiers, character])];
				if (sequence.length === 1 && sequence[0] === "esc") {
					onChange("");
					setValue("");
					return;
				}
				setValue(sequence.join("+"));
			}
		};
	}

	function finishRecord() {
		trap.handleKey = () => {};
		onChange(value);
	}

	return react.createElement(
		"div",
		{
			className: "setting-row",
		},
		react.createElement(
			"label",
			{
				className: "col description",
			},
			name,
		),
		react.createElement(
			"div",
			{
				className: "col action",
			},
			react.createElement("input", {
				value,
				onFocus: record,
				onBlur: finishRecord,
			}),
		),
	);
};

const ServiceAction = ({ item, setTokenCallback }) => {
	switch (item.name) {
		case "local":
			return react.createElement(CacheButton);
		case "musixmatch":
			return react.createElement(RefreshTokenButton, { setTokenCallback });
		default:
			return null;
	}
};

const ServiceOption = ({ item, onToggle, onSwap, isFirst = false, isLast = false, onTokenChange = null }) => {
	const [token, setToken] = useState(item.token);
	const [active, setActive] = useState(item.on);

	const setTokenCallback = useCallback(
		(token) => {
			setToken(token);
			onTokenChange(item.name, token);
		},
		[item.token],
	);

	const toggleActive = useCallback(() => {
		if (item.name === "genius" && spotifyVersion >= "1.2.31") return;
		const state = !active;
		setActive(state);
		onToggle(item.name, state);
	}, [active]);

	return react.createElement(
		"div",
		null,
		react.createElement(
			"div",
			{
				className: "setting-row",
			},
			react.createElement(
				"h3",
				{
					className: "col description",
				},
				item.name,
			),
			react.createElement(
				"div",
				{
					className: "col action",
				},
				react.createElement(ServiceAction, {
					item,
					setTokenCallback,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-up"],
					onClick: () => onSwap(item.name, -1),
					disabled: isFirst,
				}),
				react.createElement(SwapButton, {
					icon: Spicetify.SVGIcons["chart-down"],
					onClick: () => onSwap(item.name, 1),
					disabled: isLast,
				}),
				react.createElement(ButtonSVG, {
					icon: Spicetify.SVGIcons.check,
					active,
					onClick: toggleActive,
				}),
			),
		),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: item.desc,
			},
		}),
		item.token !== undefined &&
			react.createElement("input", {
				placeholder: `Place your ${item.name} token here`,
				value: token,
				onChange: (event) => setTokenCallback(event.target.value),
			}),
	);
};

const ServiceList = ({ itemsList, onListChange = () => {}, onToggle = () => {}, onTokenChange = () => {} }) => {
	const [items, setItems] = useState(itemsList);
	const maxIndex = items.length - 1;

	const onSwap = useCallback(
		(name, direction) => {
			const curPos = items.findIndex((val) => val === name);
			const newPos = curPos + direction;
			[items[curPos], items[newPos]] = [items[newPos], items[curPos]];
			onListChange(items);
			setItems([...items]);
		},
		[items],
	);

	return items.map((key, index) => {
		const item = CONFIG.providers[key];
		item.name = key;
		return react.createElement(ServiceOption, {
			item,
			key,
			isFirst: index === 0,
			isLast: index === maxIndex,
			onSwap,
			onTokenChange,
			onToggle,
		});
	});
};

const corsProxyTemplate = () => {
	const [proxyValue, setProxyValue] = react.useState(
		localStorage.getItem("spicetify:corsProxyTemplate") || "https://cors-proxy.spicetify.app/{url}",
	);

	return react.createElement("input", {
		placeholder: "CORS Proxy Template",
		value: proxyValue,
		onChange: (event) => {
			const value = event.target.value;
			setProxyValue(value);

			if (value === "" || !value) return localStorage.removeItem("spicetify:corsProxyTemplate");
			localStorage.setItem("spicetify:corsProxyTemplate", value);
		},
	});
};

const OptionList = ({ type, items, onChange }) => {
	const [itemList, setItemList] = useState(items);
	const [, forceUpdate] = useState();

	useEffect(() => {
		if (!type) return;

		const eventListener = (event) => {
			if (event.detail?.type !== type) return;
			setItemList(event.detail.items);
		};
		document.addEventListener("lyrics-plus", eventListener);

		return () => document.removeEventListener("lyrics-plus", eventListener);
	}, []);

	return itemList.map((item) => {
		if (!item || (item.when && !item.when())) {
			return;
		}

		const onChangeItem = item.onChange || onChange;

		return react.createElement(
			"div",
			null,
			react.createElement(item.type, {
				...item,
				name: item.desc,
				defaultValue: CONFIG.visual[item.key],
				onChange: (value) => {
					onChangeItem(item.key, value);
					forceUpdate({});
				},
			}),
			item.info &&
				react.createElement("span", {
					dangerouslySetInnerHTML: {
						__html: item.info,
					},
				}),
		);
	});
};

function openConfig() {
	const configContainer = react.createElement(
		"div",
		{
			id: `${APP_NAME}-config-container`,
		},
		react.createElement("h2", null, "Options"),
		react.createElement(OptionList, {
			items: [
				{
					desc: "Playbar button",
					key: "playbar-button",
					info: "Replace Spotify's lyrics button with Lyrics Plus.",
					type: ConfigSlider,
				},
				{
					desc: "Global delay",
					info: "Offset (in ms) across all tracks.",
					key: "global-delay",
					type: ConfigAdjust,
					min: -10000,
					max: 10000,
					step: 250,
				},
				{
					desc: "Font size",
					info: "(or Ctrl + Mouse scroll in main app)",
					key: "font-size",
					type: ConfigAdjust,
					min: fontSizeLimit.min,
					max: fontSizeLimit.max,
					step: fontSizeLimit.step,
				},
				{
					desc: "Alignment",
					key: "alignment",
					type: ConfigSelection,
					options: {
						left: "Left",
						center: "Center",
						right: "Right",
					},
				},
				{
					desc: "Fullscreen hotkey",
					key: "fullscreen-key",
					type: ConfigHotkey,
				},
				{
					desc: "Compact synced: Lines to show before",
					key: "lines-before",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Lines to show after",
					key: "lines-after",
					type: ConfigSelection,
					options: [0, 1, 2, 3, 4],
				},
				{
					desc: "Compact synced: Fade-out blur",
					key: "fade-blur",
					type: ConfigSlider,
				},
				{
					desc: "Noise overlay",
					key: "noise",
					type: ConfigSlider,
				},
				{
					desc: "Colorful background",
					key: "colorful",
					type: ConfigSlider,
				},
				{
					desc: "Background color",
					key: "background-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Active text color",
					key: "active-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Inactive text color",
					key: "inactive-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Highlight text background",
					key: "highlight-color",
					type: ConfigInput,
					when: () => !CONFIG.visual.colorful,
				},
				{
					desc: "Text convertion: Japanese Detection threshold (Advanced)",
					info: "Checks if whenever Kana is dominant in lyrics. If the result passes the threshold, it's most likely Japanese, and vice versa. This setting is in percentage.",
					key: "ja-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Text convertion: Traditional-Simplified Detection threshold (Advanced)",
					info: "Checks if whenever Traditional or Simplified is dominant in lyrics. If the result passes the threshold, it's most likely Simplified, and vice versa. This setting is in percentage.",
					key: "hans-detect-threshold",
					type: ConfigAdjust,
					min: thresholdSizeLimit.min,
					max: thresholdSizeLimit.max,
					step: thresholdSizeLimit.step,
				},
				{
					desc: "Clear Memory Cache",
					info: "Loaded lyrics are cached in memory for faster reloading. Press this button to clear the cached lyrics from memory without restarting Spotify.",
					key: "clear-memore-cache",
					text: "Clear memory cache",
					type: ConfigButton,
					onChange: () => {
						reloadLyrics?.();
					},
				},
			],
			onChange: (name, value) => {
				CONFIG.visual[name] = value;
				localStorage.setItem(`${APP_NAME}:visual:${name}`, value);
				lyricContainerUpdate?.();

				const configChange = new CustomEvent("lyrics-plus", {
					detail: {
						type: "config",
						name: name,
						value: value,
					},
				});
				window.dispatchEvent(configChange);
			},
		}),
		react.createElement("h2", null, "Providers"),
		react.createElement(ServiceList, {
			itemsList: CONFIG.providersOrder,
			onListChange: (list) => {
				CONFIG.providersOrder = list;
				localStorage.setItem(`${APP_NAME}:services-order`, JSON.stringify(list));
				reloadLyrics?.();
			},
			onToggle: (name, value) => {
				CONFIG.providers[name].on = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:on`, value);
				reloadLyrics?.();
			},
			onTokenChange: (name, value) => {
				CONFIG.providers[name].token = value;
				localStorage.setItem(`${APP_NAME}:provider:${name}:token`, value);
				reloadLyrics?.();
			},
		}),
		react.createElement("h2", null, "CORS Proxy Template"),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: "Use this to bypass CORS restrictions. Replace the URL with your cors proxy server of your choice. <code>{url}</code> will be replaced with the request URL.",
			},
		}),
		react.createElement(corsProxyTemplate),
		react.createElement("span", {
			dangerouslySetInnerHTML: {
				__html: "Spotify will reload its webview after applying. Leave empty to restore default: <code>https://cors-proxy.spicetify.app/{url}</code>",
			},
		}),
	);

	Spicetify.PopupModal.display({
		title: "Lyrics Plus",
		content: configContainer,
		isLarge: true,
	});
}

// ============================================================================
// Pages.js
// ============================================================================

const CreditFooter = react.memo(({ provider, copyright }) => {
	if (provider === "local") return null;
	const credit = [Spicetify.Locale.get("web-player.lyrics.providedBy", provider)];
	if (copyright) {
		credit.push(...copyright.split("\n"));
	}

	return (
		provider &&
		react.createElement(
			"p",
			{
				className: "lyrics-lyricsContainer-Provider main-type-mesto",
				dir: "auto",
			},
			credit.join(" • "),
		)
	);
});

const IdlingIndicator = ({ isActive, progress, delay, className = "", style = {} }) => {
	return react.createElement(
		"div",
		{
			className:
				`lyrics-idling-indicator ${isActive === false ? "lyrics-idling-indicator-hidden" : ""} ${className}`.trim(),
			style: {
				"--indicator-delay": `${delay}ms`,
				...style,
			},
		},
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.05 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.33 ? "active" : ""}`,
		}),
		react.createElement("div", {
			className: `lyrics-idling-indicator__circle ${progress >= 0.66 ? "active" : ""}`,
		}),
	);
};

const emptyLine = {
	startTime: 0,
	endTime: 0,
	text: [],
};

const isPauseLine = (text) => {
	if (!text) return true;
	if (Array.isArray(text)) {
		const joined = text
			.map((w) => (typeof w === "object" ? w.word : w))
			.join("")
			.trim();
		return joined === "♪" || joined === "";
	}
	let str = typeof text === "object" ? text?.props?.children?.[0] : text;
	if (typeof str !== "string") {
		str = String(str || "");
	}
	const trimmed = str.trim();
	return trimmed === "♪" || trimmed === "";
};

const findNextLineStartTime = (lines, fromIndex) => {
	for (let j = fromIndex + 1; j < lines.length; j++) {
		if (!isPauseLine(lines[j].text) && lines[j].startTime != null) {
			return lines[j].startTime;
		}
	}
	return null;
};

const getPauseIndicator = (lyrics, lineNumber, startTime, position, isFocused, isPause) => {
	if (!isFocused || !isPause) return null;

	const nextStart = findNextLineStartTime(lyrics, lineNumber);
	const pauseStart = startTime || 0;
	const pauseDuration = nextStart ? nextStart - pauseStart : 0;
	const progress = pauseDuration > 0 ? (position - pauseStart) / pauseDuration : 0;
	const delay = pauseDuration / 3;

	return react.createElement(IdlingIndicator, {
		progress,
		delay,
	});
};

const LONG_PAUSE_THRESHOLD = 8000; // 8 seconds

const processPauseLines = (lyrics) => {
	if (!lyrics || !lyrics.length) return lyrics;
	const result = [];
	for (let i = 0; i < lyrics.length; i++) {
		const line = lyrics[i];
		const nextLine = lyrics[i + 1];

		if (isPauseLine(line.text)) {
			// Skip consecutive pause lines to consolidate them into one idling indicator
			const lastLine = result[result.length - 1];
			if (lastLine && isPauseLine(lastLine.text)) {
				continue;
			}
			const nextStart = findNextLineStartTime(lyrics, i);
			const pauseStart = line.startTime || 0;
			if (nextStart != null) {
				const pauseDuration = nextStart - pauseStart;
				if (pauseDuration >= LONG_PAUSE_THRESHOLD) {
					result.push(line);
				}
			}
		} else {
			result.push(line);
			const hasLineEndTime = line.endTime != null && line.endTime > line.startTime;
			const endTime = hasLineEndTime ? line.endTime : null;
			if (endTime != null && nextLine && nextLine.startTime != null) {
				const gap = nextLine.startTime - endTime;
				if (gap >= LONG_PAUSE_THRESHOLD && nextLine.startTime > line.startTime && !isPauseLine(nextLine.text)) {
					result.push({
						text: "♪",
						startTime: endTime,
						endTime: nextLine.startTime,
					});
				}
			}
		}
	}
	return result;
};

const isRTLText = (str) => /[\u0591-\u07FF\u200F\u202B\u202E\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(str);

const renderPerformer = (performer, previousPerformer, compact) => {
	if (!CONFIG.visual["show-performers"] || !performer || (!compact && previousPerformer === performer)) return null;
	return react.createElement("span", { className: "lyrics-lyricsContainer-Performer" }, performer);
};

const useTrackPosition = (callback) => {
	const callbackRef = useRef();
	callbackRef.current = callback;

	useEffect(() => {
		const interval = setInterval(callbackRef.current, 50);

		return () => {
			clearInterval(interval);
		};
	}, [callbackRef]);
};

const KaraokeLine = ({ text, isActive, position, startTime, endTime }) => {
	if ((endTime != null && position > endTime) || (!isActive && position > startTime)) {
		return text.map(({ word }, i) => (typeof word === "string" ? word : react.cloneElement(word, { key: i })));
	}

	let accumulatedTime = startTime;
	return text.map(({ word, time }, i) => {
		const isRTL = isRTLText(typeof word === "string" ? word : "");
		const isWordActive = position >= accumulatedTime;
		accumulatedTime += time;
		const isWordComplete = isWordActive && position >= accumulatedTime;
		return react.createElement(
			"span",
			{
				key: i,
				className: `lyrics-lyricsContainer-Karaoke-Word${isWordActive ? " lyrics-lyricsContainer-Karaoke-WordActive" : ""}${isRTL ? " lyrics-lyricsContainer-Karaoke-WordRTL" : ""}`,
				style: {
					"--word-duration": `${time}ms`,
					// don't animate unless we have to
					transition: !isWordActive || isWordComplete ? "all 0s linear" : "",
				},
			},
			word,
		);
	});
};

const SyncedLyricsPage = react.memo(({ lyrics = [], provider, copyright, isKara }) => {
	const [position, setPosition] = useState(0);
	const activeLineEle = useRef();
	const lyricContainerEle = useRef();

	useTrackPosition(() => {
		const newPos = Spicetify.Player.getProgress();
		const delay = CONFIG.visual["global-delay"] + CONFIG.visual.delay;
		if (newPos !== position) {
			setPosition(newPos + delay);
		}
	});

	const lyricWithEmptyLines = useMemo(
		() =>
			[emptyLine, emptyLine, ...processPauseLines(lyrics)].map((line, i) => ({
				...line,
				lineNumber: i,
			})),
		[lyrics],
	);

	const lyricsId = lyrics[0].text;

	let activeLineIndex = 0;
	for (let i = lyricWithEmptyLines.length - 1; i > 0; i--) {
		if (position >= lyricWithEmptyLines[i].startTime) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(lyricWithEmptyLines[i].text) &&
				lyricWithEmptyLines[i + 1] &&
				position >= lyricWithEmptyLines[i + 1].startTime &&
				!isPauseLine(lyricWithEmptyLines[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	const { activeLines, activeElementIndex } = useMemo(() => {
		let startIndex = activeLineIndex;
		let visibleBefore = 0;
		const targetBefore = Number(CONFIG.visual["lines-before"]) + 1;
		while (startIndex > 0 && visibleBefore < targetBefore) {
			startIndex--;
			if (!isPauseLine(lyricWithEmptyLines[startIndex].text)) {
				visibleBefore++;
			}
		}

		let endIndex = activeLineIndex;
		let visibleAfter = 0;
		const targetAfter = Number(CONFIG.visual["lines-after"]) + 1;
		while (endIndex < lyricWithEmptyLines.length - 1 && visibleAfter < targetAfter) {
			endIndex++;
			if (!isPauseLine(lyricWithEmptyLines[endIndex].text)) {
				visibleAfter++;
			}
		}

		return {
			activeLines: lyricWithEmptyLines.slice(startIndex, endIndex + 1),
			activeElementIndex: activeLineIndex - startIndex,
		};
	}, [activeLineIndex, lyricWithEmptyLines, CONFIG.visual["lines-before"], CONFIG.visual["lines-after"]]);

	let offset = lyricContainerEle.current ? lyricContainerEle.current.clientHeight / 2 : 0;
	if (activeLineEle.current) {
		offset += -(activeLineEle.current.offsetTop + activeLineEle.current.clientHeight / 2);
	}
	const adjustedAnimationIndices = [];
	let currentIndex = 0;
	for (let j = activeElementIndex; j < activeLines.length; j++) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text) || j === activeElementIndex) {
			currentIndex++;
		}
	}
	currentIndex = -1;
	for (let j = activeElementIndex - 1; j >= 0; j--) {
		adjustedAnimationIndices[j] = currentIndex;
		if (!isPauseLine(activeLines[j].text)) {
			currentIndex--;
		}
	}

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-SyncedLyricsPage",
			ref: lyricContainerEle,
		},
		react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-SyncedLyrics",
				style: {
					"--offset": `${offset}px`,
				},
				key: lyricsId,
			},
			activeLines.map(({ text, lineNumber, startTime, endTime, originalText, performer }, i) => {
				const isFocusedLine = activeElementIndex === i;
				const isPause = isPauseLine(text);

				// Calculate indicator state for pause lines
				const indicatorEl = getPauseIndicator(
					lyricWithEmptyLines,
					lineNumber,
					startTime,
					position,
					isFocusedLine,
					isPause,
				);

				let className = "lyrics-lyricsContainer-LyricsLine";
				let ref;

				const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
				const isActive = isFocusedLine || isPlaying;

				if (isFocusedLine) {
					ref = activeLineEle;
				}
				if (isActive) {
					className += " lyrics-lyricsContainer-LyricsLine-active";
				} else if (isPause && !indicatorEl) {
					className += " lyrics-lyricsContainer-LyricsLine-hidden";
				}

				let animationIndex = adjustedAnimationIndices[i];

				const paddingLine =
					(animationIndex < 0 && -animationIndex > Number(CONFIG.visual["lines-before"])) ||
					animationIndex > Number(CONFIG.visual["lines-after"]);
				if (paddingLine) {
					className += " lyrics-lyricsContainer-LyricsLine-paddingLine";
				}
				const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
				// If we have original text and we are showing translated below, we should show the original text
				// Otherwise we should show the translated text
				const lineText = originalText && showTranslatedBelow ? originalText : text;

				// Convert lyrics to text for comparison
				const belowOrigin = (
					typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
				)?.replace(/\s+/g, "");
				const belowTxt =
					typeof text === "string"
						? text.replace(/\s+/g, "")
						: typeof text?.props?.children?.[0] === "string"
							? text.props.children[0].replace(/\s+/g, "")
							: "";

				const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

				return react.createElement(
					"div",
					{
						className,
						style: {
							cursor: "pointer",
							"--position-index": animationIndex,
							"--animation-index": (animationIndex < 0 ? 0 : animationIndex) + 1,
							"--blur-index": Math.abs(animationIndex),
						},
						dir: "auto",
						ref,
						key: lineNumber,
						onClick: () => {
							if (startTime) {
								Spicetify.Player.seek(startTime);
							}
						},
					},
					isPause
						? indicatorEl
						: react.createElement(
								"p",
								{
									onContextMenu: (event) => {
										event.preventDefault();
										Spicetify.Platform.ClipboardAPI.copy(
											Utils.convertParsedToLRC(lyrics, belowMode).original,
										)
											.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
											.catch(() =>
												Spicetify.showNotification("Failed to copy lyrics to clipboard"),
											);
									},
								},
								renderPerformer(
									performer,
									lyricWithEmptyLines[lineNumber - 1]?.performer,
									CONFIG.visual["synced-compact"],
								),
								!isKara
									? lineText
									: react.createElement(KaraokeLine, {
											text,
											startTime,
											endTime,
											position,
											isActive,
										}),
							),
					belowMode &&
						react.createElement(
							"p",
							{
								style: {
									opacity: 0.5,
								},
								onContextMenu: (event) => {
									event.preventDefault();
									Spicetify.Platform.ClipboardAPI.copy(
										Utils.convertParsedToLRC(lyrics, belowMode).conver,
									)
										.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
										.catch(() =>
											Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
										);
								},
							},
							text,
						),
				);
			}),
		),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
	);
});

class SearchBar extends react.Component {
	constructor() {
		super();
		this.state = {
			hidden: true,
			atNode: 0,
			foundNodes: [],
		};
		this.container = null;
	}

	componentDidMount() {
		this.viewPort = document.querySelector(".main-view-container .os-viewport");
		this.mainViewOffsetTop = document.querySelector(".Root__main-view").offsetTop;
		this.toggleCallback = () => {
			if (!(Spicetify.Platform.History.location.pathname === "/lyrics-plus" && this.container)) return;

			if (this.state.hidden) {
				this.setState({ hidden: false });
				this.container.focus();
			} else {
				this.setState({ hidden: true });
				this.container.blur();
			}
		};
		this.unFocusCallback = () => {
			this.container.blur();
			this.setState({ hidden: true });
		};
		this.loopThroughCallback = (event) => {
			if (!this.state.foundNodes.length) {
				return;
			}

			if (event.key === "Enter") {
				const dir = event.shiftKey ? -1 : 1;
				let atNode = this.state.atNode + dir;
				if (atNode < 0) {
					atNode = this.state.foundNodes.length - 1;
				}
				atNode %= this.state.foundNodes.length;
				const rects = this.state.foundNodes[atNode].getBoundingClientRect();
				this.viewPort.scrollBy(0, rects.y - 100);
				this.setState({ atNode });
			}
		};

		Spicetify.Mousetrap().bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).bind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).bind("esc", this.unFocusCallback);
	}

	componentWillUnmount() {
		Spicetify.Mousetrap().unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("mod+shift+f", this.toggleCallback);
		Spicetify.Mousetrap(this.container).unbind("enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("shift+enter", this.loopThroughCallback);
		Spicetify.Mousetrap(this.container).unbind("esc", this.unFocusCallback);
	}

	getNodeFromInput(event) {
		const value = event.target.value.toLowerCase();
		if (!value) {
			this.setState({ foundNodes: [] });
			this.viewPort.scrollTo(0, 0);
			return;
		}

		const lyricsPage = document.querySelector(".lyrics-lyricsContainer-UnsyncedLyricsPage");
		const walker = document.createTreeWalker(
			lyricsPage,
			NodeFilter.SHOW_TEXT,
			(node) => {
				if (node.textContent.toLowerCase().includes(value)) {
					return NodeFilter.FILTER_ACCEPT;
				}
				return NodeFilter.FILTER_REJECT;
			},
			false,
		);

		const foundNodes = [];
		while (walker.nextNode()) {
			const range = document.createRange();
			range.selectNodeContents(walker.currentNode);
			foundNodes.push(range);
		}

		if (!foundNodes.length) {
			this.viewPort.scrollBy(0, 0);
		} else {
			const rects = foundNodes[0].getBoundingClientRect();
			this.viewPort.scrollBy(0, rects.y - 100);
		}

		this.setState({ foundNodes, atNode: 0 });
	}

	render() {
		let y = 0;
		let height = 0;
		if (this.state.foundNodes.length) {
			const node = this.state.foundNodes[this.state.atNode];
			const rects = node.getBoundingClientRect();
			y = rects.y + this.viewPort.scrollTop - this.mainViewOffsetTop;
			height = rects.height;
		}
		return react.createElement(
			"div",
			{
				className: `lyrics-Searchbar${this.state.hidden ? " hidden" : ""}`,
			},
			react.createElement("input", {
				ref: (c) => {
					this.container = c;
				},
				onChange: this.getNodeFromInput.bind(this),
			}),
			react.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "currentColor",
				dangerouslySetInnerHTML: {
					__html: Spicetify.SVGIcons.search,
				},
			}),
			react.createElement(
				"span",
				{
					hidden: this.state.foundNodes.length === 0,
				},
				`${this.state.atNode + 1}/${this.state.foundNodes.length}`,
			),
			react.createElement("div", {
				className: "lyrics-Searchbar-highlight",
				style: {
					"--search-highlight-top": `${y}px`,
					"--search-highlight-height": `${height}px`,
				},
			}),
		);
	}
}

function isInViewport(element) {
	const rect = element.getBoundingClientRect();
	return (
		rect.top >= 0 &&
		rect.left >= 0 &&
		rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
		rect.right <= (window.innerWidth || document.documentElement.clientWidth)
	);
}

const SyncedExpandedLyricsPage = react.memo(({ lyrics, provider, copyright, isKara }) => {
	const [position, setPosition] = useState(
		() => Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay,
	);
	const activeLineRef = useRef(null);
	const pageRef = useRef(null);

	useTrackPosition(() => {
		if (!Spicetify.Player.data.is_paused) {
			setPosition(Spicetify.Player.getProgress() + CONFIG.visual["global-delay"] + CONFIG.visual.delay);
		}
	});

	const padded = useMemo(() => [emptyLine, ...processPauseLines(lyrics)], [lyrics]);

	const initialScroll = useRef(true);

	// Reset scroll state when lyrics change
	useEffect(() => {
		initialScroll.current = true;
	}, [lyrics]);

	const lyricsId = lyrics[0].text;

	let activeLineIndex = 0;
	for (let i = padded.length - 1; i >= 0; i--) {
		const line = padded[i];
		if (position >= line.startTime) {
			// If this is a pause line and the next one starts at the same time and is NOT a pause line,
			// prefer the next line (the text).
			if (
				isPauseLine(line.text) &&
				padded[i + 1] &&
				position >= padded[i + 1].startTime &&
				!isPauseLine(padded[i + 1].text)
			) {
				continue;
			}
			activeLineIndex = i;
			break;
		}
	}

	useEffect(() => {
		if (activeLineRef.current && (initialScroll.current || isInViewport(activeLineRef.current))) {
			// Ignore focus on the first "empty" idling indicator if it's during initial load
			if (initialScroll.current && activeLineIndex === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				// If the intro is very short (e.g. less than 300ms), don't focus it
				if (nextStart && nextStart - position < 300) {
					initialScroll.current = false;
					return;
				}
			}

			activeLineRef.current.scrollIntoView({
				behavior: initialScroll.current ? "auto" : "smooth",
				block: "center",
				inline: "nearest",
			});
			initialScroll.current = false;
		}
	}, [activeLineIndex, lyricsId]);

	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			key: lyricsId,
			ref: pageRef,
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		padded.map(({ text, startTime, endTime, originalText, performer }, i) => {
			// Show idling indicator for the initial empty line
			if (i === 0) {
				const nextStart = findNextLineStartTime(padded, 0);
				return react.createElement(IdlingIndicator, {
					key: i,
					isActive: activeLineIndex === 0,
					progress: nextStart ? position / nextStart : 0,
					delay: nextStart ? nextStart / 3 : 0,
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					style: { "--position-index": 0, "--animation-index": 1 },
				});
			}

			const isFocused = i === activeLineIndex;
			const isPause = isPauseLine(text);

			// Calculate indicator state for pause lines
			const indicatorEl = getPauseIndicator(padded, i, startTime, position, isFocused, isPause);

			const isPlaying = startTime != null && endTime != null && position >= startTime && position <= endTime;
			const isPast =
				(endTime != null && position > endTime) || (!isFocused && startTime != null && position > startTime);
			const isActive = isFocused || isPlaying;

			let className = `lyrics-lyricsContainer-LyricsLine${isActive ? " lyrics-lyricsContainer-LyricsLine-active" : ""}${isPast ? " lyrics-lyricsContainer-LyricsLine-past" : ""}`;
			if (isPause && !indicatorEl) {
				className += " lyrics-lyricsContainer-LyricsLine-hidden";
			}

			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (
				typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
			)?.replace(/\s+/g, "");
			const belowTxt =
				typeof text === "string"
					? text.replace(/\s+/g, "")
					: typeof text?.props?.children?.[0] === "string"
						? text.props.children[0].replace(/\s+/g, "")
						: "";

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className,
					key: i,
					style: {
						cursor: "pointer",
					},
					dir: "auto",
					ref: isFocused ? activeLineRef : null,
					onClick: () => {
						if (startTime) {
							Spicetify.Player.seek(startTime);
						}
					},
				},
				isPause
					? indicatorEl
					: react.createElement(
							"p",
							{
								onContextMenu: (event) => {
									event.preventDefault();
									Spicetify.Platform.ClipboardAPI.copy(
										Utils.convertParsedToLRC(lyrics, belowMode).original,
									)
										.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
										.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
								},
							},
							renderPerformer(performer, padded[i - 1]?.performer, CONFIG.visual["synced-compact"]),
							!isKara
								? lineText
								: react.createElement(KaraokeLine, { text, startTime, endTime, position, isActive }),
						),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(Utils.convertParsedToLRC(lyrics, belowMode).conver)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() =>
										Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
									);
							},
						},
						text,
					),
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null),
	);
});

const UnsyncedLyricsPage = react.memo(({ lyrics, provider, copyright }) => {
	return react.createElement(
		"div",
		{
			className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
		},
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		lyrics.map(({ text, originalText, performer }, index) => {
			const showTranslatedBelow = CONFIG.visual["translate:display-mode"] === "below";
			// If we have original text and we are showing translated below, we should show the original text
			// Otherwise we should show the translated text
			const lineText = originalText && showTranslatedBelow ? originalText : text;

			// Convert lyrics to text for comparison
			const belowOrigin = (
				typeof originalText === "object" ? originalText?.props?.children?.[0] : originalText
			)?.replace(/\s+/g, "");
			const belowTxt =
				typeof text === "string"
					? text.replace(/\s+/g, "")
					: typeof text?.props?.children?.[0] === "string"
						? text.props.children[0].replace(/\s+/g, "")
						: "";

			const belowMode = showTranslatedBelow && originalText && belowOrigin !== belowTxt;

			return react.createElement(
				"div",
				{
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					key: index,
					dir: "auto",
				},
				react.createElement(
					"p",
					{
						onContextMenu: (event) => {
							event.preventDefault();
							Spicetify.Platform.ClipboardAPI.copy(
								Utils.convertParsedToUnsynced(lyrics, belowMode).original,
							)
								.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
								.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
						},
					},
					renderPerformer(performer, lyrics[index - 1]?.performer, false),
					lineText,
				),
				belowMode &&
					react.createElement(
						"p",
						{
							style: { opacity: 0.5 },
							onContextMenu: (event) => {
								event.preventDefault();
								Spicetify.Platform.ClipboardAPI.copy(
									Utils.convertParsedToUnsynced(lyrics, belowMode).conver,
								)
									.then(() => Spicetify.showNotification("Translated lyrics copied to clipboard"))
									.catch(() =>
										Spicetify.showNotification("Failed to copy translated lyrics to clipboard"),
									);
							},
						},
						text,
					),
			);
		}),
		react.createElement("p", {
			className: "lyrics-lyricsContainer-LyricsUnsyncedPadding",
		}),
		react.createElement(CreditFooter, {
			provider,
			copyright,
		}),
		react.createElement(SearchBar, null),
	);
});

const noteContainer = document.createElement("div");
noteContainer.classList.add("lyrics-Genius-noteContainer");
const noteDivider = document.createElement("div");
noteDivider.classList.add("lyrics-Genius-divider");
noteDivider.innerHTML = `<svg width="32" height="32" viewBox="0 0 13 4" fill="currentColor"><path d=\"M13 10L8 4.206 3 10z\"/></svg>`;
noteDivider.style.setProperty("--link-left", 0);
const noteTextContainer = document.createElement("div");
noteTextContainer.classList.add("lyrics-Genius-noteTextContainer");
noteTextContainer.onclick = (event) => {
	event.preventDefault();
	event.stopPropagation();
};
noteContainer.append(noteDivider, noteTextContainer);

function showNote(parent, note) {
	if (noteContainer.parentElement === parent) {
		noteContainer.remove();
		return;
	}
	noteTextContainer.innerText = note;
	parent.append(noteContainer);
	const arrowPos = parent.offsetLeft - noteContainer.offsetLeft;
	noteDivider.style.setProperty("--link-left", `${arrowPos}px`);
	const box = noteTextContainer.getBoundingClientRect();
	if (box.y + box.height > window.innerHeight) {
		// Wait for noteContainer is mounted
		setTimeout(() => {
			noteContainer.scrollIntoView({
				behavior: "smooth",
				block: "center",
				inline: "nearest",
			});
		}, 50);
	}
}

const GeniusPage = react.memo(
	({
		lyrics,
		provider,
		copyright,
		versions,
		versionIndex,
		onVersionChange,
		isSplitted,
		lyrics2,
		versionIndex2,
		onVersionChange2,
	}) => {
		let notes = {};
		let container = null;
		let container2 = null;

		// Fetch notes
		useEffect(() => {
			if (!container) return;
			notes = {};
			let links = container.querySelectorAll("a");
			if (isSplitted && container2) {
				links = [...links, ...container2.querySelectorAll("a")];
			}
			for (const link of links) {
				let id = link.pathname.match(/\/(\d+)\//);
				if (!id) {
					id = link.dataset.id;
				} else {
					id = id[1];
				}
				ProviderGenius.getNote(id).then((note) => {
					notes[id] = note;
					link.classList.add("fetched");
				});
				link.onclick = (event) => {
					event.preventDefault();
					if (!notes[id]) return;
					showNote(link, notes[id]);
				};
			}
		}, [lyrics, lyrics2]);

		const lyricsEl1 = react.createElement(
			"div",
			null,
			react.createElement(VersionSelector, { items: versions, index: versionIndex, callback: onVersionChange }),
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
				ref: (c) => {
					container = c;
				},
				dangerouslySetInnerHTML: {
					__html: lyrics,
				},
				onContextMenu: (event) => {
					event.preventDefault();
					const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
					Spicetify.Platform.ClipboardAPI.copy(copylyrics)
						.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
						.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
				},
			}),
		);

		const mainContainer = [lyricsEl1];
		const shouldSplit = versions.length > 1 && isSplitted;

		if (shouldSplit) {
			const lyricsEl2 = react.createElement(
				"div",
				null,
				react.createElement(VersionSelector, {
					items: versions,
					index: versionIndex2,
					callback: onVersionChange2,
				}),
				react.createElement("div", {
					className: "lyrics-lyricsContainer-LyricsLine lyrics-lyricsContainer-LyricsLine-active",
					ref: (c) => {
						container2 = c;
					},
					dangerouslySetInnerHTML: {
						__html: lyrics2,
					},
					onContextMenu: (event) => {
						event.preventDefault();
						const copylyrics = lyrics.replace(/<br>/g, "\n").replace(/<[^>]*>/g, "");
						Spicetify.Platform.ClipboardAPI.copy(copylyrics)
							.then(() => Spicetify.showNotification("Lyrics copied to clipboard"))
							.catch(() => Spicetify.showNotification("Failed to copy lyrics to clipboard"));
					},
				}),
			);
			mainContainer.push(lyricsEl2);
		}

		return react.createElement(
			"div",
			{
				className: "lyrics-lyricsContainer-UnsyncedLyricsPage",
			},
			react.createElement("p", {
				className: "lyrics-lyricsContainer-LyricsUnsyncedPadding main-type-ballad",
			}),
			react.createElement("div", { className: shouldSplit ? "split" : "" }, mainContainer),
			react.createElement(CreditFooter, {
				provider,
				copyright,
			}),
			react.createElement(SearchBar, null),
		);
	},
);

const LoadingIcon = react.createElement(
	"svg",
	{
		width: "200px",
		height: "200px",
		viewBox: "0 0 100 100",
		preserveAspectRatio: "xMidYMid",
	},
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "0s",
		}),
	),
	react.createElement(
		"circle",
		{
			cx: "50",
			cy: "50",
			r: "0",
			fill: "none",
			stroke: "currentColor",
			"stroke-width": "2",
		},
		react.createElement("animate", {
			attributeName: "r",
			repeatCount: "indefinite",
			dur: "1s",
			values: "0;40",
			keyTimes: "0;1",
			keySplines: "0 0.2 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
		react.createElement("animate", {
			attributeName: "opacity",
			repeatCount: "indefinite",
			dur: "1s",
			values: "1;0",
			keyTimes: "0;1",
			keySplines: "0.2 0 0.8 1",
			calcMode: "spline",
			begin: "-0.5s",
		}),
	),
);

const VersionSelector = react.memo(({ items, index, callback }) => {
	if (items.length < 2) {
		return null;
	}
	return react.createElement(
		"div",
		{
			className: "lyrics-versionSelector",
		},
		react.createElement(
			"select",
			{
				onChange: (event) => {
					callback(items, event.target.value);
				},
				value: index,
			},
			items.map((a, i) => {
				return react.createElement("option", { value: i }, a.title);
			}),
		),
		react.createElement(
			"svg",
			{
				height: "16",
				width: "16",
				fill: "currentColor",
				viewBox: "0 0 16 16",
			},
			react.createElement("path", {
				d: "M3 6l5 5.794L13 6z",
			}),
		),
	);
});

// ============================================================================
// index.js — LyricsContainer class
// ============================================================================

class LyricsContainer extends react.Component {
	constructor() {
		super();
		this.state = {
			karaoke: null,
			synced: null,
			unsynced: null,
			genius: null,
			genius2: null,
			currentLyrics: null,
			romaji: null,
			furigana: null,
			hiragana: null,
			hangul: null,
			romaja: null,
			katakana: null,
			cn: null,
			hk: null,
			tw: null,
			musixmatchTranslation: null,
			musixmatchTranslationLanguage: null,
			musixmatchAvailableTranslations: [],
			musixmatchTrackId: null,
			neteaseTranslation: null,
			uri: "",
			provider: "",
			colors: {
				background: "",
				inactive: "",
			},
			tempo: "0.25s",
			explicitMode: -1,
			lockMode: CONFIG.locked,
			mode: -1,
			isLoading: false,
			versionIndex: 0,
			versionIndex2: 0,
			isFullscreen: false,
			isFADMode: false,
			isCached: false,
			language: null,
		};
		this.currentTrackUri = "";
		this.nextTrackUri = "";
		this.availableModes = [];
		this.styleVariables = {};
		this.fullscreenContainer = document.createElement("div");
		this.fullscreenContainer.id = "lyrics-fullscreen-container";
		this.mousetrap = null;
		this.containerRef = react.createRef(null);
		this.translator = null;
		this.initMoustrap();
		// Cache last state
		this.languageOverride = CONFIG.visual["translate:detect-language-override"];
		this.translate = CONFIG.visual.translate;
		this.reRenderLyricsPage = false;
		this.displayMode = null;
		this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
		this._musixmatchTranslationRequestId = null;
	}

	infoFromTrack(track) {
		const meta = track?.metadata;
		if (!meta) {
			return null;
		}
		return {
			duration: Number(meta.duration),
			album: meta.album_title,
			artist: meta.artist_name,
			title: meta.title,
			uri: track.uri,
			image: meta.image_url,
		};
	}

	async fetchColors(uri) {
		let vibrant = 0;
		try {
			try {
				const { fetchExtractedColorForTrackEntity } = Spicetify.GraphQL.Definitions;
				const { data } = await Spicetify.GraphQL.Request(fetchExtractedColorForTrackEntity, { uri });
				const { hex } = data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
				vibrant = Number.parseInt(hex.replace("#", ""), 16);
			} catch {
				const colors = await Spicetify.CosmosAsync.get(
					`https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=${uri}&format=json`,
				);
				vibrant = colors.entries[0].color_swatches.find(
					(color) => color.preset === "VIBRANT_NON_ALARMING",
				).color;
			}
		} catch {
			vibrant = 8747370;
		}

		this.setState({
			colors: {
				background: Utils.convertIntToRGB(vibrant),
				inactive: Utils.convertIntToRGB(vibrant, 3),
			},
		});
	}

	async fetchTempo(uri) {
		const audio = await Spicetify.CosmosAsync.get(
			`https://spclient.wg.spotify.com/audio-attributes/v1/audio-features/${uri.split(":")[2]}?format=json`,
		);
		let tempo = audio.tempo;

		const MIN_TEMPO = 60;
		const MAX_TEMPO = 150;
		const MAX_PERIOD = 0.4;
		if (!tempo) tempo = 105;
		if (tempo < MIN_TEMPO) tempo = MIN_TEMPO;
		if (tempo > MAX_TEMPO) tempo = MAX_TEMPO;

		let period = MAX_PERIOD - ((tempo - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO)) * MAX_PERIOD;
		period = Math.round(period * 100) / 100;

		this.setState({
			tempo: `${String(period)}s`,
		});
	}

	async refreshMusixmatchTranslation() {
		const selectedLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		const availableTranslations = this.state.musixmatchAvailableTranslations || [];
		const trackId = this.state.musixmatchTrackId;
		const currentUri = this.state.uri;
		const currentRequestId = Symbol("musixmatchTranslationRequest");
		this._musixmatchTranslationRequestId = currentRequestId;
		const isLatestRequest = () => this._musixmatchTranslationRequestId === currentRequestId;
		const finishRequest = () => {
			if (isLatestRequest()) {
				this._musixmatchTranslationRequestId = null;
			}
		};

		const clearTranslation = () => {
			if (this.state.musixmatchTranslation !== null || this.state.musixmatchTranslationLanguage !== null) {
				this.setState({
					musixmatchTranslation: null,
					musixmatchTranslationLanguage: null,
				});
			}
			if (CACHE[currentUri]) {
				CACHE[currentUri].musixmatchTranslation = null;
				CACHE[currentUri].musixmatchTranslationLanguage = null;
			}
		};

		if (!trackId || !selectedLanguage || selectedLanguage === "none") {
			clearTranslation();
			finishRequest();
			return;
		}

		if (!availableTranslations.includes(selectedLanguage)) {
			clearTranslation();
			finishRequest();
			return;
		}

		const baseLyrics = this.state.synced ?? this.state.unsynced;
		if (!baseLyrics) {
			finishRequest();
			return;
		}

		const currentLanguage = selectedLanguage;

		Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_MESSAGE, false, 1000);

		this.setState({
			musixmatchTranslation: null,
			musixmatchTranslationLanguage: null,
		});

		let translation;
		try {
			translation = await ProviderMusixmatch.getTranslation(trackId);
		} catch (error) {
			console.error(error);
			if (isLatestRequest()) {
				Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
				if (CACHE[currentUri]) {
					CACHE[currentUri].musixmatchTranslation = null;
					CACHE[currentUri].musixmatchTranslationLanguage = null;
				}
			}
			finishRequest();
			return;
		}

		if (!translation) {
			if (isLatestRequest()) {
				Spicetify.showNotification(MUSIXMATCH_TRANSLATION_FETCH_FAILED_MESSAGE, true, 3000);
				if (CACHE[currentUri]) {
					CACHE[currentUri].musixmatchTranslation = null;
					CACHE[currentUri].musixmatchTranslationLanguage = null;
				}
			}
			finishRequest();
			return;
		}

		if (
			currentLanguage !== CONFIG.visual["musixmatch-translation-language"] ||
			trackId !== this.state.musixmatchTrackId ||
			currentUri !== this.state.uri ||
			!isLatestRequest()
		) {
			finishRequest();
			return;
		}

		const latestBaseLyrics = this.state.synced ?? this.state.unsynced;
		if (!latestBaseLyrics) {
			finishRequest();
			return;
		}

		const mappedTranslation = latestBaseLyrics.map((line) => {
			const originalText = line.originalText ?? line.text;
			const matched = translation.find(
				(entry) => Utils.processLyrics(entry.matchedLine) === Utils.processLyrics(originalText),
			);

			return {
				...line,
				text: matched?.translation ?? line.text,
				originalText,
			};
		});

		if (!isLatestRequest()) {
			finishRequest();
			return;
		}

		this.setState({
			musixmatchTranslation: mappedTranslation,
			musixmatchTranslationLanguage: currentLanguage,
		});
		if (CACHE[currentUri]) {
			CACHE[currentUri].musixmatchTranslation = mappedTranslation;
			CACHE[currentUri].musixmatchTranslationLanguage = currentLanguage;
		}
		finishRequest();
	}

	async tryServices(trackInfo, mode = -1) {
		const currentMode = CONFIG.modes[mode] || "";
		let finalData = { ...emptyState, uri: trackInfo.uri };
		for (const id of CONFIG.providersOrder) {
			const service = CONFIG.providers[id];
			if (spotifyVersion >= "1.2.31" && id === "genius") continue;
			if (!service.on) continue;
			if (mode !== -1 && !service.modes.includes(mode)) continue;

			let data;
			try {
				data = await Providers[id](trackInfo);
			} catch (e) {
				console.error(e);
				continue;
			}

			if (data.error || (!data.karaoke && !data.synced && !data.unsynced && !data.genius)) continue;
			if (mode === -1) {
				finalData = data;
				return finalData;
			}

			if (!data[currentMode]) {
				for (const key in data) {
					if (!finalData[key]) {
						finalData[key] = data[key];
					}
				}
				continue;
			}

			for (const key in data) {
				if (!finalData[key]) {
					finalData[key] = data[key];
				}
			}

			if (data.provider !== "local" && finalData.provider && finalData.provider !== data.provider) {
				const styledMode = currentMode.charAt(0).toUpperCase() + currentMode.slice(1);
				finalData.copyright =
					`${styledMode} lyrics provided by ${data.provider}\n${finalData.copyright || ""}`.trim();
			}

			if (
				finalData.musixmatchTranslation &&
				typeof finalData.musixmatchTranslation[0].startTime === "undefined" &&
				finalData.synced
			) {
				finalData.musixmatchTranslation = finalData.synced.map((line) => ({
					...line,
					text:
						finalData.musixmatchTranslation.find(
							(l) => Utils.processLyrics(l.originalText) === Utils.processLyrics(line.text),
						)?.text ?? line.text,
				}));
			}

			return finalData;
		}

		return finalData;
	}

	async fetchLyrics(track, mode = -1, refresh = false) {
		const info = this.infoFromTrack(track);
		if (!info) {
			this.setState({ error: "No track info" });
			return;
		}

		let isCached = this.lyricsSaved(info.uri);

		if (CONFIG.visual.colorful) {
			this.fetchColors(info.uri);
		}

		this.fetchTempo(info.uri);
		this.resetDelay();

		let tempState;
		// if lyrics are cached
		if ((mode === -1 && CACHE[info.uri]) || CACHE[info.uri]?.[CONFIG.modes?.[mode]]) {
			tempState = { ...emptyState, ...CACHE[info.uri], isCached };
			if (CACHE[info.uri]?.mode) {
				this.state.explicitMode = CACHE[info.uri]?.mode;
				tempState = { ...tempState, mode: CACHE[info.uri]?.mode };
			}
		} else {
			this.setState({ ...emptyState, isLoading: true, isCached: false });

			const resp = await this.tryServices(info, mode);
			if (resp.provider) {
				// Cache lyrics
				CACHE[resp.uri] = resp;
			}

			// This True when the user presses the Cache Lyrics button and saves it to localStorage.
			isCached = this.lyricsSaved(resp.uri);

			// In case user skips tracks too fast and multiple callbacks
			// set wrong lyrics to current track.
			if (resp.uri === this.currentTrackUri) {
				tempState = { ...emptyState, ...resp, isLoading: false, isCached };
			} else {
				return;
			}
		}

		const selectedMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"] || "none";
		const shouldRefreshMusixmatchTranslation =
			tempState.musixmatchTrackId &&
			selectedMusixmatchLanguage !== "none" &&
			Array.isArray(tempState.musixmatchAvailableTranslations) &&
			tempState.musixmatchAvailableTranslations.includes(selectedMusixmatchLanguage) &&
			(tempState.musixmatchTranslationLanguage !== selectedMusixmatchLanguage ||
				!tempState.musixmatchTranslation);
		if (
			selectedMusixmatchLanguage !== "none" &&
			(!Array.isArray(tempState.musixmatchAvailableTranslations) ||
				!tempState.musixmatchAvailableTranslations.includes(selectedMusixmatchLanguage))
		) {
			if (
				typeof CONFIG.visual["translate:translated-lyrics-source"] === "string" &&
				CONFIG.visual["translate:translated-lyrics-source"].startsWith(MUSIXMATCH_TRANSLATION_PREFIX)
			) {
				CONFIG.visual["translate:translated-lyrics-source"] = "none";
				localStorage.setItem(`${APP_NAME}:visual:translate:translated-lyrics-source`, "none");
			}
			CONFIG.visual["musixmatch-translation-language"] = "none";
			localStorage.setItem(`${APP_NAME}:visual:musixmatch-translation-language`, "none");
		}
		const translationOverrides = shouldRefreshMusixmatchTranslation
			? { musixmatchTranslation: null, musixmatchTranslationLanguage: null }
			: {};

		let finalMode = mode;
		if (mode === -1) {
			if (this.state.explicitMode !== -1) {
				finalMode = this.state.explicitMode;
			} else if (this.state.lockMode !== -1) {
				finalMode = this.state.lockMode;
			} else {
				// Auto switch
				if (tempState.karaoke) {
					finalMode = KARAOKE;
				} else if (tempState.synced) {
					finalMode = SYNCED;
				} else if (tempState.unsynced) {
					finalMode = UNSYNCED;
				} else if (tempState.genius) {
					finalMode = GENIUS;
				}
			}
		}

		this.lyricsSource(tempState, finalMode);

		// if song changed one time
		if (tempState.uri !== this.state.uri || refresh) {
			// when a song starts for the first time and language-override is selected, the lyrics are converted to the specified language.
			// however, when switching it off again, the detected language needs to be known, so defaultLanguage has been introduced.
			const defaultLanguage = Utils.detectLanguage(this.state.currentLyrics);
			const language =
				CONFIG.visual["translate:detect-language-override"] !== "off"
					? CONFIG.visual["translate:detect-language-override"]
					: defaultLanguage;
			const friendlyLanguage =
				language &&
				new Intl.DisplayNames(["en"], { type: "language" }).of(language.split("-")[0])?.toLowerCase();
			const targetConvert = CONFIG.visual[`translation-mode:${friendlyLanguage}`];

			const isMemory = CACHE[tempState.uri]?.[targetConvert];
			if (CONFIG.visual.translate && defaultLanguage && !isMemory) {
				this.translateLyrics(language, this.state.currentLyrics, targetConvert).then((translated) => {
					const res = { [targetConvert]: translated };
					// Cache translated lyrics
					CACHE[tempState.uri] = { ...CACHE[tempState.uri], ...res };
					this.setState({ ...res });
				});
			}

			// reset and apply
			this.setState(
				{
					furigana: null,
					romaji: null,
					hiragana: null,
					katakana: null,
					hangul: null,
					romaja: null,
					cn: null,
					hk: null,
					tw: null,
					neteaseTranslation: null,
					...tempState,
					...translationOverrides,
					language: defaultLanguage,
				},
				() => {
					this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
					if (shouldRefreshMusixmatchTranslation) {
						this.refreshMusixmatchTranslation();
					}
				},
			);
			return;
		}

		this.setState({ ...tempState, ...translationOverrides }, () => {
			this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
			if (shouldRefreshMusixmatchTranslation) {
				this.refreshMusixmatchTranslation();
			}
		});
	}

	lyricsSource(lyricsState, mode) {
		if (!lyricsState) return;

		const lang = this.provideLanguageCode(this.state.currentLyrics);
		const friendlyLanguage =
			lang && new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0])?.toLowerCase();

		if (!this.displayMode) {
			this.displayMode = CONFIG.visual[`translation-mode:${friendlyLanguage}`];
		}

		// get original Lyrics
		const lyrics = lyricsState[CONFIG.modes[mode]];
		const translationSourceConfig = resolveTranslationSource(CONFIG.visual["translate:translated-lyrics-source"]);

		if (translationSourceConfig.language) {
			const translationLanguageKey = `${APP_NAME}:visual:musixmatch-translation-language`;
			const storedLanguage = localStorage.getItem(translationLanguageKey);

			if (storedLanguage !== translationSourceConfig.language) {
				localStorage.setItem(translationLanguageKey, translationSourceConfig.language);
			}

			if (CONFIG.visual["musixmatch-translation-language"] !== translationSourceConfig.language) {
				CONFIG.visual["musixmatch-translation-language"] = translationSourceConfig.language;
			}
		}

		if (CONFIG.visual.translate) {
			this.state.currentLyrics = lyricsState[CONFIG.visual[`translation-mode:${friendlyLanguage}`]] ?? lyrics;
		} else {
			this.state.currentLyrics = lyricsState[translationSourceConfig.key] ?? lyrics;
		}

		// Convert Mode re-fresh
		if (
			this.translate !== CONFIG.visual.translate ||
			this.languageOverride !== CONFIG.visual["translate:detect-language-override"] ||
			this.displayMode !== CONFIG.visual[`translation-mode:${friendlyLanguage}`]
		) {
			this.translate = CONFIG.visual.translate;
			this.languageOverride = CONFIG.visual["translate:detect-language-override"];
			this.displayMode = CONFIG.visual[`translation-mode:${friendlyLanguage}`];

			if (CONFIG.visual.translate) {
				const targetConvert = CONFIG.visual[`translation-mode:${friendlyLanguage}`];
				const isCached = CACHE[lyricsState.uri]?.[targetConvert];

				if (!isCached) {
					this.translateLyrics(lang, lyrics, targetConvert).then((translated) => {
						const res = { [targetConvert]: translated };
						// Cache translated lyrics
						CACHE[lyricsState.uri] = { ...CACHE[lyricsState.uri], ...res };
						this.setState({ ...this.state, ...res });
					});
				}
			} else {
				const resetCache = {
					furigana: null,
					romaji: null,
					hiragana: null,
					katakana: null,
					hangul: null,
					romaja: null,
					cn: null,
					hk: null,
					tw: null,
				};
				CACHE[lyricsState.uri] = { ...CACHE[lyricsState.uri], ...resetCache };
			}
		}
	}

	provideLanguageCode(lyrics) {
		if (!lyrics) return;

		if (CONFIG.visual["translate:detect-language-override"] !== "off") {
			return CONFIG.visual["translate:detect-language-override"];
		}
		if (this.state.language) {
			return this.state.language;
		}
		return Utils.detectLanguage(lyrics);
	}

	async translateLyrics(language, lyrics, targetConvert) {
		if (!language) return;

		Spicetify.showNotification("Converting...", false, 1000);
		if (!this.translator) {
			this.translator = new Translator(language);
		}
		await this.translator.awaitFinished(language);

		let result;
		try {
			if (language === "ja") {
				// Japanese
				const map = {
					romaji: { target: "romaji", mode: "spaced" },
					furigana: { target: "hiragana", mode: "furigana" },
					hiragana: { target: "hiragana", mode: "normal" },
					katakana: { target: "katakana", mode: "normal" },
				};

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.romajifyText(
								lyric.text,
								map[targetConvert].target,
								map[targetConvert].mode,
							),
					),
				);
			} else if (language === "ko") {
				// Korean
				result = await Promise.all(
					lyrics.map(async (lyric) => await this.translator.convertToRomaja(lyric.text, "romaji")),
				);
			} else if (language === "zh-hans") {
				// Chinese (Simplified)
				const map = {
					cn: { from: "cn", target: "cn" },
					tw: { from: "cn", target: "tw" },
					hk: { from: "cn", target: "hk" },
				};

				// prevent conversion between the same language.
				if (targetConvert === "cn") {
					Spicetify.showNotification("No conversion is needed", false, 1000);
					return lyrics;
				}

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.convertChinese(
								lyric.text,
								map[targetConvert].from,
								map[targetConvert].target,
							),
					),
				);
			} else if (language === "zh-hant") {
				// Chinese (Traditional)
				const map = {
					cn: { from: "t", target: "cn" },
					hk: { from: "t", target: "hk" },
					tw: { from: "t", target: "tw" },
				};

				// prevent conversion between the same language.
				if (targetConvert === "tw") {
					Spicetify.showNotification("No conversion is needed", false, 1000);
					return lyrics;
				}

				result = await Promise.all(
					lyrics.map(
						async (lyric) =>
							await this.translator.convertChinese(
								lyric.text,
								map[targetConvert].from,
								map[targetConvert].target,
							),
					),
				);
			}

			const res = Utils.processTranslatedLyrics(result, lyrics);
			Spicetify.showNotification("Converting...", false, 0);
			return res;
		} catch (error) {
			Spicetify.showNotification("Convert Error!", true);
			console.error(error);
		}
	}

	resetDelay() {
		CONFIG.visual.delay = Number(localStorage.getItem(`lyrics-delay:${Spicetify.Player.data.item.uri}`)) || 0;
	}

	async onVersionChange(items, index) {
		if (this.state.mode === GENIUS) {
			this.setState({
				...emptyLine,
				genius2: this.state.genius2,
				isLoading: true,
			});
			const lyrics = await ProviderGenius.fetchLyricsVersion(items, index);
			this.setState({
				genius: lyrics,
				versionIndex: index,
				isLoading: false,
			});
		}
	}

	async onVersionChange2(items, index) {
		if (this.state.mode === GENIUS) {
			this.setState({
				...emptyLine,
				genius: this.state.genius,
				isLoading: true,
			});
			const lyrics = await ProviderGenius.fetchLyricsVersion(items, index);
			this.setState({
				genius2: lyrics,
				versionIndex2: index,
				isLoading: false,
			});
		}
	}

	saveLocalLyrics(uri, lyrics) {
		if (lyrics.genius) {
			lyrics.unsynced = lyrics.genius.split("<br>").map((lyc) => {
				return {
					text: lyc.replace(/<[^>]*>/g, ""),
				};
			});
			lyrics.genius = null;
		}

		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		localLyrics[uri] = lyrics;
		localStorage.setItem(`${APP_NAME}:local-lyrics`, JSON.stringify(localLyrics));
		this.setState({ isCached: true });
	}

	deleteLocalLyrics(uri) {
		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		delete localLyrics[uri];
		localStorage.setItem(`${APP_NAME}:local-lyrics`, JSON.stringify(localLyrics));
		console.log(localLyrics);
		this.setState({ isCached: false });
	}

	lyricsSaved(uri) {
		const localLyrics = JSON.parse(localStorage.getItem(`${APP_NAME}:local-lyrics`)) || {};
		return !!localLyrics[uri];
	}

	processLyricsFromFile(event) {
		const file = event.target.files;
		if (!file.length) return;
		const reader = new FileReader();

		if (file[0].size > 1024 * 1024) {
			Spicetify.showNotification("File too large", true);
			return;
		}

		reader.onload = (e) => {
			try {
				const localLyrics = Utils.parseLocalLyrics(e.target.result);
				const parsedKeys = Object.keys(localLyrics)
					.filter((key) => localLyrics[key])
					.map((key) => key[0].toUpperCase() + key.slice(1))
					.map((key) => `<strong>${key}</strong>`);

				if (!parsedKeys.length) {
					Spicetify.showNotification("Nothing to load", true);
					return;
				}

				this.setState({ ...localLyrics, provider: "local" });
				CACHE[this.currentTrackUri] = { ...localLyrics, provider: "local", uri: this.currentTrackUri };
				this.saveLocalLyrics(this.currentTrackUri, localLyrics);

				Spicetify.showNotification(`Loaded ${parsedKeys.join(", ")} lyrics from file`);
			} catch (e) {
				console.error(e);
				Spicetify.showNotification("Failed to load lyrics", true);
			}
		};

		reader.onerror = (e) => {
			console.error(e);
			Spicetify.showNotification("Failed to read file", true);
		};

		reader.readAsText(file[0]);
		event.target.value = "";
	}
	initMoustrap() {
		if (!this.mousetrap && Spicetify.Mousetrap) {
			this.mousetrap = new Spicetify.Mousetrap();
		}
	}

	componentDidMount() {
		this.onQueueChange = async ({ data: queue }) => {
			this.state.explicitMode = this.state.lockMode;
			this.currentTrackUri = queue.current.uri;
			this.fetchLyrics(queue.current, this.state.explicitMode);
			this.viewPort.scrollTo(0, 0);

			// Fetch next track
			const nextTrack = queue.queued?.[0] || queue.nextUp?.[0];
			const nextInfo = this.infoFromTrack(nextTrack);
			// Debounce next track fetch
			if (!nextInfo || nextInfo.uri === this.nextTrackUri) return;
			this.nextTrackUri = nextInfo.uri;
			this.tryServices(nextInfo, this.state.explicitMode).then((resp) => {
				if (resp.provider) {
					// Cache lyrics
					CACHE[resp.uri] = resp;
				}
			});
		};

		if (Spicetify.Player?.data?.item) {
			this.state.explicitMode = this.state.lockMode;
			this.currentTrackUri = Spicetify.Player.data.item.uri;
			this.fetchLyrics(Spicetify.Player.data.item, this.state.explicitMode);
		}

		this.updateVisualOnConfigChange();
		Utils.addQueueListener(this.onQueueChange);

		lyricContainerUpdate = () => {
			this.reRenderLyricsPage = !this.reRenderLyricsPage;
			this.updateVisualOnConfigChange();
			this.forceUpdate();

			if (this.currentMusixmatchLanguage !== CONFIG.visual["musixmatch-translation-language"]) {
				this.currentMusixmatchLanguage = CONFIG.visual["musixmatch-translation-language"];
				this.refreshMusixmatchTranslation();
			}
		};

		reloadLyrics = () => {
			CACHE = {};
			this.updateVisualOnConfigChange();
			this.forceUpdate();
			this.fetchLyrics(Spicetify.Player.data.item, this.state.explicitMode, true);
		};

		this.viewPort =
			document.querySelector(".Root__main-view .os-viewport") ??
			document.querySelector(".Root__main-view .main-view-container__scroll-node");

		this.configButton = new Spicetify.Menu.Item("Lyrics Plus config", false, openConfig, "lyrics");
		this.configButton.register();

		this.onFontSizeChange = (event) => {
			if (!event.ctrlKey) return;
			const dir = event.deltaY < 0 ? 1 : -1;
			let temp = CONFIG.visual["font-size"] + dir * fontSizeLimit.step;
			if (temp < fontSizeLimit.min) {
				temp = fontSizeLimit.min;
			} else if (temp > fontSizeLimit.max) {
				temp = fontSizeLimit.max;
			}
			CONFIG.visual["font-size"] = temp;
			localStorage.setItem("lyrics-plus:visual:font-size", temp);
			lyricContainerUpdate();
		};

		this.toggleFullscreen = () => {
			const isEnabled = !this.state.isFullscreen;
			if (isEnabled) {
				document.body.append(this.fullscreenContainer);
				document.documentElement.requestFullscreen();
				this.mousetrap.bind("esc", this.toggleFullscreen);
			} else {
				this.fullscreenContainer.remove();
				document.exitFullscreen();
				this.mousetrap.unbind("esc");
			}

			this.setState({
				isFullscreen: isEnabled,
			});
		};
		this.mousetrap.reset();
		this.mousetrap.bind(CONFIG.visual["fullscreen-key"], this.toggleFullscreen);
		window.addEventListener("fad-request", lyricContainerUpdate);
	}

	componentWillUnmount() {
		Utils.removeQueueListener(this.onQueueChange);
		this.configButton.deregister();
		this.mousetrap.reset();
		window.removeEventListener("fad-request", lyricContainerUpdate);
	}

	updateVisualOnConfigChange() {
		this.availableModes = CONFIG.modes.filter((_, id) => {
			return Object.values(CONFIG.providers).some((p) => p.on && p.modes.includes(id));
		});

		if (!CONFIG.visual.colorful) {
			this.styleVariables = {
				"--lyrics-color-active": CONFIG.visual["active-color"],
				"--lyrics-color-inactive": CONFIG.visual["inactive-color"],
				"--lyrics-color-background": CONFIG.visual["background-color"],
				"--lyrics-highlight-background": CONFIG.visual["highlight-color"],
				"--lyrics-background-noise": CONFIG.visual.noise ? "var(--background-noise)" : "unset",
			};
		}

		this.styleVariables = {
			...this.styleVariables,
			"--lyrics-align-text": CONFIG.visual.alignment,
			"--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
			"--animation-tempo": this.state.tempo,
		};

		this.mousetrap.reset();
		this.mousetrap.bind(CONFIG.visual["fullscreen-key"], this.toggleFullscreen);
	}

	render() {
		const fadLyricsContainer = document.getElementById("fad-lyrics-plus-container");
		this.state.isFADMode = !!fadLyricsContainer;

		if (this.state.isFADMode) {
			// Text colors will be set by FAD extension
			this.styleVariables = {};
		} else if (CONFIG.visual.colorful) {
			this.styleVariables = {
				"--lyrics-color-active": "white",
				"--lyrics-color-inactive": this.state.colors.inactive,
				"--lyrics-color-background": this.state.colors.background || "transparent",
				"--lyrics-highlight-background": this.state.colors.inactive,
				"--lyrics-background-noise": CONFIG.visual.noise ? "var(--background-noise)" : "unset",
			};
		}

		this.styleVariables = {
			...this.styleVariables,
			"--lyrics-align-text": CONFIG.visual.alignment,
			"--lyrics-font-size": `${CONFIG.visual["font-size"]}px`,
			"--animation-tempo": this.state.tempo,
		};

		let mode = -1;
		if (this.state.explicitMode !== -1) {
			mode = this.state.explicitMode;
		} else if (this.state.lockMode !== -1) {
			mode = this.state.lockMode;
		} else {
			// Auto switch
			if (this.state.karaoke) {
				mode = KARAOKE;
			} else if (this.state.synced) {
				mode = SYNCED;
			} else if (this.state.unsynced) {
				mode = UNSYNCED;
			} else if (this.state.genius) {
				mode = GENIUS;
			}
		}

		let activeItem;
		let showTranslationButton;

		this.lyricsSource(this.state, mode);
		const lang = this.provideLanguageCode(this.state.currentLyrics);
		const friendlyLanguage =
			lang && new Intl.DisplayNames(["en"], { type: "language" }).of(lang.split("-")[0])?.toLowerCase();
		const hasMusixmatchLanguages =
			Array.isArray(this.state.musixmatchAvailableTranslations) &&
			this.state.musixmatchAvailableTranslations.length > 0;
		const hasTranslation =
			this.state.neteaseTranslation !== null ||
			this.state.musixmatchTranslation !== null ||
			hasMusixmatchLanguages;
		const hasPerformer = !!this.state.currentLyrics?.some((line) => line.performer);

		if (mode !== -1) {
			showTranslationButton = (friendlyLanguage || hasTranslation) && (mode === SYNCED || mode === UNSYNCED);

			if (mode === KARAOKE && this.state.karaoke) {
				activeItem = react.createElement(
					CONFIG.visual["synced-compact"] ? SyncedLyricsPage : SyncedExpandedLyricsPage,
					{
						isKara: true,
						trackUri: this.state.uri,
						lyrics: this.state.karaoke,
						provider: this.state.provider,
						copyright: this.state.copyright,
						reRenderLyricsPage: this.reRenderLyricsPage,
					},
				);
			} else if (mode === SYNCED && this.state.synced) {
				activeItem = react.createElement(
					CONFIG.visual["synced-compact"] ? SyncedLyricsPage : SyncedExpandedLyricsPage,
					{
						trackUri: this.state.uri,
						lyrics: this.state.currentLyrics,
						provider: this.state.provider,
						copyright: this.state.copyright,
						reRenderLyricsPage: this.reRenderLyricsPage,
					},
				);
			} else if (mode === UNSYNCED && this.state.unsynced) {
				activeItem = react.createElement(UnsyncedLyricsPage, {
					trackUri: this.state.uri,
					lyrics: this.state.currentLyrics,
					provider: this.state.provider,
					copyright: this.state.copyright,
					reRenderLyricsPage: this.reRenderLyricsPage,
				});
			} else if (mode === GENIUS && this.state.genius) {
				activeItem = react.createElement(GeniusPage, {
					isSplitted: CONFIG.visual["dual-genius"],
					trackUri: this.state.uri,
					lyrics: this.state.genius,
					provider: this.state.provider,
					copyright: this.state.copyright,
					versions: this.state.versions,
					versionIndex: this.state.versionIndex,
					onVersionChange: this.onVersionChange.bind(this),
					lyrics2: this.state.genius2,
					versionIndex2: this.state.versionIndex2,
					onVersionChange2: this.onVersionChange2.bind(this),
					reRenderLyricsPage: this.reRenderLyricsPage,
				});
			}
		}

		if (!activeItem) {
			activeItem = react.createElement(
				"div",
				{
					className: "lyrics-lyricsContainer-LyricsUnavailablePage",
				},
				react.createElement(
					"span",
					{
						className: "lyrics-lyricsContainer-LyricsUnavailableMessage",
					},
					this.state.isLoading ? LoadingIcon : "(• _ • )",
				),
			);
		}

		this.state.mode = mode;

		const out = react.createElement(
			"div",
			{
				className: `lyrics-lyricsContainer-LyricsContainer${CONFIG.visual["fade-blur"] ? " blur-enabled" : ""}${
					fadLyricsContainer ? " fad-enabled" : ""
				}`,
				style: this.styleVariables,
				ref: (el) => {
					if (!el) return;
					el.onmousewheel = this.onFontSizeChange;
				},
			},
			react.createElement("div", {
				className: "lyrics-lyricsContainer-LyricsBackground",
			}),
			react.createElement(
				"div",
				{
					className: "lyrics-config-button-container",
				},
				showTranslationButton &&
					react.createElement(TranslationMenu, {
						friendlyLanguage,
						hasTranslation: {
							musixmatch: this.state.musixmatchTranslation !== null,
							netease: this.state.neteaseTranslation !== null,
						},
						musixmatchLanguages: this.state.musixmatchAvailableTranslations || [],
						musixmatchSelectedLanguage:
							this.state.musixmatchTranslationLanguage ||
							CONFIG.visual["musixmatch-translation-language"],
					}),
				react.createElement(AdjustmentsMenu, { mode, hasPerformer }),
				react.createElement(
					Spicetify.ReactComponent.TooltipWrapper,
					{
						label: this.state.isCached ? "Lyrics cached" : "Cache lyrics",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							onClick: () => {
								const { synced, unsynced, karaoke, genius } = this.state;
								if (!synced && !unsynced && !karaoke && !genius) {
									Spicetify.showNotification("No lyrics to cache", true);
									return;
								}

								if (this.state.isCached) {
									this.deleteLocalLyrics(this.currentTrackUri);
									Spicetify.showNotification("Delete lyrics cache");
								} else {
									this.saveLocalLyrics(this.currentTrackUri, { synced, unsynced, karaoke, genius });
									Spicetify.showNotification("Lyrics cached");
								}
							},
						},
						react.createElement("svg", {
							width: 16,
							height: 16,
							viewBox: "0 0 16 16",
							fill: "currentColor",
							dangerouslySetInnerHTML: {
								__html: Spicetify.SVGIcons[this.state.isCached ? "downloaded" : "download"],
							},
						}),
					),
				),
				react.createElement(
					Spicetify.ReactComponent.TooltipWrapper,
					{
						label: "Load lyrics from file",
					},
					react.createElement(
						"button",
						{
							className: "lyrics-config-button",
							onClick: () => {
								document.getElementById("lyrics-file-input").click();
							},
						},
						react.createElement("input", {
							type: "file",
							id: "lyrics-file-input",
							accept: ".lrc,.txt",
							onChange: this.processLyricsFromFile.bind(this),
							style: {
								display: "none",
							},
						}),
						react.createElement("svg", {
							width: 16,
							height: 16,
							viewBox: "0 0 16 16",
							fill: "currentColor",
							dangerouslySetInnerHTML: {
								__html: Spicetify.SVGIcons["plus-alt"],
							},
						}),
					),
				),
			),
			activeItem,
			react.createElement(TopBarContent, {
				links: this.availableModes,
				activeLink: CONFIG.modes[mode],
				lockLink: CONFIG.modes[this.state.lockMode],
				switchCallback: (label) => {
					const mode = CONFIG.modes.findIndex((a) => a === label);
					if (mode !== this.state.mode) {
						// If explicitMode is not set, moving the topBar will apply the default mode value for the selected song.
						const info = this.infoFromTrack(Spicetify.Player.data.item);
						if (info?.uri && CACHE[info?.uri]) {
							CACHE[info.uri].mode = mode;
						}

						this.setState({ explicitMode: mode });
						if (this.state.provider !== "local") this.fetchLyrics(Spicetify.Player.data.item, mode);
					}
				},
				lockCallback: (label) => {
					let mode = CONFIG.modes.findIndex((a) => a === label);
					if (mode === this.state.lockMode) {
						mode = -1;
					}
					this.setState({ explicitMode: mode, lockMode: mode });
					this.fetchLyrics(Spicetify.Player.data.item, mode);
					CONFIG.locked = mode;
					localStorage.setItem("lyrics-plus:lock-mode", mode);
				},
			}),
		);

		if (this.state.isFullscreen) return Spicetify.ReactDOM.createPortal(out, this.fullscreenContainer);
		if (fadLyricsContainer) return Spicetify.ReactDOM.createPortal(out, fadLyricsContainer);
		return out;
	}
}

// ============================================================================
// PlaybarButton.js (adapted) — classic IIFE turned into a ctx-scoped function
// ============================================================================

function initPlaybarButton(ctx: ModuleRuntimeContext) {
	if (!Spicetify.Platform?.History) {
		const retry = window.setTimeout(() => initPlaybarButton(ctx), 300);
		ctx.defer(() => window.clearTimeout(retry));
		return;
	}

	const button = new Spicetify.Playbar.Button(
		"Lyrics Plus",
		`<svg role="img" height="16" width="16" aria-hidden="true" viewBox="0 0 16 16" data-encore-id="icon" fill="currentColor"><path d="M13.426 2.574a2.831 2.831 0 0 0-4.797 1.55l3.247 3.247a2.831 2.831 0 0 0 1.55-4.797zM10.5 8.118l-2.619-2.62A63303.13 63303.13 0 0 0 4.74 9.075L2.065 12.12a1.287 1.287 0 0 0 1.816 1.816l3.06-2.688 3.56-3.129zM7.12 4.094a4.331 4.331 0 1 1 4.786 4.786l-3.974 3.493-3.06 2.689a2.787 2.787 0 0 1-3.933-3.933l2.676-3.045 3.505-3.99z"></path></svg>`,
		() =>
			Spicetify.Platform.History.location.pathname !== "/lyrics-plus"
				? Spicetify.Platform.History.push("/lyrics-plus")
				: Spicetify.Platform.History.goBack(),
		false,
		Spicetify.Platform.History.location.pathname === "/lyrics-plus",
		false,
	);

	const style = document.createElement("style");
	style.innerHTML = `
		.main-nowPlayingBar-lyricsButton[data-testid="lyrics-button"] {
			display: none !important;
		}
		li[data-id="/lyrics-plus"] {
			display: none;
		}
	`;
	style.classList.add("lyrics-plus:visual:playbar-button");

	let registered = false;
	const setPlaybarButton = () => {
		if (registered) return;
		document.head.appendChild(style);
		button.register();
		registered = true;
	};
	const removePlaybarButton = () => {
		if (!registered) return;
		style.remove();
		button.deregister();
		registered = false;
	};

	if (Spicetify.LocalStorage.get("lyrics-plus:visual:playbar-button") === "true") setPlaybarButton();

	const onToggle = (event: any) => {
		if (event.detail?.name === "playbar-button") {
			if (event.detail.value) setPlaybarButton();
			else removePlaybarButton();
		}
	};
	window.addEventListener("lyrics-plus", onToggle);

	const unlisten = Spicetify.Platform.History.listen((location: any) => {
		button.active = location.pathname === "/lyrics-plus";
	});

	ctx.defer(() => {
		removePlaybarButton();
		window.removeEventListener("lyrics-plus", onToggle);
		if (typeof unlisten === "function") unlisten();
	});
}

// ============================================================================
// v3 mount — replaces the classic render() entry point
// ============================================================================

export default function (ctx: ModuleRuntimeContext) {
	const registrar = createRegistrar(ctx);
	registrar.register(
		"navlink",
		react.createElement(NavLink, { localizedApp: "Lyrics", appRoutePath: ROUTE, icon: ICON, activeIcon: ICON }),
	);
	registrar.registerRoute(ROUTE, react.createElement(LyricsContainer));
	initPlaybarButton(ctx);
}
