// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪弹窗（D09 / 2026-11 #18）：非破坏裁剪的参数 UI。
 *
 * ## 非破坏的三条可见证据
 *
 * 1. 裁剪框画在**整张原图**上（不是重新编码的图片），拖动时原图一个像素都不变；
 * 2. 原图尺寸与"原始照片不会被覆盖"写在弹窗里，恢复原图 = 删掉参数；
 * 3. 移除照片是独立动作（由宿主的内容保存链路执行），空位由后端模板不预留照片空间
 *    自然收回——不在前端伪造一个"空位"。
 *
 * ## #18：三个滑杆 → 四边可拖的裁剪框
 *
 * 界面状态从 `PhotoCropDraft`（比例 / 取景大小 / 位置）换成 `CropRect`：拖动四边或
 * 四角、松手夹回当前比例（`free` 不夹）、按住 Ctrl / Cmd 全程等比、方向键微调。
 * 几何全部在 `cropGeometry.ts` + `photoCrop.ts` 的纯函数里，组件只负责画与转发。
 *
 * ## 清晰度提示跟着框走
 *
 * 裁剪框越小可用像素越少，所以清晰度按 `rect`（不是原图）折算：`estimateRectClarity`
 * 在拖动时逐帧更新，只提示不阻断保存。
 */
import { App, Button, Modal, Popconfirm, Segmented, Typography } from "antd";
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  buildPhotoSource,
  clampCropRect,
  createRectCropParams,
  cropRectAspect,
  defaultCropRect,
  fitCropRectToAspect,
  PHOTO_CROP_ASPECTS,
  type CropRect,
  type PhotoAspect,
  type PhotoCropParams,
  type PhotoSourceInfo,
} from "./photoCrop";
import { DEFAULT_PRINTED_WIDTH_MM, estimateRectClarity, printedWidthMm } from "./photoClarity";
import { frameRatioLabel, nearestCropAspect, usePhotoFrameAspect } from "./photoFrameAspect";
import { usePhotoDimensions } from "./usePhotoDimensions";
import PhotoCropBox from "./PhotoCropBox";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 原图 data URL（`content.photo`）；空串 = 没有照片（调用方不打开弹窗）。 */
  photo: string;
  /** 已保存的裁剪参数（首次打开时还原裁剪框）。 */
  initialCrop?: PhotoCropParams | null;
  /** 照片在纸面上的宽度（mm），从预览 iframe 实测；量不到时用兜底值。 */
  printedWidthMm?: number;
  /** 预览视口：用于量"照片在纸面上实际多宽"（只读 DOM，且在 effect 里读 ref）。 */
  viewportRef?: RefObject<HTMLElement | null>;
  /** 画框宽高比覆盖值（宿主已量好时传入；不传 = 从 `viewportRef` 里量）。 */
  frameAspectRatio?: number;
  /** 应用裁剪（`null` = 恢复原图）。 */
  onApply: (params: PhotoCropParams | null) => void;
  /** 移除照片（走宿主的内容保存链路）；不传 = 不提供该动作。 */
  onRemove?: () => void;
}

/** 全幅（没有真正裁剪）。 */
const FULL_FRAME: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const ASPECT_LABEL_KEYS: Record<
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

