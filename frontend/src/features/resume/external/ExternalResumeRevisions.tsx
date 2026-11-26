// SPDX-License-Identifier: Apache-2.0
/**
 * 详情抽屉「历史版本」页签（#5）：每次上传 / 编辑 / 恢复都是一条版本，时间倒序。
 *
 * ## 恢复的语义必须是"再写一条"，不是"回到过去删掉后来"
 *
 * 恢复 = 后端以那条版本的字节再存一份新 `user_file` + 一条 `source=restore` 的版本。
 * 历史本身不改写，所以列表会**变长**（多一条"恢复到第 N 版"），这是真实发生过的事。
 * 界面据此刷新列表，而不是把被恢复的那条标记成当前 —— 只有最新一条才带「当前版本」。
 *
 * ## 列表不显示正文
 *
 * 版本行只有时间 / 字数 / 有无文字 / 来源：外部简历的正文可能有几万字，全列出来既慢又
 * 没法读。要看具体内容，恢复之后在「文本」页签里看（那是当前版本）。
 */
import { Alert, Button, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listExternalResumeRevisions, restoreExternalResumeRevision } from "../../../api/externalResumes";
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
import { formatDateTime } from "../../../utils/format";
import { revisionSourceKey } from "./blockGeometry";

export interface ExternalResumeRevisionsProps {
  resumeId: number;
  /** 恢复成功：外层用返回的详情替换当前记录（`file_id` 变了）。 */
  onRestored: (next: ExternalResumeDetail) => void;
}

export function ExternalResumeRevisions({ resumeId, onRestored }: ExternalResumeRevisionsProps) {
  useLocale();
  const [revisions, setRevisions] = useState<RevisionList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [restored, setRestored] = useState(false);
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
  }, [resumeId, refreshToken]);

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
      {revisions.items.map((revision) => (
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
                key="restore"
                size="small"
                data-testid={`external-restore-${revision.id}`}
                disabled={revision.current}
                loading={restoringId === revision.id}
                onClick={() => void restore(revision)}
              >
                {t("externalEdit.revisions.restore")}
              </Button>,
            ]}
          >
            <Space size={8} wrap>
              <Typography.Text strong>{formatDateTime(revision.created_at)}</Typography.Text>
              <Typography.Text type="secondary">
                {t("externalEdit.revisions.chars", { count: revision.text_chars })}
              </Typography.Text>
              <Typography.Text type={revision.has_text ? "secondary" : "warning"}>
                {revision.has_text
                  ? t("externalEdit.revisions.hasText")
                  : t("externalEdit.revisions.noText")}
              </Typography.Text>
              <Tag>{t(revisionSourceKey(revision.source))}</Tag>
              {revision.current ? (
                <Tag color="blue">{t("externalEdit.revisions.current")}</Tag>
              ) : null}
            </Space>
          </ListyItem>
        </div>
      ))}
    </Space>
  );
}

export default ExternalResumeRevisions;
