// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位详情（**抽屉内的一个视图**，不是弹窗）。
 *
 * 为什么要拆成视图：抽屉里再开 Modal 就是第二层容器（3300），焦点与读屏上下文都会跳走，
 * 关掉一层还要用户自己回到"刚才看的是哪条"。视图切换只换内容，标题栏与滚动位置都留在抽屉里。
 *
 * 纯展示：详情由抽屉按 id 取（卡片只放摘要，JD 可能很长，列表响应故意不带它）。
 */
import { FolderOpenOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Image, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { lookupUserFiles, openUserFile } from "../../../api/userFiles";
import { t } from "../../../i18n";
import { candidateJobSourceLabelKey } from "../../../i18n/enum/jobs";
import { useLocale } from "../../../i18n/i18nContext";
import type { CandidateJobDetail } from "../../../types";

interface Props {
  candidate: CandidateJobDetail | null;
  onEdit: (candidate: CandidateJobDetail) => void;
  /** 交给父级：关抽屉 + 打开正式岗位表单（预填这条候选）。 */
  onImport: (candidate: CandidateJobDetail) => void;
}

/** 四段正文：空的不出这一行。 */
function bodyItems(candidate: CandidateJobDetail) {
  const pairs: [string, string][] = [
    [t("jobs.candidate.detail.jd"), candidate.description],
    [t("jobs.candidate.detail.requirements"), candidate.requirements],
    [t("jobs.candidate.detail.additional"), candidate.additional_info],
    [t("jobs.candidate.detail.raw"), candidate.raw_text],
  ];
  return pairs
    .filter(([, body]) => Boolean(body))
    .map(([label, body]) => ({ key: label, label, children: body }));
}

export default function CandidateJobDetailView({ candidate, onEdit, onImport }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [openingIndex, setOpeningIndex] = useState<number | null>(null);

  // 截图保存时按数组顺序落了磁盘副本；反查结果按 id 升序，与保存顺序一致，按下标对得上。
  const openCopy = (index: number) => {
    if (!candidate) return;
    setOpeningIndex(index);
    void lookupUserFiles({
      source_type: "candidate_image",
      source_ref: `candidate_job:${candidate.id}`,
    })
      .then(async (result) => {
        const target = result.items[index];
        if (!target) return message.warning(t("jobs.candidate.detail.copy-missing"));
        await openUserFile(target.id);
        return message.success(t("jobs.candidate.detail.copy-opened"));
      })
      .catch((error: unknown) => {
        message.error(
          error instanceof Error ? error.message : t("jobs.candidate.detail.copy-failed"),
        );
      })
      .finally(() => setOpeningIndex(null));
  };

  if (!candidate) return null;

  // 来源是落库的协议值（或后端站点名）：能对上语言包就翻，站点名原样显示。
  const sourceKey = candidateJobSourceLabelKey(candidate.source);
  const sourceLabel = sourceKey
    ? t(sourceKey)
    : candidate.source || t("jobs.candidate.detail.source-manual");

  // 备选阶段不展示地点/薪资：真到投递的时候正式岗位里有更全的版本。
  const fields = [
    {
      key: "company",
      label: t("jobs.candidate.detail.company"),
      children: candidate.company || t("jobs.candidate.detail.company-unknown"),
    },
    {
      key: "source",
      label: t("jobs.candidate.detail.source"),
      children: (
        <Space>
          <Tag>{sourceLabel}</Tag>
          <Tag color={candidate.status === "imported" ? "green" : "orange"}>
            {candidate.status === "imported"
              ? t("jobs.candidate.detail.status-imported", { id: candidate.imported_job_id ?? "" })
              : t("jobs.candidate.detail.status-pending")}
          </Tag>
        </Space>
      ),
    },
    ...(candidate.source_url
      ? [
          {
            key: "url",
            label: t("jobs.candidate.detail.source-url"),
            children: (
              <Typography.Link
                href={candidate.source_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <LinkOutlined /> {t("jobs.candidate.detail.open-source")}
              </Typography.Link>
            ),
          },
        ]
      : []),
    ...bodyItems(candidate),
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Descriptions size="small" column={1} bordered items={fields} />
      {candidate.images.length > 0 ? (
        <section>
          <Typography.Title level={5}>{t("jobs.candidate.detail.images")}</Typography.Title>
          <Space wrap>
            {candidate.images.map((source, index) => (
              <Space key={`${index}-${source.slice(-16)}`} orientation="vertical" size={2}>
                <Image src={source} width={160} />
                <Button
                  type="link"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  loading={openingIndex === index}
                  onClick={() => openCopy(index)}
                >
                  {t("jobs.candidate.detail.open-copy")}
                </Button>
              </Space>
            ))}
          </Space>
        </section>
      ) : null}
      {candidate.note ? (
        <Typography.Text type="secondary">
          {t("jobs.candidate.detail.note", { note: candidate.note })}
        </Typography.Text>
      ) : null}
      <Space>
        <Button onClick={() => onEdit(candidate)}>{t("jobs.candidate.action.edit")}</Button>
        {candidate.status === "pending" ? (
          <Button type="primary" onClick={() => onImport(candidate)}>
            {t("jobs.candidate.action.import")}
          </Button>
        ) : null}
      </Space>
    </Space>
  );
}
