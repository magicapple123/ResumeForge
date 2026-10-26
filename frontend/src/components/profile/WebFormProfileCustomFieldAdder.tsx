// SPDX-License-Identifier: Apache-2.0
import { PlusOutlined } from "@ant-design/icons";
import { Button, Input, Space } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}

export default function WebFormProfileCustomFieldAdder({ value, onChange, onAdd }: Props) {
  useLocale();
  return (
    <Space.Compact style={{ width: "100%", marginTop: 4 }}>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onAdd}
        placeholder={t("profileLibrary.webform.addFieldPlaceholder")}
        maxLength={40}
        aria-label={t("profileLibrary.webform.addFieldAria")}
      />
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={onAdd}
        aria-label={t("profileLibrary.webform.addFieldAction")}
      >
        {t("profileLibrary.webform.addFieldAction")}
      </Button>
    </Space.Compact>
  );
}
