// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器 iframe 里的**覆盖层注入**（D05 辅助线 / D10 灰度校样 / D09 裁剪预览）。
 *
 * 覆盖层全部写在 `iframe.contentDocument` 里，只对"眼前这一次预览"生效：
 *
 * - 纸面 HTML 由后端渲染，前端不写回、不请求新接口——导出产物走同一份后端产物，
 *   **辅助标记没有任何进入产物的通道**（这也是 D05 的验收口径）；
 * - 每个 iframe 是独立文档；用户切页/重排/改内容时 iframe 会重载，覆盖层随之消失，
 *   所以调用方（ProviewLayer）在每次 `load` 后重新 sync 一次。
 *
 * 与 `resume-preview/clickToEdit.ts` 同一手法（样式注入 + 固定 id 判重），但两个模块
 * 各自独立：点击编辑是既有功能，本模块不 import 它，避免一处改动连带另一个功能。
 */
import { renderGuideLayer, clearGuideLayer, measureGuideGeometry } from "./guideGeometry";
import { cropInsetPercent, type PhotoCropParams } from "./photoCrop";
import { anyGuideEnabled, type GuideFlags } from "./types";

export const PROOF_STYLE_ID = "resume-proview-proof-style";
export const CROP_STYLE_ID = "resume-proview-crop-style";

/** 灰度校样：整份纸面转灰度，不改任何 `--rf-*` / 用户颜色参数。 */
export const PROOF_CSS = "html{filter:grayscale(1)!important}";

/** 模板里照片的类名（8 套模板共用，见 backend/app/templates/*.html.j2）。 */
const PHOTO_CLASS = "profile-photo";

export interface OverlayState {
  guides: GuideFlags;
  proof: boolean;
  /** 已通过来源校验的裁剪参数（`null` = 不裁）。 */
  crop: PhotoCropParams | null;
  pageWidth: number;
  pageHeight: number;
}

function ensureStyle(doc: Document, id: string, css: string): void {
  const head = doc.head ?? doc.documentElement;
  if (!head) return;
  let style = doc.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = id;
    head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function removeStyle(doc: Document, id: string): void {
  doc.getElementById(id)?.remove();
}

/** 灰度校样开关（幂等）。 */
export function applyGrayscaleProof(doc: Document | null, enabled: boolean): void {
  if (!doc) return;
  if (enabled) ensureStyle(doc, PROOF_STYLE_ID, PROOF_CSS);
  else removeStyle(doc, PROOF_STYLE_ID);
}

/**
 * 非破坏裁剪预览（D09）：只写 `object-view-box`，**不动图片数据**。
 *
 * 用 `object-view-box` 而不是"先 canvas 裁一张再换 src"：后者每次拖动都要重编码，
 * 而且会把派生图写回正文——正是"反复裁切覆盖原图"要避免的做法。裁剪参数本身是
 * 可保存的数据（`format_config.photo_crop`），原图引用不变。
 */
export function applyPhotoCrop(doc: Document | null, crop: PhotoCropParams | null): void {
  if (!doc) return;
  if (!crop) {
    removeStyle(doc, CROP_STYLE_ID);
    return;
  }
  const { top, right, bottom, left } = cropInsetPercent(crop);
  const css =
    "." +
    PHOTO_CLASS +
    "{object-view-box:inset(" +
    top +
    "% " +
    right +
    "% " +
    bottom +
    "% " +
    left +
    "%)!important;}";
  ensureStyle(doc, CROP_STYLE_ID, css);
}

/**
 * 一次性同步一个纸面文档的覆盖层（幂等；iframe 每次 load 后调用）。
 *
 * 顺序固定：先清旧的辅助线层（几何依赖当前文档布局），再按开关重画；样式类（灰度/裁剪）
 * 由各自函数幂等覆盖。
 */
export function syncProviewOverlays(doc: Document | null, state: OverlayState): void {
  if (!doc) return;
  applyGrayscaleProof(doc, state.proof);
  applyPhotoCrop(doc, state.crop);
  if (anyGuideEnabled(state.guides)) {
    const geometry = measureGuideGeometry(doc, state.pageWidth, state.pageHeight);
    renderGuideLayer(doc, geometry, state.guides);
  } else {
    clearGuideLayer(doc);
  }
}

/** 关掉/卸载时清干净（不在纸面里留下任何节点或样式）。 */
export function clearProviewOverlays(doc: Document | null): void {
  if (!doc) return;
  removeStyle(doc, PROOF_STYLE_ID);
  removeStyle(doc, CROP_STYLE_ID);
  clearGuideLayer(doc);
}
