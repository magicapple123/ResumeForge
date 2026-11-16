// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「麦克风」一行：设备下拉 + 刷新 + 授权入口 + 测试入口（需求 #8.2 / #8.3 / I-07）。
 *
 * 为什么单独成文件：`AsrSettingsCard` 只剩 300 行余量（它自己已经拆过两轮：列表、
 * 弹窗、字段表、服务商网格），再塞一个带弹层与设备枚举的区块又会顶到预算。这里只
 * 负责"选哪个输入设备"，语音服务配置仍在卡片里。
 *
 * 设备名为什么可能全是「麦克风 1/2/3」：未授权时浏览器按隐私规定把 `label` 置空。
 * 所以列表为空不是 bug，UI 用占位名兜住——但**必须给出授权入口**：授权只能由用户
 * 手势触发，走不了后台自动弹，所以没有按钮就等于这条路径不存在（I-07 的成因）。
 */

import { AudioOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Flex, Select, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceError } from "../../hooks/voiceErrors";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import MicTestModal from "./MicTestModal";
import {
  ensureMicPermission,
  listAudioInputs,
  queryMicPermission,
  readPreferredDeviceId,
  savePreferredDeviceId,
  watchMicPermission,
  type AudioInputDevice,
  type MicPermissionState,
} from "./voicePrefs";

/** 三态提示：`null` 表示"已授权且设备名都能读到"，不需要解释。 */
interface MicHint {
  tone: "secondary" | "warning";
  text: string;
}

/**
 * 三态提示文案。
 *
 * 顺序有讲究：**权限状态优先于设备列表**——未授权时列表本身也"看得出来有问题"，但真正
 * 能行动的信息是"去点授权"，把它压在设备名提示下面等于没说。
 */
function hintFor(permission: MicPermissionState, devices: AudioInputDevice[]): MicHint | null {
  if (permission === "denied") {
    return { tone: "warning", text: t("voiceInput.settings.device.denied") };
  }
  if (permission === "prompt") {
    return { tone: "secondary", text: t("voiceInput.settings.device.prompt") };
  }
  if (devices.length === 0) {
    return { tone: "secondary", text: t("voiceInput.settings.device.empty") };
  }
  if (devices.some((device) => device.label.length === 0)) {
    return { tone: "secondary", text: t("voiceInput.settings.device.hint") };
  }
  return null;
}

export default function MicSettingsRow() {
  useLocale();
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selected, setSelected] = useState<string>(() => readPreferredDeviceId() ?? "");
  const [permission, setPermission] = useState<MicPermissionState>("prompt");
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<VoiceError | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // 异步回调返回时组件可能已经卸载（切走设置页）：授权成功后不能再 setState。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await listAudioInputs();
    if (mountedRef.current) setDevices(next);
    return next;
  }, []);

  // 首次挂载拉一次设备列表与权限：`enumerateDevices()` 在未授权时只返回无名设备，
  // 所以这里**不申请权限**（浏览器要求用户手势），拿不到就显示占位名 + 授权按钮。
  useEffect(() => {
    let active = true;
    void (async () => {
      const [nextDevices, nextPermission] = await Promise.all([
        listAudioInputs(),
        queryMicPermission(),
      ]);
      if (!active) return;
      setDevices(nextDevices);
      setPermission(nextPermission);
    })();
    return () => {
      active = false;
    };
  }, []);

  // 权限变化立刻反映到 UI：`devicechange` 不覆盖"权限被授予"，只有这条能让我们在
  // 用户去站点设置解除后马上把下拉里的无名设备换成真实设备名。
  useEffect(
    () =>
      watchMicPermission((next) => {
        if (!mountedRef.current) return;
        setPermission(next);
        if (next === "granted") {
          setGrantError(null);
          void refresh();
        }
      }),
    [refresh],
  );

  // 插拔设备（含授权后浏览器重建设备条目）会发 `devicechange`；不接它就只能手动刷新。
  useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (typeof media?.addEventListener !== "function") return undefined;
    const handleDeviceChange = () => {
      void refresh();
    };
    media.addEventListener("devicechange", handleDeviceChange);
    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("devicechange", handleDeviceChange);
      }
    };
  }, [refresh]);

  const onChange = (value: string) => {
    setSelected(value);
    // 空值 = 系统默认：清掉存储，而不是存一个空串。
    savePreferredDeviceId(value.length > 0 ? value : null);
  };

  /** 「授权麦克风」：唯一的用户手势入口，取流后立刻释放，再重拉设备列表。 */
  const handleGrant = async () => {
    setGranting(true);
    setGrantError(null);
    const outcome = await ensureMicPermission();
    if (!mountedRef.current) return;
    setPermission(outcome.state);
    setGrantError(outcome.error);
    // 授权成功后**必须立刻**重新枚举：设备名只在拿到权限之后才可读，等用户点刷新
    // 等于把"下拉里全是麦克风 1/2/3"原样留着。
    await refresh();
    if (mountedRef.current) setGranting(false);
  };

  /** 测试弹层关闭：它本身就是一次授权（getUserMedia），关掉后要重查权限并重拉设备。 */
  const handleTestClose = () => {
    setTestOpen(false);
    void (async () => {
      const nextPermission = await queryMicPermission();
      if (!mountedRef.current) return;
      setPermission(nextPermission);
      await refresh();
    })();
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

  const hint = hintFor(permission, devices);
  const needsGrant = permission !== "granted";

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
        {/* 未授权时把入口放在**同一排**：提示语说"点右侧"，按钮就真在右侧。 */}
        {needsGrant ? (
          <Button
            icon={<SafetyCertificateOutlined />}
            onClick={() => void handleGrant()}
            loading={granting}
            disabled={granting || undefined}
          >
            {permission === "denied"
              ? t("voiceInput.settings.device.regrant")
              : t("voiceInput.settings.device.grant")}
          </Button>
        ) : null}
        <Button icon={<AudioOutlined />} onClick={() => setTestOpen(true)}>
          {t("voiceInput.settings.micTest.open")}
        </Button>
      </Flex>

      {hint ? (
        <Typography.Paragraph type={hint.tone} style={{ margin: "8px 0 0" }}>
          {hint.text}
        </Typography.Paragraph>
      ) : null}

      {/* 失败原因走 voiceErrors 的分类文案（已经写明"发生了什么 + 怎么办"），不另造兜底。 */}
      {grantError ? (
        <Typography.Paragraph type="danger" style={{ margin: "4px 0 0" }}>
          {grantError.message}
        </Typography.Paragraph>
      ) : null}

      <MicTestModal open={testOpen} onClose={handleTestClose} />
    </>
  );
}
