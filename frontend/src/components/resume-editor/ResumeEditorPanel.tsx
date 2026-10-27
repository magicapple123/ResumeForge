// SPDX-License-Identifier: Apache-2.0
/**
 * 简历内容编辑器的**视图**（草稿条 + Provider + 头部 + 那个唯一的 `<Form>` + 标签页）。
 *
 * 与 `useResumeEditorPanel`（状态机）配对：这个文件只管"长什么样"，判据全在 hook 里。
 *
 * 两个变体：
 *
 * - `variant="modal"`：弹窗形态。说明行、额外头部、岗位参考栏（窄屏折成 Collapse）都渲染，
 *   整块 body 由外面的 `Modal` 负责滚动；
 * - `variant="inline"`：制作台中栏。**没有左右分栏**，也不渲染参考栏——中栏只有
 *   320–400px，再分两栏就什么都不剩。
 *
 * **表单只在这里**。`popupGuard` P1 是文件级文本扫描（同一个文件里既有表单、又有弹层时，
 * 那个弹层必须禁蒙层关闭），把表单关进这个不叫 `*Modal.tsx` 的面板里，宿主弹窗就只需管
 * 自己的壳。**注释里不要写出尖括号形式的标签名**：扫描器读的是原文，写了就会被当成真的
 * 弹层标签（本文件正是这么被误报过一次）。
 */
import { Alert, Button, Collapse, Form, Grid, Space, Tabs } from "antd";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { EditorSchemaOut } from "../../features/profile-library/types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeContent } from "../../types";
import DraftRestoreBar from "../common/DraftRestoreBar";
import EditorHeader from "./EditorHeader";
import EditorTabStrip from "./EditorTabStrip";
import { EditorFieldProvider } from "./editorSchemaContext";
import { ProfileFillProvider } from "./profileFillContext";
import type { ResumeEditorPanelApi } from "./editorPanelTypes";

export interface ResumeEditorPanelProps {
  api: ResumeEditorPanelApi;
  /** 弹窗形态才传：说明行、额外头部、岗位参考栏、`fillAll` 入口。 */
  description?: string;
  headerExtra?: ReactNode;
  referencePanel?: ReactNode;
  onFillAll?: () => void;
  /** `modal` = 弹窗 body（整块滚动）；`inline` = 中栏（Tabs 自己滚，无左右分栏）。 */
  variant: "modal" | "inline";
  /**
   * 表单上方的额外区块（F4：新建简历的「资料来源」面板）。放在 `<Form>` **内部**，
   * 因为区块要写表单值；它自身不注册 Form.Item，不会给提交值添字段。
   */
  sourcePanel?: ReactNode;
  /** F10：当前简历的编辑器视图（板块/字段可见性）；缺省 = 不过滤（旧行为）。 */
  editorSchema?: EditorSchemaOut | null;
  /** 表单对应的服务端内容：「字段有值就保留输入框」的判据用。 */
  editorContent?: ResumeContent | null;
}

