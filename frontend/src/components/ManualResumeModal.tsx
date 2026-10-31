// SPDX-License-Identifier: Apache-2.0
/**
 * 用户手写简历弹窗（F4）：初始内容与候选**只来自当前组投影**（v2 文档）。
 *
 * 2026-10-30 文档模型 v2：弹窗内嵌的编辑器从 v1 ResumeEditorModal 换成 v2 DocumentEditor；
 * projection.data.content 已是 v2 ResumeDocument（经 normalizeDocument 收口），保存时
 * createManualResume 直接提交 v2 content。岗位模式只覆盖求职意向（见 profileToResume）。
 *
 * 保留：简历名称、岗位参考栏、资料来源页签、保存、「前往简历制作台（草稿）」、快照过期提示。
 * 已移除：v1 草稿条/自动重同步/fillSources 逐条填入（v2 编辑器链没有这些机制；「从资料填入」
 * 由独立 ProfileFillMenu 承担，本弹窗的初始内容已整份来自投影）。
 */
import { App, Button, Input, Modal, Space, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createManualResume } from "../api/resumes";
import { useCurrentProjection } from "../features/profile-library/useCurrentProjection";
import { bumpResumeList } from "../features/resume/resumeListEvents";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { getSnapshot } from "../i18n/localeStore";
import type { Job, ProfileCreationContext, ResumeDocument, ResumeLanguage } from "../types";
import { projectionToResumeDocument } from "../utils/profileToResume";
import { layer } from "../theme/tokens";
import LoadingBlock from "./common/LoadingBlock";
import JobRequirementPanel from "./JobRequirementPanel";
import DocumentEditor from "./resume-editor/DocumentEditor";
import ResumeLanguageSelect from "./resume/ResumeLanguageSelect";

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
  const [document, setDocument] = useState<ResumeDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startingInWorkbench, setStartingInWorkbench] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // 开/关时的状态归位（同步 setState 用渲染期守卫）：每次打开都从新的投影开始。
  const [prevOpen, setPrevOpen] = useState<boolean | null>(null);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setTitle(initialTitle);
      setCreationLanguage(getSnapshot().locale);
      setDocument(null);
      setDirty(false);
      setConfirmingClose(false);
    }
  }

  // 投影内容 -> 合法 v2 文档（岗位模式覆盖求职意向）。资料在别的窗口被改 → 未编辑时自动
  // 重同步；已编辑时保留用户的修改（不在未保存时静默覆盖）。
  const baseDocument = useMemo<ResumeDocument | null>(
    () => (projection.data ? projectionToResumeDocument(projection.data, job) : null),
    [job, projection.data],
  );
  const [syncedBase, setSyncedBase] = useState<ResumeDocument | null>(null);
  if (baseDocument !== syncedBase) {
    setSyncedBase(baseDocument);
    if (baseDocument && (!document || !dirty)) {
      setDocument(baseDocument);
      setDirty(false);
    }
  }

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

  const handleCreateFailure = (error: unknown): void => {
    const code = (error as { businessCode?: string } | null)?.businessCode;
    if (code === "profile_snapshot_stale") {
      projection.reload();
      message.error(t("resume.manual.snapshot-stale"));
      return;
    }
    message.error(error instanceof Error ? error.message : String(error));
  };

  const save = async () => {
    if (!document || saving) return;
    setSaving(true);
    try {
      await createManualResume({
        job_id: job?.id ?? null,
        title: job ? "" : title.trim(),
        content: document,
        language: creationLanguage,
        profile_context: profileContext,
      });
    } catch (error) {
      handleCreateFailure(error);
      return;
    } finally {
      setSaving(false);
    }
    bumpResumeList();
    message.success(job ? t("resume.manual.saved.job") : t("resume.manual.saved.general"));
    onClose();
  };

  /** 「前往简历制作台」：用当前内容建一份草稿；有未保存修改时不可用（会丢那些修改）。 */
  const startInWorkbench = async () => {
    if (!document || dirty || startingInWorkbench || !onOpenWorkbench) return;
    setStartingInWorkbench(true);
    try {
      const created = await createManualResume({
        job_id: job?.id ?? null,
        title: job ? "" : title.trim(),
        content: document,
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

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const switchGroup = () => {
    onClose();
    navigate("/profile");
  };

  const loading = open && projection.loading && !projection.data;
  const failed =
    open && projection.loading === false && projection.error !== null && !projection.data;

  const footer = confirmingClose ? (
    <Space size={8} wrap>
      <Typography.Text type="warning">{t("resume.manual.unsaved")}</Typography.Text>
      <Button onClick={() => setConfirmingClose(false)}>{t("resume.manual.keep-editing")}</Button>
      <Button danger onClick={onClose}>
        {t("resume.manual.discard-close")}
      </Button>
    </Space>
  ) : (
    <Space size={8} wrap>
      {onOpenWorkbench ? (
        <Tooltip title={dirty ? t("resume.manual.workbench-blocked") : undefined}>
          <span>
            <Button
              disabled={dirty || undefined}
              loading={startingInWorkbench}
              onClick={() => void startInWorkbench()}
            >
              {t("workbench.action.open-from-new")}
            </Button>
          </span>
        </Tooltip>
      ) : null}
      <ResumeLanguageSelect
        value={creationLanguage}
        onChange={setCreationLanguage}
        disabled={saving}
      />
      <Button onClick={requestClose} disabled={saving}>
        {t("resume.manual.close")}
      </Button>
      <Button type="primary" loading={saving} onClick={() => void save()}>
        {t("resume.manual.save")}
      </Button>
    </Space>
  );

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
      <Modal
        open={open && !loading && !failed && !!document}
        title={
          job
            ? t("resume.manual.title.job", { title: job.title })
            : t("resume.manual.title.general")
        }
        width={job ? "min(1320px, calc(100vw - 24px))" : "min(1000px, calc(100vw - 24px))"}
        zIndex={layer.editorModal}
        destroyOnHidden
        mask={{ closable: false }}
        keyboard={!saving}
        onCancel={requestClose}
        footer={footer}
        styles={{
          body: {
            maxHeight: "var(--rf-modal-body-max-h)",
            overflowY: "auto",
            overflowX: "hidden",
          },
        }}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {job ? t("resume.manual.description.job") : t("resume.manual.description.general")}
        </Typography.Paragraph>
        {job ? null : (
          <Input
            aria-label={t("resume.manual.name.aria")}
            value={title}
            maxLength={64}
            placeholder={t("resume.manual.name.placeholder")}
            onChange={(event) => setTitle(event.target.value)}
            style={{ maxWidth: 360, marginBottom: 12 }}
          />
        )}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {document ? (
              <DocumentEditor
                document={document}
                onChange={(next) => {
                  setDocument(next);
                  setDirty(true);
                }}
              />
            ) : null}
          </div>
          {job ? (
            <div style={{ width: 320, flex: "0 0 auto" }}>
              <JobRequirementPanel job={job} />
            </div>
          ) : projection.data ? (
            // 资料来源：v2 里只读展示当前组投影的分区清单（v1 ProfileSourceTabs 依赖 v1
            // content 字段，已随 v1 编辑器链删除；逐条/整份填入不在新建弹窗里）。
            <div style={{ width: 320, flex: "0 0 auto" }}>
              <Typography.Text strong>{t("editor.sources.title")}</Typography.Text>
              <ul style={{ paddingLeft: 18, margin: "8px 0 12px" }}>
                {projection.data.source_layout.map((section) => (
                  <li key={section.section_key}>
                    {section.section_name}
                    {section.entry_count > 0 ? " · " + section.entry_count : ""}
                  </li>
                ))}
              </ul>
              <Button size="small" onClick={switchGroup}>
                {t("profileLibrary.empty.switchGroup")}
              </Button>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
