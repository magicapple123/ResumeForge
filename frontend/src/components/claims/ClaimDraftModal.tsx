// SPDX-License-Identifier: Apache-2.0
/**
 * 从一段资料草拟台账条目：粘贴 → 生成草稿 → 逐条核对 → 保存。
 *
 * 草稿一律带「待确认」状态入库，所以这里的核对环节不是走过场：用户至少要看一眼
 * 原始事实有没有被曲解。候选表述允许就地改，因为那是最常需要调整的一栏。
 */
import { App, Button, Checkbox, Input, Modal, Popconfirm, Select, Space, Typography } from "antd";
import { useRef, useState } from "react";
import EmptyState from "../common/EmptyState";
import { createClaim, draftClaims } from "../../api/claims";
import { useApi } from "../../hooks/useApi";
import {
  buildClaimEntryGroups,
  claimCategoryForSection,
  claimSubjectForEntry,
  entryToClaimText,
  findClaimEntry,
} from "../../features/claims/entryOptions";
import { getWorkspace } from "../../features/profile-library/api";
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
  // 「生成过」与「生成出 0 条」是两种状态：只有前者为真时，0 条才值得显示空态；
  // 打开弹窗还没点生成时什么都不该显示。
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState(false);

  // P3：从资料库选一条，把原文 / 主体 / 分类预填进来（纯前端，不改后端协议）。
  const workspace = useApi(() => getWorkspace(), [open], { enabled: open });
  const entryGroups = buildClaimEntryGroups(workspace.data);
  const [entryId, setEntryId] = useState<string | undefined>(undefined);
  // 待确认的替换：用户改过内容后再选另一条资料，不能静默覆盖。
  const [pendingEntryId, setPendingEntryId] = useState<string | undefined>(undefined);
  // 上一次由"选资料"写入的三段值；用来区分"用户手改过"与"什么都没动"。
  const lastApplied = useRef<{ rawText: string; subject: string; category: string } | null>(null);

  const reset = () => {
    setRows([]);
    setNotes([]);
    // 必须一起清掉：否则关掉再开会立刻说「没提取到事实」，把一次正常启动说成失败。
    setGenerated(false);
    setEntryId(undefined);
    setPendingEntryId(undefined);
    lastApplied.current = null;
  };

  /** 把选中的资料写进表单（原文按板块字段拼好，主体 / 分类预填，用户仍可改）。 */
  const applyEntry = (pickedId: string) => {
    const found = findClaimEntry(workspace.data, pickedId);
    if (!found) return;
    const nextRawText = entryToClaimText(found.section, found.entry) || rawText;
    const nextSubject = claimSubjectForEntry(found.section, found.entry) || subject;
    const nextCategory = claimCategoryForSection(found.section.key);
    setRawText(nextRawText);
    setSubject(nextSubject);
    setCategory(nextCategory);
    setEntryId(pickedId);
    lastApplied.current = {
      rawText: nextRawText,
      subject: nextSubject,
      category: nextCategory,
    };
  };

  /** 用户是否在选资料之后又手动改过（没选过资料时，只要填过东西就算改过）。 */
  const hasManualEdits = () => {
    const applied = lastApplied.current;
    if (!applied) return Boolean(rawText.trim() || subject.trim());
    return (
      rawText !== applied.rawText || subject !== applied.subject || category !== applied.category
    );
  };

  const pickEntry = (pickedId: string | undefined) => {
    if (!pickedId) {
      setEntryId(undefined);
      return;
    }
    if (hasManualEdits()) {
      setPendingEntryId(pickedId);
      return;
    }
    applyEntry(pickedId);
  };

  const confirmReplace = () => {
    const pickedId = pendingEntryId;
    setPendingEntryId(undefined);
    if (pickedId) applyEntry(pickedId);
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
      setGenerated(true);
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
          {/* 主操作随阶段切换：没草稿时是「生成草稿」，有草稿时才是「保存选中」。
              两者都放 footer，用户不用回正文里找下一步。 */}
          {rows.length > 0 ? (
            <Button type="primary" loading={busy} onClick={() => void save()}>
              {t("claimDraftModal.action.saveSelected", {
                count: rows.filter((row) => row.checked).length,
              })}
            </Button>
          ) : (
            <Button type="primary" loading={busy} onClick={() => void generate()}>
              {t("claimDraftModal.action.generate")}
            </Button>
          )}
        </Space>
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">{t("claimDraftModal.intro")}</Typography.Text>
        {/* P3：真的从资料库选一条，而不是让用户自己复制粘贴。选中的内容进 raw_text 后
            仍可编辑；再选另一条会覆盖原文/主体/类别，所以必须先确认。 */}
        <div className="claim-draft-field">
          <label className="claim-draft-label" htmlFor="claim-draft-entry">
            <Typography.Text type="secondary">
              {t("claimDraftModal.label.fromProfile")}
            </Typography.Text>
          </label>
          <Popconfirm
            open={pendingEntryId !== undefined}
            title={t("claimDraftModal.replaceEntry.confirm")}
            description={t("claimDraftModal.replaceEntry.note")}
            okText={t("claimDraftModal.replaceEntry.action")}
            cancelText={t("common.action.cancel")}
            onConfirm={confirmReplace}
            onCancel={() => setPendingEntryId(undefined)}
          >
            <Select
              id="claim-draft-entry"
              allowClear
              showSearch
              optionFilterProp="label"
              value={entryId}
              onChange={(value) => pickEntry(value as string | undefined)}
              options={entryGroups}
              placeholder={t("claimDraftModal.placeholder.fromProfile")}
              loading={workspace.loading}
              disabled={Boolean(workspace.error) || undefined}
              style={{ width: "100%" }}
              notFoundContent={
                !workspace.loading && entryGroups.length === 0
                  ? t("claimDraftModal.fromProfile.empty")
                  : undefined
              }
            />
          </Popconfirm>
          {workspace.error && (
            <Typography.Text type="danger">
              {t("claimDraftModal.fromProfile.loadFailed")}
            </Typography.Text>
          )}
        </div>
        {/* 标签各占一行：只有 placeholder 的话，一旦输入就再也看不出这一栏是什么。 */}
        <div className="claim-draft-input-row">
          <div className="claim-draft-field claim-draft-field--fixed">
            <label className="claim-draft-label" htmlFor="claim-draft-category">
              <Typography.Text type="secondary">
                {t("claimDraftModal.label.category")}
              </Typography.Text>
            </label>
            <Select
              id="claim-draft-category"
              value={category}
              onChange={setCategory}
              style={{ width: "100%" }}
              options={CLAIM_CATEGORIES.map((value) => ({
                value,
                label: t(CLAIM_CATEGORY_LABEL_KEYS[value]),
              }))}
            />
          </div>
          <div className="claim-draft-field claim-draft-field--grow">
            <label className="claim-draft-label" htmlFor="claim-draft-subject">
              <Typography.Text type="secondary">
                {t("claimDraftModal.label.subject")}
              </Typography.Text>
            </label>
            <Input
              id="claim-draft-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t("claimDraftModal.placeholder.subjectExample")}
            />
          </div>
        </div>
        <Input.TextArea
          rows={6}
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          placeholder={t("claimDraftModal.placeholder.rawText")}
        />
        {/* 重新生成会整体覆盖草稿（含用户已改的内容），所以降为次要文字按钮并先确认。 */}
        {rows.length > 0 && (
          <div className="claim-draft-regenerate">
            <Popconfirm
              title={t("claimDraftModal.regenerate.confirm")}
              onConfirm={() => void generate()}
            >
              <Button type="text" size="small" loading={busy}>
                {t("claimDraftModal.action.regenerate")}
              </Button>
            </Popconfirm>
          </div>
        )}

        {notes.map((note) => (
          <Typography.Text key={note} type="secondary">
            · {note}
          </Typography.Text>
        ))}

        {generated && rows.length === 0 && (
          <EmptyState inline description={t("claimDraftModal.empty.nothingExtracted")} />
        )}

        {rows.length > 0 && (
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
