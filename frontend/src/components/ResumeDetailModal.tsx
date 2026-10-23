// SPDX-License-Identifier: Apache-2.0
/** 简历记录预览弹窗（历史记录用）：加载详情、调整版式、渲染 HTML 后展示。
 *
 * 预览主体已抽到 ``components/resume/ResumeDetailPreview``（B3）：本弹窗只负责
 * 加载 detail/html、错误与骨架屏，以及把「换版式 / 自动一页 / 保存编辑」这些会改
 * 数据与重渲染的动作准备好，交给共享组件渲染。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Alert, App, Button, Modal, Popconfirm, Space, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchResumeHtml,
  fetchResumeTemplates,
  getResume,
  renderResume,
  updateResume,
  updateResumeLayout,
} from "../api/resumes";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../types";
import type { LayoutMeasure } from "../utils/resumeLayoutMeasure";
import { t } from "../i18n";
import { bumpResumeList } from "../features/resume/resumeListEvents";
import { useResumeRelayout } from "../features/resume/useResumeRelayout";
import { useRichTextOverrides } from "../features/resume/useRichTextOverrides";
import type { RichTextEditAdapter } from "./resume-preview/richText";
import ResumeDeliveryInfo from "./resume/ResumeDeliveryInfo";
import ResumeDetailPreview from "./resume/ResumeDetailPreview";
import PageSkeleton from "./common/PageSkeleton";
import type { ResumePreviewHandle } from "./ResumePreview";

interface Props {
  recordId: number | null;
  onClose: () => void;
  /** 打开就进制作台（「新建简历 → 前往简历制作台」）。见 `ResumeDetailPreview`。 */
  autoOpenWorkbench?: boolean;
}

const DEFAULT_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  // 草稿的初始语言：新记录/还没选过时就是中文（后端旧记录同样是中文）。
  language: "zh-CN",
};

