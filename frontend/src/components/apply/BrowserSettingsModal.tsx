/**
 * 受控浏览器的选择弹窗：自动 / Chrome / Edge / 自定义路径。
 *
 * **与投递台共用同一份浏览器类型配置**（窗口与登录态彼此隔离），所以这里保存的就是投递
 * 设置里那两个字段，字段组件也是同一个（`BrowserChoiceFields`）——两处各写一份选择逻辑的话，
 * 迟早会出现"投递台用 Chrome、网申页却起了 Edge"这种没人能解释的状态。
 *
 * 这里**只读写浏览器相关的字段**：整份 `ApplyConfig` 太大（间隔、上限、招呼语、站点…），
 * 在网申页铺开只会让人困惑。保存时把当前配置整份提交、只改这两个字段——后端是整份覆盖，
 * 所以必须先取回现值再合并，否则会把其它设置清空。
 */
import { App, Button, Form, Modal } from "antd";
import { useEffect, useState } from "react";
import { getApplyConfig, updateApplyConfig } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import PageSkeleton from "../common/PageSkeleton";
import type { ApplyConfigOut, BrowserChoice } from "../../types";
import BrowserChoiceFields from "./BrowserChoiceFields";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调（网申页据此重新拉一次浏览器状态）。 */
  onSaved?: () => void;
}

interface BrowserForm {
  browser_choice: BrowserChoice;
  browser_path: string;
}

export default function BrowserSettingsModal({ open, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<BrowserForm>();
  const { data, loading } = useApi<ApplyConfigOut>(getApplyConfig, []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        browser_choice: data.browser_choice,
        browser_path: data.browser_path,
      });
    }
  }, [data, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      // **整份取回 → 只改这两个字段 → 整份提交**：后端 PUT 是整份覆盖，
      // 直接提交 `values` 会把间隔、上限、招呼语、站点全部清空。
      //
      // 显式挑出 `ApplyConfigIn` 的字段，**不要 `{...data}`**：GET 返回的是
      // `ApplyConfigOut`（输入字段 + `defaults` 出厂默认值回显），而 PUT 收的是
      // `ApplyConfigIn`（`extra="forbid"`）——整个响应体回传会多出一个 `defaults`，
      // 后端 422「Extra inputs are not permitted」，而报错里既没有字段名也没有上下文。
      // `defaults` 是**只读回显**，不是配置项。
      const current = data as ApplyConfigOut;
      await updateApplyConfig({
        interval_seconds: current.interval_seconds,
        interval_jitter_seconds: current.interval_jitter_seconds,
        daily_limit: current.daily_limit,
        per_task_limit: current.per_task_limit,
        breaker_threshold: current.breaker_threshold,
        default_greeting: current.default_greeting,
        skip_same_company: current.skip_same_company,
        confirm_real_gap: current.confirm_real_gap,
        browser_port: current.browser_port,
        browser_choice: values.browser_choice,
        browser_path: values.browser_path,
        site_key: current.site_key,
      });
      // 名字要和页头那两个按钮**对得上**：原来这里（以及下面那行链接）写的是
      // 「重启浏览器」，而页面上从来没有这个按钮——用户照着找必然找不到，
      // 这正是"三个按钮职责说不清"的来源之一。
      message.success("浏览器设置已保存");
      onSaved?.();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="浏览器设置"
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      onOk={() => void submit()}
      width={640}
    >
      {loading ? (
        <PageSkeleton rows={3} card={false} />
      ) : (
        <>
          <p>
            投递台和网申填表会分别打开独立浏览器窗口与登录态；这里选择的浏览器类型对两边都生效。
          </p>
          <Form form={form} layout="vertical">
            <BrowserChoiceFields />
          </Form>
          <Button type="link" style={{ paddingLeft: 0 }} onClick={onClose}>
            换过浏览器后，回页面点「关闭浏览器」再点「启动浏览器」才会生效
          </Button>
        </>
      )}
    </Modal>
  );
}
