// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球的球体按钮：Tooltip、7 层过渡 span 与当前表情素材。
 *
 * ## I-17：悬停只留一行，长文案只说一次
 *
 * 之前的 tooltip 是四条动作拼成的一句 55 字长句——悬停才看得见、移开就消失，鼠标用户
 * 读不完，触屏/键盘用户根本读不到。现在拆成两级：
 *
 * - **悬停**：一行 `touTou.orb.tooltip`（"单击… · 长按看更多 · 划词 {shortcut}"）；
 * - **首次进入**：一个只出现一次的 `Popover`（`touTou.orb.help` 四条动作 + 「知道了」），
 *   出现即写 `resumeforge.orb.hint_seen`，刷新不再出现；
 * - **随时可查**：同一段 `touTou.orb.help` 也挂在动作面板的「球的用法」里——长按球就能读，
 *   不依赖任何"刚才一闪而过的那句提示"。
 *
 * 首次说明用 `Popover` 而不是更长的 Tooltip：它要常驻到用户读完（Tooltip 会随鼠标移开
 * 消失），并且带一个可聚焦的关闭按钮——与 `components/common/HintDetail.tsx` 同一套取舍
 * （长文本进 Popover，短提示才留在 Tooltip）。
 */
import { Button, Popover, Tooltip } from "antd";
import { useEffect, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import { formatShortcut } from "../shortcuts/matchShortcut";
import { useShortcutSettings } from "../shortcuts/useShortcutKeymap";
import { TOU_TOU_FACE_SOURCES, type TouTouFaceKey } from "./touTouFaces";

/** 「首次说明已看过」的本地标记（照抄 BROWSER_HINT_SEEN_KEY 的写法）。 */
export const ORB_HINT_SEEN_KEY = "resumeforge.orb.hint_seen";
/** 首次说明的自动收起时间：够读完四条，又不至于一直挂在球旁边。 */
const ORB_HINT_AUTO_HIDE_MS = 8000;

function hasSeenOrbHint(): boolean {
  try {
    return localStorage.getItem(ORB_HINT_SEEN_KEY) === "1";
  } catch {
    // 存储不可用（隐私模式 / 禁用 localStorage）时按"已看过"处理：宁可不提示，
    // 也不要每次进页面都弹一次读不完的说明。
    return true;
  }
}

function markOrbHintSeen(): void {
  try {
    localStorage.setItem(ORB_HINT_SEEN_KEY, "1");
  } catch {
    /* 可选偏好：写不进去就退化成"这次会话内只提示一次"。 */
  }
}

interface Props {
  buttonRef: RefObject<HTMLButtonElement | null>;
  buttonClasses: string;
  activeFace: TouTouFaceKey;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  /** 长按判定用：松手/移出/取消都要撤掉 400ms 计时器，否则会"按着拖一半弹面板"。 */
  onPointerMove?: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onPointerCancel?: () => void;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onMouseEnter: () => void;
  onMouseMove: () => void;
}

export function TouTouOrbButton({
  buttonRef,
  buttonClasses,
  activeFace,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onClick,
  onKeyDown,
  onFocus,
  onMouseEnter,
  onMouseMove,
}: Props) {
  useLocale();
  const shortcuts = useShortcutSettings();
  const shortcut = (shortcuts.bindings.selectionPanel ?? [])
    .map((key) => formatShortcut(key))
    .join(" / ");
  /** 首次进入的那一次完整说明：初值读标记，之后只由用户关闭或超时收起。 */
  const [firstRunOpen, setFirstRunOpen] = useState(() => !hasSeenOrbHint());

  useEffect(() => {
    if (!firstRunOpen) return;
    // 一出现就记标记：用户刷新页面时看到的是"已经看过"的状态，不是又弹一遍。
    markOrbHintSeen();
    const timer = window.setTimeout(() => setFirstRunOpen(false), ORB_HINT_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [firstRunOpen]);

  return (
    <Popover
      open={firstRunOpen}
      // 说明自己带关闭按钮；点旁边（球本身也算旁边）也收起，免得拦住单击。
      onOpenChange={(next) => {
        if (!next) setFirstRunOpen(false);
      }}
      // `trigger={[]}`：它不由 hover/click 触发，只由上面的 `open` 控制。
      trigger={[]}
      placement="top"
      content={
        <div style={{ maxWidth: 260, fontSize: 12, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{t("touTou.orb.helpTitle")}</p>
          <p style={{ margin: "0 0 8px" }}>{t("touTou.orb.help", { shortcut })}</p>
          <Button size="small" type="primary" onClick={() => setFirstRunOpen(false)}>
            {t("touTou.orb.helpClose")}
          </Button>
        </div>
      }
      styles={{ root: { zIndex: layer.orbTooltip } }}
    >
      <Tooltip
        title={t("touTou.orb.tooltip", { shortcut })}
        placement="top"
        /*
         * 球（.tt-shell）已提到 3650，antd Tooltip 默认的 1070 会被盖住；
         * 抬到与 .tt-tip 同一地标 3700（见 tou-tou.css）。默认的 hover 事件
         * 不影响 280ms 的单击/双击判定。
         */
        styles={{ root: { zIndex: layer.orbTooltip } }}
      >
        <button
          ref={buttonRef}
          type="button"
          className={buttonClasses}
          aria-label={t("touTou.orb.ariaLabel")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onMouseEnter={onMouseEnter}
          onMouseMove={onMouseMove}
        >
          <span className="tt-hide">
            <span className="tt-scale">
              <span className="tt-float">
                <span className="tt-breathe">
                  {/* T10：光晕是 .tt-breathe 的**同级子元素**，跟着球体一起位移/缩放。
                      放在 .tt-turn 之前：表情换图时不会把环一起换掉。 */}
                  <span className="tt-glow" aria-hidden="true" />
                  <span className="tt-turn">
                    {/* 只渲染当前表情这一张：6 张常驻 img 全量进首屏（约 1.4MB）太贵，
                        换 src 即换脸，无需淡入淡出。 */}
                    <img
                      className="tt-face is-active"
                      src={TOU_TOU_FACE_SOURCES[activeFace]}
                      alt=""
                    />
                  </span>
                </span>
              </span>
            </span>
          </span>
        </button>
      </Tooltip>
    </Popover>
  );
}
