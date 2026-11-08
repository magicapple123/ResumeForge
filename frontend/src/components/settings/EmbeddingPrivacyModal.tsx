// SPDX-License-Identifier: Apache-2.0
/**
 * 首次为某个 host 启用远程检索时的隐私确认（任务书 §4.5 的产品红线）。
 *
 * 按 host 记：换 host 会重新弹；mask={{ closable: false }} 是因为点确认会发起
 * 写入（confirm + enable 两个请求），蒙层误触不能让弹窗消失而动作还在跑。
 */
import { Modal, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  /** 将要收到资料条目文本的 host。 */
  host: string;
  /** confirm + enable 进行中：忽略 Esc / ×，防止半路关掉。 */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EmbeddingPrivacyModal({ open, host, busy, onConfirm, onCancel }: Props) {
  useLocale();
  return (
    <Modal
      open={open}
      title={t("embeddingSearch.privacy.title")}
      okText={t("embeddingSearch.privacy.confirm")}
      cancelText={t("embeddingSearch.privacy.cancel")}
      confirmLoading={busy}
      // 有提交动作的 Modal：蒙层关闭一律禁掉（AGENTS.md 弹层关闭语义）。
      mask={{ closable: false }}
      closable={!busy}
      keyboard={!busy}
      onOk={onConfirm}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {t("embeddingSearch.privacy.body", { host })}
      </Typography.Paragraph>
      <Typography.Text type="secondary">{t("embeddingSearch.privacy.detail")}</Typography.Text>
    </Modal>
  );
}
