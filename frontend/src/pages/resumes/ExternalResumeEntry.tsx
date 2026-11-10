// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心筛选栏的「外部简历 N」入口（清单 §1.3 第 3 条）。
 *
 * 单独成组件是为了避开 `ResumesPage` 的行数预算（改前 483/500）：入口自己取计数，
 * 页面只多一行 JSX。
 *
 * 计数用 `page_size: 1` 拿 `total`，**不拉全量**；每次挂载取一次——从子页返回时
 * `ResumesPage` 会重新挂载，上传/删除后数字自然刷新，不需要额外的失效机制。
 * 数量为 0 时按钮仍在（否则空态入口永远找不到），只是不带数字。
 */
import { Button } from "antd";
import { useNavigate } from "react-router-dom";
import { listExternalResumes } from "../../api/externalResumes";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function ExternalResumeEntry() {
  useLocale();
  const navigate = useNavigate();
  const { data } = useApi(() => listExternalResumes({ page_size: 1 }), []);
  const total = data?.total ?? 0;
  // 不额外挂 aria-label：可见文本「外部简历 5」本身就是最好的可访问名。
  // 曾试过「外部简历，共 5 份」，但 axe 的 label-content-name-mismatch（serious）
  // 要求可访问名包含可见文本，两个措辞对不上就会红。
  return (
    <Button onClick={() => navigate("/resumes/external")}>
      {total > 0
        ? t("resumesPage.external.entryWithCount", { count: total })
        : t("resumesPage.external.entry")}
    </Button>
  );
}
