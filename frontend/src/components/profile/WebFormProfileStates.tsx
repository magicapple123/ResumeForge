// SPDX-License-Identifier: Apache-2.0
import { Alert, Space, Typography } from "antd";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";

export function WebFormProfileLoadError({
  description,
  onRetry,
  retrying,
}: {
  description: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  useLocale();
  return (
    <ErrorState
      description={description}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={t("common.retry")}
    />
  );
}

export function WebFormProfileNotice() {
  useLocale();
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      title={t("profileLibrary.webform.sectionAlertTitle")}
      description={
        <Space orientation="vertical" size={2}>
          <Typography.Text>{t("profileLibrary.webform.sectionPurpose")}</Typography.Text>
          <Typography.Text>{t("profileLibrary.webform.sectionMerge")}</Typography.Text>
          <Typography.Text>{t("profileLibrary.webform.sectionResumeOnly")}</Typography.Text>
          <Typography.Text>{t("profileLibrary.webform.sectionPrivateLocal")}</Typography.Text>
        </Space>
      }
    />
  );
}

export function WebFormProfileEmpty({ onEdit }: { onEdit: () => void }) {
  useLocale();
  return (
    <EmptyState
      inline
      description={
        <Space orientation="vertical" size={2}>
          <Typography.Text>{t("profileLibrary.webform.sectionEmpty")}</Typography.Text>
          <Typography.Text>{t("profileLibrary.webform.sectionEmptyHint")}</Typography.Text>
        </Space>
      }
      actionLabel={t("profileLibrary.action.edit")}
      onAction={onEdit}
    />
  );
}
