// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器 iframe 里的**覆盖层注入**（D05 辅助线 / D10 灰度校样）。
 *
 * 覆盖层全部写在 `iframe.contentDocument` 里，只对"眼前这一次预览"生效：
 *
 * - 纸面 HTML 由后端渲染，前端不写回、不请求新接口——导出产物走同一份后端产物，
 *   **辅助标记没有任何进入产物的通道**（这也是 D05 的验收口径）；
 * - 每个 iframe 是独立文档；用户切页/重排/改内容时 iframe 会重载，覆盖层随之消失，
 *   所以调用方（ProviewLayer）在每次 `load` 后重新 sync 一次。
 *
 * ## 照片裁剪为什么**不再**在这里注入（2026-10 #10）
 *
 * D09 最初用 CSS `object-view-box` 在纸面 iframe 上"实时预演裁剪"，当时前端假设
 * 纸面 HTML 用的是**原图**。但实际渲染链路上，后端 `render_html` 一旦收到
 * `format_config.photo_crop` 就会把 `<img>` 换成**派生裁剪图**（HTML / PDF / Word
 * 三条产物同源）。两层裁剪叠在一起：用户选的是左半块，页面先显示左半块、再由
 * `object-view-box` 从"左半块"里再裁一次——这就是"照片裁剪未生效/取景不对"的来源。
 * 现在裁剪只在服务端做一次，覆盖层不再碰照片。
 *
 * 与 `resume-preview/clickToEdit.ts` 同一手法（样式注入 + 固定 id 判重），但两个模块
 * 各自独立：点击编辑是既有功能，本模块不 import 它，避免一处改动连带另一个功能。
 */
import { renderGuideLayer, clearGuideLayer, measureGuideGeometry } from "./guideGeometry";
import { anyGuideEnabled, type GuideFlags } from "./types";

export const PROOF_STYLE_ID = "resume-proview-proof-style";

/** 灰度校样：整份纸面转灰度，不改任何 `--rf-*` / 用户颜色参数。 */
export const PROOF_CSS = "html{filter:grayscale(1)!important}";

export interface OverlayState {
  guides: GuideFlags;
  proof: boolean;
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
 * 一次性同步一个纸面文档的覆盖层（幂等；iframe 每次 load 后调用）。
 *
 * 顺序固定：先清旧的辅助线层（几何依赖当前文档布局），再按开关重画；灰度样式由
 * `applyGrayscaleProof` 幂等覆盖。**照片不做任何注入**：裁剪已由服务端按
 * `format_config.photo_crop` 派生（见文件头）。
 */
export function syncProviewOverlays(doc: Document | null, state: OverlayState): void {
  if (!doc) return;
  applyGrayscaleProof(doc, state.proof);
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
  clearGuideLayer(doc);
}
