/** 简历微调表单：编辑结构化内容后交由父组件保存并重新渲染。 */
import { SaveOutlined, ImportOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Col,
  Collapse,
  Form,
  Grid,
  Input,
  Modal,
  Row,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ResumeContent } from "../types";
import ResumeWritingPanel from "./ResumeWritingPanel";

interface Props {
  open: boolean;
  content: ResumeContent | null;
  onClose: () => void;
  onSave: (content: ResumeContent) => Promise<void>;
  title?: string;
  description?: string;
  saveLabel?: string;
  referencePanel?: ReactNode;
  /** 从预览点击进入时使用的结构化字段路径，如 projects.0.description.1。 */
  initialTarget?: string | null;
  /** 提供后启用「写作增强」标签页（STAR/润色/翻译/话术，结果回填个人总结）。 */
  resumeId?: number;
  /**
   * 「从我的资料填入」的候选；不传则这条入口完全不渲染。
   *
   * 手写简历会传（"预填之后我又补了一段实习，想加进这份简历"）；编辑已保存简历时不传
   * ——那时用户要的是改这一份，不是从资料里再抓一条进来。
   */
  fillSources?: ProfileFillSources | null;
  /**
   * 是否渲染**条目级**的「从资料填入本条」，默认 `true`。
   *
   * 关掉它（`false`）时，模块顶部的「从我的资料追加一条」照旧可用，只是每个条目头部
   * 不再出现下拉。岗位详情里的「自行编写简历」用它：那份表单的经历/项目是空的，
   * 用户要照着岗位从头写，条目级填入没有可对应的东西。
   */
  entryFill?: boolean;
  /**
   * 「填入我的资料全部数据」（T11）。
   *
   * 提供后头部多一个次按钮：把整份「我的资料」一次性带进表单。手写通用简历会传
   * （它从空白开始，需要一条"要么自己写、要么全部带入"的捷径）；岗位模式与编辑已保存
   * 简历都不传——前者会替用户做决定，后者要的是改这一份而不是换成资料里的内容。
   */
  fillAll?: () => ResumeContent;
}

import {
  EducationEditor,
  ExperienceEditor,
  CampusEditor,
  ProjectEditor,
  SkillEditor,
  AwardEditor,
} from "./resume-editor/ResumeSectionEditors";
import FieldRewritePanel from "./resume-editor/FieldRewritePanel";
import { resolveEditorTarget } from "./resume-editor/ResumeEditorTarget";
import { EDITOR_FIELD_SCROLL_OPTIONS } from "./resume-editor/editorFieldScroll";
import { ProfileFillProvider } from "./resume-editor/profileFillContext";
import { readResumeValueByPath } from "../utils/resumeFieldPath";
import { hasAnyResumeContent } from "../utils/profileToResume";
import type { ProfileFillSources } from "../features/profile/profileFillOptions";
import { useFormShortcutHistory } from "../features/shortcuts/useFormShortcutHistory";
import { layer } from "../theme/tokens";

