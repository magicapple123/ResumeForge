// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」：左栏排版参数 · 中栏编辑内容 · 右栏看版面，三栏同屏。
 *
 * 为什么不再沿用旧名：改名是为了把它的定位说清——它不止"放大看一遍"，而是**改一句措辞 →
 * 看版面变化 → 再调一个参数**的闭环。外面那份预览塞在列表页里，视口高度只有几百像素、还带
 * 缩放，看不出"这一页排得满不满、分页在哪"；这里换一个大视口重新量一次，页面就是原尺寸。
 *
 * 三个刻意的复用（都不另写第二份实现）：预览仍是同一个 `ResumePreview`
 * （`ResumeWorkbenchCanvas` 里）；中栏的编辑器仍是同一份主体（`ResumeWorkbenchEditorColumn` →
 * `resume-editor/ResumeEditorPanel`）；版式参数仍是同一组控件（`ResumeTemplateControls` /
 * `ResumeMeasureControls`），只是多了两个只在此处出现的分组（间距 / 外观）。
 *
 * 降级是"少一栏"而不是"换一套实现"：没有 `onSaveContent`（生成流程那种只读宿主）→ 中栏不渲染，
 * 退回两栏；`<1280px` 中栏变成覆盖在左栏上的抽屉，`<1000px` 中栏不渲染（内容编辑走「手动调整」）。
 *
 * 2026-10 两处形态变化（都由用户截图驱动，见 `resume-workbench.css`）：**铺满视口**——不再有 12px
 * 留白与圆角外壳（那圈留白会露出遮罩，看起来像一条黑边）；**三栏可拖宽**——宽度状态机与持久化
 * 在 `useWorkbenchColumns`，这里只渲染两条分隔条。
 */
import { Modal } from "antd";
import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResumeTemplateCatalog } from "../../hooks/useResumeTemplateCatalog";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import { t } from "../../i18n";
import ResumeWorkbenchActionBar from "./ResumeWorkbenchActionBar";
import ResumeWorkbenchLiveCanvas, { type RichTextEditAdapter } from "./ResumeWorkbenchLiveCanvas";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";
import WorkbenchPanelsDrawer from "./WorkbenchPanelsDrawer";
import WorkbenchParamsColumn from "./WorkbenchParamsColumn";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";
import {
  useWorkbenchColumns,
  WORKBENCH_KEYBOARD_STEP,
  WORKBENCH_WIDTH_LIMITS,
} from "./useWorkbenchColumns";
import { useWorkbenchOverallSave } from "./useWorkbenchOverallSave";

/**
 * 分隔条的无障碍名。**只剩内容栏那一条**：参数栏自 2026-10-23 起是固定宽（`WORKBENCH_PARAMS_WIDTH`，
 * 用户口径"第一列没必要调整宽度"），没有分隔条可念。
 */
const RESIZER_LABEL_KEY = {
  editor: "workbench.resizer.editor",
} as const;