export default function ResumeDetailModal({ recordId, onClose, autoOpenWorkbench = false }: Props) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<ResumeLayout>(DEFAULT_LAYOUT);
  const [savedLayout, setSavedLayout] = useState<ResumeLayout>(DEFAULT_LAYOUT);
  const [layoutStatus, setLayoutStatus] = useState<{
    pages: number;
    overflow: boolean;
  } | null>(null);
  const [pdfDirectAvailable, setPdfDirectAvailable] = useState(true);
  const [layoutSaving, setLayoutSaving] = useState(false);
  // 预览量到的实测高度：只有浏览器能量准，所以由预览上报、这里转交给诊断面板。
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const previewRef = useRef<ResumePreviewHandle>(null);
  /**
   * 「右键加粗」的乐观叠加层：把还没保存的粗体记在 `detail.content` 之外（见
   * `useRichTextOverrides` 文件头）。这里是它唯一合适的宿主——只有这一层同时握着
   * `detail.content`、`setHtml` 与保存链路。
   */
  const overlays = useRichTextOverrides(detail?.content ?? null);
  /**
   * 预览用的加粗契约。**这里刻意不重渲染 html**：
   *
   * 纸面上那一栏已经被 `useClickToEditPreview` 就地改过（立刻看到粗体），随后由制作台的实时
   * 预览（合并内容整份重排）或保存后的重渲染收口。若在这里再发一次 `/render`，iframe 会白屏
   * 重载一次，把用户刚恢复的选区一并丢掉——用户的感受是"点加粗，页面闪了一下"。
   */
  const richEdit = useMemo<RichTextEditAdapter | undefined>(() => {
    if (!detail) return undefined;
    return {
      read: (path) => overlays.read(path),
      toggle: (path, next, base) => {
        overlays.apply(path, next, base);
      },
    };
  }, [detail, overlays]);
  /**
   * 版式重排：尾随合并（`useResumeRelayout`，项 6 / D11）。
   *
   * 本地草稿只在**渲染成功之后**推进（`onRendered`），所以"读数已经前进、画面还是旧版式"
   * 这种不一致不可能出现——这正是本项要修掉的既有缺陷（C5 的第一种形态）。
   * 失败时**不重试**、只提示并清掉探针（D13：探针是"我看到的"，渲染失败就不能继续呈现它）。
   */
  const { relayouting, request: requestLayout } = useResumeRelayout({
    render: async (next) => {
      if (!detail) return;
      setHtml(await renderResume(detail.content, next));
    },
    onRendered: (next) => setLayout(next),
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "按新设置重新排版失败");
      previewRef.current?.setLiveProbe("");
    },
  });
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);
  const [suggestionsResetKey, setSuggestionsResetKey] = useState(0);
  const loadedRecordId = useRef<number | null>(null);
  const requestVersion = useRef(0);
  const saveRequestVersion = useRef(0);
  const layoutDirty = JSON.stringify(layout) !== JSON.stringify(savedLayout);
  /**
   * 关闭前的确认卡片（2026-10-24）：排版设置改了没保存时，关窗会把它一起丢掉。
   *
   * 内容那一半不在这里管——「手动调整」子弹窗有自己的守卫（`useResumeEditorPanel` 的
   * 脏值确认），两层各问一句会让用户连点两次才关得掉。
   *
   * 判断写在 `Popconfirm` 的 `onOpenChange` 里而不是按钮的 `onClick` 上：antd 会把
   * `Popconfirm` 自己的 onClick 与子元素的合并，两处各写一份就会"问完又立刻关掉"。
   */
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const handleCloseRequest = (next: boolean) => {
    if (!next) return setCloseConfirmOpen(false);
    if (layoutDirty) setCloseConfirmOpen(true);
    else onClose();
  };
  // 确认后先收起卡片再关：这张卡片住在弹窗里，留着 `open` 的话换一份简历再打开会直接
  // 亮着一张"要不要丢弃"的卡片。
  const confirmClose = () => {
    setCloseConfirmOpen(false);
    onClose();
  };

  // Compiler 规范：随 recordId 变化的重置用渲染期守卫式调整（含首次挂载）；
  // ref 失效递增与异步取数留在 effect。
  const [prevRecordId, setPrevRecordId] = useState<number | null | undefined>(recordId);
  if (prevRecordId !== recordId) {
    setPrevRecordId(recordId);
    setDetail(null);
    setHtml("");
    setError("");
    setLayoutStatus(null);
    // 换一份简历：上一条留下的加粗 overlay 绝不能跟过来（同名字段很可能就是同一句原文）。
    overlays.clear();
    // 换一份简历：上一份留下的"要不要丢弃排版"卡片不能跟过来。
    setCloseConfirmOpen(false);
  }

  useEffect(() => {
    const currentRequest = ++requestVersion.current;
    if (!recordId) return;
    // "上次加载的记录 id"跨渲染比较属于 ref 读写：按规则必须留在 effect 内。
    const isNewRecord = loadedRecordId.current !== recordId;
    loadedRecordId.current = recordId;
    if (isNewRecord) {
      setSuggestionsGenerated(false);
      setSuggestionsResetKey((value) => value + 1);
    }
    void Promise.all([getResume(recordId), fetchResumeHtml(recordId)])
      .then(([data, rendered]) => {
        if (currentRequest !== requestVersion.current) return;
        setDetail(data);
        setHtml(rendered);
        // 版式跟着记录走：上次用的是哪套，这次打开还是哪套。
        const nextLayout = {
          template: data.template || DEFAULT_LAYOUT.template,
          format_name: data.format_name ?? DEFAULT_LAYOUT.format_name,
          // 必须带上按简历的覆盖：后面每次重渲染都从这份 layout 出发，
          // 漏了它就会出现"导出用新方案、预览用旧方案"这种最难看的不一致。
          format_config: data.format_config ?? {},
          page_limit: data.page_limit || DEFAULT_LAYOUT.page_limit,
          font_scale: data.font_scale || DEFAULT_LAYOUT.font_scale,
          // 语言跟着记录走：打开一份英文简历，排版栏里显示的必须是 English。
          language: data.language ?? DEFAULT_LAYOUT.language,
        } satisfies ResumeLayout;
        setLayout(nextLayout);
        setSavedLayout(nextLayout);
      })
      .catch((err) => {
        if (currentRequest === requestVersion.current) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      });
    return () => {
      if (currentRequest === requestVersion.current) requestVersion.current += 1;
    };
  }, [recordId]);

  // 只有第一次打开时才去问后端的模板目录（能不能直接生成 PDF）。
  useEffect(() => {
    void fetchResumeTemplates()
      .then((catalog) => setPdfDirectAvailable(catalog.pdf_direct_available))
      .catch(() => {
        // 取不到目录时仍允许导出，失败会由导出接口给出提示。
      });
  }, []);

  const saveEditedResume = async (content: ResumeContent) => {
    if (!detail) return;
    const requestAtStart = requestVersion.current;
    const saveAtStart = ++saveRequestVersion.current;
    // overlay 里**仍然有效**的那几条叠在表单值上：`base` 对得上的说明用户没在中栏改过这个
    // 字段（改了 base 就变了，overlay 自动失效）。合并只在这一处做，另一处不再重复。
    const merged = overlays.merge(content) ?? content;
    const updated = await updateResume(detail.id, merged);
    if (requestAtStart !== requestVersion.current || saveAtStart !== saveRequestVersion.current) {
      return;
    }
    const rendered = await renderResume(updated.content, layout);
    if (requestAtStart !== requestVersion.current || saveAtStart !== saveRequestVersion.current) {
      return;
    }
    // 保存成功 = 这份简历"存在了"（0051）：制作台草稿要到这里才出现在简历中心。
    // `draft: false` 显式写上（后端也会这么返回，但旧后端不返回该字段时不能把按钮留在
    // 「保存到简历中心」的形态上）。
    setDetail({ ...updated, draft: false });
    setHtml(rendered);
    // 内容已经落到服务端：overlay 再留着就会"盖住"刚存下去的值。
    overlays.clear();
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
    // 刷新广播放在**保存成功之后**：进制作台、点开预览都不该让列表白跑一次请求。
    bumpResumeList();
    message.success("简历修改已保存");
  };

  /**
   * AI 修订（AI 修改 / 采纳建议）成功后的刷新：修订接口已在服务端落库，这里只需
   * 按新内容重渲染预览。旧建议基于修订前的正文，一并重置。
   */
  const applyRevisedDetail = async (updated: ResumeDetail) => {
    const requestAtStart = requestVersion.current;
    const rendered = await renderResume(updated.content, layout);
    if (requestAtStart !== requestVersion.current) return;
    setDetail(updated);
    setHtml(rendered);
    setSuggestionsGenerated(false);
    setSuggestionsResetKey((value) => value + 1);
  };

  /**
   * 「保存到简历中心」（0051）：这份记录还是草稿，而用户什么都没改就点了保存。
   *
   * 实现只发**一次内容 PATCH**——后端"内容写入即转正"，不需要新接口。宿主里另外两个
   * 保存分支（内容 / 版式）都会顺带转正，但它们在"什么都没脏"时一个请求都不发，所以
   * 草稿要现身只能靠这一条。
   */
  const publishDraft = async (): Promise<boolean> => {
    if (!detail) return false;
    // 已经不是草稿：没什么可发布（按钮本就不会出现，这里只是把契约写清）。
    if (!detail.draft) return true;
    try {
      // 纸面上加过的粗体也要一起落库：`merged` 在没有 overlay 时**就是** `detail.content`
      // （同一引用），所以"什么都没改"的路径一个字节都没变。
      const merged = overlays.merge(detail.content) ?? detail.content;
      const updated = await updateResume(detail.id, merged);
      // 正文一个字节都没变：不重渲染 html（省一次 /render），也**保留 `content` 的旧引用**
      // ——编辑器靠内容签名判断要不要回填，换一个等值的新引用虽不会误判，但没必要。
      // 真有 overlay 时就必须换成 `merged` 并重渲染，否则粗体只存在于这一次点击里。
      const changed = merged !== detail.content;
      if (changed) setHtml(await renderResume(merged, layout));
      setDetail((prev) =>
        prev ? { ...updated, content: merged, draft: false } : { ...updated, draft: false },
      );
      overlays.clear();
      bumpResumeList();
      message.success(t("workbench.draft.published"));
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("workbench.draft.publish-failed"));
      return false;
    }
  };

  /**
   * 换模板 / 加页数 / 改字号：**只重排不落库**的是 `requestLayout`，真正写回记录的是本函数
   * （`PATCH /resumes/{id}/layout`）。
   *
   * 返回值是"版式有没有落库"，两个调用点都要用它：底部「保存」按钮不看，制作台顶部的
   * 「保存修改」必须看——它要靠这个结果决定"要不要把版式快照对齐"，而对齐等于告诉用户
   * "已经存上了"。失败提示只在这里弹一次，调用点只看返回值，不重复弹。
   */
  const saveLayout = async (): Promise<boolean> => {
    // 没改动 = 已经与记录一致（对齐快照是安全的）；上一次还在飞则既不能再发，
    // 也不能声称已存——两种情况必须分开，合成一个 `return` 就分不出真假了。
    if (!detail) return false;
    if (!layoutDirty) return true;
    if (layoutSaving) return false;
    setLayoutSaving(true);
    try {
      const updated = await updateResumeLayout(detail.id, layout);
      const nextLayout: ResumeLayout = {
        template: updated.template || layout.template,
        format_name: updated.format_name ?? layout.format_name,
        format_config: updated.format_config ?? layout.format_config ?? {},
        page_limit: updated.page_limit || layout.page_limit,
        font_scale: updated.font_scale || layout.font_scale,
        // 逐字段重建最容易漏这一行：漏了会让本地草稿变回 undefined（界面上显示中文），
        // 与记录里真实的语言不一致——下一次保存又把英文写回中文（§9.1 R1）。
        language: updated.language ?? layout.language,
      };
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
      setHtml(await renderResume(updated.content, nextLayout));
      // 同上：版式保存成功也让草稿转正（用户没改内容、只把版面排好了也算）。
      bumpResumeList();
      message.success("排版设置已保存");
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存排版设置失败");
      return false;
    } finally {
      setLayoutSaving(false);
    }
  };

  const cancelLayout = () => {
    if (!detail || !layoutDirty || relayouting || layoutSaving) return;
    // 走同一条重排通道：草稿在渲染成功后才回到 `savedLayout`（一个宿主只有一套口径）。
    requestLayout(savedLayout);
  };

  return (
    <Modal
      title={
        // 标题行右侧自绘 ×（`closable={false}`）：卡片长在用户刚点的地方，不用把视线
        // 拉到底部去找确认。
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{detail?.title ?? "简历预览"}</span>
          <Popconfirm
            open={closeConfirmOpen}
            onOpenChange={handleCloseRequest}
            title={t("workbench.close.title")}
            description={t("resume.preview.close.body")}
            okText={t("workbench.close.confirm")}
            cancelText={t("common.action.keep-editing")}
            okButtonProps={{ danger: true }}
            onConfirm={confirmClose}
            placement="bottomRight"
          >
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label={t("common.action.close")}
              style={{ marginLeft: "auto" }}
            />
          </Popconfirm>
        </div>
      }
      open={!!recordId}
      onCancel={() => handleCloseRequest(true)}
      // × 由标题行自绘（见上），弹窗自带的那个会和它并排出现两颗。
      closable={false}
      width="min(960px, 96vw)"
      footer={null}
      // 弹窗自身滚动：预览区高度已经与上方内容解耦（见 ResumePreview 的固定预算），
      // 内容再长也只是让这里滚动，不去压缩预览。
      // 正文右缘原本紧贴滚动条（body 自己就是滚动容器，左右内边距为 0）：滚动条一出现
      // 内容就被顶到它边上。右侧留 12px 让两者分开；再用等量的负外边距把这 12px
      // 从弹窗内边距里"借"回来，内容宽度因此一点不变——滚动条整条往弹窗边缘挪
      // 12px，左右看起来也仍然平衡。
      styles={{
        body: {
          maxHeight: "var(--rf-modal-body-max-h)",
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 12,
          marginRight: -12,
        },
      }}
      destroyOnHidden
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : !detail || !html ? (
        <PageSkeleton rows={8} card={false} />
      ) : (
        <>
          {/* 关联上下文（RF-11）：这份简历对着哪个岗位，投递进度与模拟面试都带着
              job_id 直达，不必到对应模块再找一遍岗位。纯 Link 行、零新增请求；
              通用简历（无 job_id）没有这行（预览头部的「通用简历」标签照旧）。 */}
          {detail.job_id ? (
            <Space size={12} wrap style={{ marginBottom: 12 }}>
              <Link to={`/jobs?job_id=${detail.job_id}`}>查看关联岗位</Link>
              <Typography.Text type="secondary">·</Typography.Text>
              <Link to={`/tracker?job_id=${detail.job_id}`}>该岗位的投递进度</Link>
              <Typography.Text type="secondary">·</Typography.Text>
              <Link to={`/interview?job_id=${detail.job_id}`}>模拟面试</Link>
            </Space>
          ) : null}
          {/* 版本信息位（RF-17）：血缘 + 投递记录，弹窗打开时按需拉取一次。 */}
          <div style={{ marginBottom: 12 }}>
            <ResumeDeliveryInfo
              recordId={detail.id}
              parentRevisionId={detail.parent_revision_id ?? null}
            />
          </div>
          <ResumeDetailPreview
            detail={detail}
            html={html}
            layout={layout}
            autoOpenWorkbench={autoOpenWorkbench}
            // 叠加了纸面上加粗的那几条：只给制作台的实时预览用（中栏编辑器仍吃服务端内容）。
            liveContent={overlays.merged ?? undefined}
            // 加粗也是"还没保存的改动"：不并进脏值，关制作台时会静默丢掉。
            richDirty={overlays.dirty}
            onDiscardRichText={overlays.clear}
            richEdit={richEdit}
            layoutStatus={layoutStatus}
            measure={measure}
            pdfDirectAvailable={pdfDirectAvailable}
            relayouting={relayouting}
            previewRef={previewRef}
            onLayoutStatus={setLayoutStatus}
            onMeasure={setMeasure}
            onApplyLayout={(next) => requestLayout(next)}
            // 制作台顶部「保存修改」要落库版式：把这条已有的 PATCH 链路直接交给它。
            // 底部那颗「保存」按钮仍在（定位不同：它只存版式，不动内容），两者共用本函数
            // 内部的 `layoutDirty / layoutSaving` 守卫，谁先点都不会发两次请求。
            onCommitLayout={saveLayout}
            // 草稿且什么都没脏时点「保存到简历中心」：见 `publishDraft`。
            onPublishDraft={publishDraft}
            // 版式 PATCH 在飞时制作台顶部的「保存修改」必须禁用：这条链路此刻返回 `false`
            // （同一时刻不许发两次 PATCH），若按钮还能点，用户会看到"点了、按钮还在、没有提示"，
            // 而内容其实一次都没存。
            layoutSaving={layoutSaving}
            onApplyFittedFormat={(formatConfig) =>
              // 「自动一页」也只写入当前草稿：同一条重排通道，不另开一份"正在重排"口径。
              requestLayout({ ...layout, format_config: formatConfig })
            }
            extraActions={
              layoutDirty ? (
                <Space size={8}>
                  <Button onClick={cancelLayout} disabled={relayouting || layoutSaving}>
                    取消
                  </Button>
                  <Button
                    type="primary"
                    loading={layoutSaving}
                    disabled={relayouting}
                    onClick={() => void saveLayout()}
                  >
                    保存
                  </Button>
                </Space>
              ) : null
            }
            onSaveEditedResume={(content) => saveEditedResume(content)}
            onResumeRevised={(updated) => applyRevisedDetail(updated)}
            suggestionsGenerated={suggestionsGenerated}
            suggestionsResetKey={suggestionsResetKey}
            onSuggestionsGenerated={() => setSuggestionsGenerated(true)}
          />
        </>
      )}
    </Modal>
  );
}
