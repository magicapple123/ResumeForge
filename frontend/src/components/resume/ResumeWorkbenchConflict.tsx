// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的**版本冲突条**（W02 / A06 / R02）：保存被 409 拦下后的唯一出口。
 *
 * 为什么不是弹窗：冲突不是"再来一层确认"，而是一次**必须处理的状态**——它挡着保存，
 * 但用户可以继续看内容、对比、决定。做成浮层挂在动作条下方（`.resume-wb-body` 已是
 * `position: relative`），既不新增第二层 Modal（叠层守卫），也不会让用户以为保存成功了。
 *
 * 三个动作都能落地（W00 §4.2 的契约）：
 *
 * | 动作 | 实现 | 用户拿到什么 |
 * | --- | --- | --- |
 * | 用最新的 | GET 最新 → 宿主替换 detail/html/layout + 清 overlay/草稿 | 服务端那一版（本地改动丢弃） |
 * | 比较差异 | GET 最新 → `summarizeDraftDiff(本地, 最新)` 逐字段列出 | 决定依据，不写库 |
 * | 另存副本 | `POST /resumes/manual`（draft=false，标题带（副本），内容取本地） | 本地这份变成新简历，原记录不动 |
 *
 * **没有"再点一次保存"**：那条路就是硬覆盖，正是 W02 要消灭的缺陷。所以冲突期间制作台
 * 的保存/取消失效，只有这三颗按钮可点。
 */
import { Alert, Button, Space, Typography } from "antd";
import { App } from "antd";
import { useCallback, useState } from "react";
import { createManualResume, getResume } from "../../api/resumes";
import type { ResumeContent, ResumeDetail, ResumeLanguage } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import { summarizeDraftDiff, type DraftDiffEntry } from "../../utils/draftDiff";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  resumeId: number;
  /** 记录原标题：另存副本的标题 = 原标题 +（副本）。 */
  resumeTitle: string;
  resumeLanguage?: ResumeLanguage;
  /** Read the current document without constructing an older content model. */
  readLocalContent: () => ResumeContent | ResumeDocument | null;
  /**
   * 本地还没保存的 v2 文档（"另存副本"取它）：v2 文案就是服务端要的格式，
   * 不能拿 v1 投影副本去建新记录。
   */
  readLocalDocument?: () => ResumeDocument | null;
  /** 宿主注入的"另存副本"（走条件写宿主，标题带（副本））。 */
  saveAsCopy?: (content: ResumeDocument) => Promise<ResumeDetail>;
  /** 「用最新的」：把服务端最新交给宿主（替换 detail/html/layout、清 overlay 与草稿）。 */
  onAdoptLatest: (latest: ResumeDetail) => Promise<void> | void;
  /** 冲突已处理完（用最新的 / 另存副本成功）：宿主清冲突态、恢复动作条。 */
  onResolved: () => void;
  /** 副本建好之后的刷新入口（宿主 bumpResumeList；制作台自己不需要它）。 */
  onCopyCreated?: (copy: ResumeDetail) => void;
}

type Busy = "latest" | "compare" | "copy" | null;