interface Props {
  open: boolean;
  html: string;
  warnings: string[];
  /** 与记录里的页数上限一致；预览里那几根虚线就是按它切的。 */
  pages: number;
  onClose: () => void;
  /** 版式控件（与主预览同一份状态）：在制作台里也能边走边调。 */
  layout?: ResumeLayout;
  resumeId?: number;
  relayouting?: boolean;
  /** 这份简历有没有照片：没有时照片滑杆禁用并说明原因（与外面的主预览一致）。 */
  hasPhoto?: boolean;
  onApplyLayout?: (next: ResumeLayout) => void;
  /**
   * 版式落库（宿主那条 `PATCH /resumes/{id}/layout`）。`onApplyLayout` 只重排**不落库**，
   * 少了这根线，用户调完参数点「保存修改」就只存了内容。返回 `false` = 没落库。
   * 缺省时退化为"只存内容"：不报错、也不弹"没有保存"（只读宿主没有这条链路很正常）。
   */
  onCommitLayout?: () => Promise<boolean>;
  /**
   * 宿主的版式 PATCH 在飞（底部那颗「保存」点下去之后）。
   *
   * 那段时间里 `onCommitLayout` 会返回 `false`（同一时刻不许发两次 PATCH），顶部「保存修改」
   * 若还能点，用户看到的只是"按钮点不动、界面没变"——内容却一次都没存。所以直接禁用。
   */
  layoutSaving?: boolean;
  onExport?: () => void;
  previewRef?: RefObject<ResumePreviewHandle | null>;
  /**
   * 制作台与主预览**共用同一份口径**（2026-10-21 用户要求）：主预览在草稿，制作台就是
   * 草稿；主预览在精确，制作台就是精确。切换也双向同步。
   */
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 精确预览所需的上下文（与外面的那一份逐字段相同）。 */
  exactPreview?: ExactPreviewOptions;
  /**
   * 中栏编辑：这份简历当前**已保存**的内容。
   *
   * 缺省（或没给 `onSaveContent`）时中栏不渲染——生成流程的只读预览、窄屏都走这条路。
   */
  content?: ResumeContent | null;
  /** 中栏保存：PATCH 后由宿主 setDetail + 重渲染，右栏按新内容重排。 */
  onSaveContent?: (content: ResumeContent) => Promise<void>;
  /**
   * 中栏是否有未保存的内容：宿主据此禁用底部「手动调整」（两个编辑器同时开会在草稿上
   * 互相覆盖，见设计 §9 Q6）。
   */
  onEditorDirtyChange?: (dirty: boolean) => void;
  /**
   * 「从我的资料追加一条」的候选：中栏与「手动调整」弹窗**同一份实现**。
   * `null`（或还没取到资料）时中栏里没有这条入口，其余功能照旧。
   */
  fillSources?: ProfileFillSources | null;
  /**
   * 这份记录还是**制作台草稿**（0051）：没保存过，所以简历中心里还看不到它。
   *
   * 有了它，「保存」就不能只在"有改动"时出现——草稿刚建出来时内容与版式都没动过，
   * 按钮不出现用户就没有任何办法让它进入简历中心（那正是这条需求要消灭的现象）。
   */
  isDraft?: boolean;
  /** 草稿里什么都没脏时点「保存到简历中心」走这条：宿主发一次内容 PATCH 清掉草稿标记。 */
  onPublishDraft?: () => Promise<boolean>;
  richEdit?: RichTextEditAdapter; // 右键加粗契约（右栏纸面用）；不传 = 右键交给浏览器
  liveContent?: ResumeContent | null; // 右栏实时预览吃的正文（叠加了未保存的加粗）
  richDirty?: boolean; // 纸面加粗还没保存：参与脏值与关闭确认
  onDiscardRichText?: () => void; // 丢掉这些 overlay（取消修改 / 放弃并关闭）
  /**
   * 加粗 overlay 的合并函数（宿主的 `overlays.merge`）。
   *
   * 中栏改内容时草稿要先叠上加粗再送预览：不叠的话"在纸面上加了粗、又在编辑器里改了一句话"
   * 会让加粗凭空消失（草稿里没有 overlay）。
   */
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
}

