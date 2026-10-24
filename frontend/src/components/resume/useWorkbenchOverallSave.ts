// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」顶部那对**整体**动作（保存 / 取消）：状态机 + 「有没有改动」那两个布尔。
 *
 * 为什么单独成文件而不是留在 `ResumeZoomModal`：那个文件是"外壳 + 三栏 + 动作条"的组合根，
 * 而这里全是**纯状态判断**（基线快照、脏值、就地确认、两步提交），一行 JSX 都不需要。搬出去
 * 之后，读动作条的人看到的是"按了会怎样"的几个名字，不必在 JSX 中间跳着找 state。
 *
 * ## 为什么 `dirty` 不是一个布尔
 *
 * 两个来源性质不同：中栏内容是**显式保存**（`editorDirty`，草稿住在编辑器里），左栏参数是
 * **即时生效**的（`layout` 每拖一下就是新对象，预览已按它重排，也可以回滚到打开那一刻的
 * `layoutSnapshot`）。只认前者，用户拖完字号会发现顶部没有「取消」；只认后者，改了一句措辞
 * 同样没反应。对用户而言只有一件事："我改了东西，现在想存下来或者作废"。
 *
 * **W02 起 `dirty` 是唯一出口**：动作条的显隐、关闭确认（`needsCloseConfirm`）、保存按钮
 * 的 loading 都消费这一个 `dirty`。纸面加粗（`richDirty`）由 `ResumeZoomModal` 并进
 * `editorDirty` 再传进来，不在这里再算一遍——三处各算一次的产物就是"关闭时问、保存时又不问"。
 *
 * ## 保存为什么先版式、后内容
 *
 * 版式 PATCH 会返回新的 `detail` 与重渲染的 html，先做它，后面内容保存失败时"版式这一半"已经
 * 是确定的；反过来会出现"内容已存、版式失败"，而用户看不出到底哪一半成功了。
 *
 * 快照只在版式**确认落库**之后才对齐：提前对齐、或落库失败也对齐，都会让没存上的那一半看起来
 * 存上了——按钮收起，用户再也没有重试的入口。失败提示由各自的链路给（版式在宿主的
 * `commitLayout` 里已经 `message.error`，内容在编辑器的 `handleFinish` 里），这里只判断
 * 成败、不重复弹。
 *
 * ## W02：整体保存的串行化 / 冲突交给 `useDocumentSave`
 *
 * 单飞、过时回包、失败保草稿、409 冲突态全在那个 hook 里（它只管状态，不认业务）。这里只负责
 * **顺序**：版式 → 正文 → 草稿仅发布，每一步的终态决定下一步走不走。冲突时**停住**并把
 * `conflict` 交给动作条换成"用最新的 / 比较 / 另存副本"，绝不自动重试——自动重试就是硬覆盖。
 */
import { useMemo, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout } from "../../types";
import { useDocumentSave } from "../../features/resume-document/useDocumentSave";
import type { ResumeDocumentPipeline, SaveOutcome } from "../../features/resume-document/types";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";

/**
 * 版式深拷贝。浅拷贝**不够**：`format_config` 是嵌套对象，用户一拖滑杆就换了一个新对象，若快照
 * 里存的还是同一个引用，"打开时"与"现在"永远相等，"有没有改动"这条信号就废了。
 */
export function cloneLayout(layout: ResumeLayout): ResumeLayout {
  return JSON.parse(JSON.stringify(layout)) as ResumeLayout;
}

export interface WorkbenchOverallSaveOptions {
  /** 制作台是否打开：打开那一刻记版式基线，关闭时清空（换一份简历再进来必须重新取基线）。 */
  open: boolean;
  /** 当前**草稿**版式：左栏控件即时改的就是它（不是记录里存的那份）。 */
  layout?: ResumeLayout;
  /** 中栏内容脏值，即编辑器 `onDirtyChange` 上报的那一份（纸面加粗已由宿合并进来）。 */
  editorDirty: boolean;
  /** 这份记录还是制作台草稿（见 `onPublishDraft`）：保存按钮要常驻。 */
  isDraft?: boolean;
  /** 中栏的命令式句柄：`saveAsync()` / `discard()` 都在那一层（判据全在中栏里）。 */
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** 回滚版式的通道：**只重排、不落库**。 */
  onApplyLayout?: (next: ResumeLayout) => void;
  /** 版式落库通道（老宿主，无版本条件写）；`false` = 没落库。缺省时保存退化为"只存内容"。 */
  onCommitLayout?: () => Promise<boolean>;
  /**
   * W02 条件写通道（宿主注入）：有它时版式/正文/发布三笔写入都带 `expectedRevision`。
   * 缺省 = 旧的无条件写（生成流程那种只读宿主，没有冲突保护可言）。
   */
  documentPipeline?: ResumeDocumentPipeline;
  /**
   * 这份记录还是**制作台草稿**（0051）：内容与版式都没脏过，但用户点了「保存到简历中心」。
   *
   * 那条路径必须单独存在：`onCommitLayout` 在版式不脏时直接返回 `true`（什么都不发），
   * 内容也不脏就不会调 `editorRef.saveAsync()`——两条写入都不发生，后端的 `draft` 标记就
   * 永远清不掉，草稿也就永远进不了简历中心。
   */
  onPublishDraft?: () => Promise<boolean>;
}

