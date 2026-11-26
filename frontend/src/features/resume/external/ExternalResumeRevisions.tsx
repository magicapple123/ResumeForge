// SPDX-License-Identifier: Apache-2.0
/**
 * 详情弹层「历史版本」页签（T12 / R9-6 / R11）：每条版本都能预览、能看差异，恢复要二次确认。
 *
 * ## 恢复的语义必须是"再写一条"，不是"回到过去删掉后来"
 *
 * 恢复 = 后端以那条版本的字节再存一份新 `user_file` + 一条 `source=restore` 的版本。
 * 历史本身不改写，所以列表会**变长**（多一条"恢复到第 N 版"），这是真实发生过的事。
 * 因为是"写操作"，点一下就执行太轻了：先二次确认，并把"会新增一条版本、历史不消失"
 * 写在确认框里（`revisions.confirmBody`）。
 *
 * ## 四条修正（R11 / R9-6）
 *
 * 1. `refreshKey` 进 effect 依赖：编辑只改 `record.file_id`，antd Tabs 又不卸载非激活面板，
 *    不刷新的话刚生成的那版根本不出现、「当前版本」还标在上一版上。
 * 2. 版本行加「预览」：后端 `GET /file?revision_id=` 早就支持，点开就在行下展开那一版的
 *    原件，不动当前版本；当前版本禁用（它就在「原件」页签里）。
 * 3. 恢复的二次确认（见上）。
 * 4. 「比上一版 ±N 字」：列表时间倒序，"上一版"就是下一条；最老的一版写「首版」。
 *
 * ## 列表不显示正文
 *
 * 版本行只有时间 / 字数 / 有无文字 / 来源 / 差异：外部简历的正文可能有几万字，全列出来
 * 既慢又没法读。要看内容就预览原件，或恢复之后在「文本」页签里看。
 */
