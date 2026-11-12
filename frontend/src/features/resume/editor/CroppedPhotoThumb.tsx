// SPDX-License-Identifier: Apache-2.0
/**
 * 按 `photo_crop` 取景显示的**照片缩略图**（任务 6）。
 *
 * ## 为什么需要它
 *
 * 裁剪改成非破坏之后（原图不动、只存 `format_config.photo_crop`），页面上每一处缩略图都必须
 * **按 rect 显示取景**，否则用户裁完看到缩略图还是整张原图，会以为"没生效"。这里把
 * `PhotoCropDialog` 预览那套百分比定位算式抽成唯一实现，chip / 编辑器两处共用。
 *
 * ## 算式与预览逐字一致
 *
 * 外层盒子按取景比例 `(rect.w × source.width) / (rect.h × source.height)` 定形，内层 img
 * 放大 `1 / rect.w` 与 `1 / rect.h`，再按 `rect.x / rect.y` 反向偏移。三处（弹窗预览、
 * chip、编辑器缩略图）因此不可能出现"预览一个样、缩略图另一个样"。
 *
 * ## 无裁剪时**完全退化成一张原图 `<img>`**
 *
 * 没有 `photo_crop`（或参数已失效）时渲染的就是原来那个 `<img className=…>`，DOM 结构与
 * 样式与改动前逐像素等价——不给"没裁过"的照片引入任何包装层。
 *
 * ## 内层 img 显式 `objectFit: "fill"`
 *
 * 调用点的容器可能带 `img { object-fit: cover }`（`.document-photo-frame` 就是），那会把
 * 已经按取景比例拉伸的图再裁一次。这里显式复位，避免"缩略图比预览多裁一圈"。
 */
import type { CSSProperties } from "react";
import type { PhotoCropParams } from "../preview/photoCrop";

interface Props {
  /** 原图 data URL（**永远**是原图，不是裁剪结果）。 */
  photo: string;
  /** 已保存的裁剪参数；`null` / 缺省 = 不裁剪，直接渲染原图。 */
  crop?: PhotoCropParams | null;
  /** 外层类名（chip 用 `.document-chip-photo`，编辑器用 `.document-photo-thumb`）。 */
  className?: string;
  /** 无障碍名（外层 `role="img"` 的标签；内层 img 置空避免重复朗读）。 */
  alt: string;
}

export default function CroppedPhotoThumb({ photo, crop, className, alt }: Props) {
  const base = className ? ` ${className}` : "";
  if (!crop) {
    return <img className={className} src={photo} alt={alt} />;
  }
  const { rect, source } = crop;
  if (!(rect.w > 0) || !(rect.h > 0) || !(source.width > 0) || !(source.height > 0)) {
    return <img className={className} src={photo} alt={alt} />;
  }
  const ratio = (rect.w * source.width) / (rect.h * source.height);
  const frameStyle: CSSProperties = {
    aspectRatio: String(ratio),
    overflow: "hidden",
    position: "relative",
  };
  const imageStyle: CSSProperties = {
    position: "absolute",
    width: `${100 / rect.w}%`,
    height: `${100 / rect.h}%`,
    left: `${(-rect.x / rect.w) * 100}%`,
    top: `${(-rect.y / rect.h) * 100}%`,
    maxWidth: "none",
    objectFit: "fill",
  };
  return (
    <span className={`rf-crop-thumb${base}`} style={frameStyle} role="img" aria-label={alt}>
      <img src={photo} alt="" style={imageStyle} draggable={false} />
    </span>
  );
}
