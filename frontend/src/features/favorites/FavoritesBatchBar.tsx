// SPDX-License-Identifier: Apache-2.0
/** 收藏夹批量操作条（#28F）：批量取消收藏 / 批量加入队列。 */
import { Button, Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface FavoritesBatchBarProps {
  count: number;
  onUnfavorite: () => void;
  onEnqueue: () => void;
}

export default function FavoritesBatchBar(props: FavoritesBatchBarProps) {
  useLocale();
  if (props.count <= 0) return null;
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary">
        {t("favorites.batch.selected", { count: props.count })}
      </Typography.Text>
      <Button danger onClick={props.onUnfavorite}>
        {t("favorites.action.batchUnfavorite")}
      </Button>
      <Button onClick={props.onEnqueue}>{t("favorites.action.batchEnqueue")}</Button>
    </Space>
  );
}