export default function ResumeWorkbenchConflict({
  resumeId,
  resumeTitle,
  resumeLanguage = "zh-CN",
  readLocalContent,
  readLocalDocument,
  saveAsCopy,
  onAdoptLatest,
  onResolved,
  onCopyCreated,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [busy, setBusy] = useState<Busy>(null);
  const [diff, setDiff] = useState<DraftDiffEntry[] | null>(null);

  /** 读服务端最新：三个动作都要它，失败信息统一给一句"没读到最新版本"。 */
  const fetchLatest = useCallback(async (): Promise<ResumeDetail | null> => {
    try {
      return await getResume(resumeId);
    } catch {
      message.error(t("workbench.conflict.use-latest.failed"));
      return null;
    }
  }, [message, resumeId]);

  const adoptLatestVersion = async (): Promise<void> => {
    setBusy("latest");
    try {
      const latest = await fetchLatest();
      if (!latest) return;
      await onAdoptLatest(latest);
      onResolved();
      message.success(t("workbench.conflict.use-latest.done"));
    } finally {
      setBusy(null);
    }
  };

  const compare = async (): Promise<void> => {
    setBusy("compare");
    try {
      const latest = await fetchLatest();
      if (!latest) return;
      const local = readLocalContent();
      setDiff(local ? summarizeDraftDiff(local, latest.content) : []);
    } finally {
      setBusy(null);
    }
  };

  /**
   * 另存副本：先建新记录，再把原记录同步成最新。
   *
   * 两步都要做，只做第一步会让界面停在"原记录还是旧版、本地又脏"的死结里——用户点保存
   * 立刻又撞一次同一个冲突。副本成功之后本地改动的价值已经落地，所以第二步失败也只提示
   * "副本已保存、原简历没同步"，不再把冲突条挂回来（那会让用户以为副本也没成）。
   */
  const saveCopy = async (): Promise<void> => {
    const localDocument = readLocalDocument?.() ?? null;
    const local = readLocalContent();
    if (!local && !localDocument) return;
    setBusy("copy");
    try {
      const copy =
        saveAsCopy && localDocument
          ? await saveAsCopy(localDocument)
          : await createManualResume({
              title: t("workbench.conflict.copy.title", { title: resumeTitle }),
              // 旧宿主（v1 工作台，已停用）：把投影当 v2 传，只为让旧链路编译与旧测试可跑，
              // 新宿主一定走上面的 saveAsCopy 分支。
              content: local as unknown as ResumeDocument,
              draft: false,
              language: resumeLanguage,
            });
      onCopyCreated?.(copy);
      message.success(t("workbench.conflict.copy.done", { title: copy.title }));
      const latest = await fetchLatest();
      if (latest) await onAdoptLatest(latest);
      if (!latest) message.warning(t("workbench.conflict.copy-sync.failed"));
      onResolved();
    } catch {
      message.error(t("workbench.conflict.copy.failed"));
    } finally {
      setBusy(null);
    }
  };

  const actions = (
    <Space wrap size={8}>
      <Button
        type="primary"
        size="small"
        loading={busy === "latest"}
        onClick={() => void adoptLatestVersion()}
      >
        {t("workbench.conflict.action.use-latest")}
      </Button>
      <Button size="small" loading={busy === "compare"} onClick={() => void compare()}>
        {t("workbench.conflict.action.compare")}
      </Button>
      <Button size="small" loading={busy === "copy"} onClick={() => void saveCopy()}>
        {t("workbench.conflict.action.save-copy")}
      </Button>
    </Space>
  );

  const body = (
    <>
      <Alert
        type="warning"
        showIcon
        title={t("workbench.conflict.title")}
        // 三个动作在标题下方一行：让"发生了什么"和"能怎么办"同时可见。
        description={
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text>{t("workbench.conflict.body")}</Typography.Text>
            {actions}
          </Space>
        }
      />
      {diff ? (
        <div className="resume-wb-conflict-diff" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
            <Typography.Text strong>{t("workbench.conflict.compare.local")}</Typography.Text>
            <Typography.Text type="secondary">→</Typography.Text>
            <Typography.Text strong>{t("workbench.conflict.compare.latest")}</Typography.Text>
          </div>
          {diff.length === 0 ? (
            <Typography.Text type="secondary">
              {t("workbench.conflict.compare.empty")}
            </Typography.Text>
          ) : (
            <div style={{ maxHeight: 200, overflowY: "auto", display: "grid", gap: 4 }}>
              {diff.map((entry) => (
                <div key={entry.label} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                  <span style={{ minWidth: 96, color: "var(--rf-text-secondary)" }}>
                    {entry.label}
                  </span>
                  <span style={{ flex: "1 1 0", wordBreak: "break-word" }}>{entry.before}</span>
                  <span style={{ color: "var(--rf-text-secondary)" }}>→</span>
                  <span style={{ flex: "1 1 0", wordBreak: "break-word" }}>{entry.after}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </>
  );

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        zIndex: 20,
        maxHeight: "70%",
        padding: "12px 16px",
        overflowY: "auto",
        background: "var(--rf-surface)",
        borderBottom: "1px solid var(--rf-border)",
      }}
    >
      {body}
    </div>
  );
}
