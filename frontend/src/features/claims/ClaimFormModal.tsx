// SPDX-License-Identifier: Apache-2.0
/**
 * 台账条目的新建 / 编辑表单（编排层）。
 *
 * 两个刻意的取舍：
 * 1. **字段按组拆文件**（原始事实 / 核实 / 证据 / 面试细节）：本文件原为 456/500 行，
 *    再加「关联资料条目」必然顶破预算（清单 §20.8）。拆分只搬渲染、不改行为。
 * 2. **关联资料条目在打开弹窗时才拉资料库**：工作区接口一次要带定义与全部条目，
 *    不能在台账列表页常驻请求；select 的选项按「板块 → 条目名」分组。
 */
import { SaveOutlined } from "@ant-design/icons";
import { App, Form } from "antd";
import { useEffect, useState } from "react";
import FormModal from "../../components/common/FormModal";
import { useFormDraft } from "../../hooks/useFormDraft";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { getWorkspace } from "../profile/library/api";
import {
  buildClaimEntryGroups,
  claimCategoryForSection,
  claimSubjectForEntry,
  findClaimEntry,
} from "../../features/claims/entryOptions";
import { useApi } from "../../hooks/useApi";
import { createClaim, listAllowedUses, updateClaim } from "../../api/claims";
import type { Claim } from "../../types";
import ClaimFactFields from "./form/ClaimFactFields";
import ClaimVerifyFields from "./form/ClaimVerifyFields";
import ClaimEvidenceFields from "./form/ClaimEvidenceFields";
import ClaimInterviewFields from "./form/ClaimInterviewFields";
import { EMPTY_VALUES, toPayload, toValues } from "./form/claimFormTypes";
import type { FormValues } from "./form/claimFormTypes";

interface Props {
  open: boolean;
  claim: Claim | null;
  onClose: () => void;
  onSaved: (claim: Claim) => void;
}

