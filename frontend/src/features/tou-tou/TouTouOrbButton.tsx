// SPDX-License-Identifier: Apache-2.0
/** 投投悬浮球的球体按钮：Tooltip、7 层过渡 span 与当前表情素材。 */

import { Tooltip } from "antd";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import { formatShortcut } from "../shortcuts/matchShortcut";
import { useShortcutSettings } from "../shortcuts/useShortcutKeymap";
import { TOU_TOU_FACE_SOURCES, type TouTouFaceKey } from "./touTouFaces";

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
  return (
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
  );
}
