// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏「版面」组顶部的**常驻版面状态条**（#24 24A / 24C）。
 *
 * ## 为什么是"常驻一行"而不是"异常时才出现的告警"
 *
 * 预览卡那四个入口回答的是"**结果对不对**"（交付前最后一眼）；制作台要回答的是
 * "**我改完变成什么样了**"。后者只有在**一直看得见**的时候才有用：用户拖行距滑块，
 * 眼睛盯的是同一行数字在变——那条数字如果只在溢出时冒出来，健康区间里就是盲的。
 *
 * ## 为什么点开才是完整诊断卡
 *
 * 完整结论（偏空 / 拥挤 / 溢出、先动哪个旋钮、候选版式）全在后端 `/layout/analyze`。
 * 拖动滑杆时每动一格问一次会把交互拖垮（#23 的 3.9s 教训），所以：
 * - 这一行的数字**只本地算**：`占用率 = 正文高度 / (一页正文高 × 页数上限)`，公式与阈值
 *   都住在 `layoutStatusSummary.ts`（与预览卡的诊断徽标共用一份）；
 * - 点开弹层才挂载 `ResumeLayoutDiagnosisCard`，此时才有一次 `/layout/analyze`；关掉即
 *   卸载（`lazyContent`），再打开按当前草稿版式重新算——后端有缓存键，重复打开会命中。
 *
 * 换句话说：**`onChange` 里永远不会有请求**，这是本条最容易写错的地方。
 *
 * ## 数字口径要标注
 *
 * 制作台里的数字按**未保存的草稿**量，预览卡按**已保存的记录**量，两者必然可能不同
 * （#24 一致性约束 2）。所以版式一改，这一行就挂一颗「未保存」；判据见
 * {@link useUnsavedLayoutFlag}。中栏**正文**的脏判断在这一层拿不到（见
 * `WorkbenchParamsColumnV2` 的 `dirty` 入参注释）。
 */
import { useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout } from "../../types";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumePreviewHandle } from "../ResumePreview";
import ResumeDiagnosticsBar from "./ResumeDiagnosticsBar";
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";
import { draftLayoutKey } from "./resumeLayoutDiagnosisKeys";
import { summarizeLayoutStatus } from "./layoutStatusSummary";
import { useWorkbenchLayoutSnapshot } from "./workbenchLayoutStore";

/**
 * 有没有**未保存的版式改动**。
 *
 * 两个信号合起来用（这一层只有这两个）：
 * 1. `draftLayoutKey(layout) !== draftLayoutKey(baseline)`——与"打开制作台那一刻"相比改过；
 * 2. `revision` 变化 = 记录被写过一次。若那一次写入**没有同时改变版式指纹**，就说明刚
 *    存的就是眼前这一版，于是把它记成"干净版式"，标记随之消失（验收判据里"保存后该标记
 *    消失"靠这一条）。
 *
 * 为什么不直接用外壳的 `save.layoutDirty`：那要改外壳的 props 链（本批的文件范围不含它）。
 * 已知的边界：别的写操作（例如 24D 的「补进简历」）也会推进 revision，此时若版式正脏，
 * 标记可能提前消失——所以 `dirty` 入参优先于这里的推断，外壳接上后以它为准。
 */
function useUnsavedLayoutFlag(
  layout: ResumeLayout,
  baseline: ResumeLayout,
  revision: number | null,
  override: boolean | undefined,
): boolean {
  const layoutKey = draftLayoutKey(layout);
  const baselineKey = draftLayoutKey(baseline);
  /** 最近一次"记录写入且版式没跟着变"的那一版；`null` = 还没观察到这样的写入。 */
  const [savedKey, setSavedKey] = useState<string | null>(null);
  // 上一帧观察到的 (revision, 版式指纹)。渲染期守卫式调整（与 useWorkbenchV2Save 同一写法）：
  // 放在 effect 里会晚一帧，用户会看到标记"闪一下"。
  const [observed, setObserved] = useState<{ revision: number | null; key: string }>({
    revision,
    key: layoutKey,
  });
  if (observed.revision !== revision) {
    if (observed.key === layoutKey) setSavedKey(layoutKey);
    setObserved({ revision, key: layoutKey });
  } else if (observed.key !== layoutKey) {
    setObserved({ revision, key: layoutKey });
  }
  if (override !== undefined) return override;
  return layoutKey !== baselineKey && layoutKey !== savedKey;
}

