// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪弹窗（D09）：非破坏裁剪的参数 UI。
 *
 * ## 非破坏的三条可见证据
 *
 * 1. 预览用「整图 + 位置偏移」裁出来的**窗口**（不是重新编码的图片），所以拖动滑杆时
 *    原图一个像素都不变；
 * 2. 原图尺寸与"原始照片不会被覆盖"写在弹窗里，恢复原图 = 删掉参数；
 * 3. 移除照片是独立动作（由宿主的内容保存链路执行），空位由后端模板不预留照片空间
 *    自然收回——不在前端伪造一个"空位"。
 *
 * ## 比例 / 取景 / 清晰度
 *
 * 比例锁定用固定档位（原图、1:1、3:4、4:3）；取景大小与位置是归一化草稿，提交时才
 * 换算成 `photo_crop` 参数。清晰度按纸面实际宽度折算打印 dpi，低于门槛给**提示**
 * 但允许保存（参数是用户的决定，界面只负责说清后果）。
 */
import { App, Alert, Button, Modal, Popconfirm, Segmented, Slider, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { t } from "../../../i18n";
import {
  computeCropRect,
  createPhotoCropParams,
  DEFAULT_CROP_DRAFT,
  draftFromParams,
  buildPhotoSource,
  PHOTO_CROP_ASPECTS,
  type PhotoAspect,
  type PhotoCropDraft,
  type PhotoCropParams,
  type PhotoSourceInfo,
} from "../../../features/resume-proview/photoCrop";
import {
  DEFAULT_PRINTED_WIDTH_MM,
  estimatePrintClarity,
  printedWidthMm,
} from "../../../features/resume-proview/photoClarity";
import { usePhotoDimensions } from "../../../features/resume-proview/usePhotoDimensions";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 原图 data URL（`content.photo`）；空串 = 没有照片（调用方不打开弹窗）。 */
  photo: string;
  /** 已保存的裁剪参数（首次打开时还原滑杆位置）。 */
  initialCrop?: PhotoCropParams | null;
  /** 照片在纸面上的宽度（mm），从预览 iframe 实测；量不到时用兜底值。 */
  printedWidthMm?: number;
  /** 预览视口：用于量"照片在纸面上实际多宽"（只读 DOM，且在 effect 里读 ref）。 */
  viewportRef?: RefObject<HTMLElement | null>;
  /** 应用裁剪（`null` = 恢复原图）。 */
  onApply: (params: PhotoCropParams | null) => void;
  /** 移除照片（走宿主的内容保存链路）；不传 = 不提供该动作。 */
  onRemove?: () => void;
}

/** 目标比例（宽/高）：用于预览框的 `aspect-ratio`。 */
function previewAspect(draft: PhotoCropDraft, source: PhotoSourceInfo | null): number | undefined {
  if (!source) return undefined;
  const rect = computeCropRect(source, draft);
  const pixelWidth = rect.w * source.width;
  const pixelHeight = rect.h * source.height;
  if (pixelWidth <= 0 || pixelHeight <= 0) return undefined;
  return pixelWidth / pixelHeight;
}

/** 浏览器是否支持 `object-view-box`（Chromium 104+ / Electron 新版支持）。 */
function supportsObjectViewBox(): boolean {
  try {
    const api = (
      globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }
    ).CSS;
    return Boolean(api?.supports?.("object-view-box", "inset(0)"));
  } catch {
    return false;
  }
}

