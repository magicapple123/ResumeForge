// SPDX-License-Identifier: Apache-2.0
/**
 * 「事件行」：通知中心与启动提醒弹窗共用的一行（整改 #13）。
 *
 * ## 为什么抽一个组件
 *
 * 这两处此前各长各的：弹窗把「紧急度 Tag + 标题 + 时间 + 三个按钮」塞进一个 `Space`
 * 里，被挤成三段（日期掉第二行最左、按钮掉第三行）；通知行只有标题 + 一段灰字，
 * 六条「提醒已过期」长得完全一样、也看不出能点。同一种信息在两个地方用两种排法，
 * 用户每次都要重新学一遍——所以只留这一份结构。
 *
 * ## 行结构（2026-11-26 用户第二次拍板后的**纯文字**版）
 *
 * ```
 * [未读点] 标题                                   ›
 * 副行（相对时间 · 说明）   [逾期 N 天]      [动作…]
 * ```
 *
 * 箭头 `›` 在**标题行**里，不在行尾当兄弟（T25 / R24）：原先它是 `.rf-event-main`
 * 之外的第二个 flex 子项，动作组因此被它挤掉 `箭头宽 + gap` 的宽度——弹窗里
 * 「动作右缘」比「箭头右缘」内缩 13px，分隔线又是第三个坐标。挪进标题行后，
 * 主内容占满整行，动作组与箭头共用同一条右缘（弹窗实测三条右缘完全重合）。
 *
 * 拍板时明确去掉的两样东西，**不要加回来**：
 *
 * 1. **左缘色条**（`::before` / `border-left` / inset 阴影）：用户原话「我不想要这个条，
 *    看着 AI 味太重了」。分隔已经由 `border-bottom` 承担，状态由字重与文字承担。
 *    `event-row.css` 里因此一条左边线都没有，有守卫盯着（`EventRow.test.tsx`）。
 * 2. **图标槽**：类型靠标题文字区分（「任务已完成」/「提醒已过期：…」），行里不再有图标。
 *
 * ## 两个刻意的 props 设计
 *
 * - **没有 `tone` / `icon`**：只收 `unread` 与 `overdueDays`。这是从类型上堵住"按状态
 *   上色"——组件里不可能再长出第二个配色分支（颜色只用在未读点与逾期红字上）。
 * - **容器不是 `<button>`**：弹窗行里有三个真按钮，`<button>` 里套 `<button>` 是非法
 *   HTML（浏览器会把内层拆出去，事件全乱）。用 `div` 容器 + **标题上的一个真 button** 承担
 *   打开动作：鼠标点整行仍然有效（外层 onClick），键盘 Tab 到标题按钮按 Enter/Space 打开。
 *   早先容器是 `div role="button" tabIndex=0`，axe 的 `nested-interactive` 判 serious——
 *   交互角色里不能再放交互元素；现在角色只落在标题按钮上，行内动作是它的兄弟节点。
 *
 * 行内动作自己 `stopPropagation`（见调用方）：那一层是"点完成不该跳走"的唯一保障，
 * 组件不替他兜（兜了反而会掩盖漏写的 `stopPropagation`）。
 */
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import "./event-row.css";

export interface EventRowProps {
  /** 单行省略的标题。未读时字重 600 + 前置 6px 品牌色圆点。 */
  title: string;
  /** 副行左侧内容：通常是相对时间与一句说明（`今天 14:12 · 已自动跳过`）。 */
  meta?: ReactNode;
  /** 副行右端的动作槽（仅弹窗用）。调用方负责 `stopPropagation`。 */
  actions?: ReactNode;
  /** 未读：字重 600 + 圆点。**已读不靠颜色区分**，靠字重。 */
  unread?: boolean;
  /** 逾期天数；> 0 才在副行渲染红字，0 / 负数 / 缺省都不渲染。 */
  overdueDays?: number;
  /** 整行点击/回车。缺省时这一行不带"可点"承诺（不渲染箭头）。 */
  onOpen?: () => void;
}

export default function EventRow({
  title,
  meta,
  actions,
  unread = false,
  overdueDays,
  onOpen,
}: EventRowProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则副行文案停在旧语言。
  useLocale();
  const overdue = typeof overdueDays === "number" && overdueDays > 0;
  const hasSubLine = Boolean(meta) || overdue || Boolean(actions);
  const className = ["rf-event-row", unread ? "is-unread" : "", onOpen ? "is-clickable" : ""]
    .filter(Boolean)
    .join(" ");

  const titleNode = (
    <>
      {unread && <span className="rf-event-dot" aria-hidden="true" />}
      <span className="rf-event-title-text">{title}</span>
      {/* 箭头在标题行内（T25）：行的右端只留这一条右缘，副行动作组因此能贴到同一条线。 */}
      {onOpen && (
        <span className="rf-event-arrow" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );

  return (
    <div className={className} onClick={onOpen}>
      <div className="rf-event-main">
        {onOpen ? (
          // 可点行：打开动作落在标题按钮上；行内的「更多操作 / 完成」是它的兄弟，
          // 不再嵌在交互角色里（axe nested-interactive）。按钮原生支持 Enter / Space。
          <button type="button" className="rf-event-open">
            <span className="rf-event-title">{titleNode}</span>
          </button>
        ) : (
          <span className="rf-event-title">{titleNode}</span>
        )}
        {hasSubLine && (
          <span className="rf-event-subline">
            {meta && <span className="rf-event-meta">{meta}</span>}
            {overdue && (
              <span className="rf-event-overdue">
                {t("trackerUi.card.overdueDays", { days: overdueDays })}
              </span>
            )}
            {actions && <span className="rf-event-actions">{actions}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
