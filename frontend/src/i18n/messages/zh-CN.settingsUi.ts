// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页另外八张卡片的界面文案：投投悬浮球、求职助手放宽模式、生成内容保存位置、
 * 帮助与诊断、隐私与数据主权、提醒与提示音、助手技能与网申填表放宽模式。
 *
 * 「软件更新」卡不在这里——它已有一整套 `update.*` key，剩余文案追加在
 * `zh-CN.update.ts`（同一个命名空间不拆两处）。
 *
 * 开关上的「开 / 关」四张卡共用，放最前面，避免各写一份同义文案。
 */
const settingsUi = {
  // ── 开关上共用的两档文案 ─────────────────────────────────────
  /** Switch 的选中态；四张卡的开关共用。 */
  "settingsUi.switch.on": "开",
  /** Switch 的未选中态。 */
  "settingsUi.switch.off": "关",
  /** 即改即存开关下面那行通用说明（投投悬浮球与提醒弹窗共用）。 */
  "settingsUi.switch.defaultOnHint": "默认开启，可随时在这里关闭。",

  // ── 投投悬浮球卡 ─────────────────────────────────────────
  "settingsUi.orb.title": "投投悬浮球",
  /** 卡片说明：入口是什么、贴边收起后会不会挡内容。 */
  "settingsUi.orb.intro":
    "在应用各页面保留一个轻量的求职助手入口。点击它可以直接进入助手，静置后会自动贴边收起，不会遮挡主要内容。",
  /** 入口开关的无障碍名。 */
  "settingsUi.orb.enableAria": "开启投投悬浮球",
  "settingsUi.orb.enableToast": "已开启投投悬浮球",
  "settingsUi.orb.disableToast": "已关闭投投悬浮球",
  /** 提示标语开关的无障碍名。 */
  "settingsUi.orb.tipsAria": "开启投投提示标语",
  "settingsUi.orb.tipsOnToast": "投投会继续弹出提示标语",
  "settingsUi.orb.tipsOffToast": "投投不再弹出提示标语",
  /** 关掉标语后仍保留哪些行为：只说被影响的，不吓唬用户。 */
  "settingsUi.orb.tipsHint":
    "关闭后悬浮球不再弹出提示语，也不会在「我的资料」页提示你去改资料，其余功能不受影响。",
  "settingsUi.orb.loadFailed": "加载投投悬浮球设置失败",
  "settingsUi.orb.saveFailed": "保存投投悬浮球设置失败",

  // ── 求职助手「放宽模式」卡 ───────────────────────────────────
  "settingsUi.assistantRelaxed.title": "求职助手 · 放宽模式",
  /** 默认态说明：现在助手看到的是脱敏资料。 */
  "settingsUi.assistantRelaxed.intro":
    "默认关闭：助手读到的是脱敏资料（不含姓名、电话等身份字段），也没有网申填写值与历史对话工具。",
  "settingsUi.assistantRelaxed.toggleAria": "求职助手放宽模式",
  "settingsUi.assistantRelaxed.enableToast":
    "已开启放宽模式：求职助手现在可以读取完整资料（含敏感信息）",
  "settingsUi.assistantRelaxed.disableToast": "已关闭：助手回到默认的脱敏视图，敏感工具不再下发",
  "settingsUi.assistantRelaxed.saveFailed": "保存助手放宽模式设置失败",
  /** 开启态说明：解锁范围 + 数据会发给谁。 */
  "settingsUi.assistantRelaxed.stateOn":
    "已开启：助手可以读取完整资料——姓名、电话、邮箱等身份字段，网申填表的真实填写值，以及你的历史对话；这些内容会随提问发送给你配置的大模型服务商。请仅在本人设备上开启。",
  /** 关闭态说明（开启前的提前告知）。 */
  "settingsUi.assistantRelaxed.stateOff":
    "开启前请知悉：开启后助手可读取完整资料（含姓名、电话等敏感信息）、网申填表的真实填写值与历史对话，这些内容会随提问发送给你配置的大模型服务商。",
  /** 任何模式都不解锁的边界：凭据、照片二进制、删除类工具。 */
  "settingsUi.assistantRelaxed.neverSent":
    "任何模式下都不会发送：API 密钥等凭据与全局配置、简历照片的图片内容；助手也永远没有删除类工具。",

  // ── 生成内容保存位置卡 ───────────────────────────────────────
  "settingsUi.exportSave.title": "生成内容保存位置",
  "settingsUi.exportSave.intro":
    "默认保存到浏览器默认下载目录；从本机前端选择文件夹后，导出会同时保存一份到那里。",
  "settingsUi.exportSave.browse": "选择文件夹",
  "settingsUi.exportSave.reset": "恢复默认",
  /** 当前路径那一行；`{path}` 是已选目录或下面的默认值文案。 */
  "settingsUi.exportSave.current": "当前：{path}",
  /** 没有选过目录时的取值。 */
  "settingsUi.exportSave.defaultPath": "默认（浏览器下载目录）",
  /** 落盘冲突与失败时的保证：加后缀不覆盖、失败也不影响下载。 */
  "settingsUi.exportSave.footnote":
    "同名文件已存在时会自动加时间戳后缀，不会覆盖；落盘失败不影响正常下载。",
  "settingsUi.exportSave.loadFailed": "加载导出保存位置失败",
  "settingsUi.exportSave.resetDone": "已恢复默认：仅浏览器下载",
  "settingsUi.exportSave.saveFailed": "保存导出保存位置失败",
  "settingsUi.exportSave.cancelled": "已取消选择",
  /** 选好目录后的告知；`{path}` 是刚保存的绝对路径。 */
  "settingsUi.exportSave.picked": "已保存：从本机前端导出时会同时存到 {path}",
  "settingsUi.exportSave.pickerFailed": "无法打开文件夹选择器，请重试",

  // ── 帮助与诊断卡 ─────────────────────────────────────────
  "settingsUi.help.title": "帮助与诊断",
  /** 说明段的前半句：诊断包里有什么。 */
  "settingsUi.help.introLead":
    "遇到问题可以先导出一份诊断包：里面只有脱敏的运行事件、系统信息和近期日志，",
  /** 说明段里被加粗的那半句：包内没有什么（隐私承诺的核心）。 */
  "settingsUi.help.introNoResume": "不含简历数据与密钥",
  /** 说明段的后半句：发出来能省掉来回。 */
  "settingsUi.help.introTail": "。把它连同问题描述一起发出来，能省掉大半来回。",
  "settingsUi.help.export": "导出诊断包",
  "settingsUi.help.exported": "诊断包已导出，里面没有简历数据与密钥",
  "settingsUi.help.exportFailed": "导出诊断包失败",
  /** 预览摘要；`{files}` 是括号里的文件清单（没有文件时为空串）。 */
  "settingsUi.help.previewSummary": "包内约 {count} 条脱敏事件{files}，{note}",
  /** 文件清单两侧的括号（中文全角；英文用半角并补前导空格）。 */
  "settingsUi.help.previewFiles": "（{files}）",
  /** 清单里多个文件之间的分隔符。 */
  "settingsUi.help.previewSeparator": "、",
  /** 反馈渠道那一行的三段：链接前、群号前、群号后。 */
  "settingsUi.help.feedbackLead": "反馈渠道：",
  "settingsUi.help.feedbackJoin": "，或加用户群",
  "settingsUi.help.feedbackTail": "（进群后可直接反馈）。",

  // ── 隐私与数据主权卡 ─────────────────────────────────────────
  "settingsUi.privacy.title": "隐私与数据主权",
  /** 第一条承诺的前半句（加粗的「本机」在下一步）。 */
  "settingsUi.privacy.localLead": "你的简历、岗位、资料与提醒都保存在",
  /** 第一条承诺里被加粗的两个字：数据在本机。 */
  "settingsUi.privacy.localStrong": "本机",
  "settingsUi.privacy.localTail":
    "的数据目录里（SQLite 数据库），应用没有账号体系、没有埋点上报，也不会把简历数据上传到任何服务器。",
  /** AI 边界：只在主动调用时外包，密钥留在本机。 */
  "settingsUi.privacy.ai":
    "AI 功能只在你主动调用时，把完成任务所需的内容发送给你自己配置的模型服务商；服务商密钥保存在本机（Windows 上经系统级 DPAPI 加密）。诊断包（见「应用」分页的帮助与诊断）只含脱敏运行事件与日志尾部，不含简历数据与密钥。",
  /** 第三条承诺的两个小标题（各自后面紧跟一段正文）。 */
  "settingsUi.privacy.exportStrong": "带走数据：",
  "settingsUi.privacy.exportBody":
    "「数据集」卡片「导出」下拉里的「导出全部数据集」可整份导出为 .zip ——数据库、被引用的附件、自定义字体与全局模型配置都在包内；数据目录里若有既没进包、也不属于可重建产物的顶层项，导出后会明确提示「另有 N 项未纳入备份」。",
  "settingsUi.privacy.deleteStrong": "彻底删除：",
  "settingsUi.privacy.deleteBody":
    "删除对应数据集即可；想删得干干净净，退出应用后直接删除数据目录（backend/data）即可，卸载不留残余。",

  // ── 提醒与提示音卡 ─────────────────────────────────────────
  "settingsUi.reminderPopup.title": "提醒与提示音",
  "settingsUi.reminderPopup.intro":
    "打开应用时，若还有未完成的日历提醒，是否弹出「近期提醒」列表。",
  "settingsUi.reminderPopup.toggleAria": "打开应用时弹出提醒",
  "settingsUi.reminderPopup.enableToast": "已开启：打开应用时弹出近期提醒",
  "settingsUi.reminderPopup.disableToast": "已关闭：打开应用时不再弹出提醒",
  "settingsUi.reminderPopup.loadFailed": "加载提醒弹窗设置失败",
  "settingsUi.reminderPopup.saveFailed": "保存提醒弹窗设置失败",
  /** 提示音开关的说明：哪些任务会响、弹窗不受影响。 */
  "settingsUi.reminderPopup.soundIntro":
    "生成类任务（简历生成、岗位解读、匹配度分析等）与投递 / 采集批次**完成时**，是否播放一声提示音。 弹窗提醒不受这个开关影响。",
  "settingsUi.reminderPopup.soundAria": "任务完成时播放提示音",
  "settingsUi.reminderPopup.soundHint": "默认开启。浏览器若拦截自动播放，会静默跳过。",

  // ── 助手技能卡（只读摘要） ────────────────────────────────────
  "settingsUi.skills.title": "助手技能",
  /** 说明段的第一段：技能 = 提示词；第二段在 introPrompt 与 introMiddle 之间。 */
  "settingsUi.skills.introLead": "技能是一份",
  "settingsUi.skills.introPrompt": "提示词",
  "settingsUi.skills.introMiddle": "，也可以再带上一包",
  "settingsUi.skills.introKnowledge": "知识文件",
  /** 说明段的收尾：知识文件按需读取，最后引到工作台。 */
  "settingsUi.skills.introTail":
    "（.md / .txt）。启用的技能会告诉助手「按什么要求作答」，知识文件则由助手在需要时自己去读，不会一次性塞进对话。想新建或改得更细，请",
  "settingsUi.skills.manageLink": "去工作台管理",
  /** 链接后面的句号（单独一条，免得把标点画进链接下划线）。 */
  "settingsUi.skills.manageTail": "。",
  "settingsUi.skills.empty": "还没有技能",
  "settingsUi.skills.tagEnabled": "启用中",
  "settingsUi.skills.tagDisabled": "已停用",
  /** 技能行摘要的片段：知识文件份数 / 只有提示词 / 没写适用场景 / 字数 / 更新时间。 */
  "settingsUi.skills.files": "{count} 份知识文件",
  "settingsUi.skills.promptOnly": "仅提示词",
  "settingsUi.skills.noDescription": "未填写适用场景",
  "settingsUi.skills.promptChars": "提示词 {count} 字",
  "settingsUi.skills.updatedAt": "更新于 {date}",

  // ── 网申填表「放宽模式」卡 ────────────────────────────────────
  "settingsUi.webFormRelaxed.title": "网申填表 · 放宽模式",
  /** 默认态：「只填不点」的边界。 */
  "settingsUi.webFormRelaxed.intro":
    "默认关闭：网申填表「只填不点」，下拉、勾选、日期都需要你在页面上自己点。",
  "settingsUi.webFormRelaxed.toggleAria": "网申填表放宽模式",
  "settingsUi.webFormRelaxed.enableToast": "已开启放宽模式",
  "settingsUi.webFormRelaxed.disableToast": "已关闭：回到「只填不点」的默认边界",
  "settingsUi.webFormRelaxed.saveFailed": "保存放宽模式设置失败",
  /** 开启后程序会代做什么、仍然不做什么、风险在哪。 */
  "settingsUi.webFormRelaxed.warning":
    "开启后程序会尝试代点下拉/弹层选项并代勾你逐条确认过的声明项，存在选错可能，填完请核对；日期选择器与文件上传仍不代做。",
} as const;

export default settingsUi;
