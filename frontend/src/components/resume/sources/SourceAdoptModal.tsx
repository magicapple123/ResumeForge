// SPDX-License-Identifier: Apache-2.0
/**
 * 采纳来源更新并写回正文（W12 / P1-06）。
 *
 * 打开时先读 `GET /sources/{id}/revision-text`：能读到原文就预填并显示修订号；
 * 读不到（如手工来源）则保持空输入并提示用户粘贴。用户编辑后与来源指纹不一致时
 * 给出提示但仍允许提交——由服务端 409 source_revision_stale 兜底（按现有分流展示）。
 */
import { Alert, Button, Input, Modal, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { pt } from "../../../features/resume-provenance/i18n";
import { adoptSourceLink, fetchRevisionText } from "../../../features/resume-provenance/api";
import type {
  FactLockViolationOut,
  RevisionTextViewOut,
  SourceImpactEntryOut,
} from "../../../features/resume-provenance/types";
import { ApiError } from "../../../api/client";

interface Props {
  open: boolean;
  entry: SourceImpactEntryOut | null;
  /** 当前简历 revision（条件写；缺省不伪造）。 */
  expectedRevision?: number;
  onCancel: () => void;
  /** 采纳成功：宿主刷新影响面/来源链。 */
  onAdopted?: (appliedPath: string) => void;
}

const REASON_KEYS: Record<string, Parameters<typeof pt>[0]> = {
  manual_source_has_no_body: "provenance.adopt.reason.manual",
  external_ref_unresolvable: "provenance.adopt.reason.externalRef",
  source_body_not_found: "provenance.adopt.reason.notFound",
  source_body_too_large: "provenance.adopt.reason.tooLarge",
  historical_revision_not_stored: "provenance.adopt.reason.historical",
  no_revision: "provenance.adopt.reason.none",
};

function reasonText(reason: string): string {
  const key = REASON_KEYS[reason];
  return key ? pt(key) : pt("provenance.adopt.reason.unknown");
}

function violationsOf(error: unknown): FactLockViolationOut[] {
  if (!(error instanceof ApiError)) return [];
  const payload = error.payload as { violations?: unknown } | undefined;
  if (!payload || !Array.isArray(payload.violations)) return [];
  return payload.violations as FactLockViolationOut[];
}

export default function SourceAdoptModal({
  open,
  entry,
  expectedRevision,
  onCancel,
  onAdopted,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<FactLockViolationOut[]>([]);
  const [revisionView, setRevisionView] = useState<RevisionTextViewOut | null>(null);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionFailed, setRevisionFailed] = useState(false);
  /** 用户是否已经动过输入框（自动预填不能覆盖用户输入）。 */
  const touchedRef = useRef(false);

  const loadRevisionText = useCallback(async () => {
    if (!entry) return;
    setRevisionLoading(true);
    setRevisionFailed(false);
    setRevisionView(null);
    try {
      const view = await fetchRevisionText(entry.source_id);
      setRevisionView(view);
      if (view.resolvable && !touchedRef.current) setText(view.text);
    } catch {
      setRevisionFailed(true);
    } finally {
      setRevisionLoading(false);
    }
  }, [entry]);

  // effect 只负责"开始取数"：setState 放进 microtask（避免同步级联渲染告警）。
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      touchedRef.current = false;
      setText("");
      setError(null);
      setViolations([]);
      setRevisionView(null);
      void loadRevisionText();
    });
  }, [open, loadRevisionText]);

  const close = () => {
    setText("");
    setError(null);
    setViolations([]);
    setRevisionView(null);
    onCancel();
  };

  const submit = async () => {
    if (!entry || !text.trim()) {
      setError(pt("provenance.adopt.empty"));
      return;
    }
    setSubmitting(true);
    setError(null);
    setViolations([]);
    try {
      const result = await adoptSourceLink(entry.link_id, {
        text: text.trim(),
        path: entry.path,
        ...(typeof expectedRevision === "number" ? { expected_revision: expectedRevision } : {}),
      });
      onAdopted?.(result.applied_path);
      close();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.businessCode === "source_revision_stale") {
          setError(pt("provenance.adopt.stale"));
          return;
        }
        if (caught.businessCode === "resume_revision_conflict") {
          setError(pt("provenance.adopt.revisionConflict"));
          return;
        }
        if (caught.businessCode === "fact_lock_conflict") {
          setViolations(violationsOf(caught));
          setError(pt("provenance.adopt.factLockTitle"));
          return;
        }
      }
      setError(
        caught instanceof Error && caught.message ? caught.message : pt("provenance.adopt.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const mismatch = Boolean(revisionView?.resolvable && text.trim() !== revisionView.text.trim());
  const sourceMismatch = Boolean(
    revisionView?.resolvable && revisionView.fingerprint_matched === false,
  );

  return (
    <Modal
      open={open}
      title={pt("provenance.adopt.title")}
      onCancel={close}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={close} disabled={submitting || undefined}>
          {pt("provenance.adopt.cancel")}
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting || undefined}
          disabled={!text.trim() || undefined}
          onClick={() => void submit()}
        >
          {pt("provenance.adopt.submit")}
        </Button>,
      ]}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pt("provenance.adopt.hint")}
        </Typography.Text>
        {entry ? (
          <Typography.Text code style={{ fontSize: 12 }}>
            {entry.path}
          </Typography.Text>
        ) : null}
        {revisionLoading ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {pt("provenance.adopt.revisionLoading")}
          </Typography.Text>
        ) : null}
        {revisionFailed ? (
          <Alert type="warning" showIcon title={pt("provenance.adopt.revisionLoadFailed")} />
        ) : null}
        {revisionView && !revisionView.resolvable ? (
          <Alert
            type="info"
            showIcon
            title={pt("provenance.adopt.unresolvable")}
            description={reasonText(revisionView.reason)}
          />
        ) : null}
        {revisionView?.resolvable ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {revisionView.revision_no != null
              ? pt("provenance.adopt.revisionText", { no: revisionView.revision_no })
              : pt("provenance.adopt.revisionTextNoNumber")}
          </Typography.Text>
        ) : null}
        {sourceMismatch ? (
          <Alert type="warning" showIcon title={pt("provenance.adopt.sourceFingerprintMismatch")} />
        ) : null}
        {mismatch ? (
          <Alert type="warning" showIcon title={pt("provenance.adopt.fingerprintMismatch")} />
        ) : null}
        {error ? <Alert type="error" showIcon title={error} /> : null}
        {violations.map((violation) => (
          <Alert
            key={violation.lock_id + ":" + violation.path}
            type="warning"
            showIcon
            title={pt("provenance.lock.violationLine", {
              label: violation.label || violation.field,
              locked: violation.locked_value,
              current: violation.current_value,
            })}
            description={pt("provenance.lock.violationReason", { reason: violation.reason })}
          />
        ))}
        <Input.TextArea
          rows={5}
          value={text}
          maxLength={20000}
          showCount
          aria-label={pt("provenance.adopt.text")}
          placeholder={pt("provenance.adopt.textPlaceholder")}
          onChange={(event) => {
            touchedRef.current = true;
            setText(event.target.value);
          }}
        />
      </Space>
    </Modal>
  );
}