export default function ResumeEditorModal({
  open,
  content,
  onClose,
  onSave,
  title = "手动调整简历内容",
  description,
  saveLabel = "保存并更新预览",
  referencePanel,
  initialTarget,
  resumeId,
  fillSources,
  entryFill = true,
  fillAll,
}: Props) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<ResumeContent>();
  // `FormInstance<ResumeContent>` 的 setFieldValue 只接受"字面量路径联合"，
  // 而这里的字段名是 `resolveEditorTarget` 算出来的数组。两者本来就是同一个东西
  // （同一份映射），这里做一次显式的类型擦除，比在每个调用点写一遍断言清楚。
  // 用 useCallback 固定引用：它被 tabItems 的 useMemo 依赖，每次渲染换一个新函数会让
  // 整个标签页内容跟着重建。
  const setFormValue = useCallback(
    (name: (string | number)[], value: unknown) =>
      (form.setFieldValue as unknown as (n: (string | number)[], v: unknown) => void)(name, value),
    [form],
  );
  const [saving, setSaving] = useState(false);
  // R5 快捷键：撤回/恢复作用于这份表单（跨标签页也有效），保存等价于点「保存并更新预览」
  // ——两者走同一个 `form.submit()` 入口，不另开保存路径。弹窗没开/正在保存时不接管。
  const formHistory = useFormShortcutHistory(form, {
    onSave: () => form.submit(),
    historyEnabled: open && !saving,
    saveEnabled: open && !saving,
  });
  // `reset` 是稳定引用（useCallback），单独取出来当 effect 依赖：
  // 直接依赖 formHistory 会在 canUndo/canRedo 翻转时重跑下面那个载入 effect。
  const resetFormHistory = formHistory.reset;
  // 未保存守卫（RF-13）：表单被改过且还没保存时，取消/遮罩/ESC 都要先过一道确认，
  // 防止点错一下就把整份编辑丢掉。保存成功即清脏。
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  // AI 改写后的内容快照：表单里只落了被改的那一栏，这里留一份完整内容给面板回显
  // 「当前内容」。父组件的 content 在整个弹窗生命周期里是不变的（保存后才换）。
  const [rewrittenContent, setRewrittenContent] = useState<ResumeContent | null>(null);
  const screens = Grid.useBreakpoint();
  // 是否用"两栏独立滚动"的布局：要有参考栏、且屏幕够宽（窄屏走折叠面板单列）。
  // 这一个布尔值同时决定 body 的滚动方式与 grid 的 class，两者不能各判一遍——
  // 判两次会出现"body 不滚 + grid 不是双栏"的组合，内容是滚不动的。
  const wideLayout = Boolean(referencePanel) && Boolean(screens.lg);

  // 基本信息里只有「个人总结」能从资料填入：姓名、手机、邮箱这些是身份信息，用户可能
  // 就是在这份简历里改过它们，从资料覆盖回去等于把他刚改的抹掉。
  const summarySource = fillSources?.summary?.trim() ?? "";
  // 上下文的值必须稳定：每次渲染新建一个对象会让所有消费它的分区重渲染（表单很大）。
  const fillContextValue = useMemo(
    () =>
      fillSources ? { sources: fillSources, onFilled: () => setDirty(true), entryFill } : null,
    [fillSources, entryFill],
  );

  /**
   * 「填入我的资料全部数据」：整份表单被覆盖，所以先看有没有东西会被冲掉。
   *
   * `getFieldsValue(true)` 取**全部**已注册值而不是当前标签页的：antd 的 Tabs 惰性渲染，
   * 只看当前页会把"教育里已经填好的两条"当成空，于是一声不响地覆盖掉用户的内容。
   */
  const fillAllFromProfile = () => {
    if (!fillAll) return;
    const apply = () => {
      form.setFieldsValue(fillAll() as never);
      setDirty(true);
      formHistory.push();
      message.success("已填入「我的资料」的内容");
    };
    if (!hasAnyResumeContent(form.getFieldsValue(true) as ResumeContent)) {
      apply();
      return;
    }
    modal.confirm({
      title: "将用「我的资料」覆盖当前已填写的内容？",
      okText: "覆盖填入",
      cancelText: "取消",
      onOk: apply,
    });
  };

  // Compiler 规范：随 open/content/initialTarget 变化的回填用渲染期守卫式调整；
  // 表单实例写入与滚动聚焦的定时器副作用留在 effect。
  const [prevSync, setPrevSync] = useState<{
    open: boolean;
    content: ResumeContent | null;
    initialTarget: string | null | undefined;
  } | null>(null);
  if (
    prevSync === null ||
    prevSync.open !== open ||
    prevSync.content !== content ||
    prevSync.initialTarget !== initialTarget
  ) {
    setPrevSync({ open, content, initialTarget });
    if (open && content) {
      setRewrittenContent(null);
      setDirty(false);
      const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
      setActiveTab(target?.tab ?? "basic");
    }
  }

  // 弹窗开着且没保存的修改还在时，挂 beforeunload（照抄 ProfilePage 的模式）：
  // 刷新/关闭浏览器出原生确认，不再静默丢稿。
  useEffect(() => {
    if (!open || !dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge 只认 returnValue，两者都给。
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, dirty]);

  const requestClose = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: "未保存的修改将丢失",
      content: "这份简历还有改动没有保存，确定要关闭吗？",
      okText: "放弃修改",
      cancelText: "继续编辑",
      onOk: () => {
        setDirty(false);
        onClose();
      },
    });
  };

  useEffect(() => {
    if (!open || !content) return;
    form.setFieldsValue(content);
    // 换了/重开了这份简历：历史清空，以刚载入的内容为基线（撤回不该跨简历生效）。
    resetFormHistory();
    const target = initialTarget ? resolveEditorTarget(initialTarget) : null;
    if (!target || target.name.length === 0) return;
    // `scrollMode: "if-needed"`：字段已经在可视区内就别再滚一次——那会把用户正在看的
    // 上下文顶走（尤其两栏布局下光标根本没动，界面却跳了）。
    const scrollOptions = EDITOR_FIELD_SCROLL_OPTIONS;
    let rafId = 0;
    const timer = window.setTimeout(() => {
      form.scrollToField(target.name, scrollOptions);
      const field = form.getFieldInstance(target.name) as { focus?: () => void } | undefined;
      field?.focus?.();
      // 表单刚挂载时行高还没稳定（TextArea 的 autoSize、图片等），第一枪可能落在旧位置。
      // 下一帧补一次：`if-needed` 保证已经对准时它什么也不做。
      rafId = window.requestAnimationFrame(() => {
        form.scrollToField(target.name, scrollOptions);
      });
    });
    return () => {
      window.clearTimeout(timer);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [content, form, initialTarget, open, resetFormHistory]);

  const tabItems = useMemo(
    () => [
      {
        key: "basic",
        label: "基本信息",
        children: (
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="name" label="姓名">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="gender" label="性别">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="birth_year" label="出生年份">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="phone" label="手机">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="city" label="所在城市">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="github" label="GitHub 主页">
                <Input placeholder="https://github.com/用户名" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="personal_website" label="个人主页">
                <Input placeholder="https://example.com" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="job_intent" label="求职意向">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="summary" label="个人总结">
                <Input.TextArea rows={5} />
              </Form.Item>
              {summarySource && (
                <Space size={6} style={{ marginTop: -8, marginBottom: 12 }}>
                  <Tooltip title="把「我的资料」里的个人总结写到这一栏（会覆盖当前内容，可再用撤销前的原文改回）">
                    <Button
                      size="small"
                      icon={<ImportOutlined />}
                      onClick={() => {
                        setFormValue(["summary"], summarySource);
                        setDirty(true);
                      }}
                    >
                      从我的资料填入个人总结
                    </Button>
                  </Tooltip>
                </Space>
              )}
            </Col>
          </Row>
        ),
      },
      { key: "education", label: "教育", children: <EducationEditor /> },
      { key: "experience", label: "实习/工作", children: <ExperienceEditor /> },
      { key: "campus", label: "校园经历", children: <CampusEditor /> },
      { key: "projects", label: "项目", children: <ProjectEditor /> },
      { key: "skills", label: "技能", children: <SkillEditor /> },
      { key: "awards", label: "荣誉", children: <AwardEditor /> },
      ...(resumeId
        ? [
            {
              key: "writing",
              label: "写作增强",
              children: (
                <ResumeWritingPanel
                  resumeId={resumeId}
                  initialText={content?.summary ?? ""}
                  onApply={(text) => form.setFieldValue("summary", text)}
                />
              ),
            },
          ]
        : []),
    ],
    // summarySource 决定「填入个人总结」是否出现；setFormValue 已用 useCallback 固定。
    [resumeId, content, form, summarySource, setFormValue],
  );

  const handleFinish = async (values: ResumeContent) => {
    if (!content) return;
    setSaving(true);
    try {
      // 照片不在本次编辑表单中，始终保留已校验的原始值。
      await onSave({ ...content, ...values, photo: content.photo });
      setDirty(false);
      // 已保存的内容成为新基线：这次编辑不再可撤回（撤回已落库的改动会让人以为没存上）。
      resetFormHistory();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存简历修改失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      width={referencePanel ? "min(1320px, calc(100vw - 24px))" : "min(1000px, calc(100vw - 24px))"}
      // 必须高于宿主弹窗（ResumeDetailModal / GenerateResumeModal）：全局主题把
      // zIndexPopupBase 提到了 3100，宿主 Modal 因此在 3100；这里写死 3110 才能稳稳
      // 盖在宿主之上。旧的 1100 反而比宿主低——编辑器被宿主弹窗整个压住，看起来就是
      // 「手动调整」卡片被挡住了。
      zIndex={layer.editorModal}
      destroyOnHidden
      // 必须垂直居中：body 限高后弹窗总高仍接近满视口，antd 默认 top:100px 会让
      // 底部（保存按钮一带）被推出视口外，看起来就是"弹出的卡片被挡住了"。
      mask={{ closable: !saving }}
      keyboard={!saving}
      onCancel={requestClose}
      footer={
        <Space>
          <Button disabled={saving} onClick={requestClose}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={() => form.submit()}
          >
            {saveLabel}
          </Button>
        </Space>
      }
      styles={{
        // 宽屏 + 岗位参考：**body 不滚**，左右两栏各滚各的（见 styles/resume.css）。
        // 这里必须同时把 body 变成纵向 flex：`height: 100%` 只有在父容器高度确定时才
        // 生效，而 `max-height` 单独一个并不构成确定高度——flex 布局会把剩余高度算给
        // grid，`min-height: 0` 才允许它缩到内容以下、让子栏真正出现滚动条。
        // 窄屏与无参考时保持原来的"整块 body 一起滚"。
        body: wideLayout
          ? {
              maxHeight: "var(--rf-modal-body-max-h)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }
          : { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
    >
      {/* 候选为 null 时这个 Provider 等于不存在：`useProfileFill()` 返回 null，
          各分区据此完全不渲染「从我的资料填入」。 */}
      <ProfileFillProvider value={fillContextValue}>
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
                      label: "查看岗位要求",
                      children: referencePanel,
                    },
                  ]}
                />
              )}
            </div>
          )}
          <div className="resume-editor-main">
            {description && (
              <Typography.Text type="secondary" className="resume-editor-description">
                {description}
              </Typography.Text>
            )}
            {fillAll && (
              <div className="resume-editor-fill-all">
                <Button
                  size="small"
                  icon={<ImportOutlined />}
                  aria-label="填入我的资料全部数据"
                  onClick={fillAllFromProfile}
                >
                  填入我的资料全部数据
                </Button>
              </div>
            )}
            <Form
              form={form}
              layout="vertical"
              onValuesChange={() => {
                setDirty(true);
                formHistory.push();
              }}
              onFinish={(values) => void handleFinish(values as ResumeContent)}
            >
              {/* 从预览点某一栏进来时，先把"按我的要求改这一栏"摆在最上面：
                用户的意图就是改他刚点的那一处，不该让他先自己找到对应标签页。
                写入的是表单值（不落库），仍要点「保存并更新预览」才算改过简历。 */}
              {resumeId && initialTarget && content ? (
                <FieldRewritePanel
                  resumeId={resumeId}
                  content={rewrittenContent ?? content}
                  path={initialTarget}
                  onChange={(next) => {
                    // 只更新被改写的那一栏对应的表单值：整份 setFieldsValue 会把用户
                    // 在这个弹窗里已经手改过、但还没保存的内容一起覆盖掉。
                    //
                    // 表单字段名要与编辑器一致：列表里的某一条要点在表单里是整个数组
                    // （`projects.0.description`），所以按**解析后的字段名**从新内容里取值，
                    // 而不是按原始路径取那一条字符串。
                    const target = resolveEditorTarget(initialTarget);
                    setFormValue(target.name, readResumeValueByPath(next, target.name));
                    setRewrittenContent(next);
                    // AI 填入也是"没保存的修改"：未保存守卫必须同样看住它。
                    setDirty(true);
                  }}
                />
              ) : null}
              <Tabs activeKey={activeTab} items={tabItems} onChange={setActiveTab} />
            </Form>
          </div>
        </div>
      </ProfileFillProvider>
    </Modal>
  );
}
