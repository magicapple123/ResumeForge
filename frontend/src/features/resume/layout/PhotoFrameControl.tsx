// SPDX-License-Identifier: Apache-2.0
/**
 * 照片「边框与位置」（R-07 / R-10）：一个弹层，五个字段。
 *
 * ## 为什么是弹层而不是五行滑杆
 *
 * 制作台左栏是 380–640px 的可拖窄栏，五条新滑杆会把「照片大小」之后的所有分组推下去
 * 两屏；这五项又都是低频调整。折成一枚按钮 + 弹层，既保留可发现性，也不改变左栏节奏。
 *
 * ## 逻辑只此一份（I-01）
 *
 * 六行参数与"草稿 + 120ms 防抖 + 关闭时 flush + 探针"全在 `PhotoFrameFields.tsx`
 * （字段右键的「照片框…」浮层共用它）；纯函数在 `photoFrame.ts`，本文件只留
 * 「标签 + Popover + 字段」这层壳。
 *
 * ## 默认值 = 模板现值（产品已拍板）
 *
 * 模板 CSS 一直是「1px 实线 + `var(--line)` + 4px 圆角」，而 PDF/Word 从来没画过它。
 * 现在三个出口都按同一组默认值画；只有用户**动过**某一项才写 `format_config`，
 * 因此「没调过」的旧简历 HTML 一个字节都不变。
 */
import { BorderOutlined } from "@ant-design/icons";
import { Button, Popover, Space } from "antd";
import { useRef, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import PhotoFrameFields from "./PhotoFrameFields";
import { photoFrameCustomized } from "./photoFrame";

export {
  COMMIT_DEBOUNCE_MS,
  PHOTO_FRAME_BOUNDS,
  PHOTO_FRAME_KEYS,
  photoFrameCustomized,
  readPhotoFrame,
  withPhotoFrame,
} from "./photoFrame";

interface Props {
  formatConfig?: ResumeFormatConfig | null;
  disabled?: boolean;
  hasPhoto?: boolean;
  onChange: (next: ResumeFormatConfig) => void;
  /** 拖动中的即时反馈：`.profile-photo { … }`。空串 = 清掉探针。 */
  onProbe?: (css: string) => void;
  /**
   * WF-13：并进「照片」格时不渲染标签（标签只出现一次），也不套第二层 Space——
   * 这一模式下按钮是合并格第二行的唯一内容，外层由 `PhotoScaleControl` 的槽位负责。
   */
  inline?: boolean;
}

export default function PhotoFrameControl({
  formatConfig,
  disabled = false,
  hasPhoto,
  onChange,
  onProbe,
  inline = false,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  const flushRef = useRef<(() => void) | null>(null);
  const customized = photoFrameCustomized(formatConfig);
  const noPhoto = hasPhoto === false;

  // I-01：左栏「选中照片 → 去『照片框』」的跳转锚点。`PhotoFrameFields` 在弹层里，
  // 未展开时不可见，所以锚点必须落在这层壳上（否则 scrollIntoView 滚到一个 0 高节点）。
  // WF-13：并进「照片」格后锚点跟着按钮走，仍是同一个可滚动到的壳。
  const trigger = (
    <Popover
      open={open}
      trigger="click"
      placement="leftTop"
      onOpenChange={(next) => {
        // 关闭时先把挂起的那一次写进去，再清探针——否则最后一个 120ms 内的拖动会丢。
        if (next) {
          setOpen(true);
          return;
        }
        flushRef.current?.();
        onProbe?.("");
        setOpen(false);
      }}
      content={
        // T02：面板宽度改成"宿主决定"，这里是**唯一**需要 300 的宿主
        // （popover 的 shrink-to-fit 会按 `1fr` 的最小内容宽度塌成一条）。
        <div style={{ width: 300 }}>
          <PhotoFrameFields
            formatConfig={formatConfig}
            disabled={disabled}
            hasPhoto={hasPhoto}
            onProbe={onProbe}
            flushRef={flushRef}
            onChange={onChange}
          />
        </div>
      }
    >
      <Button
        size="small"
        icon={inline ? <BorderOutlined /> : undefined}
        disabled={disabled || noPhoto || undefined}
        aria-expanded={open}
        // 图标自带 `aria-label`（"border"），会把无障碍名拼成 "border 边框与位置"；
        // 显式写 aria-label 让读屏与测试都拿到同一句文案（与按钮文字同源）。
        aria-label={
          customized
            ? t("resume.photo.frame.openCustom")
            : inline
              ? t("resume.photo.frame.entry")
              : t("resume.photo.frame.open")
        }
      >
        {customized
          ? t("resume.photo.frame.openCustom")
          : inline
            ? t("resume.photo.frame.entry")
            : t("resume.photo.frame.open")}
      </Button>
    </Popover>
  );

  if (inline) {
    return <div data-workbench-photo-card="">{trigger}</div>;
  }

  return (
    <Space size={6} data-workbench-photo-card="">
      <span className="resume-measure-label">{t("resume.photo.frame.label")}</span>
      {trigger}
    </Space>
  );
}
