// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「面试 · 镜头」卡（F18）：总开关 + 录像 / 抽帧 / 保留期 / 是否计入总分。
 *
 * 隐私相关的三条不变量在这里落地：
 * 1. 总开关**默认关**，首次打开先弹一次说明（`consentSeen` 之后不再弹，不是每场面试弹）；
 * 2. 录像与抽帧都有"具体在做什么"的说明，而不是一行"开启摄像头"；
 * 3. 存储位置与"不进备份"写在卡里——用户不该靠猜知道录像会不会被打进备份包。
 *
 * 值存在 `localStorage`（`cameraSettings`），与数据集无关，不需要数据库迁移。
 */
import { App, Card, Divider, Select, Space, Switch, Typography } from "antd";
import { useCameraSettings, type CameraRetentionDays } from "./cameraSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text>{label}</Typography.Text>
        {hint ? (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {hint}
            </Typography.Text>
          </div>
        ) : null}
      </div>
      <div style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

export function InterviewCameraSettingsCard() {
  useLocale();
  const { modal } = App.useApp();
  const [settings, patch] = useCameraSettings();

  const toggleEnabled = (next: boolean) => {
    if (!next) {
      patch({ enabled: false });
      return;
    }
    if (settings.consentSeen) {
      patch({ enabled: true });
      return;
    }
    modal.confirm({
      title: t("interviewCamera.consent.title"),
      content: t("interviewCamera.consent.body"),
      okText: t("interviewCamera.consent.ok"),
      cancelText: t("interviewCamera.consent.cancel"),
      onOk: () => patch({ enabled: true, consentSeen: true }),
    });
  };

  return (
    <Card size="small" title={t("interviewCamera.settings.title")}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Row
          label={t("interviewCamera.settings.enable")}
          hint={t("interviewCamera.settings.enableHint")}
        >
          <Switch
            checked={settings.enabled}
            onChange={toggleEnabled}
            aria-label={t("interviewCamera.settings.enable")}
          />
        </Row>
        <Divider style={{ margin: 0 }} />
        <Row
          label={t("interviewCamera.settings.record")}
          hint={t("interviewCamera.settings.recordHint")}
        >
          <Switch
            checked={settings.record}
            disabled={!settings.enabled}
            onChange={(checked) => patch({ record: checked })}
            aria-label={t("interviewCamera.settings.record")}
          />
        </Row>
        <Row
          label={t("interviewCamera.settings.analyze")}
          hint={t("interviewCamera.settings.analyzeHint")}
        >
          <Switch
            checked={settings.analyze}
            disabled={!settings.enabled}
            onChange={(checked) => patch({ analyze: checked })}
            aria-label={t("interviewCamera.settings.analyze")}
          />
        </Row>
        <Row label={t("interviewCamera.settings.retention")}>
          <Select<CameraRetentionDays>
            value={settings.retentionDays}
            disabled={!settings.enabled || !settings.record}
            onChange={(value) => patch({ retentionDays: value })}
            style={{ width: 150 }}
            aria-label={t("interviewCamera.settings.retention")}
            options={[
              { value: 7, label: t("interviewCamera.settings.retention7") },
              { value: 30, label: t("interviewCamera.settings.retention30") },
              { value: 0, label: t("interviewCamera.settings.retentionNever") },
            ]}
          />
        </Row>
        <Divider style={{ margin: 0 }} />
        <Row
          label={t("interviewCamera.settings.countInScore")}
          hint={t("interviewCamera.settings.countInScoreHint")}
        >
          <Switch
            checked={settings.countInScore}
            disabled={!settings.enabled || !settings.analyze}
            onChange={(checked) => patch({ countInScore: checked })}
            aria-label={t("interviewCamera.settings.countInScore")}
          />
        </Row>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("interviewCamera.settings.storageHint")}
        </Typography.Text>
      </Space>
    </Card>
  );
}

export default InterviewCameraSettingsCard;
