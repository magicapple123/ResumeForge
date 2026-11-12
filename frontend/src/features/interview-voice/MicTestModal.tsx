// SPDX-License-Identifier: Apache-2.0
/**
 * 「测试麦克风」弹层（需求 #8.3）。
 *
 * 存在的理由：出现「嗯。」那类问题时，用户唯一能自查的就是"这台电脑到底有没有把声音
 * 录进去"。所以这里只做一件事——录 3 秒，把**电平与峰值**画出来。
 *
 * **不上传**：走 `useMicMeter` 而不是 `useVoiceInput`。测试路径一旦带上上传语义，
 * 就会同时依赖"语音服务有没有配好""额度还剩多少"，那正好是最不该耦合进来的两件事。
 *
 * 关闭即释放麦克风（指示灯必须灭）：`handleClose` 先 `stop()` 再 `onClose()`。
 */

import { Button, Flex, Modal, Progress, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIC_TEST_SECONDS,
  SILENCE_PEAK_THRESHOLD,
  formatPeakPercent,
} from "../../hooks/voiceGates";
import { useMicMeter } from "../../hooks/useMicMeter";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface MicTestModalProps {
  open: boolean;
  onClose: () => void;
}

export default function MicTestModal({ open, onClose }: MicTestModalProps) {
  useLocale();
  const meter = useMicMeter();
  const [remaining, setRemaining] = useState(MIC_TEST_SECONDS);
  const tickerRef = useRef<number | null>(null);
  const { status, level, peak, deviceLabel, deviceLost, error, start, stop } = meter;

  const clearTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  // 到 3 秒自动停：用户可能只是想确认一下电平，不该逼他再点一次。
  // 倒计时的初值在"开始测试"里复位——effect 里再 setState 会触发级联渲染。
  useEffect(() => {
    if (status !== "live") return undefined;
    tickerRef.current = window.setInterval(() => {
      setRemaining((previous) => {
        if (previous <= 1) {
          clearTicker();
          stop();
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return clearTicker;
  }, [status, stop, clearTicker]);

  const handleStart = () => {
    setRemaining(MIC_TEST_SECONDS);
    start();
  };

  const handleClose = () => {
    clearTicker();
    stop();
    onClose();
  };

  const percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
  const deviceName = deviceLabel || t("voiceInput.micTest.deviceDefault");
  const hint =
    status === "live"
      ? t("voiceInput.micTest.remaining", { seconds: remaining })
      : status === "starting"
        ? t("voiceInput.status.starting")
        : t("voiceInput.micTest.idle");

  return (
    <Modal
      open={open}
      title={t("voiceInput.micTest.title")}
      footer={null}
      onCancel={handleClose}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("voiceInput.micTest.intro")}
      </Typography.Paragraph>

      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {t("voiceInput.micTest.device", { name: deviceName })}
      </Typography.Paragraph>

      {deviceLost ? (
        <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
          {t("voiceInput.settings.device.lost")}
        </Typography.Paragraph>
      ) : null}

      <Progress percent={percent} showInfo={false} aria-label={t("voiceInput.micTest.peak")} />

      <Flex align="center" justify="space-between" gap={12} style={{ marginTop: 4 }}>
        <Typography.Text type="secondary">{hint}</Typography.Text>
        <Typography.Text strong>
          {t("voiceInput.micTest.peak", { peak: formatPeakPercent(peak) })}
        </Typography.Text>
      </Flex>

      {error ? (
        <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
          {error.message}
        </Typography.Paragraph>
      ) : null}

      {/* 判定只在测试结束后给：录音中电平本来就是忽高忽低的，提前下结论会误导。 */}
      {status === "idle" && !error && peak > 0 ? (
        <Typography.Paragraph
          type={peak < SILENCE_PEAK_THRESHOLD ? "warning" : "success"}
          style={{ marginTop: 12, marginBottom: 0 }}
        >
          {peak < SILENCE_PEAK_THRESHOLD
            ? t("voiceInput.micTest.result.silent")
            : t("voiceInput.micTest.result.ok")}
        </Typography.Paragraph>
      ) : null}

      <Flex gap={8} style={{ marginTop: 16 }}>
        {status === "live" ? (
          <Button onClick={stop}>{t("voiceInput.micTest.stop")}</Button>
        ) : (
          <Button
            type="primary"
            onClick={handleStart}
            loading={status === "starting"}
            disabled={status === "starting" || undefined}
          >
            {t("voiceInput.micTest.start")}
          </Button>
        )}
      </Flex>
    </Modal>
  );
}
