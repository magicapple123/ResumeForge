// SPDX-License-Identifier: Apache-2.0
import { ToolOutlined } from "@ant-design/icons";
import { Button, Divider } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export default function AssistantToolsEntryRow({ onOpen }: { onOpen: () => void }) {
  useLocale();
  return (
    <>
      <Divider style={{ margin: "6px 0" }} />
      <Button
        type="text"
        size="small"
        className="composer-add-action"
        icon={<ToolOutlined />}
        aria-label={t("assistantTools.entry")}
        onClick={onOpen}
      >
        {t("assistantTools.entry")}
      </Button>
    </>
  );
}
