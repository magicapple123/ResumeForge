// SPDX-License-Identifier: Apache-2.0
/**
 * 发送区的两个内联图标（R06-D）：朝**正上**的实心纸飞机，与生成中的实心圆角方块。
 *
 * 为什么自己做而不旋转 `@ant-design/icons` 的 `SendOutlined`：
 * ① 旋转会让 16–18px 的路径边缘发虚（浏览器按未旋转的栅格化再转）；
 * ② 它的视觉重心不在几何中心，转完会偏出圆形按钮的中心；
 * ③ 折痕方向转过来后是歪的，放大看很别扭。
 *
 * 为什么放在 `composer/` 而不是做全局图标层：项目里只有 `components/ThemeSwitch.tsx`
 * 一处内联 SVG 的先例，没有图标层。为一个按钮开一层框架不划算，也不该由这个改动开先例。
 *
 * `width/height="1em"` + `verticalAlign: -0.125em` 是与 antd 图标对齐的写法（antd 的 Icon
 * 就是这么做的）：按钮字号变，图标跟着变，不会出现"按钮变大、图标没变"。
 */

/** 朝正上的实心纸飞机：圆按钮里指向右上会显得"斜着飞出去"，向上才是"提交"的方向感。 */
export function SendUpIcon() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 18 18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ verticalAlign: "-0.125em" }}
    >
      <path d="M9 2.6 15.4 15.2 9 12.2 2.6 15.2z" />
    </svg>
  );
}

/** 生成中的停止符号：实心圆角方块（比 `StopOutlined` 在圆形按钮里更稳、更小）。 */
export function StopSquareIcon() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ verticalAlign: "-0.125em" }}
    >
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}