export default function PhotoCropModal({
  open,
  onClose,
  photo,
  initialCrop = null,
  printedWidthMm: printedWidthMmValue,
  viewportRef,
  frameAspectRatio,
  onApply,
  onRemove,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const dimensions = usePhotoDimensions(open ? photo : null);
  // I-37：画框比例从纸面 iframe 实测（`object-fit: contain` 不改元素盒子），
  // 换模板就跟着变；量不到时 `presetAspect` 为 null，保持原来的「原图」默认。
  const measuredFrameAspect = usePhotoFrameAspect(open, viewportRef);
  const frameAspect = frameAspectRatio ?? measuredFrameAspect;
  const presetAspect = nearestCropAspect(frameAspect);
  const frameLabel = frameRatioLabel(frameAspect);
  // 纸面宽度从这个 iframe 实测：裁剪参数是相对原图的，清晰度提示却取决于"纸上多大"。
  const [measuredWidth, setMeasuredWidth] = useState<number | undefined>(undefined);
  const decodedSource: PhotoSourceInfo | null = dimensions
    ? buildPhotoSource(photo, dimensions.width, dimensions.height)
    : null;
  // 换照片后旧裁剪失效（`source.sha256` 指向旧图）。
  const cropInvalidated = Boolean(
    decodedSource && initialCrop && initialCrop.source.sha256 !== decodedSource.sha256,
  );
  const savedCrop = cropInvalidated ? null : initialCrop;
  const source: PhotoSourceInfo | null = decodedSource ?? savedCrop?.source ?? null;

  // 用户手动改过比例之后，晚到的实测结果不能把他的选择拽回去。
  const [aspectTouched, setAspectTouched] = useState(false);
  const [aspect, setAspect] = useState<PhotoAspect>(savedCrop?.aspect ?? presetAspect ?? "free");
  const [rect, setRect] = useState<CropRect>(
    savedCrop ? clampCropRect(savedCrop.rect) : FULL_FRAME,
  );

  // 打开时按"已保存参数"还原；没有已保存参数就从整幅开始。`open` 变化才重置，
  // 用户拖动过程中父组件重渲染不会把框拽回去。
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setAspectTouched(false);
      setAspect(savedCrop?.aspect ?? presetAspect ?? "free");
      setRect(savedCrop ? clampCropRect(savedCrop.rect) : FULL_FRAME);
    }
  }

  // I-37：画框比例是打开后才实测到的。量到之前先用「原图」，量到且没有已保存裁剪、
  // 用户也没手动改过比例时，才套最接近的预设（默认模板 → 4:5，modern → 1:1）。
  useEffect(() => {
    if (!open || savedCrop || aspectTouched || !presetAspect) return;
    setAspect((current) => (current === "free" ? presetAspect : current));
  }, [open, savedCrop, aspectTouched, presetAspect]);

  // 旧裁剪因换照片失效：框与比例一起复位。
  useEffect(() => {
    if (!cropInvalidated) return;
    setAspectTouched(false);
    setAspect(presetAspect ?? "free");
    setRect(FULL_FRAME);
  }, [cropInvalidated, presetAspect]);

  const sourceWidth = dimensions?.width ?? 0;
  const sourceHeight = dimensions?.height ?? 0;
  // 锁定比例 + 还没拿到真尺寸时先给整幅，解码完成后换成该比例的居中矩形。
  useEffect(() => {
    if (!open || sourceWidth <= 0 || sourceHeight <= 0 || savedCrop) return;
    if (aspect === "free") return;
    setRect((current) => {
      if (current.w < 0.9999 || current.h < 0.9999) return current;
      return defaultCropRect(aspect, { sha256: "", width: sourceWidth, height: sourceHeight });
    });
  }, [open, sourceWidth, sourceHeight, aspect, savedCrop]);

  useEffect(() => {
    if (!open || !viewportRef) {
      setMeasuredWidth(undefined);
      return;
    }
    const frame = viewportRef.current?.querySelector("iframe");
    const image = frame?.contentDocument?.querySelector(".profile-photo");
    const imageRect = image?.getBoundingClientRect();
    setMeasuredWidth(
      imageRect && imageRect.width > 0 ? printedWidthMm(imageRect.width) : undefined,
    );
  }, [open, viewportRef]);

  const safeRect = clampCropRect(rect);
  const params = source ? createRectCropParams(source, safeRect, aspect) : null;
  const clarity = source
    ? estimateRectClarity(
        source,
        safeRect,
        measuredWidth ?? printedWidthMmValue ?? DEFAULT_PRINTED_WIDTH_MM,
      )
    : null;
  const cropRatio = cropRectAspect(safeRect, source);
  const aspectOptions = PHOTO_CROP_ASPECTS.map((value) => ({
    value,
    label: t(ASPECT_LABEL_KEYS[value]),
  }));

  const selectAspect = (next: PhotoAspect) => {
    setAspectTouched(true);
    setAspect(next);
    setRect((current) => fitCropRectToAspect(current, next, source));
  };

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
      width={640}
      footer={[
        <Button
          key="reset"
          onClick={() => {
            onApply(null);
            message.success(t("proview.photo.cleared"));
            onClose();
          }}
          disabled={!savedCrop}
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
      {photo ? (
        <PhotoCropBox
          photo={photo}
          source={source}
          rect={safeRect}
          aspect={aspect}
          disabled={!source}
          onChange={setRect}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginTop: 12,
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <Typography.Text style={{ fontSize: 12 }}>{t("proview.photo.aspect")}</Typography.Text>
          <Segmented
            size="small"
            aria-label={t("proview.photo.aspect")}
            value={aspect}
            options={aspectOptions}
            onChange={(next) => selectAspect(next as PhotoAspect)}
            style={{ display: "flex", marginTop: 4 }}
          />
          {frameLabel && presetAspect ? (
            <Typography.Text
              type="secondary"
              data-testid="photo-frame-hint"
              style={{ display: "block", marginTop: 6, fontSize: 12 }}
            >
              {t("proview.photo.frameHint", {
                frame: frameLabel,
                aspect: t(ASPECT_LABEL_KEYS[presetAspect]),
              })}
            </Typography.Text>
          ) : null}
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 6, fontSize: 12 }}
          >
            {source
              ? t("proview.photo.source", { width: source.width, height: source.height })
              : t("proview.photo.noPhoto")}
          </Typography.Text>
        </div>
        <div style={{ flex: "0 0 120px" }}>
          <div
            role="img"
            aria-label={t("proview.photo.previewAlt")}
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: cropRatio > 0 ? String(cropRatio) : "3 / 4",
              overflow: "hidden",
              background: "var(--rf-surface-alt)",
              borderRadius: 4,
            }}
          >
            {photo && safeRect.w > 0 && safeRect.h > 0 ? (
              <img
                src={photo}
                alt=""
                style={{
                  position: "absolute",
                  width: `${100 / safeRect.w}%`,
                  height: `${100 / safeRect.h}%`,
                  left: `${(-safeRect.x / safeRect.w) * 100}%`,
                  top: `${(-safeRect.y / safeRect.h) * 100}%`,
                  maxWidth: "none",
                  userSelect: "none",
                }}
              />
            ) : null}
          </div>
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 4, fontSize: 12 }}
          >
            {t("proview.photo.previewLabel")}
          </Typography.Text>
        </div>
      </div>
      {clarity ? (
        <Typography.Text
          type={clarity.level === "ok" ? "secondary" : "warning"}
          style={{ display: "block", marginTop: 12, fontSize: 12 }}
        >
          {clarity.level === "ok"
            ? t("proview.photo.clarity.ok", {
                width: clarity.pixelWidth,
                height: clarity.pixelHeight,
              })
            : t("proview.photo.clarity.warn", {
                width: clarity.pixelWidth,
                height: clarity.pixelHeight,
              })}
        </Typography.Text>
      ) : null}
      {clarity ? (
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
          {t("proview.photo.clarity.tip", {
            mm: clarity.printedWidthMm,
            width: Math.ceil((clarity.printedWidthMm / 25.4) * 300),
            height: Math.ceil(((clarity.printedWidthMm / 25.4) * 300) / cropRatio),
          })}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
