// SPDX-License-Identifier: Apache-2.0
/**
 * 侧栏、移动端导航抽屉、「我的空间」菜单与「界面与导航」设置卡：导航入口名、页面标题、
 * 品牌文案与外壳上的无障碍说明。
 *
 * 入口名以 `labelKey` 的形式放在 `components/navigation/navigationConfig.ts`，渲染处再
 * `t()`；模块作用域不求值 `t()`，切语言时由消费组件订阅后重新渲染。
 */
const navigation = {
  // ── 导航入口名（NAVIGATION_ITEMS 的 labelKey）──────────────
  "navigation.item.home": "首页",
  "navigation.item.jobs": "岗位广场",
  "navigation.item.resumes": "简历中心",
  "navigation.item.apply": "投递台",
  "navigation.item.webform": "网申填表",
  "navigation.item.tracker": "求职进度",
  "navigation.item.interview": "模拟面试",
  "navigation.item.assistant": "求职助手",
  "navigation.item.settings": "设置",
  "navigation.item.profile": "我的资料",
  "navigation.item.favorites": "收藏夹",
  "navigation.item.materials": "资料箱",
  "navigation.item.knowledge": "知识库",
  "navigation.item.skills": "工作台",
  "navigation.item.analytics": "求职统计",
  "navigation.item.claims": "事实台账",
  "navigation.item.trash": "回收站",

  /** 「事实核对」不在侧栏里，但路由标题要用它（/claims/drill）。 */
  "navigation.page.claimsDrill": "事实核对",

  /** 「我的空间」菜单的触发按钮文字，同时用作它的无障碍名。 */
  "navigation.mySpace.label": "我的空间",
  /** 侧栏与移动端抽屉里的使用指南入口。 */
  "navigation.guide.open": "使用指南",

  /** 移动端导航抽屉的标题与主导航区域的无障碍名。 */
  "navigation.mobile.title": "功能导航",
  "navigation.mobile.aria": "移动端主导航",

  /** 跳过导航链接：键盘用户可以直接落到主内容。 */
  "navigation.a11y.skipToMain": "跳到主要内容",

  /** 侧栏品牌区与页头。 */
  "navigation.shell.title": "AI 定制化简历生成平台",
  "navigation.shell.brandCaption": "AI 简历工作台",
  "navigation.shell.versionTooltip": "当前版本",
  "navigation.shell.scrollTop": "回到当前页面顶部",
  "navigation.shell.collapse": "收起侧栏",
  "navigation.shell.expand": "展开侧栏",
  "navigation.shell.openMenu": "打开导航",

  /** 设置页「界面与导航」卡。 */
  "navigation.settings.title": "界面与导航",
  "navigation.settings.restore": "恢复默认显示",
  "navigation.settings.intro":
    "隐藏只会移除导航入口，不会删除数据，也不会禁止直接访问对应页面。首页、岗位广场、简历中心、我的资料、投递台和设置始终保留。",
  "navigation.settings.group.primary": "核心入口",
  "navigation.settings.group.space": "我的空间",
  "navigation.settings.fixed": "固定显示",
  "navigation.settings.switchAria": "{name}导航入口",
  "navigation.settings.saved": "导航显示设置已保存",
  "navigation.settings.saveFailed": "保存导航显示设置失败",
} as const;

export default navigation;