export interface WorkbenchLayoutStatusBarProps {
  /** 当前**草稿**版式（滑杆改的就是它）。 */
  layout: ResumeLayout;
  /** 打开制作台那一刻的版式：用来判断"有没有未保存的版式改动"。 */
  baseline: ResumeLayout;
  /** 记录 id：没有它就没法问后端要诊断结论（只读宿主 / 生成中的临时预览）。 */
  resumeId?: number | null;
  /**
   * 记录的版本号（`documentPipeline.revision`）。它是"记录被写过一次"的唯一信号：
   * 版式没跟着变而 revision 前进了 = 刚刚保存成功 = 「未保存」该消失。
   */
  revision?: number | null;
  previewRef: RefObject<ResumePreviewHandle | null>;
  /** 版式保存/重排在飞：弹层里的动作要跟着禁用（与预览卡同一个口径）。 */
  relayouting?: boolean;
  /**
   * 宿主额外提供的脏标记（中栏正文是否改过）。不传时只用版式指纹判断——
   * 正文脏只有外壳知道，本轮没有从外壳往下传（见交付说明的协调项）。
   */
  dirty?: boolean;
  /** 应用诊断/优化器给出的版式（写回草稿版式，不额外发请求）。 */
  onApplyLayout: (next: ResumeLayout) => void;
}

export default function WorkbenchLayoutStatusBar({
  layout,
  baseline,
  resumeId,
  revision = null,
  previewRef,
  relayouting = false,
  dirty,
  onApplyLayout,
}: WorkbenchLayoutStatusBarProps) {
  // 测量由右栏画布写进 store（左右两栏没有共同 props 链，见 workbenchLayoutStore）。
  // 订阅语言变化：状态句由 `layoutStatusSummary` 里的模块级 `t()` 生成，换语言要重算。
  useLocale();
  const { measure, layoutStatus } = useWorkbenchLayoutSnapshot();
  // 不做 memo：这一行只拼一句文案（几次除法 + 字符串），而 `t()` 读的是语言快照——
  // 上面那行 `useLocale()` 保证换语言时重渲染，句子随之重算。挂 memo 反而要把 locale
  // 塞进依赖（linter 会判成"多余依赖"），不如就地算。
  const summary = summarizeLayoutStatus({ measure, layoutStatus });
  /** 「未保存」判据（判据本身与理由见 `useUnsavedLayoutFlag`）。 */
  const unsaved = useUnsavedLayoutFlag(layout, baseline, revision, dirty);
  /**
   * 画布已经判定溢出时，即使本地占用率刚好 100%（四舍五入）也要走警告语义——
   * 这与预览卡的 `overflow` 兜底是同一条判据（`layoutNeedsAttention` 已统一）。
   */
  const overflow = Boolean(layoutStatus?.overflow) || summary.overflowPages > 0;
  const canDiagnose = Boolean(resumeId) && measure !== null;
  return (
    /**
     * 外层只做两件事：给 e2e/样式一个**制作台专属**的锚点（`.resume-wb-layout-status`，
     * 与诊断条自己的类名分开——那个类名预览卡也在用），并把数字挂成 `data-*`：
     * 自动化可以直接断言"拖滑块后 data-fill 变了"，不用解析中文句子。
     */
    <div
      className="resume-wb-layout-status"
      data-fill={summary.fillPercent ?? undefined}
      data-overflow-pages={summary.overflowPages}
      data-attention={summary.attention ? "1" : "0"}
      data-unsaved={unsaved ? "1" : "0"}
    >
      <ResumeDiagnosticsBar
        variant="compact"
        diagnosis={{
          content: null,
          badge: summary.badge,
          summary: summary.summary,
          attention: summary.attention,
          dirty: unsaved,
          /**
           * 关掉即卸载诊断卡：只有弹层打开时才会有一次 `/layout/analyze`。
           * 拖动滑杆期间这一层**只重算本地数字**，不发任何请求。
           */
          lazyContent: canDiagnose
            ? (open) =>
                open ? (
                  <ResumeLayoutDiagnosisCard
                    resumeId={resumeId as number}
                    measure={measure}
                    overflow={overflow}
                    previewRef={previewRef}
                    layout={layout}
                    disabled={relayouting}
                    // 诊断/优化器写回的是 format_config：叠在当前草稿版式上（整体替换语义由
                    // 宿主决定，这里只交出后端回显的那一份）。
                    onApplied={(formatConfig: ResumeFormatConfig) =>
                      onApplyLayout({ ...layout, format_config: formatConfig })
                    }
                    onAddPage={() =>
                      onApplyLayout({ ...layout, page_limit: layout.page_limit + 1 })
                    }
                  />
                ) : null
            : undefined,
        }}
      />
    </div>
  );
}
