// SPDX-License-Identifier: Apache-2.0
/**
 * 简历宿主（`ResumeDetailModal`）的**文档写入层**（W02）。
 *
 * 从 `ResumeDetailModal` 搬出来的原因有两个，都不是"分层好看"：
 *
 * 1. 那个文件已贴 500 行预算（零豁免），而 W02 要往里加条件写、冲突通道与"用最新的"；
 * 2. 三笔写入（正文 / 版式 / 草稿发布）原来各自 `try/catch` + `message`，条件写之后它们
 *    都要回答同一个问题——"这次失败是不是版本冲突"。判定只写一处（`isRevisionConflict`），
 *    才不会出现"正文弹冲突条、版式却弹红 toast"的分叉。
 *
 * ## 错误传播口径（调用方必须知道）
 *
 * `saveContent` **抛出**：正文保存由编辑器表单提交驱动，`useResumeEditorPanel` 用
 * try/catch 做"失败保留草稿 + 错误指引"。返回错误对象会让那条链路把失败当成功。
 * 版式 / 发布**返回终态**：它们没有"表单提交"这层语义，由整体保存状态机直接消费。
 *
 * ## 与老链路并存
 *
 * `saveEditedResume` / `saveLayout` / `publishDraft` 三个无版本条件的入口继续保留：
 * 「手动调整」弹窗与主预览底部的「保存」不是 W02 的改造对象，它们的行为逐字不变。
 */
import type { App as AntdApp } from "antd";
import type { Dispatch, SetStateAction } from "react";
import {
  createManualResume,
  saveResumeContent,
  saveResumeLayout,
  updateResume,
  updateResumeLayout,
} from "../../api/resumes";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import { t } from "../../i18n";
import { bumpResumeList } from "../../features/resume/resumeListEvents";
import { isRevisionConflict, revisionOf } from "./saveOutcome";
import type { SaveOutcome } from "./types";

type MessageApi = ReturnType<typeof AntdApp.useApp>["message"];

/** 打开预览时还没取到记录用的默认版式（与后端旧记录的口径一致）。 */
export const DEFAULT_RESUME_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  // 草稿的初始语言：新记录/还没选过时就是中文（后端旧记录同样是中文）。
  language: "zh-CN",
};

/** 详情 → 版式草稿：字段逐项兜底，漏一个就会让界面显示与记录不一致（尤其 `language`）。 */
export function layoutFromDetail(detail: ResumeDetail): ResumeLayout {
  return {
    template: detail.template || DEFAULT_RESUME_LAYOUT.template,
    format_name: detail.format_name ?? DEFAULT_RESUME_LAYOUT.format_name,
    // 必须带上按简历的覆盖：后面每次重渲染都从这份 layout 出发，
    // 漏了它就会出现"导出用新方案、预览用旧方案"这种最难看的不一致。
    format_config: detail.format_config ?? {},
    page_limit: detail.page_limit || DEFAULT_RESUME_LAYOUT.page_limit,
    font_scale: detail.font_scale || DEFAULT_RESUME_LAYOUT.font_scale,
    language: detail.language ?? DEFAULT_RESUME_LAYOUT.language,
  };
}

export interface ResumeDocumentHostOptions {
  detail: ResumeDetail | null;
  layout: ResumeLayout;
  layoutDirty: boolean;
  layoutSaving: boolean;
  /** 右键加粗的乐观叠加层：保存前合并、保存成功后清空。 */
  overlays: {
    merge: (content: ResumeContent | null) => ResumeContent | null;
    clear: () => void;
  };
  message: MessageApi;
  /**
   * 预览请求序号：换记录后旧回包不能覆盖新界面（既有守卫，原样搬用）。
   *
   * 传**取值函数**而不是 ref 对象：React refs 规则不允许把 ref 交给渲染期执行的函数
   * （这里在渲染期只是构造闭包，真正的读写都发生在保存回调里）。
   */
  readRequestVersion: () => number;
  /** 上一次保存的请求序号（判断回包是否过时；只读，不推进）。 */
  readSaveRequestVersion: () => number;
  /** 登记一次新的保存请求序号并返回它（每次保存自增，旧回包据此作废）。 */
  nextSaveRequestVersion: () => number;
  setDetail: Dispatch<SetStateAction<ResumeDetail | null>>;
  setHtml: (html: string) => void;
  setLayout: (next: ResumeLayout) => void;
  setSavedLayout: (next: ResumeLayout) => void;
  setLayoutSaving: (saving: boolean) => void;
  /** 保存成功后旧建议 / 风险扫描结论失效。 */
  resetSuggestions: () => void;
  /** 渲染 HTML（宿主注入 `renderResume`，保证"预览与保存"同一条管线）。 */
  render: (content: ResumeContent, layout: ResumeLayout) => Promise<string>;
}