import { Alert, Button, Popconfirm, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { externalResumeFileUrl, listExternalResumeRevisions, restoreExternalResumeRevision } from "../../../api/externalResumes";
import type {
  ExternalResumeDetail,
  ExternalResumeRevision,
  ExternalResumeRevisions as RevisionList,
} from "../../../api/externalResumes";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { ListyItem } from "../../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../../components/common/listyPadding";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { fileKindOf } from "../../../utils/fileKind";
import { formatDateTime } from "../../../utils/format";
import {
  formatCharDelta,
  revisionDiffChars,
  revisionSourceKey,
} from "./blockGeometry";
import { ExternalOriginalPreview } from "./ExternalOriginalPreview";
import { ExternalRevisionCompare } from "./ExternalRevisionCompare";
import "./externalPreview.css";
import "./externalRevisionDiff.css";

export interface ExternalResumeRevisionsProps {
  resumeId: number;
  /** 当前详情：预览某一版时要借它的文件名与格式判断怎么渲染。 */
  record: ExternalResumeDetail;
  /** 外部变更信号（如 `record.file_id`）：编辑后新版本要立刻出现在首位并标「当前」。 */
  refreshKey?: string | number;
  /** 恢复成功：外层用返回的详情替换当前记录（`file_id` 变了）。 */
  onRestored: (next: ExternalResumeDetail) => void;
  /**
   * 选中某一版（T12）：外层据此把「原件」页签的预览与「文本」页签的内容都切到这一版，
   * 并在详情顶部出一条"正在看历史版本"的提示。不传时只是本页签内的预览。
   */
  onViewVersion?: (revision: ExternalResumeRevision) => void;
  /** 从外部指定要展开的那一版（深链 / 恢复后保持定位）。 */
  initialRevisionId?: number;
}

/** 行下展开的那块面板：一次只开一个，两种形态（原件预览 / 正文对比）。 */
type OpenPane = { kind: "preview" | "compare"; id: number } | null;

export function ExternalResumeRevisions({
  resumeId,
  record,
  refreshKey,
  onRestored,
  onViewVersion,
  initialRevisionId,
}: ExternalResumeRevisionsProps) {
  useLocale();
  const [revisions, setRevisions] = useState<RevisionList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [restored, setRestored] = useState(false);
  const [pane, setPane] = useState<OpenPane>(
    initialRevisionId === undefined ? null : { kind: "preview", id: initialRevisionId },
  );
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listExternalResumeRevisions(resumeId)
      .then((next) => {
        if (cancelled) return;
        setRevisions(next);
        setError("");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setRevisions(null);
        setError(caught instanceof Error ? caught.message : t("externalEdit.revisions.failed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `refreshKey` 必须在依赖里：编辑/恢复只改 record.file_id，面板又不会重新挂载。
  }, [resumeId, refreshKey, refreshToken]);

  const restore = useCallback(
    async (revision: ExternalResumeRevision) => {
      setRestoringId(revision.id);
      setActionError("");
      setRestored(false);
      try {
        const result = await restoreExternalResumeRevision(resumeId, revision.id);
        onRestored(result.resume);
        setRestored(true);
        setRefreshToken((value) => value + 1);
      } catch (caught: unknown) {
        setActionError(caught instanceof Error ? caught.message : t("externalEdit.revisions.restoreFailed"));
      } finally {
        setRestoringId(null);
      }
    },
    [resumeId, onRestored],
  );

  if (loading && revisions === null) return <LoadingBlock tip={t("externalEdit.revisions.loading")} />;
  if (error) {
    return (
      <ErrorState
        description={error}
        onRetry={() => setRefreshToken((value) => value + 1)}
        retryLabel={t("common.retry")}
      />
    );
  }
  if (revisions === null || revisions.items.length === 0) {
    return <Alert data-testid="external-revisions-empty" type="info" showIcon title={t("externalEdit.revisions.empty")} />;
  }

  const previewable = fileKindOf(record.mime, record.name) === "pdf";
  /**
   * 「当前版本」只标在**最新那一行**上。
   *
   * `current` 是后端按 `revision.file_id === row.file_id` 算的；恢复会把简历指回某个
   * 旧版本的文件，于是"被恢复的那一行"和"新写的那一行"file_id 相同、都算 current——
   * 界面上一排三个「当前版本」标签（实测）。列表是新在前的，所以取第一条就够。
   * 其余同字节的行改标「内容同当前版本」，别让用户以为有三个当前版本。
   */
  const newestCurrentId = revisions.items.find((item) => item.current)?.id ?? null;

  /** 打开行下面板：一次只开一个；点同一行的同一个按钮 = 收起。 */
  const togglePane = (kind: "preview" | "compare", id: number) => {
    setPane((current) => (current?.kind === kind && current.id === id ? null : { kind, id }));
  };

  /**
   * 「预览」同时通知外层把「原件 / 文本」两个页签切到这一版（T12）。
   * 不通知的话，"预览"只是本页签里的一小块，"内容"仍停在当前版本上——用户会以为没生效。
   */
  const openPreview = (revision: ExternalResumeRevision) => {
    togglePane("preview", revision.id);
    onViewVersion?.(revision);
  };

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }} data-testid="external-revisions">
      {restored ? (
        <Alert data-testid="external-restored" type="success" showIcon title={t("externalEdit.revisions.restored")} />
      ) : null}
      {actionError ? (
        <Alert
          data-testid="external-restore-error"
          type="error"
          showIcon
          title={t("externalEdit.revisions.restoreFailed")}
          description={actionError}
        />
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("externalEdit.revisions.previewHint")}
      </Typography.Text>
      {revisions.items.map((revision, index) => {
        const delta = revisionDiffChars(revisions.items, index);
        const showPreview = pane?.kind === "preview" && pane.id === revision.id;
        const showCompare = pane?.kind === "compare" && pane.id === revision.id;
        return (
          <div
            key={revision.id}
            data-testid={`external-revision-${revision.id}`}
            style={{ borderBottom: "1px solid var(--rf-border)" }}
          >
            {/* 行外壳走 `ListyItem`（antd 的 `List` 已弃用），密度用项目统一的 small 档。 */}
            <ListyItem
              style={LISTY_ITEM_PADDING_SMALL}
              actions={[
                <Button
                  key="preview"
                  size="small"
                  data-testid={`external-preview-${revision.id}`}
                  disabled={revision.current}
                  title={
                    revision.current
                      ? t("externalEdit.revisions.previewCurrentHint")
                      : t("externalEdit.revisions.previewHint")
                  }
                  onClick={() => openPreview(revision)}
                >
                  {t("externalEdit.revisions.preview")}
                </Button>,
                <Button
                  key="compare"
                  size="small"
                  data-testid={`external-compare-${revision.id}`}
                  disabled={revision.current}
                  title={
                    revision.current
                      ? t("externalEdit.revisions.previewCurrentHint")
                      : t("externalEdit.revisions.compareHint")
                  }
                  onClick={() => togglePane("compare", revision.id)}
                >
                  {t("externalEdit.revisions.compare")}
                </Button>,
                <Popconfirm
                  key="restore"
                  title={t("externalEdit.revisions.confirmTitle")}
                  description={t("externalEdit.revisions.confirmBody")}
                  okText={t("externalEdit.revisions.confirmOk")}
                  cancelText={t("externalEdit.revisions.confirmCancel")}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void restore(revision)}
                >
                  <Button
                    size="small"
                    data-testid={`external-restore-${revision.id}`}
                    disabled={revision.current}
                    loading={restoringId === revision.id}
                  >
                    {t("externalEdit.revisions.restore")}
                  </Button>
                </Popconfirm>,
              ]}
            >
              <Space size={8} wrap>
                <Typography.Text strong>{formatDateTime(revision.created_at)}</Typography.Text>
                <Typography.Text type="secondary">
                  {t("externalEdit.revisions.chars", { count: revision.text_chars })}
                </Typography.Text>
                <Typography.Text type="secondary" className="rf-ext-revision-diff">
                  {delta === null
                    ? t("externalEdit.revisions.first")
                    : t("externalEdit.revisions.diff", { delta: formatCharDelta(delta) })}
                </Typography.Text>
                <Typography.Text type={revision.has_text ? "secondary" : "warning"}>
                  {revision.has_text
                    ? t("externalEdit.revisions.hasText")
                    : t("externalEdit.revisions.noText")}
                </Typography.Text>
                <Tag>{t(revisionSourceKey(revision.source))}</Tag>
                {revision.id === newestCurrentId ? (
                  <Tag color="blue">{t("externalEdit.revisions.current")}</Tag>
                ) : revision.current ? (
                  <Tag>{t("externalEdit.revisions.sameFile")}</Tag>
                ) : null}
              </Space>
            </ListyItem>
            {showPreview ? (
              <div className="rf-ext-revision-preview" data-testid={`external-preview-pane-${revision.id}`}>
                {previewable ? (
                  <ExternalOriginalPreview
                    record={{ ...record, file_id: revision.file_id }}
                    revisionId={revision.id}
                  />
                ) : (
                  <Space orientation="vertical" size={8} style={{ padding: 12 }}>
                    <Alert type="info" showIcon title={t("externalEdit.revisions.previewUnsupported")} />
                    {/* 第三个参数 `download` = 让后端把 `Content-Disposition` 换成 attachment：
                        这一支本来就说"非 PDF 历史文件不做在线预览"，点了是要存盘，不是在新标签页里
                        再撞一次"打不开"。（T28 加的入参，旧调用点不传即保持 inline，向后兼容。） */}
                    <Button
                      size="small"
                      href={externalResumeFileUrl(resumeId, revision.id, true)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("resumesPage.external.downloadOriginal")}
                    </Button>
                  </Space>
                )}
              </div>
            ) : null}
            {showCompare ? (
              <ExternalRevisionCompare
                resumeId={resumeId}
                revision={revision}
                currentText={record.text}
              />
            ) : null}
          </div>
        );
      })}
    </Space>
  );
}

export default ExternalResumeRevisions;
