// SPDX-License-Identifier: Apache-2.0
/**
 * 字体样张：**只读**弹窗，内置思源黑体与历史导入字体共用一份。
 *
 * ## 为什么固定四行
 *
 * 中文简历最容易翻车的是三件事，四行正好各覆盖一处：
 *
 * 1. **标题行**（22px）——最常用的形态，字号最大，缺字或字重不对一眼就能看出来；
 * 2. **中英数混排**（14px）——中文字体的西文与数字宽度常常不协调（"8,500" 挤或散）；
 * 3. **中文标点**（14px）——全角标点最容易暴露字族缺字、被替换成别的字形；
 * 4. **粗体行**（14px，`font-weight:700`）——**缺粗体字面**时浏览器与 fpdf2 都会用
 *    "描边加粗"顶上，中文笔画密，糊成一团。这一行就是给用户核对这件事的。
 *
 * ## 字体文件读不到时明说不可用
 *
 * `FontFace.load()` reject（404 / 文件损坏）时弹窗里直接写「字体文件不可用」，**不**
 * 静默回退系统字体——回退会让用户以为"这款字体就长这样"，那是最坏的一种谎。
 * 唯一的例外是运行环境根本没有 CSS Font Loading API（只有 jsdom 这样）：那不属于
 * "文件读不到"，按可显示处理，避免把测试环境当成故障。
 */
import { Alert, Button, Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import { resumeFontPreviewUrl } from "../../api/fonts";
import { t } from "../../i18n";

/** 样张用的 CSS 家族名：每次打开都从文件 URL 现挂一份，关掉就摘掉。 */
const SAMPLE_FAMILY = "rf-font-sample";

type LoadState = "loading" | "ready" | "unavailable";

interface Props {
  /** 要看的字体文件名；`null` = 关闭。 */
  name: string | null;
  /** 标题里显示的展示名；不给就退回文件名。 */
  displayName?: string;
  /** 已经在用这一款：底部按钮显示"在用"态并禁用。 */
  active?: boolean;
  /** 底部「设为当前」；不给就只读（没有这颗按钮）。 */
  onActivate?: () => void;
  onClose: () => void;
}

export default function FontSampleModal({
  name,
  displayName,
  active = false,
  onActivate,
  onClose,
}: Props) {
  /** 最近一次加载结果，带上"是哪一款"：换一款字体时旧结果不能冒充新结果。 */
  const [result, setResult] = useState<{ name: string; load: LoadState } | null>(null);

  /**
   * 只有 jsdom 没有 CSS Font Loading：它不是"文件读不到"，按可显示处理（见文件头）。
   * 在渲染期判断而不是 effect 里 setState：这是**环境常量**，不是需要同步的外部状态。
   */
  const supported = typeof FontFace !== "undefined" && typeof document.fonts !== "undefined";
  const load: LoadState = !supported ? "ready" : result?.name === name ? result.load : "loading";

  useEffect(() => {
    if (!name || !supported) return undefined;
    let cancelled = false;
    // 已经 `add` 进 document.fonts 的那一份：清理时摘掉，否则它会一直占着解码后的字面。
    let added: FontFace | null = null;
    const face = new FontFace(SAMPLE_FAMILY, `url("${resumeFontPreviewUrl(name)}")`);
    face.load().then(
      (loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        added = loaded;
        setResult({ name, load: "ready" });
      },
      () => {
        if (cancelled) return;
        // 文件读不到（404 / 损坏）：交给界面说"不可用"，绝不静默回退系统字体。
        setResult({ name, load: "unavailable" });
      },
    );
    return () => {
      cancelled = true;
      if (added) document.fonts?.delete(added);
    };
  }, [name, supported]);

  const family = useMemo(() => `"${SAMPLE_FAMILY}", sans-serif`, []);
  const title = name
    ? `${t("fontDownload.sampleTitle")} · ${displayName || name}`
    : t("fontDownload.sampleTitle");

  return (
    <Modal
      open={name !== null}
      title={title}
      onCancel={onClose}
      // 只读弹窗：遮罩点击就能关（`popupStackGuard` 只约束含表单的写入弹窗）。
      mask={{ closable: true }}
      width={560}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          {t("common.action.close")}
        </Button>,
        onActivate ? (
          <Button key="use" type="primary" disabled={active} onClick={onActivate}>
            {active ? t("fontDownload.sampleActive") : t("fontDownload.sampleActivate")}
          </Button>
        ) : null,
      ]}
    >
      {load === "unavailable" ? (
        <Alert type="warning" showIcon title={t("fontDownload.sampleUnavailable")} />
      ) : (
        <div
          className="font-sample"
          style={{ fontFamily: family }}
          aria-busy={load === "loading"}
          data-testid="font-sample"
        >
          <div className="font-sample-title">{t("fontDownload.sampleLineTitle")}</div>
          <div className="font-sample-mixed">{t("fontDownload.sampleLineMixed")}</div>
          <div className="font-sample-punct">{t("fontDownload.sampleLinePunct")}</div>
          <div className="font-sample-bold">{t("fontDownload.sampleLineBold")}</div>
        </div>
      )}
    </Modal>
  );
}
