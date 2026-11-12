// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑某条队列条目的招呼语与简历；招呼语可先按岗位生成一版再改。
 * （自 ApplyQueuePanel 拆出，逐字搬运，行为等价；App.useApp() 原本就在本组件内调用。）
 */
import { App, Button, Form, Modal, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { previewGreeting, updateQueueItem } from "../../../api/apply";
import AbortButton from "../../../components/common/AbortButton";
import { errorText, useAbortableRequest } from "../../../hooks/useAbortableRequest";
import { useResumeSearchSelectForJob } from "../../../hooks/remoteSearchOptions";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { HintedTextArea } from "../../../components/common/MaxLengthHint";
import type { ApplyQueueItem } from "../../../types";
import { GreetingTemplatePicker } from "./GreetingTemplatePicker";
import ResumeFitHint from "../insights/ResumeFitHint";

export function QueueItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: ApplyQueueItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后弹窗停在旧文案。
  useLocale();
  const [form] = Form.useForm<{ greeting: string; resume_id?: number }>();
  // 简历下拉改为远程搜索（P0-1）：候选限定该岗位关联过的简历，
  // 编辑器挂载即打开，挂载时回查已选值并预拉第一页候选。
  const resumeSelect = useResumeSearchSelectForJob(item.job_id);
  // 招呼语是现场生成的一小段文案，但同样要等模型回包：等着的时候可以停。
  const greetingRequest = useAbortableRequest();
  const generating = greetingRequest.loading;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ greeting: item.greeting, resume_id: item.resume_id ?? undefined });
  }, [form, item]);

  useEffect(() => {
    // 已选简历的保显示（P0-1）：按 id 回查补进候选，再预拉第一页候选。
    void resumeSelect.ensure(item.resume_id);
    void resumeSelect.reload();
    // 编辑目标在本组件生命周期内不变，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateGreeting = async () => {
    // 先落到局部常量：闭包里读 `item.job_id` 会丢掉上面的判空收窄（TS 不跨回调保留）。
    const jobId = item.job_id;
    if (jobId == null) return;
    const outcome = await greetingRequest.run((signal) =>
      previewGreeting({ job_id: jobId, item_id: item.id }, signal),
    );
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("applyQueue.toast.greetingFailed")));
      return;
    }
    if (outcome.status === "aborted") return;
    form.setFieldValue("greeting", outcome.data.greeting);
    message.success(
      outcome.data.source === "generated"
        ? t("applyQueue.toast.greetingGenerated")
        : t("applyQueue.toast.greetingDefault"),
    );
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await updateQueueItem(item.id, {
        greeting: values.greeting ?? "",
        ...(values.resume_id ? { resume_id: values.resume_id } : {}),
      });
      message.success(t("applyQueue.toast.updated"));
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyQueue.toast.updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("applyQueue.editor.title", {
        title: item.job_title || t("applyQueue.editor.untitledJob"),
      })}
      open
      onCancel={onClose}
      footer={null}
      mask={{ closable: false }}
      width={560}
    >
      <Form form={form} layout="vertical">
        {/* #15D 推荐简历：放在简历下拉**上方**——先看建议再选，比"选完再告诉你有更好的"顺手。
            `gain <= 0` 时组件自身不渲染，编辑器保持原样。 */}
        <ResumeFitHint
          queueId={item.id}
          onApply={(resumeId) => {
            form.setFieldValue("resume_id", resumeId);
            // 把推荐项补进下拉候选，否则选择框里只会显示一个裸 id。
            void resumeSelect.ensure(resumeId);
          }}
        />
        <Form.Item
          name="resume_id"
          label={t("applyQueue.detail.resume")}
          extra={t("applyQueue.editor.resumeHint")}
        >
          <Select
            allowClear
            placeholder={t("applyQueue.editor.resumePlaceholder")}
            {...resumeSelect.selectProps}
          />
        </Form.Item>
        {/* #14D：模板选择放在招呼语输入框**上方**——先挑模板再改，比"先手写再替换"顺手。
            没有模板时本组件自身不渲染，编辑器保持原样。 */}
        <GreetingTemplatePicker
          item={item}
          onApply={(text) => form.setFieldValue("greeting", text)}
        />
        <Form.Item name="greeting" label={t("applyQueue.detail.greeting")}>
          <HintedTextArea rows={3} maxLength={1000} />
        </Form.Item>
      </Form>
      <Space>
        <Button onClick={() => void generateGreeting()} loading={generating}>
          {t("applyQueue.editor.generate")}
        </Button>
        {generating && <AbortButton onClick={() => greetingRequest.cancel()} />}
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("common.action.save")}
        </Button>
        <Button onClick={onClose}>{t("common.action.cancel")}</Button>
      </Space>
    </Modal>
  );
}