export interface WorkbenchOverallSave {
  /** 有没有**任何**改动（内容脏 **或** 版式与基线不同）：全屏唯一的脏值出口。 */
  dirty: boolean;
  /** 只有版式脏：取消/关闭的措辞要据此换一句（丢的东西不一样）。 */
  layoutDirty: boolean;
  /** 整体保存正在跑（按钮 loading，同一时刻不许再点、也不许点取消）。 */
  saving: boolean;
  /** 停在 409 冲突态：保存/取消禁用，正文上方换成三选一。 */
  conflict: boolean;
  /** 最近一次保存失败（非冲突）：动作条留一句"改动还留着"，保存按钮就是重试入口。 */
  saveFailed: boolean;
  /** 顶部「保存修改」：先落版式、后存内容、最后处理草稿发布。 */
  save: () => Promise<void>;
  /** 冲突已解决（用最新的 / 另存副本成功）：恢复成可保存。 */
  settleConflict: () => void;
  /** 文档被替换/关闭：让在飞回包作废（晚到的成功不能把新文档标成已保存）。 */
  invalidateDocument: () => void;
  /** 顶部确认条里的「放弃修改」：内容回填 + **仅当版式真的动过**时才回滚并重排。 */
  cancel: () => void;
  /** 「取消修改」被按过、确认条正亮着。 */
  discardConfirm: boolean;
  setDiscardConfirm: (value: boolean) => void;
}

