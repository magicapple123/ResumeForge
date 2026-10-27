// SPDX-License-Identifier: Apache-2.0
/**
 * 从一段资料草拟台账条目：粘贴 → 生成草稿 → 逐条核对 → 保存。
 *
 * 草稿一律带「待确认」状态入库，所以这里的核对环节不是走过场：用户至少要看一眼
 * 原始事实有没有被曲解。候选表述允许就地改，因为那是最常需要调整的一栏。
 */
import { App, Button, Checkbox, Input, Modal, Select, Space, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { useState } from "react";
import { createClaim, draftClaims } from "../../api/claims";
import { t } from "../../i18n";
import { CLAIM_CATEGORY_LABEL_KEYS } from "../../i18n/enum/claims";
import { useLocale } from "../../i18n/i18nContext";
import type { Claim, ClaimDraftPayload, ClaimPayload } from "../../types";
import { CLAIM_CATEGORIES } from "../../types";

/**
 * 一行草稿。可提交的内容单独放在 `payload` 里，而不是把 UI 状态（勾选、行号）混进
 * payload 再"提交时抠掉"——那样早晚会漏抠一个字段。
 */
interface DraftRow {
  key: number;
  checked: boolean;
  payload: ClaimPayload;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (claims: Claim[]) => void;
}

export default function ClaimDraftModal({ open, onClose, onSaved }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [rawText, setRawText] = useState("");
  // i18n-ok: 分类兜底值是提交后端的协议值
  const [category, setCategory] = useState<ClaimDraftPayload["category"]>("项目经历");
  const [subject, setSubject] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setRows([]);
    setNotes([]);
  };

  const generate = async () => {
    if (!rawText.trim()) {
      message.warning(t("claimDraftModal.toast.pasteFirst"));
      return;
    }
    setBusy(true);
    try {
      const result = await draftClaims({ category, subject, raw_text: rawText });
      setRows(result.drafts.map((payload, index) => ({ key: index, checked: true, payload })));
      setNotes(result.notes);
      if (result.drafts.length === 0) message.info(t("claimDraftModal.toast.noDrafts"));
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("claimDraftModal.error.generateFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  /** 改可提交的内容。 */
  const update = (key: number, patch: Partial<ClaimPayload>) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, payload: { ...row.payload, ...patch } } : row,
      ),
    );
  };

  /** 改这一行的勾选状态（属于界面状态，不进 payload）。 */
  const toggle = (key: number, checked: boolean) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, checked } : row)));
  };

  const save = async () => {
    const picked = rows.filter((row) => row.checked);
    if (picked.length === 0) {
      message.warning(t("claimDraftModal.toast.pickAtLeastOne"));
      return;
    }
    setBusy(true);
    try {
      const saved: Claim[] = [];
      for (const row of picked) {
        saved.push(await createClaim(row.payload));
      }
      message.success(t("claimDraftModal.toast.saved", { count: saved.length }));
      onSaved(saved);
      reset();
      onClose();
    } catch (error) {
      // 中途失败时已保存的条目仍然有效，如实说清数量，不要假装整批成功或整批失败。
      message.error(error instanceof Error ? error.message : t("claimDraftModal.error.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("claimDraftModal.title")}
      width={760}
      onCancel={() => {
        reset();
        onClose();
      }}
      // 草稿一多（每条三行输入框）就超出视口：限高让弹窗在内部滚动，底部按钮始终可见。
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      footer={
        <Space>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("common.action.cancel")}
          </Button>
          {rows.length > 0 && (
            <Button type="primary" loading={busy} onClick={() => void save()}>
              {t("claimDraftModal.action.saveSelected", {
                count: rows.filter((row) => row.checked).length,
              })}
            </Button>
          )}
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">{t("claimDraftModal.intro")}</Typography.Text>
        <Space size={12}>
          <Select
            value={category}
            onChange={setCategory}
            style={{ width: 160 }}
            options={CLAIM_CATEGORIES.map((value) => ({
              value,
              label: t(CLAIM_CATEGORY_LABEL_KEYS[value]),
            }))}
          />
          <Input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t("claimDraftModal.placeholder.subject")}
            style={{ width: 260 }}
          />
        </Space>
        <Input.TextArea
          rows={6}
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder={t("claimDraftModal.placeholder.rawText")}
        />
        <Button type="primary" loading={busy} onClick={() => void generate()}>
          {t("claimDraftModal.action.generate")}
        </Button>

        {notes.map((note) => (
          <Typography.Text key={note} type="secondary">
            · {note}
          </Typography.Text>
        ))}

        {rows.length === 0 ? (
          <EmptyState inline description={t("claimDraftModal.empty.noDrafts")} />
        ) : (
          <div className="claim-draft-list">
            {rows.map((row) => (
              <div key={row.key} className="claim-draft-row">
                <Checkbox
                  checked={row.checked}
                  onChange={(event) => toggle(row.key, event.target.checked)}
                />
                <div className="claim-draft-fields">
                  <Input
                    value={row.payload.title}
                    onChange={(event) => update(row.key, { title: event.target.value })}
                    placeholder={t("claimDraftModal.placeholder.title")}
                    maxLength={200}
                  />
                  <Input.TextArea
                    rows={2}
                    value={row.payload.source_fact}
                    onChange={(event) => update(row.key, { source_fact: event.target.value })}
                    placeholder={t("claimDraftModal.placeholder.sourceFact")}
                  />
                  <Input.TextArea
                    rows={2}
                    value={row.payload.candidate_wording}
                    onChange={(event) => update(row.key, { candidate_wording: event.target.value })}
                    placeholder={t("claimDraftModal.placeholder.candidateWording")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Space>
    </Modal>
  );
}
