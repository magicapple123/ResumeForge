// SPDX-License-Identifier: Apache-2.0
/**
 * 用户手写简历弹窗（F4）：初始内容与候选**只来自当前组投影**。
 *
 * - **初始内容 = 当前组投影内容**（F9/R1）：岗位模式只额外把求职意向覆盖成岗位名；
 *   通用模式同样预填——"新建简历里的大字段/小字段信息与我的资料当前组同步"。
 * - 编辑器页签随当前组参与清单过滤（参与清单搭在 fillSources 上，见 profileFillOptions）。
 * - 打开期间别的窗口改资料/切组：未编辑则自动重同步；已编辑则编辑器内联提示二选一
 *   （不静默覆盖用户的输入，见 `useEditorContentSync`）。
 * - 「资料来源」面板由投影的 `source_layout` 驱动（7/13 个分区），不提供选组器（R-27），
 *   只给「去切换组」跳资料页；逐条/整份填入都不改已有正文（R-34）。
 * - 新建简历里的修改**不回写资料**：保存只写这份简历记录。
 * - 投影读取失败可重试；不阻塞其它入口（失败时给「重新读取 / 关闭」）。
 */
import { App, Button, Input, Modal, Space, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createManualResume } from "../api/resumes";
import { buildProfileFillSources } from "../features/profile/profileFillOptions";
import { useCurrentProjection } from "../features/profile-library/useCurrentProjection";
import { bumpResumeList } from "../features/resume/resumeListEvents";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { getSnapshot } from "../i18n/localeStore";
import type { Job, ProfileCreationContext, ResumeContent, ResumeLanguage } from "../types";
import { projectionToResumeContent } from "../utils/profileToResume";
import LoadingBlock from "./common/LoadingBlock";
import JobRequirementPanel from "./JobRequirementPanel";
import ResumeEditorModal from "./ResumeEditorModal";
import ProfileSourceTabs from "./resume-editor/profileSourceTabs";

interface Props {
  /** null 表示从头编写**通用简历**（不关联任何岗位）。 */
  job: Job | null;
  open: boolean;
  /** 通用简历的初始名称，留空则由后端按「姓名-自定义简历-时间」命名。 */
  initialTitle?: string;
  onClose: () => void;
  /** 「前往简历制作台」：拿到新建简历的 id 后由宿主打开详情页里的制作台。 */
  onOpenWorkbench?: (resumeId: number) => void;
}