export default function ResumeZoomModal({
  open,
  html,
  warnings,
  pages,
  onClose,
  layout,
  resumeId,
  relayouting = false,
  hasPhoto,
  onApplyLayout,
  onCommitLayout,
  layoutSaving = false,
  onExport,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  content,
  onSaveContent,
  onEditorDirtyChange,
  fillSources,
  isDraft = false,
  onPublishDraft,
  richEdit,
  liveContent,
  richDirty,
  onDiscardRichText,
  mergeLive,
}: Props) {
  // 制作台有自己的预览实例：字号滑块要即时作用在**这一个** iframe 上（调用方给了 ref 就用它）。
  const fallbackPreviewRef = useRef<ResumePreviewHandle>(null);
  const workbenchPreviewRef = previewRef ?? fallbackPreviewRef;
  // 目录**只取一次**，四个分组共用（`useApi` 没有跨实例缓存，各取一次就是四个请求）。
  const { catalog } = useResumeTemplateCatalog();
  /**
   * 中栏 → 右栏的**单向**草稿通道（P0-7）。
   *
   * 在**这一层**创建、只往下传，**这一层自己不订阅**——订阅放在
   * `ResumeWorkbenchLiveCanvas` 那个薄壳里，否则每键输入都会重渲染整个三栏弹窗。
   * 用 `useState` 的惰性初始化（而不是 `useRef(...).current`）：ref 的值不允许在渲染期读取
   * （`react-hooks/refs`），而这里就是要在渲染期把它传给子组件。惰性初始化同样只执行一次，
   * 生命周期跟随弹窗实例：关掉再开是一份新的（不会带上次的残留草稿）。
   */
  const [draftStore] = useState(createResumeDraftStore);
  // 中栏**不再可折叠**（2026-10-23 用户口径："去掉右上角的收起内容栏按钮"）。理由不只是
  // 少一颗按钮：折叠会把中栏整个卸载，那份未保存的草稿只留在 sessionStorage 里，用户回来
  // 时看到的是"上次的改动不见了"。中栏是这一屏的主场，藏起来只会让人找不到它。
  // 中栏脏值同时上报给宿主（底部「手动调整」要用），这里再留一份，好让关闭前的那次
  // 判断（Esc / × / 遮罩）自己就能决定"要不要问"。
  const [editorDirty, setEditorDirty] = useState(false);
  /**
   * 「刚打开这份简历时」的版式快照：左栏每个参数右侧那颗 ↺ 恢复的就是它。
   *
   * 与"随模板"（删掉覆盖、回到模板默认）是**两件事**：用户要的是"我刚才调坏了，
   * 退回我进来时看到的那个样子"。所以这里存的是一份完整 layout，且在每次打开时重取
   * （保存后再打开，基线就是保存后的那一版）。
   */
  const [baseline, setBaseline] = useState<ResumeLayout | null>(layout ?? null);
  const [prevOpenState, setPrevOpenState] = useState(open);
  if (prevOpenState !== open) {
    setPrevOpenState(open);
    if (open) setBaseline(layout ?? null);
  }
  // 保存中：顶部「保存修改」上 loading，同一时刻「取消修改」禁用（避免保存还没落库就先清掉）。
  const [editorSaving, setEditorSaving] = useState(false);
  // 顶部动作条上的两颗按钮靠这个句柄打到中栏的状态机上（表单实例、脏值、内联确认都在那一层）。
  const editorRef = useRef<ResumeWorkbenchEditorHandle>(null);
  // 「有没有改动 / 保存 / 取消 / 就地确认」全在 hook 里：脏值有三个来源（中栏内容 + 左栏版式 +
  // 纸面加粗）。加粗必须并进 `editorDirty`——`save()` 只有看到它才会去点中栏的保存。
  const { dirty, layoutDirty, saving, save, cancel, discardConfirm, setDiscardConfirm } =
    useWorkbenchOverallSave({
      open,
      layout,
      editorDirty: editorDirty || Boolean(richDirty),
      isDraft,
      editorRef,
      onApplyLayout,
      onCommitLayout,
      onPublishDraft,
    });
  // 「点纸面字段 → 定位中栏输入框」。每次点击换新对象（`nonce` 自增）：同一条路径连点两次
  // 引用也会变，中栏那条 effect 才会重新滚一遍并聚焦（只比路径的话第二次点击毫无反应）。
  const [pickTarget, setPickTarget] = useState<{ path: string; nonce: number } | null>(null);
  const handlePickField = (path: string) =>
    setPickTarget((previous) => ({ path, nonce: (previous?.nonce ?? 0) + 1 }));
  // 三栏宽度：拖动 / 键盘 / 复位 / 持久化都在这个 hook 里（渲染仍归这个文件）。
  const {
    containerRef: bodyRef,
    style: bodyStyle,
    widths,
    draggingKind,
    startDrag,
    nudge,
    reset: resetWidths,
  } = useWorkbenchColumns();
  const editorEnabled = Boolean(onSaveContent);
  /**
   * 三档形态。判据是**弹窗体自己的宽**——2026-10 起制作台铺满视口（`.ant-modal-body`
   * 的宽度就等于视口宽，见 `resume-workbench.css` 的"外壳"段），所以这里用视口媒体查询
   * 与 CSS 侧 `@container wb (max-width: …)` 得到的是同一个数，不需要第二份阈值。
   *
   * 三个档位（方案 §4.5.6）：
   *   three → 参数常驻 + 内容常驻；two → 参数常驻 + 内容进抽屉；one → 画布独占 + 两个抽屉。
   * jsdom 的 `matchMedia` 桩恒 false ⇒ 三栏，既有断言的 DOM 一字不变。
   */
  const twoColumn = useMediaQuery("(max-width: 1280px)");
  const oneColumn = useMediaQuery("(max-width: 1000px)");
  const tier: "three" | "two" | "one" = oneColumn ? "one" : twoColumn ? "two" : "three";
  /** 两个抽屉互斥（同一个状态）：768 宽时两个 378 会把画布全盖住。 */
  const [openPanel, setOpenPanel] = useState<"params" | "content" | null>(null);
  const hasSettings = Boolean(layout && onApplyLayout);
  const showParamsColumn = hasSettings && tier !== "one";
  const showEditorColumn = editorEnabled && tier === "three";
  // 内容栏不在栅格里时，纸面点击也要能把用户带到输入框：先开抽屉再定位。
  const pickFromPaper = (path: string) => {
    if (!showEditorColumn) setOpenPanel("content");
    handlePickField(path);
  };
  const handleEditorDirty = useCallback(
    (dirty: boolean) => {
      setEditorDirty(dirty);
      onEditorDirtyChange?.(dirty);
    },
    [onEditorDirtyChange],
  );

  // 有**任何**改动（内容脏 / 版式与快照不同 / 纸面加粗）→ 先问一句；否则直接关。
  // 确认卡片长在动作条最右那颗 × 上：用户按的是关闭，卡片就该在那儿展开（Esc 与遮罩同一条路）。
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  /**
   * 关闭前要不要问一句：除了"有改动"，**草稿本身**也要问——那份记录还没进过简历中心，
   * 关掉等于把它扔掉，而这时 `dirty` 是 false，只按脏值判断会静默丢弃。
   */
  const needsCloseConfirm = dirty || isDraft || Boolean(richDirty);
  // 判断只写在这里、不写在按钮的 `onClick` 上：antd 会把 `Popconfirm` 自己的 onClick 与
  // 子元素的 onClick 合并，两处各写一份就会出现"问完又立刻关掉"或"关了卡片还亮着"。
  const handleCloseRequest = (next: boolean) => {
    if (!next) return setCloseConfirmOpen(false);
    if (needsCloseConfirm) setCloseConfirmOpen(true);
    else onClose();
  };
  const handleCancel = () => handleCloseRequest(true);
  /** 「放弃并关闭」：丢掉中栏未保存的内容与纸面加粗，再关（否则下次打开会冒出已放弃的改动）。 */
  const confirmDiscardAndClose = () => {
    editorRef.current?.discard();
    onDiscardRichText?.();
    setCloseConfirmOpen(false);
    onClose();
  };
  /** 取消修改：内容回填 + 版式回滚（在 `cancel` 里）+ 丢掉纸面加粗（overlay 不在编辑器里）。 */
  const cancelAll = () => {
    onDiscardRichText?.();
    cancel();
  };
  // 描述跟着"丢什么"走：只说"没保存"会让用户猜不出丢的是内容还是排版。
  const closeBody =
    layoutDirty && editorDirty
      ? "workbench.actionbar.discard.close-body"
      : layoutDirty
        ? "workbench.actionbar.discard.close-layout"
        : dirty
          ? "workbench.close.body-content"
          : "workbench.close.body-draft";

  /**
   * 内容栏的分隔条。**参数栏没有**：它是固定宽（用户口径"第一列没必要调整宽度"），
   * 给一条拖不动的分隔条只会让人以为坏了。
   *
   * 只在中栏可见时渲染；`<1280px` / `<1000px` 两档由 CSS 直接 `display: none`
   * （既不占布局，也不进 Tab 序列）。
   */
  const resizer = () => {
    // 栏位常量写死在这里而不是当参数传：参数栏没有分隔条之后，"可传的值"只剩一个，
    // 留一个 `kind` 参数只会让人以为还有第二条（`RESIZER_LABEL_KEY` 也只剩一个键）。
    const kind = "editor" as const;
    return (
      <div
        key={kind}
        className={`resume-wb-resizer${draggingKind === kind ? " is-dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t(RESIZER_LABEL_KEY[kind])}
        aria-valuenow={widths[kind]}
        aria-valuemin={WORKBENCH_WIDTH_LIMITS[kind].min}
        aria-valuemax={WORKBENCH_WIDTH_LIMITS[kind].max}
        tabIndex={0}
        onMouseDown={(event) => startDrag(kind, event)}
        onDoubleClick={resetWidths}
        onKeyDown={(event) => {
          // 只有左右方向键有意义（分隔条是竖直的）；`preventDefault` 挡住页面横向滚动。
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudge(kind, -WORKBENCH_KEYBOARD_STEP);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            nudge(kind, WORKBENCH_KEYBOARD_STEP);
          }
        }}
      />
    );
  };

  const paramsColumn = hasSettings ? (
    <WorkbenchParamsColumn
      layout={layout as ResumeLayout}
      baseline={baseline ?? (layout as ResumeLayout)}
      relayouting={relayouting}
      catalog={catalog}
      hasPhoto={hasPhoto}
      previewRef={workbenchPreviewRef}
      tier={tier}
      editorEnabled={editorEnabled}
      onChange={onApplyLayout as (next: ResumeLayout) => void}
    />
  ) : null;

  /**
   * 内容栏本体：三栏时常驻中栏，两栏/单栏时搬进抽屉。
   * 只写一份 JSX —— 两处各写一遍必然分叉（隐藏动作条、pickTarget 这些细节很容易漏）。
   */
  const editorColumn = editorEnabled ? (
    <div className="resume-wb-col resume-wb-col-editor">
      <ResumeWorkbenchEditorColumn
        ref={editorRef}
        active
        content={content ?? null}
        resumeId={resumeId}
        fillSources={fillSources}
        relayouting={relayouting}
        onSave={onSaveContent as (next: ResumeContent) => Promise<void>}
        onDirtyChange={handleEditorDirty}
        onSavingChange={setEditorSaving}
        // 只上行：中栏把草稿写进 store，右栏订阅它；`content` 永远是服务端那一份。
        draftStore={draftStore}
        // 点右栏纸面上的字段 → 这一栏切标签页 + 滚到对应输入框并聚焦。
        pickTarget={pickTarget}
        // 底部不再有一对局部的保存/取消：整屏顶部那一对是**整体**的（内容 + 排版），
        // 两对并排放着，用户得先猜"这两颗管的是不是同一件事"。
        hideActions
      />
    </div>
  ) : null;

  return (
    <Modal
      // 标题节点**就是**动作条：56px 一行放"名字 + 保存/取消 + 导出"，关掉默认 header 的
      // 内边距与关闭按钮位置（见 resume-workbench.css 的 `.resume-zoom-workbench-wrap`）。
      title={
        // 标题节点**就是**动作条（实现见 `ResumeWorkbenchActionBar`）：56px 一行放
        // "名字 + 保存/取消 + 导出 + ×"，关掉默认 header 的内边距与关闭按钮位置
        // （见 resume-workbench.css 的 `.resume-zoom-workbench-wrap`）。
        <ResumeWorkbenchActionBar
          resumeName={content?.name}
          editorEnabled={editorEnabled}
          dirty={dirty || Boolean(richDirty)}
          isDraft={isDraft}
          layoutSaving={layoutSaving}
          editorSaving={editorSaving}
          saving={saving}
          discardConfirm={discardConfirm}
          closeConfirmOpen={closeConfirmOpen}
          closeBody={closeBody}
          onSave={() => void save()}
          onRequestDiscardConfirm={setDiscardConfirm}
          onDiscard={cancelAll}
          onExport={onExport}
          // 两栏及以下：内容栏不在栅格里，必须给一个入口（否则「编辑内容」不可达）。
          onOpenContent={
            editorEnabled && tier !== "three" ? () => setOpenPanel("content") : undefined
          }
          // 单栏：参数栏也不在栅格里了。
          onOpenParams={hasSettings && tier === "one" ? () => setOpenPanel("params") : undefined}
          onCloseRequest={handleCloseRequest}
          onCloseConfirmed={confirmDiscardAndClose}
        />
      }
      open={open}
      onCancel={handleCancel}
      // 关闭按钮改由动作条最右那颗自绘 × 承担（它自带就地确认卡片，见上）。
      closable={false}
      // 有写入请求的弹层必须显式禁蒙层关闭：误点遮罩丢掉一整屏未保存的编辑代价太大。
      mask={{ closable: false }}
      // 动作区在标题行（导出），没有底部按钮组——写 `footer` 而不是省略，是为了让
      // `popupGuard` P2（"Modal 必须自带 footer 或 okText"）看得到这个决定。
      footer={null}
      // 铺满视口：宽度用 `100%`（= wrapper 的宽度，不含滚动条）而不是 `100vw`——后者把
      // 竖向滚动条的宽度也算进去，横向会多出十几像素溢出。`padding: 0` 必须显式写：
      // antd 给 `.ant-modal` 的 `padding-bottom: 24px` 会让底部露出遮罩（又一条"黑边"）。
      width="100%"
      style={{ top: 0, height: "100dvh", maxWidth: "none", margin: 0, padding: 0 }}
      classNames={{ wrapper: "resume-zoom-workbench-wrap" }}
      styles={{
        wrapper: { inset: 0, display: "flex", alignItems: "stretch", overflow: "hidden" },
        container: {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxHeight: "100%",
          margin: 0,
          padding: 0,
          overflow: "hidden",
        },
        header: { flex: "0 0 auto", marginBottom: 0 },
        body: {
          display: "flex",
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "hidden",
          padding: 0,
        },
      }}
      destroyOnHidden
    >
      <div
        ref={bodyRef}
        style={bodyStyle}
        className={`resume-wb-body${hasSettings ? "" : " is-preview-only"}${
          editorEnabled ? "" : " is-editor-hidden"
        }`}
      >
        {showParamsColumn ? paramsColumn : null}
        {showEditorColumn ? editorColumn : null}
        {showEditorColumn ? resizer() : null}
        <div className="resume-wb-col resume-wb-col-canvas">
          <ResumeWorkbenchLiveCanvas
            html={html}
            warnings={warnings}
            pages={pages}
            previewRef={workbenchPreviewRef}
            previewMode={previewMode}
            onPreviewModeChange={onPreviewModeChange}
            exactPreview={exactPreview}
            // 勾上「草稿模式编辑」后，右栏纸面点哪里，中栏就跳到哪一栏的输入框。
            onPickField={editorEnabled ? pickFromPaper : undefined}
            // 实时预览：中栏一改右栏就重排；保存期间让路给宿主返回的 html。
            // 优先级在画布里定：草稿（叠加加粗）→ 这里这一版（宿主已保存 / 已加粗）。
            content={liveContent ?? content ?? null}
            draftStore={draftStore}
            mergeLive={mergeLive}
            layout={layout}
            richEdit={richEdit}
            suspended={saving || editorSaving}
          />
        </div>
      </div>
      <WorkbenchPanelsDrawer
        openPanel={openPanel}
        onClose={() => setOpenPanel(null)}
        editorEnabled={editorEnabled}
        hasSettings={hasSettings}
        editor={editorColumn}
        params={paramsColumn}
      />
    </Modal>
  );
}
