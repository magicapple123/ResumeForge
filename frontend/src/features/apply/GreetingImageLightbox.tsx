// SPDX-License-Identifier: Apache-2.0
/**
 * 配图灯箱（R21）：点缩略图看大图，Esc 关闭，关闭后焦点回到触发它的缩略图。
 *
 * ## 为什么不用 antd `Image` 的 preview
 *
 * `Image.PreviewGroup` 自带一套工具栏与缩放交互，但"关闭后焦点回到哪"由它内部决定，
 * 而这条正好是键盘用户的硬要求（Esc 关掉之后焦点掉到 `body`，Tab 会从页面开头重走）。
 * 自己实现只有两个交互：Esc 关、按钮关，焦点归还由这里显式负责，行为可断言。
 *
 * ## 为什么挂在 `document` 上听 Esc 而不是 DOM 层级冒泡
 *
 * 灯箱是从队列编辑弹窗里打开的：焦点可能在弹窗内容、也可能在 body（毕竟遮罩是兄弟节点）。
 * 只挂在自己那层 div 上，按 Esc 时若焦点在别处就收不到。`document` 上的监听 + 打开时
 * `dialogRef.focus()` 两条一起，才保证"不管焦点在哪，Esc 都关"。
 *
 * ## 为什么要 portal 到 body
 *
 * 灯箱在 antd Modal 里打开；Modal 内容容器在动画期间带 `transform`，`position: fixed` 的
 * 子节点会退化成"相对那个容器定位"，遮罩就盖不满屏。挂到 body 上再给一个高于 Modal 的
 * 层级，位置和层级都不依赖父级的实现细节。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { userFileRawUrl } from "../../api/userFiles";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyGreetingImageOption } from "../../types";
import { formatBytes } from "../../utils/format";

/** 灯箱只需要展示用的三个字段，不依赖完整选项（选项可能还没加载回来）。 */
export type GreetingImagePreviewTarget = Pick<
  ApplyGreetingImageOption,
  "id" | "name" | "size_bytes"
>;

export interface GreetingImageLightboxProps {
  /** `null` = 关闭。 */
  image: GreetingImagePreviewTarget | null;
  onClose: () => void;
}

export default function GreetingImageLightbox({ image, onClose }: GreetingImageLightboxProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则灯箱里那句「Esc 关闭」停在旧语言。
  useLocale();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // 打开前是谁持有焦点 —— 关闭时还给它。
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const open = image !== null;

  // Esc 回调始终用最新的一份（父组件每次渲染都会新建闭包）。
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const active = document.activeElement;
    previousFocus.current = active instanceof HTMLElement ? active : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 弹窗（队列编辑）自己也可能监听 Esc：灯箱在最上层，先关灯箱、不连带关掉下面那层。
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // 焦点归还：键盘用户按 Esc 之后应当还在刚才那张缩略图上。
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [open]);

  if (!image) return null;

  return createPortal(
    <div className="rf-greeting-lightbox">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("applyQueue.image.previewAria", { name: image.name })}
        className="rf-greeting-lightbox-inner"
        tabIndex={-1}
      >
        <img
          className="rf-greeting-lightbox-img"
          src={userFileRawUrl(image.id)}
          alt={image.name}
        />
        <div className="rf-greeting-lightbox-caption">
          <span className="rf-greeting-lightbox-name">{image.name}</span>
          <span className="rf-greeting-lightbox-size">{formatBytes(image.size_bytes)}</span>
          <span className="rf-greeting-lightbox-hint">
            {t("applyQueue.image.lightboxHint")}
          </span>
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={onClose}
            aria-label={t("applyQueue.image.lightboxClose")}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
