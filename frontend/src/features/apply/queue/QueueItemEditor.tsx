// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑某条队列条目的招呼语与简历；招呼语可先按岗位生成一版再改。
 * （自 ApplyQueuePanel 拆出，逐字搬运，行为等价；App.useApp() 原本就在本组件内调用。）
 *
 * T30：简历下拉换成 `useResumeRefSelect`——**一个下拉、两组选项**（内部简历 / 外部简历），
 * 外部项带 PDF/DOCX 徽标，与提醒关联简历（R14）同一口径。值域是复合串
 * `internal:12` / `external:7`（两张表 id 会撞号，裸数字分不清来源），提交时用
 * `resumeRefIds` 拆回 `resume_id` / `external_resume_id` 两个互斥字段。
 */
import { App, Button, Form, Modal, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { previewGreeting, updateQueueItem } from "../../../api/apply";
import { getApplyGreetingImage } from "../../../api/applyExtras";
import AbortButton from "../../../components/common/AbortButton";
import { errorText, useAbortableRequest } from "../../../hooks/useAbortableRequest";
import { useApi } from "../../../hooks/useApi";
import { useResumeRefSelect } from "../../../hooks/useResumeRefSelect";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { HintedTextArea } from "../../../components/common/MaxLengthHint";
import type { ApplyGreetingImage, ApplyQueueItem } from "../../../types";
import { GREETING_IMAGE_MAX_FALLBACK } from "../../../types";
import { encodeResumeRef, resumeRefIds, resumeRefValue } from "../../../types/resumeRef";
import GreetingImagePicker from "../GreetingImagePicker";
import { GreetingTemplatePicker } from "./GreetingTemplatePicker";
import ResumeFitHint from "../insights/ResumeFitHint";

/** 编辑表单的形状：招呼语、简历（复合值），以及 T8 的「这一条的配图」。 */
interface EditorValues {
  greeting: string;
  /** `internal:12` / `external:7`；空 = 按默认规则为该岗位找简历。 */
  resume_ref?: string;
  image_ids?: number[];
}

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
  const [form] = Form.useForm<EditorValues>();
  // 简历下拉（T30）：并行查内部 / 外部两端、分组显示，编辑器挂载即打开，
  // 挂载时回查已选值并预拉第一页候选。
  const resumeSelect = useResumeRefSelect();
  // T8：配图候选与上限来自接口（上限的权威值在后端 attachments，不在前端写死）。
  const { data: imageData } = useApi<ApplyGreetingImage>(getApplyGreetingImage, []);
  // 招呼语是现场生成的一小段文案，但同样要等模型回包：等着的时候可以停。
  const greetingRequest = useAbortableRequest();
  const generating = greetingRequest.loading;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      greeting: item.greeting,
      resume_ref: resumeRefValue(item),
      // 行内配图（T8）：空数组就是"没单独选"（保存时原样回传，后端照旧存空）。
      image_ids: item.image_ids ?? [],
    });
  }, [form, item]);

  useEffect(() => {
    // 已选简历的保显示：按复合值回查补进候选（外部简历同样回查），拿不到就退回记录上的
    // 名字快照，再预拉第一页候选。
    void resumeSelect.ensure(resumeRefValue(item), item.resume_title);
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
    // 复合值 → 两个互斥的 id 字段。**两个键都要给**：只给外部 id 会让库里已存的内部 id
    // 留着，合并后变成"两个都关联"（后端 422）；两键都给 null 才是"改回默认"。
    const ids = resumeRefIds(values.resume_ref);
    setSaving(true);
    try {
      await updateQueueItem(item.id, {
        greeting: values.greeting ?? "",
        resume_id: ids.resume_id,
        external_resume_id: ids.external_resume_id,
        // 总是带上 `image_ids`（含空数组）：空数组的语义是"这条不单独选图"，
        // 后端必须能把它和"没提交这个字段"区分开——否则清空选择不生效。
        image_ids: values.image_ids ?? [],
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
            // 推荐项一定是内部简历：复合值固定为 `internal:<id>`。
            const ref = encodeResumeRef({ kind: "internal", id: resumeId });
            form.setFieldValue("resume_ref", ref);
            // 把推荐项补进下拉候选，否则选择框里只会显示一个裸 id。
            void resumeSelect.ensure(ref);
          }}
        />
        <Form.Item
          name="resume_ref"
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
        {/* T8 行内覆盖：这一条岗位单独选图。留空 = 跟随设置里的默认图片——
            两者是不同状态，所以空槽明写"跟随默认"，不给"未选择"这种含糊说法。
            R21：这里只选"这一条要发的"，缩略图可点开灯箱、× 只移除不删库；
            删库入口只在投递设置里（`GreetingImageMultiSelect` 不渲染任何删除按钮）。 */}
        <Form.Item
          name="image_ids"
          label={t("applyQueue.image.editorLabel")}
          extra={t("applyQueue.image.editorExtra", {
            count: imageData?.max_count ?? GREETING_IMAGE_MAX_FALLBACK,
          })}
        >
          <GreetingImagePicker
            mode="multiple"
            maxCount={imageData?.max_count ?? GREETING_IMAGE_MAX_FALLBACK}
            maxImageBytes={imageData?.max_image_bytes}
            options={imageData?.options ?? []}
            placeholder={t("applyQueue.image.editorPlaceholder")}
            ariaLabel={t("applyQueue.image.editorLabel")}
          />
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
