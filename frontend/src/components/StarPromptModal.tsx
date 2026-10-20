/** GitHub Star 提示弹窗（从 App.tsx 抽出，守住单文件行数预算）。 */
import { Button, Modal, Typography } from "antd";
import promoPlane from "../assets/toutou/promo-plane.webp";
import { APP_NAME, GITHUB_REPO } from "../config";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function StarPromptModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={380}>
      <div style={{ textAlign: "center", paddingBlock: 8 }}>
        <img src={promoPlane} alt="" style={{ height: 72, width: "auto", objectFit: "contain" }} />
        <Typography.Title level={5} style={{ marginTop: 12, marginBottom: 4 }}>
          如果 {APP_NAME} 对你有帮助
        </Typography.Title>
        <Typography.Text type="secondary">
          欢迎去 GitHub 给项目点一个 Star ⭐——这是对独立开发最实在的支持。
        </Typography.Text>
        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            去点 Star
          </Button>
        </div>
      </div>
    </Modal>
  );
}
