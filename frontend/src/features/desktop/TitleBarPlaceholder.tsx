// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳的**纯占位**标题栏（P1-1 第二层兜底）。
 *
 * 存在的唯一理由：旧壳只注入了 `window.splash`，没有 2.1 才加的自绘标题栏桥
 * (`window.desktopShell`)。按桥分流时那种壳会整条标题栏都不渲染，父级的
 * `html:has(.app-titlebar)` 因此不命中——32px 没人占位，系统绘制的三颗窗口按钮
 * 直接浮在页面内容上方，点击被吞（误点 = 最小化/关闭）。
 *
 * 所以这里只做一件事：**把 32px 占住**。没有菜单、没有按钮、不订阅任何事件、
 * 不碰主进程；整条可拖（`-webkit-app-region: drag` 由 `.app-titlebar-drag` 提供），
 * 与真实标题栏的拖拽手感一致——拖拽不算"可交互控件"，不会吞掉任何点击。
 *
 * 刻意不写任何文案：没有文字就没有 i18n key，也不会让 cjkRatchet 上涨。
 */
export default function TitleBarPlaceholder() {
  return (
    <div
      className="app-titlebar app-titlebar--placeholder"
      data-testid="desktop-titlebar-placeholder"
      aria-hidden="true"
    >
      <div className="app-titlebar-drag" />
    </div>
  );
}
