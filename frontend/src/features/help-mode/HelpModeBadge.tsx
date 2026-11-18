// SPDX-License-Identifier: Apache-2.0
/**
 * 提示模式的常驻徽标（I-18 ④）：右下角一行「提示模式 · Esc 退出」+ 一个退出按钮。
 *
 * 为什么必须有这个东西：提示模式会把页面上所有说明原地展开，版面立刻变样。没有徽标
 * 的话，用户看到的是"页面突然变长了"而不是"我打开了一个模式"，也不知道怎么退回去。
 *
 * 三条实现约束：
 * 1. `role="status"` + `aria-live="polite"`：读屏用户按了 `Alt+H` 之后要能听到"已经进
 *    入提示模式"，否则对他们来说这个快捷键等于没反应（焦点可能还在原处）；
 * 2. **换页即退出**：模式是"看当前这一页"的，跨页保留会让人在新页面上看到一堆展开的
 *    说明却不知道为什么（本地没有记忆点）；
 * 3. 只挂一个 fixed 的小胶囊，不占流、不进 Layout——它随时可能出现又消失，进流就会顶
 *    得页面跳一下。
 */
import { Button } from "antd";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import { exitHelpMode, useHelpMode, useHintCount } from "./helpModeStore";

export default function HelpModeBadge() {
  useLocale();
  const active = useHelpMode();
  // I-28：本页可展开的条数。`HintDetail` 平时就挂载并登记，所以这个数在进入模式之前
  // 就已成立；0 条时也要说清楚"没有"，否则用户按了 Alt+H 会以为快捷键坏了。
  const hintCount = useHintCount();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    if (pathnameRef.current === location.pathname) return;
    pathnameRef.current = location.pathname;
    exitHelpMode();
  }, [location.pathname]);

  if (!active) return null;

  return (
    <div
      data-help-mode-badge="active"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        // 右下角，但让开悬浮球（球贴右边缘、直径 64px）：压在球上会吃掉点击。
        right: 84,
        bottom: 20,
        zIndex: layer.orbTooltip,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px 6px 12px",
        borderRadius: 999,
        border: "1px solid var(--rf-border-strong)",
        background: "var(--rf-surface)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.14)",
        fontSize: 12,
        lineHeight: 1.4,
        color: "var(--rf-text)",
      }}
    >
      <span>{t("helpMode.badge")}</span>
      <span className="help-mode-badge-count">
        {hintCount > 0 ? t("helpMode.badgeCount", { count: hintCount }) : t("helpMode.badgeEmpty")}
      </span>
      <Button size="small" type="text" onClick={exitHelpMode} aria-label={t("helpMode.exit")}>
        {t("helpMode.exit")}
      </Button>
    </div>
  );
}
