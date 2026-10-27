// SPDX-License-Identifier: Apache-2.0
/**
 * 网申页「智能逐项填表」卡：标题、开关、卡片说明、状态标签、候选提示、资料目标与结束态。
 */
const liveModeCard = {
  "liveModeCard.title": "智能逐项填表",
  "liveModeCard.toggle.off": "关闭",
  "liveModeCard.toggle.on": "开启",
  "liveModeCard.toggle.ariaOff": "关闭智能逐项填表",
  "liveModeCard.toggle.ariaOn": "开启智能逐项填表",
  "liveModeCard.intro.lead": "开启后回到浏览器窗口，",
  "liveModeCard.intro.focusHint": "点到哪个框，就在框旁边给出资料里对应的值",
  "liveModeCard.intro.writeHint": "，你点「填入」才写进去。认不出来的时候点",
  "liveModeCard.intro.profilePickerHint": "「换个资料…」",
  "liveModeCard.intro.profileListHint": "会列出你填过的全部资料（按分区、可搜索），",
  "liveModeCard.intro.pickHint": "你自己挑一条填",
  "liveModeCard.intro.tail": "——所以不必依赖它认得出这个框。适合逐项核对，也能帮到批量填不了的框。",
  "liveModeCard.status.waiting": "等待你点某个框",
  "liveModeCard.status.off": "未开启",
  "liveModeCard.tag.off": "已关闭",
  "liveModeCard.tag.ai": "AI 建议",
  "liveModeCard.alternatives.tooltipEntry": "{label}：{value}",
  "liveModeCard.alternatives.count": "另有 {count} 个候选（在浏览器窗口里点选）",
  "liveModeCard.remember.tag": "等待选择资料目标",
  "liveModeCard.remember.choose": "选择保存位置",
  "liveModeCard.progress.filled": "本次已填 {count} 个",
  "liveModeCard.progress.keepRunning": "悬浮球仍在浏览器中，可随时重新开启",
  "liveModeCard.ended.browserClosed":
    "浏览器已关闭，本次填写已自动结束。重新打开浏览器后会再次自动开启。",
} as const;

export default liveModeCard;