export default function ManualResumeModal({
  job,
  open,
  initialTitle = "",
  onClose,
  onOpenWorkbench,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const projection = useCurrentProjection(open);
  const [title, setTitle] = useState(initialTitle);
  const [creationLanguage, setCreationLanguage] = useState<ResumeLanguage>(getSnapshot().locale);
  const [startingInWorkbench, setStartingInWorkbench] = useState(false);
  /** 编辑器里有没有未保存的修改（"前往简历制作台"用初始内容建草稿，脏时不能用）。 */
  const [editorDirty, setEditorDirty] = useState(false);

  // 开/关时的状态归位（Compiler 规范：同步 setState 用渲染期守卫，放在 effect 外）。
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null);
  if (prevOpen !== open) {
    setPrevOpen(open);
    // 每次打开都从初始名称重新开始：上一次改了一半的名字不该留到下一份简历。
    if (open) {
      setTitle(initialTitle);
      setCreationLanguage(getSnapshot().locale);
    }
  }

  /**
   * 初始内容 = **当前组投影内容**（F9/R1，两种模式一致）。
   *
   * 岗位模式只额外覆盖求职意向（"我要投这个岗位"是这一次新建的意图，资料里那份可能不同）；
   * 其余字段逐字来自服务端投影——前端不再有第二份"岗位模式留空哪些模块"的规则。
   * 用户在这个弹窗里的修改只写进新建的简历记录，**不回写资料**。
   */
  const content = useMemo<ResumeContent | null>(
    () => (projection.data ? projectionToResumeContent(projection.data, job) : null),
    [job, projection.data],
  );

  // 「从资料填入本条」的候选：服务端投影 candidates（当前组），value 是 content 现成条目。
  const fillSources = useMemo(
    () => (projection.data ? buildProfileFillSources(projection.data) : null),
    [projection.data],
  );

  /**
   * 创建态快照（F4-BE）：把这次打开面板时看到的投影 token 与来源布局一起交给服务端。
   * token 与保存时不一致 → 409 profile_snapshot_stale（服务端拒绝用旧组数据建简历）。
   */
  const profileContext = useMemo<ProfileCreationContext | undefined>(() => {
    if (!projection.data) return undefined;
    return {
      snapshot_token: projection.data.snapshot_token,
      participating_keys: projection.data.scope.participating_keys,
      layout: projection.data.source_layout.map((section) => ({
        section_key: section.section_key,
        section_name: section.section_name,
        entry_count: section.entry_count,
      })),
    };
  }, [projection.data]);

  /** 创建失败：快照过期要引导"重新打开面板"，其余错误如实显示后端原因。 */
  const handleCreateFailure = (error: unknown): void => {
    const code = (error as { businessCode?: string } | null)?.businessCode;
    if (code === "profile_snapshot_stale") {
      projection.reload();
      message.error(t("resume.manual.snapshot-stale"));
      return;
    }
    message.error(error instanceof Error ? error.message : String(error));
  };

  const save = async (nextContent: ResumeContent) => {
    try {
      await createManualResume({
        job_id: job?.id ?? null,
        title: job ? "" : title.trim(),
        content: nextContent,
        language: creationLanguage,
        profile_context: profileContext,
      });
    } catch (error) {
      handleCreateFailure(error);
      throw error;
    }
    // T12：保存成功就广播。列表由订阅方各自重取。
    bumpResumeList();
    message.success(job ? t("resume.manual.saved.job") : t("resume.manual.saved.general"));
  };

  /**
   * 「前往简历制作台」：用**初始内容**建一份草稿，然后让宿主打开制作台。
   *
   * 建的是**草稿**（0051）：用户在制作台里保存过才出现在简历中心，所以这里不广播列表刷新。
   */
  const startInWorkbench = async () => {
    // 脏值时按钮已禁用；这里再判一次，避免将来有第二个入口绕过禁用把改动丢掉。
    if (!content || startingInWorkbench || editorDirty || !onOpenWorkbench) return;
    setStartingInWorkbench(true);
    try {
      const created = await createManualResume({
        job_id: job?.id ?? null,
        title: job ? "" : title.trim(),
        content,
        draft: true,
        language: creationLanguage,
        profile_context: profileContext,
      });
      onOpenWorkbench(created.id);
    } catch (error) {
      handleCreateFailure(error);
    } finally {
      setStartingInWorkbench(false);
    }
  };

  /** 「去切换组」：不选组、只跳资料页（R-27 同口径）。 */
  const switchGroup = () => {
    onClose();
    navigate("/profile");
  };

  const loading = open && projection.loading && !projection.data;
  const failed = open && !projection.loading && projection.error !== null && !projection.data;

  return (
    <>
      <Modal open={loading} footer={null} closable={false} mask={{ closable: false }}>
        <div style={{ textAlign: "center", padding: "28px 0" }}>
          <LoadingBlock />
          <div style={{ marginTop: 12 }}>{t("resume.manual.loading")}</div>
        </div>
      </Modal>
      <Modal
        open={failed}
        title={t("editor.sources.title")}
        footer={null}
        closable={false}
        mask={{ closable: false }}
        onCancel={onClose}
      >
        <Typography.Paragraph>{t("resume.manual.load-failed")}</Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {projection.error?.message}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" onClick={() => projection.reload()}>
            {t("resume.manual.retry")}
          </Button>
          <Button onClick={onClose}>{t("resume.manual.close")}</Button>
        </Space>
      </Modal>
      <ResumeEditorModal
        open={open && !loading && !failed && !!content}
        content={content}
        title={
          job
            ? t("resume.manual.title.job", { title: job.title })
            : t("resume.manual.title.general")
        }
        // 打开期间资料被别的窗口改掉：未编辑自动重同步、已编辑内联提示（不静默覆盖）。
        deferRefreshWhenDirty
        onDirtyChange={setEditorDirty}
        // 草稿作用域必须带岗位维度：这里不传 resumeId，只按 id 分槽会让所有岗位共用
        // resume.edit#new——在岗位 A 放弃修改后打开岗位 B，B 会看到 A 的草稿。
        draftScopeKey={job ? `resume.edit#new@job-${job.id}` : undefined}
        headerExtra={
          job ? undefined : (
            <Input
              aria-label={t("resume.manual.name.aria")}
              value={title}
              maxLength={64}
              placeholder={t("resume.manual.name.placeholder")}
              onChange={(event) => setTitle(event.target.value)}
              style={{ maxWidth: 360, marginBottom: 12 }}
            />
          )
        }
        description={
          job ? t("resume.manual.description.job") : t("resume.manual.description.general")
        }
        saveLabel={t("resume.manual.save")}
        referencePanel={job ? <JobRequirementPanel job={job} /> : undefined}
        fillSources={fillSources}
        // T11：通用模式才给「重新带入全部」；数据来自当前组投影（服务端确定性纸面内容）。
        fillAll={
          job || !projection.data
            ? undefined
            : () =>
                projectionToResumeContent(projection.data as NonNullable<typeof projection.data>)
        }
        sourcePanel={
          projection.data ? (
            <ProfileSourceTabs projection={projection.data} onSwitchGroup={switchGroup} />
          ) : undefined
        }
        footerExtra={
          onOpenWorkbench ? (
            // 这条入口用的是**初始内容**（不是表单里的编辑）：有未保存修改时点了会丢改动，
            // 所以脏时就地禁用并说明原因（功能提示必须用 Tooltip 而不是原生 title）。
            <Tooltip title={editorDirty ? t("resume.manual.workbench-blocked") : undefined}>
              <span>
                <Button
                  disabled={editorDirty || undefined}
                  loading={startingInWorkbench}
                  onClick={() => void startInWorkbench()}
                >
                  {t("workbench.action.open-from-new")}
                </Button>
              </span>
            </Tooltip>
          ) : undefined
        }
        onClose={onClose}
        onSave={save}
      />
    </>
  );
}