export default function ResumeEditorPanel({
  api,
  description,
  headerExtra,
  referencePanel,
  onFillAll,
  variant,
  sourcePanel,
  editorSchema,
  editorContent,
}: ResumeEditorPanelProps) {
  useLocale();
  // "两栏独立滚动"：要有参考栏且屏幕够宽。这一个布尔值同时决定 body 的滚动方式与 grid
  // 的 class——判两次会出现"body 不滚 + grid 不是双栏"，内容是滚不动的。
  // 中栏形态永远不是两栏。
  const screens = Grid.useBreakpoint();
  const wideLayout = variant === "modal" && Boolean(referencePanel) && Boolean(screens.lg);

  // 草稿恢复条：**点了才应用**。恢复后按"未保存的修改"处理——它确实还没落库。
  // `changes` 让用户先看清"恢复会改掉什么"再决定，而不是盲点一个按钮。
  const draftBar = api.draftPending ? (
    <DraftRestoreBar
      savedAt={api.draftPending.savedAt}
      fieldCount={Object.keys(api.draftPending.values).length}
      onRestore={api.restoreDraft}
      onDiscard={api.discardDraft}
      changes={api.draftChanges}
    />
  ) : null;

  // 资料刷新提示（F9/R1）：打开新建简历期间别的窗口改了资料/切了组，而表单里已经有未保存
  // 的改动——不静默覆盖，就地给两个出口。用页内 Alert（不再是第二个弹层/确认框）。
  const profileRefreshBar = api.contentRefreshPending ? (
    <Alert
      className="resume-editor-profile-refresh"
      type="info"
      showIcon
      title={t("editor.profile-refresh.title")}
      description={t("editor.profile-refresh.body")}
      action={
        <Space size={8} wrap>
          <Button size="small" type="primary" onClick={api.applyLatestContent}>
            {t("editor.profile-refresh.apply")}
          </Button>
          <Button size="small" onClick={api.dismissContentRefresh}>
            {t("editor.profile-refresh.keep")}
          </Button>
        </Space>
      }
      style={{ marginBottom: 12 }}
    />
  ) : null;

  // 中栏宽度放不下 8 个栏目：栏目条自绘（`EditorTabStrip`），溢出时才出一颗三角下拉，
  // 且下拉**只列没显示出来的**那几个栏目。弹窗形态不需要它——那里宽度够，antd 自带的
  // 「…」弹层本来就点得动，所以弹窗继续用 antd 自己的标签栏。
  const tabStrip =
    variant === "inline" ? (
      <EditorTabStrip items={api.tabItems} activeKey={api.activeTab} onSelect={api.setActiveTab} />
    ) : null;

  // 中栏的 antd 标签栏只剩内容面板，导航由上面那条自绘栏目条承担（CSS 里把 nav 藏掉）。
  const tabsClassName = variant === "inline" ? "resume-wb-tabs-body" : undefined;

  /**
   * 表单子树 + 页签**整块 memo**（需求 #12）：打字时状态机每帧都会返回一个新的 `api`
   * 对象（脏值、草稿快照等），如果直接在这里重建 `<Form>`/`<Tabs>`，antd 的 Form、
   * 页签导航与 rc-tabs 的指示条都会跟着逐键重渲染——用户感知就是"输入卡顿"。
   *
   * 依赖只放**语义真的会变**的几项：`api.onValuesChange` / `api.onFinish` 已由状态机
   * 用 useCallback 固定，`api.tabItems` 只在板块可见性变化时重建。打字不改变其中任何
   * 一项，于是输入只让"正在编辑的那个 Form.Item"自己重渲染（受控值本来就走这条路）。
   */
  const form = useMemo(
    () => (
      <Form
        form={api.form}
        layout="vertical"
        onValuesChange={api.onValuesChange}
        onFinish={(values) => void api.onFinish(values)}
      >
        {sourcePanel}
        <Tabs
          className={tabsClassName}
          activeKey={api.activeTab}
          items={api.tabItems}
          onChange={api.setActiveTab}
        />
      </Form>
    ),
    // 刻意不依赖整个 api：它每帧都是新对象（脏值/草稿快照），收进来 memo 就永远失效了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      api.form,
      api.onValuesChange,
      api.onFinish,
      api.activeTab,
      api.setActiveTab,
      api.tabItems,
      sourcePanel,
      tabsClassName,
    ],
  );

  // 中栏形态：没有左右分栏，也没有参考栏（见文件头）。
  //
  // 栏目条刻意放在 `form` **外面**：它是粘顶的（`position: sticky`），放在表单内部会被
  // 表单的 re-render 一起重建，滚动时还会被 `Form` 的 wrapper 影响；放在外面它既不受
  // 表单更新影响，也天然成为滚动容器里的第一个壳。
  if (variant === "inline") {
    return (
      <EditorFieldProvider schema={editorSchema ?? undefined} content={editorContent}>
        <ProfileFillProvider value={api.fillContextValue}>
          <div className="resume-editor-inline">
            {draftBar}
            {profileRefreshBar}
            <EditorHeader
              description={description}
              onFillAll={onFillAll}
              headerExtra={headerExtra}
            />
            {tabStrip}
            {form}
          </div>
        </ProfileFillProvider>
      </EditorFieldProvider>
    );
  }

  return (
    <EditorFieldProvider schema={editorSchema ?? undefined} content={editorContent}>
      <ProfileFillProvider value={api.fillContextValue}>
        {draftBar}
        {profileRefreshBar}
        <div
          className={`resume-editor-layout${referencePanel ? " resume-editor-layout--with-reference" : ""}`}
        >
          {referencePanel && (
            <div className="resume-editor-reference">
              {wideLayout ? (
                referencePanel
              ) : (
                <Collapse
                  size="small"
                  items={[
                    {
                      key: "job-reference",
                      label: t("editor.reference.toggle"),
                      children: referencePanel,
                    },
                  ]}
                />
              )}
            </div>
          )}
          <div className="resume-editor-main">
            <EditorHeader
              description={description}
              onFillAll={onFillAll}
              headerExtra={headerExtra}
            />
            {form}
          </div>
        </div>
      </ProfileFillProvider>
    </EditorFieldProvider>
  );
}