export default function ClaimFormModal({ open, claim, onClose, onSaved }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const editing = claim !== null;
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  // 资料库条目是「关联资料条目」的选项来源：只在弹窗打开时拉，且与编辑对象无关。
  // `refreshOnRequest: false`：这是**编辑弹窗**——品牌图标双击的整页刷新若把这份数据换掉，
  // 宿主里"选项变了"的 effect 会连带重算表单，把用户正在写的草稿冲掉。
  const workspace = useApi(() => getWorkspace(), [open], {
    enabled: open,
    refreshOnRequest: false,
  });
  const entryGroups = buildClaimEntryGroups(workspace.data);
  // 「可用范围」在生成时是硬约束（resume_generate_user.md），让用户凭记忆重打会造出
  // "AI 岗简历" / "AI岗简历" 这种同义变体。候选来自台账历史，仍允许自由新增。
  const allowedUses = useApi(() => listAllowedUses(), [open], {
    enabled: open,
    refreshOnRequest: false,
  });
  const hasInterviewDetails = Boolean(
    claim &&
    (claim.interview_details?.decisions?.length ||
      claim.interview_details?.difficulties?.length ||
      claim.interview_details?.verification?.length ||
      claim.interview_details?.result),
  );
  // 草稿只进 sessionStorage，且按"编辑对象"分作用域（12 号与 13 号各一份）。
  const watched = Form.useWatch<FormValues>([], form) as FormValues | undefined;
  const draft = useFormDraft({
    scope: "claims.edit#" + (claim?.id ?? "new"),
    values: (watched ?? EMPTY_VALUES) as unknown as Record<string, unknown>,
    open,
    isEmpty: (values) => !values.title && !values.source_fact,
  });

  // 打开时把表单回填成"正在编辑的那一条"或空白。
  // dirty 不在这里重置：它说的是"本次打开期间用户改过没"，收掉的正确时机是关闭
  // （见 onCancel 与保存成功两处）。在这里 setState 属于 effect 内同步改状态，
  // 会触发级联渲染（react-hooks/set-state-in-effect），而且它本来也不是回填的一部分。
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(claim ? toValues(claim) : EMPTY_VALUES);
  }, [open, claim, form]);

  /**
   * 新建时关联资料条目：按刚选中的那条回填主体与分类。
   *
   * 只在新建、主体为空、分类仍是默认值时才动——编辑态与用户已经填过的值一律不覆盖，
   * 否则"补一条关联"会悄悄改掉一条已经核对过的台账。
   */
  const backfillFromEntry = (entryId: string) => {
    if (editing) return;
    if (String(form.getFieldValue("subject") ?? "").trim()) return;
    if (form.getFieldValue("category") !== EMPTY_VALUES.category) return;
    const found = findClaimEntry(workspace.data, entryId);
    if (!found) return;
    form.setFieldsValue({
      subject: claimSubjectForEntry(found.section, found.entry),
      category: claimCategoryForSection(found.section.key),
    });
  };

  const submit = async () => {
    let values: FormValues;
    try {
      const validated = await form.validateFields();
      // 「面试细节」默认收起，折叠里的 Form.Item 未挂载时不会被 validateFields 取回；
      // 合并整个 store（preserve 保留了它们的值），否则收起状态下保存会把这一节清空。
      values = { ...(form.getFieldsValue(true) as FormValues), ...validated };
    } catch {
      return; // 校验失败时 antd 已在字段旁给出提示
    }
    const payload = toPayload(values);
    try {
      const saved = editing ? await updateClaim(claim.id, payload) : await createClaim(payload);
      // 提交成功才清草稿：清早了等于"保存失败也把内容扔了"。
      draft.clear();
      message.success(editing ? t("claimForm.toast.saved") : t("claimForm.toast.created"));
      onSaved(saved);
      // 保存成功同样是"一次编辑结束"：标记清掉，别把下次打开的弹窗说成有未保存修改。
      setDirty(false);
      onClose();
    } catch (error) {
      // 「已确认却还留着【待补】」这类自相矛盾由后端挡下，原样把中文原因显示出来，
      // 否则用户只会看到一个说得不清不楚的 422。
      message.error(error instanceof Error ? error.message : t("claimForm.toast.saveFailed"));
    }
  };

  return (
    <FormModal
      open={open}
      title={editing ? t("claimForm.title.edit") : t("claimForm.title.create")}
      onCancel={() => {
        // L1：有草稿时关闭无损，只告知一句（短、不打断）。
        if (dirty) toast.info(t("draft.kept"));
        // 闭即清"脏"标记：下次打开是一张干净的弹窗（回填在 effect 里，与它无关）。
        setDirty(false);
        onClose();
      }}
      onSubmit={() => void submit()}
      okText={t("claimForm.action.save")}
      okIcon={<SaveOutlined />}
      dirty={dirty}
      hasDraft
      draftBar={
        draft.pending
          ? {
              savedAt: draft.pending.savedAt,
              fieldCount: Object.keys(draft.pending.values).length,
              onRestore: () => form.setFieldsValue(draft.adopt() as unknown as FormValues),
              onDiscard: draft.discard,
            }
          : null
      }
      width={880}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={EMPTY_VALUES}
        onValuesChange={() => setDirty(true)}
      >
        <ClaimFactFields />
        <ClaimVerifyFields allowedUseOptions={allowedUses.data ?? []} />
        <ClaimEvidenceFields
          entryGroups={entryGroups}
          entriesLoading={workspace.loading}
          entriesFailed={Boolean(workspace.error)}
          entriesEmpty={!workspace.loading && !workspace.error && entryGroups.length === 0}
          autoLinked={Boolean(claim?.entry_ids_auto)}
          onEntryAdded={backfillFromEntry}
        />
        <ClaimInterviewFields defaultOpen={hasInterviewDetails} />
      </Form>
    </FormModal>
  );
}
