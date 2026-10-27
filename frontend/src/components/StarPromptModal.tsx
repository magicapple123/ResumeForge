// SPDX-License-Identifier: Apache-2.0
/** GitHub Star 提示弹窗（从 App.tsx 抽出，守住单文件行数预算）。 */
import { Button, Modal, Typography } from "antd";
import promoPlane from "../assets/toutou/promo-plane.webp";
import { GITHUB_REPO } from "../config";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function StarPromptModal({ open, onClose }: Props) {
  useLocale();
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={380}>
      <div style={{ textAlign: "center", paddingBlock: 8 }}>
        <img src={promoPlane} alt="" style={{ height: 72, width: "auto", objectFit: "contain" }} />
        <Typography.Title level={5} style={{ marginTop: 12, marginBottom: 4 }}>
          {t("appConfig.star.title", { name: t("appConfig.brand.name") })}
        </Typography.Title>
        <Typography.Text type="secondary">{t("appConfig.star.body")}</Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            {t("appConfig.star.action")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