export function useWorkbenchOverallSave({
  open,
  layout,
  editorDirty,
  isDraft = false,
  editorRef,
  onApplyLayout,
  onCommitLayout,
  documentPipeline,
  onPublishDraft,
}: WorkbenchOverallSaveOptions): WorkbenchOverallSave {
  /**
   * 「打开制作台那一刻」的版式基线。左栏参数是**即时生效**的（拖一下预览就按新参数重排，后端
   * 也已经落库），所以"取消"要把它退回到这里——不然用户点完取消，纸面还是改过的样子。
   */
  const [layoutSnapshot, setLayoutSnapshot] = useState<ResumeLayout | null>(() =>
    open && layout ? cloneLayout(layout) : null,
  );
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLayoutSnapshot(open && layout ? cloneLayout(layout) : null);
  }
  // 有没有**任何**改动：比较用 `JSON.stringify`（`ResumeLayout` 是固定形状的对象，键序稳定，
  // 结构比较足够）。这是**唯一**的脏值出口，见文件头。
  const layoutDirty = useMemo(() => {
    if (!layout || !layoutSnapshot) return false;
    return JSON.stringify(layout) !== JSON.stringify(layoutSnapshot);
  }, [layout, layoutSnapshot]);
  const dirty = editorDirty || layoutDirty;

  // 「取消修改」的就地确认：用户的眼睛在顶部动作条上，确认条就必须长在那里。
  const [discardConfirm, setDiscardConfirm] = useState(false);
  // 脏值转 false（刚保存成功）时把确认条收起来，否则它会挂在那里像个幽灵。
  const [prevEditorDirty, setPrevEditorDirty] = useState(editorDirty);
  if (prevEditorDirty !== editorDirty) {
    setPrevEditorDirty(editorDirty);
    if (!editorDirty) setDiscardConfirm(false);
  }

  /** 老宿主的版式一步：boolean 语义折成保存终态（`false` = 没落库）。 */
  const commitLayoutLegacy = async (): Promise<SaveOutcome> => {
    // 两种情况必须分开：**未传**这条链路 = 只读宿主，静默退化为"只存内容"（不阻塞）；
    // **拒绝** = 落库失败，必须拦住。
    if (!onCommitLayout) return { status: "unchanged", revision: 0 };
    const committed = await onCommitLayout().catch(() => false);
    return committed === false
      ? { status: "failed", error: null }
      : { status: "saved", revision: 0 };
  };

  /** 老宿主的草稿发布一步：`false` = 没发成。 */
  const publishDraftLegacy = async (): Promise<SaveOutcome> => {
    if (!onPublishDraft) return { status: "unchanged", revision: 0 };
    const published = await onPublishDraft().catch(() => false);
    return published === false
      ? { status: "failed", error: null }
      : { status: "saved", revision: 0 };
  };

  /**
   * 一次完整保存。顺序与"失败不对齐快照"的理由见文件头；每一步的终态决定下一步走不走。
   *
   * `revision` 在两步之间**本地推进**：版式保存成功会返回新版本，正文条件写必须用新版本，
   * 不能等宿主 `setDetail` 之后的下一轮渲染——那之间的 await 里还有一次网络往返。
   */
  const performSave = async (): Promise<SaveOutcome> => {
    let written = false;
    let revision = documentPipeline?.revision ?? 0;
    if (layoutDirty) {
      const outcome = documentPipeline
        ? await documentPipeline.saveLayout(revision)
        : await commitLayoutLegacy();
      if (outcome.status === "conflict" || outcome.status === "failed") return outcome;
      written = outcome.status === "saved" || written;
      revision = outcome.revision;
      // 版式**确认落库**之后才对快照对齐（见文件头的理由）。
      setLayoutSnapshot(layout ? cloneLayout(layout) : null);
    }
    if (editorDirty) {
      const contentOutcome = await editorRef.current?.saveAsync(
        documentPipeline ? revision : undefined,
      );
      if (!contentOutcome || contentOutcome.status === "invalid") {
        // 表单校验没过 = 没有发请求：既不是成功也不是失败，草稿与脏值全部原样保留，
        // 错误提示由表单自己的校验态给。
        return { status: "unchanged", revision };
      }
      if (contentOutcome.status === "conflict") {
        return { status: "conflict", currentRevision: contentOutcome.currentRevision };
      }
      if (contentOutcome.status === "failed") {
        return { status: "failed", error: contentOutcome.error };
      }
      if (contentOutcome.revision !== null) revision = contentOutcome.revision;
      written = true;
    }
    // 草稿的"仅发布"路径：两条写入都没发生（内容没改、版式没动），只有它能把 `draft`
    // 清掉。放在内容之后：真脏的时候前面那条写入已经会转正，再发一次就是同一个请求走两遍。
    if (isDraft && !editorDirty && !layoutDirty) {
      const published = documentPipeline
        ? await documentPipeline.publishDraft(revision)
        : await publishDraftLegacy();
      if (published.status === "conflict" || published.status === "failed") return published;
      written = written || published.status === "saved";
    }
    return written ? { status: "saved", revision } : { status: "unchanged", revision };
  };

  const documentSave = useDocumentSave({ perform: performSave });

  /**
   * 「放弃修改」：两件事都要做，只做一件都会留下"取消了一半"的界面。
   *
   * 1. `discard()`：清草稿 + 回填服务端内容 + 清脏 + 重置历史；
   * 2. 回滚版式：左栏那些参数是即时生效的，不退的话纸面还是改过的样子。
   *
   * 但第 2 步只对**真的动过版式**才成立：没动过就没有可回滚的东西，无条件发一次等于白让服务端
   * 重排一遍（几百毫秒的渲染）。判据必须写在调用**之前**——回滚之后 `layoutDirty` 自己就转
   * false 了，那时再判永远不成立。
   */
  const cancel = (): void => {
    editorRef.current?.discard();
    if (layoutDirty && layoutSnapshot) onApplyLayout?.(cloneLayout(layoutSnapshot));
    setDiscardConfirm(false);
  };

  return {
    dirty,
    layoutDirty,
    saving: documentSave.saving,
    conflict: documentSave.conflict,
    saveFailed: documentSave.status === "failed",
    save: documentSave.save,
    settleConflict: documentSave.settleConflict,
    invalidateDocument: documentSave.invalidate,
    cancel,
    discardConfirm,
    setDiscardConfirm,
  };
}