export interface ResumeDocumentHost {
  /** 老链路：无条件写（「手动调整」弹窗、生成流程复用）。 */
  saveEditedResume: (content: ResumeContent) => Promise<void>;
  /** W02：条件写，返回新 revision；失败/冲突**抛出**（编辑器负责提示与保草稿）。 */
  saveEditedResumeConditional: (
    content: ResumeContent,
    expectedRevision: number,
  ) => Promise<number>;
  /** 老链路：版式无条件写，`false` = 没落库（主预览底部那颗「保存」）。 */
  saveLayout: () => Promise<boolean>;
  /** W02：版式条件写（整体保存的第一步）。 */
  commitLayout: (expectedRevision: number) => Promise<SaveOutcome>;
  /** 老链路：草稿发布（无版本条件）。 */
  publishDraft: () => Promise<boolean>;
  /** W02：草稿发布条件写。 */
  publishDraftConditional: (expectedRevision: number) => Promise<SaveOutcome>;
  /** 冲突"用最新的"：整份替换本地（含清 overlay / 重渲染），不写库。 */
  adoptLatest: (latest: ResumeDetail) => Promise<void>;
  /** 冲突"另存副本"：用本地内容建新记录（draft=false，标题带（副本））。 */
  saveAsCopy: (content: ResumeContent) => Promise<ResumeDetail>;
}