export default function PhotoCropModal({
  open,
  onClose,
  photo,
  initialCrop = null,
  printedWidthMm: printedWidthMmValue,
  viewportRef,
  onApply,
  onRemove,
}: Props) {
  const { message } = App.useApp();
  const dimensions = usePhotoDimensions(open ? photo : null);
  // 纸面宽度从这个 iframe 实测：裁剪参数是相对原图的，清晰度提示却取决于"纸上多大"。
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const source: PhotoSourceInfo | null = dimensions
    ? buildPhotoSource(photo, dimensions.width, dimensions.height)
    : (initialCrop?.source ?? null);
  const [draft, setDraft] = useState<PhotoCropDraft>(() =>
    initialCrop ? draftFromParams(initialCrop) : DEFAULT_CROP_DRAFT,
  );

  // 打开时按"已保存参数"还原；没有已保存参数就从全幅开始。`open` 变化才重置，
  // 用户拖动过程中父组件重渲染不会把滑块拽回去。
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setDraft(initialCrop ? draftFromParams(initialCrop) : DEFAULT_CROP_DRAFT);
  }

  useEffect(() => {
    if (!open || !viewportRef) {
      setMeasuredWidth(undefined);
      return;
    }
    const frame = viewportRef.current?.querySelector("iframe");
    const image = frame?.contentDocument?.querySelector(".profile-photo");
    const rect = image?.getBoundingClientRect();
    setMeasuredWidth(rect && rect.width > 0 ? printedWidthMm(rect.width) : undefined);
  }, [open, viewportRef]);

  const params = source ? createPhotoCropParams(source, draft) : null;
  const clarity = params
    ? estimatePrintClarity(params, measuredWidth ?? printedWidthMmValue ?? DEFAULT_PRINTED_WIDTH_MM)
    : null;
  const aspectRatio = previewAspect(draft, source);
  const rect = source ? computeCropRect(source, draft) : null;
  const objectViewBoxSupported = supportsObjectViewBox();
  const cropRatio =
    params && params.rect.h > 0 && params.rect.w > 0
      ? (params.rect.w * params.source.width) / (params.rect.h * params.source.height)
      : 3 / 4;

  const ASPECT_LABEL_KEY: Record<
    PhotoAspect,
    | "proview.photo.aspect.original"
    | "proview.photo.aspect.square"
    | "proview.photo.aspect.portrait"
    | "proview.photo.aspect.landscape"
  > = {
    free: "proview.photo.aspect.original",
    "1:1": "proview.photo.aspect.square",
    "3:4": "proview.photo.aspect.portrait",
    "4:5": "proview.photo.aspect.landscape",
  };
  const aspectOptions = PHOTO_CROP_ASPECTS.map((value) => ({
    value,
    label: t(ASPECT_LABEL_KEY[value]),
  }));

  const apply = () => {
    if (!params) {
      message.warning(t("proview.photo.unsupported"));
      return;
    }
    onApply(params);
    message.success(t("proview.photo.saved"));
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("proview.photo.title")}
      onCancel={onClose}
      width={620}
      footer={[
        <Button
          key="reset"
          onClick={() => {
            onApply(null);
            message.success(t("proview.photo.cleared"));
            onClose();
          }}
          disabled={!initialCrop}
        >
          {t("proview.photo.reset")}
        </Button>,
        onRemove ? (
          <Popconfirm
            key="remove"
            title={t("proview.photo.removeTitle")}
            description={t("proview.photo.removeBody")}
            okText={t("proview.photo.removeConfirm")}
            cancelText={t("common.action.keep-editing")}
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              onRemove();
              message.success(t("proview.photo.removed"));
              onClose();
            }}
          >
            <Button danger>{t("proview.photo.remove")}</Button>
          </Popconfirm>
        ) : null,
        <Button key="apply" type="primary" onClick={apply} disabled={!params}>
          {t("proview.photo.apply")}
        </Button>,
      ]}
    >
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
        {t("proview.photo.hint")}
      </Typography.Text>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "0 1 220px", minWidth: 160 }}>
          <div
            role="img"
            aria-label={t("proview.photo.previewAlt")}
            style={{
              position: "relative",
              overflow: "hidden",
              width: "100%",
              aspectRatio: aspectRatio ? String(aspectRatio) : "3 / 4",
              background: "var(--rf-surface-alt)",
              borderRadius: 6,
            }}
          >
            {photo && rect ? (
              <img
                src={photo}
                alt={t("proview.photo.previewLabel")}
                style={{
                  position: "absolute",
                  width: `${100 / rect.w}%`,
                  height: `${100 / rect.h}%`,
                  left: `${(-rect.x / rect.w) * 100}%`,
                  top: `${(-rect.y / rect.h) * 100}%`,
                  maxWidth: "none",
                  userSelect: "none",
                }}
              />
            ) : null}
          </div>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 6, fontSize: 12 }}
          >
            {source
              ? t("proview.photo.source", { width: source.width, height: source.height })
              : t("proview.photo.noPhoto")}
          </Typography.Text>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div>
              <Typography.Text style={{ fontSize: 12 }}>
                {t("proview.photo.aspect")}
              </Typography.Text>
              <Segmented
                size="small"
                aria-label={t("proview.photo.aspect")}
                value={draft.aspect}
                options={aspectOptions}
                onChange={(next) =>
                  setDraft((current) => ({ ...current, aspect: next as PhotoAspect }))
                }
                style={{ display: "flex", marginTop: 4 }}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("proview.photo.lockedHint")}
              </Typography.Text>
            </div>
            <div>
              <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.zoom")}</Typography.Text>
              <Slider
                min={35}
                max={100}
                step={1}
                value={Math.round(draft.zoom * 100)}
                ariaLabelForHandle={t("proview.photo.zoomAria")}
                onChange={(value) => setDraft((current) => ({ ...current, zoom: value / 100 }))}
              />
            </div>
            <div>
              <Typography.Text style={{ fontSize: 12 }}>
                {t("proview.photo.offsetX")}
              </Typography.Text>
              <Slider
                min={-100}
                max={100}
                value={Math.round(draft.offsetX * 100)}
                ariaLabelForHandle={t("proview.photo.offsetXAria")}
                onChange={(value) => setDraft((current) => ({ ...current, offsetX: value / 100 }))}
              />
            </div>
            <div>
              <Typography.Text style={{ fontSize: 12 }}>
                {t("proview.photo.offsetY")}
              </Typography.Text>
              <Slider
                min={-100}
                max={100}
                value={Math.round(draft.offsetY * 100)}
                ariaLabelForHandle={t("proview.photo.offsetYAria")}
                onChange={(value) => setDraft((current) => ({ ...current, offsetY: value / 100 }))}
              />
            </div>
          </Space>
        </div>
      </div>
      {clarity ? (
        <Alert
          style={{ marginTop: 14 }}
          type={clarity.level === "ok" ? "success" : "warning"}
          showIcon
          title={
            clarity.level === "ok"
              ? t("proview.photo.clarity.ok", {
                  width: clarity.pixelWidth,
                  height: clarity.pixelHeight,
                })
              : t("proview.photo.clarity.warn", {
                  width: clarity.pixelWidth,
                  height: clarity.pixelHeight,
                })
          }
          description={t("proview.photo.clarity.tip", {
            mm: clarity.printedWidthMm,
            width: Math.ceil((clarity.printedWidthMm / 25.4) * 300),
            height: Math.ceil(((clarity.printedWidthMm / 25.4) * 300) / cropRatio),
          })}
        />
      ) : null}
      {objectViewBoxSupported ? null : (
        <Alert
          style={{ marginTop: 10 }}
          type="info"
          showIcon
          title={t("proview.photo.unsupported")}
        />
      )}
    </Modal>
  );
}
