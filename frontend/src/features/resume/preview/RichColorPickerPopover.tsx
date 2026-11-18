// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面右键菜单的**第二层浮层**：点「自定义颜色…」后在指针原处打开的拾色弹层（I-13 收尾）。
 *
 * ## 为什么必须是第二个宿主，而不是把 ColorPicker 塞进菜单
 *
 * 纸面菜单由 `features/context-menu` 的**单例宿主**渲染，它的契约是"点任意项 → 立即关闭"
 * （`ContextMenuSurface` 在 `onClick` 里先回调再 `onClose()`）。antd 的取色面板一旦被
 * 那次 `onClose()` 一起卸载，用户就是"点开一个瞬间消失的面板"。所以流程刻意改成
 * **菜单先关、弹层后开**：两层永不同时出现，单例宿主的契约一个字都不用改。
 *
 * ## 定位与选区
 *
 * 落点沿用菜单的 `placeMenu`（贴指针 + 夹进视口），只是尺寸换成本弹层的估算值——
 * 这样两个浮层在同一个坐标上"接力"，不会出现"菜单在这儿、面板跳到屏幕另一头"。
 * 选区不是本组件的责任：它在 iframe 里，由调用方（`useClickToEditPreview`）用
 * `restoreRichSelection` 保住；本组件只负责"选颜色"。
 *
 * ## 取消 = 一个字节都不改
 *
 * 「取消」/ Esc / 点外部都只调 `onCancel`，不改内容、不写宿主；只有「应用」才把
 * `#rrggbb` 交出去。面板内部状态（拖动色轮期间的中间值）死在组件里。
 */
import { Button, ColorPicker } from "antd";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { placeMenu } from "../../context-menu/positioning";
import { layer } from "../../../theme/tokens";
import { COLOR_PRESETS } from "../layout/inlineMarks";
import "../../../styles/rich-color-popover.css";

/**
 * 弹层的估算尺寸（贴边夹取用）。
 *
 * jsdom 量不到真实像素，所以这里与 `ContextMenuSurface.estimateSize` 同一口径：
 * 先给一个与实际面板同量级的常数，真机由 antd 的 `autoAdjustOverflow` 兜住。
 * 导出是为了让结构守卫能直接断言"落点来自 `placeMenu`，不是另一套算法"。
 */
export const RICH_COLOR_PICKER_SIZE = { width: 248, height: 320 } as const;

export interface RichColorPickerProps {
  /** 右键时的指针位置（父页面视口坐标）——与菜单同一坐标。 */
  x: number;
  y: number;
  /** 选区当前颜色（runs 里那一档）；`null` = 未设色 / 跨多种颜色。决定面板初值。 */
  initial: string | null;
  /** 应用选中颜色（`#rrggbb`）；面板内部已 normalize。 */
  onApply: (hex: string) => void;
  /** 取消：不改内容、不写宿主。 */
  onCancel: () => void;
}

/** 面板初值：与中栏工具条同一取舍（未设色时取正文黑，而不是"恒显红"）。 */
const FALLBACK_HEX = "#111111";

export default function RichColorPickerPopover({
  x,
  y,
  initial,
  onApply,
  onCancel,
}: RichColorPickerProps) {
  useLocale();
  const [hex, setHex] = useState(() => initial ?? FALLBACK_HEX);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 落点与菜单同一套算法：区别只有尺寸（弹层比菜单宽、比菜单矮）。
  const placement = placeMenu({ x, y }, RICH_COLOR_PICKER_SIZE);

  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      // 取色面板由 `getPopupContainer` 挂在 `rootRef` 里，所以"点面板"不会被误判成点外部。
      if (rootRef.current?.contains(node)) return;
      onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    // 用 mousedown 而不是 pointerdown：与菜单宿主同一取舍（jsdom / 老 Safari 的指针事件
    // 不冒泡到 document 时，"点外不关"比"少关一次"更难解释）。
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return createPortal(
    <div
      ref={rootRef}
      className="rf-rich-color-popover"
      role="dialog"
      aria-label={t("typography.inline.color")}
      // 锚点坐标留成可断言的结构：jsdom 量不了像素，但"弹层接在菜单同一坐标上"必须能验。
      data-rf-anchor-x={x}
      data-rf-anchor-y={y}
      // 面板当前色（应用时交出去的就是它）：面板内部是受控 state，外部只好从这一处读。
      data-rf-color={hex}
      style={{ left: placement.left, top: placement.top, zIndex: layer.aiPolish }}
    >
      <ColorPicker
        // 受控恒开：本组件的存在就是"面板正开着"，关闭由外层卸载完成
        // （antd 内部"点外部→关"的路径不参与，否则会与下面的 dismiss 抢同一拍）。
        open
        value={hex}
        disabledAlpha
        placement="bottomLeft"
        presets={[{ label: t("typography.inline.colorPresets"), colors: [...COLOR_PRESETS] }]}
        // 面板跟着锚点走：portal 到本组件内部，点面板才不会命中上面的"点外部"判断。
        getPopupContainer={() => rootRef.current ?? document.body}
        onChange={(color) => setHex(color.toHexString().toLowerCase())}
        panelRender={(panel) => (
          <div className="rf-rich-color-panel">
            {panel}
            <div className="rf-rich-color-actions">
              {/* antd 会给两个汉字的按钮插一个空格（"取 消"），无障碍名随之变形；
                  显式 `aria-label` 让屏幕阅读器与测试拿到的都是那句原文。 */}
              <Button size="small" aria-label={t("rich.menu.colorCancel")} onClick={onCancel}>
                {t("rich.menu.colorCancel")}
              </Button>
              <Button
                size="small"
                type="primary"
                aria-label={t("rich.menu.colorApply")}
                onClick={() => onApply(hex)}
              >
                {t("rich.menu.colorApply")}
              </Button>
            </div>
          </div>
        )}
      >
        {/* 触发器只是一枚落在指针上的锚点：面板本身才是用户看见的东西。
            `aria-hidden` 是因为它没有可读文案，键盘用户走 Esc / 取消按钮。 */}
        <span className="rf-rich-color-anchor" aria-hidden="true" />
      </ColorPicker>
    </div>,
    document.body,
  );
}
