// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「麦克风」一行：设备下拉 + 刷新 + 测试入口（需求 #8.2 / #8.3）。
 *
 * 为什么单独成文件：`AsrSettingsCard` 只剩 300 行余量（它自己已经拆过两轮：列表、
 * 弹窗、字段表、服务商网格），再塞一个带弹层与设备枚举的区块又会顶到预算。这里只
 * 负责"选哪个输入设备"，语音服务配置仍在卡片里。
 *
 * 设备名为什么可能全是「麦克风 1/2/3」：未授权时浏览器按隐私规定把 `label` 置空。
 * 所以列表为空不是 bug，UI 用占位名兜住并提示"授权后才显示设备名"。
 */

import { AudioOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Flex, Select, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import MicTestModal from "./MicTestModal";
import {
  listAudioInputs,
  readPreferredDeviceId,
  savePreferredDeviceId,
  type AudioInputDevice,
} from "./voicePrefs";

export default function MicSettingsRow() {
  useLocale();
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selected, setSelected] = useState<string>(() => readPreferredDeviceId() ?? "");
  const [testOpen, setTestOpen] = useState(false);

  const refresh = useCallback(async () => {
    setDevices(await listAudioInputs());
  }, []);

  // 首次挂载拉一次设备列表：`enumerateDevices()` 在未授权时只返回无名设备，
  // 所以这里不申请权限，拿不到就显示占位名（见 voicePrefs 的说明）。
  useEffect(() => {
    let active = true;
    void (async () => {
      const next = await listAudioInputs();
      if (active) setDevices(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  const onChange = (value: string) => {
    setSelected(value);
    // 空值 = 系统默认：清掉存储，而不是存一个空串。
    savePreferredDeviceId(value.length > 0 ? value : null);
  };

  const options = [
    { value: "", label: t("voiceInput.settings.device.default") },
    ...devices
      // `deviceId` 为空串的条目就是"当前默认"，与上面那一项重复。
      .filter((device) => device.deviceId.length > 0)
      .map((device, index) => ({
        value: device.deviceId,
        label: device.label || t("voiceInput.settings.device.unnamed", { index: index + 1 }),
      })),
  ];

  return (
    <>
      <Flex align="center" gap={8} wrap="wrap">
        <Typography.Text type="secondary">{t("voiceInput.settings.device.label")}</Typography.Text>
        <Select
          value={selected}
          options={options}
          onChange={onChange}
          style={{ minWidth: 220 }}
          popupMatchSelectWidth={false}
          aria-label={t("voiceInput.settings.device.aria")}
        />
        <Tooltip title={t("voiceInput.settings.device.refresh")}>
          <Button
            icon={<ReloadOutlined />}
            aria-label={t("voiceInput.settings.device.refresh")}
            onClick={() => void refresh()}
          />
        </Tooltip>
        <Button icon={<AudioOutlined />} onClick={() => setTestOpen(true)}>
          {t("voiceInput.settings.micTest.open")}
        </Button>
      </Flex>

      {/* 占位名/空列表都可能是"还没授权"——只有这两种情况才需要解释。*/}
      {devices.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
          {t("voiceInput.settings.device.empty")}
        </Typography.Paragraph>
      ) : devices.some((device) => device.label.length === 0) ? (
        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
          {t("voiceInput.settings.device.hint")}
        </Typography.Paragraph>
      ) : null}

      <MicTestModal open={testOpen} onClose={() => setTestOpen(false)} />
    </>
  );
}