export function createResumeDocumentHost(options: ResumeDocumentHostOptions): ResumeDocumentHost {
  const {
    detail,
    layout,
    layoutDirty,
    layoutSaving,
    overlays,
    message,
    readRequestVersion,
    readSaveRequestVersion,
    nextSaveRequestVersion,
    setDetail,
    setHtml,
    setLayout,
    setSavedLayout,
    setLayoutSaving,
    resetSuggestions,
    render,
  } = options;

  /**
   * 正文写入的唯一实现（新旧端点共用）。`expectedRevision` 缺省 = 旧的无条件写。
   *
   * 返回保存后的 revision：整体保存需要把它推给下一步（草稿发布 / 下一次保存），
   * 不能等宿主 `setDetail` 之后的下一轮渲染——那之间还有一次网络往返。
   */
  const persistContent = async (
    content: ResumeContent,
    expectedRevision?: number,
  ): Promise<number> => {
    if (!detail) throw new Error(t("workbench.save.no-record"));
    const requestAtStart = readRequestVersion();
    const saveAtStart = nextSaveRequestVersion();
    // overlay 里**仍然有效**的那几条叠在表单值上：`base` 对得上的说明用户没在中栏改过这个
    // 字段（改了 base 就变了，overlay 自动失效）。合并只在这一处做，另一处不再重复。
    const merged = overlays.merge(content) ?? content;
    const updated =
      expectedRevision === undefined
        ? await updateResume(detail.id, merged)
        : await saveResumeContent(detail.id, merged, expectedRevision);
    if (requestAtStart !== readRequestVersion() || saveAtStart !== readSaveRequestVersion()) {
      return revisionOf(updated);
    }
    const rendered = await render(updated.content, layout);
    if (requestAtStart !== readRequestVersion() || saveAtStart !== readSaveRequestVersion()) {
      return revisionOf(updated);
    }
    // 保存成功 = 这份简历"存在了"（0051）：制作台草稿要到这里才出现在简历中心。
    // `draft: false` 显式写上（后端也会这么返回，但旧后端不返回该字段时不能把按钮留在
    // 「保存到简历中心」的形态上）。
    setDetail({ ...updated, draft: false });
    setHtml(rendered);
    // 内容已经落到服务端：overlay 再留着就会"盖住"刚存下去的值。
    overlays.clear();
    resetSuggestions();
    // 刷新广播放在**保存成功之后**：进制作台、点开预览都不该让列表白跑一次请求。
    bumpResumeList();
    message.success(t("workbench.save.content-saved"));
    return revisionOf(updated);
  };

  /**
   * 版式写入的唯一实现（新旧端点共用）。
   *
   * 返回值是保存终态：整体保存要据此决定"内容还走不走"，而老链路只要 boolean。
   * 失败提示只在这里弹一次，调用点只看终态，不重复弹。
   */
  const commitLayoutWithRevision = async (expectedRevision?: number): Promise<SaveOutcome> => {
    if (!detail) return { status: "failed", error: new Error(t("workbench.save.no-record")) };
    if (!layoutDirty) return { status: "unchanged", revision: revisionOf(detail) };
    if (layoutSaving) return { status: "failed", error: null };
    setLayoutSaving(true);
    try {
      const updated =
        expectedRevision === undefined
          ? await updateResumeLayout(detail.id, layout)
          : await saveResumeLayout(detail.id, layout, expectedRevision);
      const nextLayout = layoutFromDetail(updated);
      // 版式 PATCH 返回的 `content` 是 JSON 重新解析出来的**新引用**，但正文一个字节都没变。
      // 直接 `setDetail(updated)` 会让编辑器的"内容换了"守卫命中，把用户还没保存的正文覆盖掉。
      // `draft: false`：版式写入同样让草稿转正（0051）。
      setDetail((prev) => ({
        ...updated,
        content: prev?.content ?? updated.content,
        draft: false,
      }));
      setLayout(nextLayout);
      setSavedLayout(nextLayout);
      setHtml(await render(updated.content, nextLayout));
      bumpResumeList();
      message.success(t("workbench.save.layout-saved"));
      return { status: "saved", revision: revisionOf(updated) };
    } catch (error) {
      // 冲突不进 toast：整体保存会把冲突交给"三选一"浮层；老链路（主预览底部保存）没有
      // 那层 UI，但把它当普通失败提示也够用——用户至少看到"没保存成功"。
      if (isRevisionConflict(error)) return { status: "conflict", currentRevision: null };
      message.error(t("workbench.save.layout-failed"));
      return { status: "failed", error };
    } finally {
      setLayoutSaving(false);
    }
  };

  /**
   * 草稿发布：这份记录还是 draft 时，宿主发一次内容写入把标记清掉（"内容写入即转正"）。
   *
   * `expectedRevision` 缺省 = 老链路无条件写。返回终态的理由同版式：整体保存要消费它。
   */
  const publishDraftWithRevision = async (expectedRevision?: number): Promise<SaveOutcome> => {
    if (!detail) return { status: "failed", error: new Error(t("workbench.save.no-record")) };
    // 已经不是草稿：没什么可发布（按钮本就不会出现，这里只是把契约写清）。
    if (!detail.draft) return { status: "unchanged", revision: revisionOf(detail) };
    try {
      // 纸面上加过的粗体也要一起落库：`merged` 在没有 overlay 时**就是** `detail.content`
      // （同一引用），所以"什么都没改"的路径一个字节都没变。
      const merged = overlays.merge(detail.content) ?? detail.content;
      const updated =
        expectedRevision === undefined
          ? await updateResume(detail.id, merged)
          : await saveResumeContent(detail.id, merged, expectedRevision);
      // 正文一个字节都没变：不重渲染 html（省一次 /render），也**保留 `content` 的旧引用**
      // ——编辑器靠内容签名判断要不要回填，换一个等值的新引用虽不会误判，但没必要。
      const changed = merged !== detail.content;
      if (changed) setHtml(await render(merged, layout));
      setDetail((prev) =>
        prev ? { ...updated, content: merged, draft: false } : { ...updated, draft: false },
      );
      overlays.clear();
      bumpResumeList();
      message.success(t("workbench.draft.published"));
      return { status: "saved", revision: revisionOf(updated) };
    } catch (error) {
      if (isRevisionConflict(error)) return { status: "conflict", currentRevision: null };
      message.error(t("workbench.draft.publish-failed"));
      return { status: "failed", error };
    }
  };

  const adoptLatest = async (latest: ResumeDetail): Promise<void> => {
    const nextLayout = layoutFromDetail(latest);
    // 版式草稿与基线一起换成最新：否则左栏还显示旧模板，下一次保存又会把它写回去。
    setDetail(latest);
    setLayout(nextLayout);
    setSavedLayout(nextLayout);
    // 加粗 overlay 基于旧正文的路径，正文换了就必须作废（否则会盖在别的句子上）。
    overlays.clear();
    setHtml(await render(latest.content, nextLayout));
    resetSuggestions();
  };

  const saveAsCopy = async (content: ResumeContent): Promise<ResumeDetail> => {
    const merged = overlays.merge(content) ?? content;
    const copy = await createManualResume({
      // 标题在宿主持有（`detail.title`）；没加载完时退回正文里的名字，仍保证带（副本）。
      title: t("workbench.conflict.copy.title", {
        title: detail?.title || content.name || "",
      }),
      content: merged,
      draft: false,
    });
    bumpResumeList();
    return copy;
  };

  return {
    saveEditedResume: async (content) => {
      await persistContent(content);
    },
    saveEditedResumeConditional: (content, expectedRevision) =>
      persistContent(content, expectedRevision),
    saveLayout: async () => {
      const outcome = await commitLayoutWithRevision(undefined);
      return outcome.status === "saved" || outcome.status === "unchanged";
    },
    commitLayout: (expectedRevision) => commitLayoutWithRevision(expectedRevision),
    publishDraft: async () => {
      const outcome = await publishDraftWithRevision(undefined);
      return outcome.status === "saved" || outcome.status === "unchanged";
    },
    publishDraftConditional: (expectedRevision) => publishDraftWithRevision(expectedRevision),
    adoptLatest,
    saveAsCopy,
  };
}
