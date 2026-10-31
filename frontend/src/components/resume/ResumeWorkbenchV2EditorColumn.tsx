// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台中栏（v2）：DocumentEditor + 旧简历转换提示。
 *
 * 编辑器是受控的：所有改动经 onChange 回到宿主（工作台把它记进历史并标脏）；
 * 中栏不再持有表单实例，也没有第二份文档。
 *
 * 转换提示（backend ResumeOut.document_conversion）：旧简历第一次被读取时后端会做 v1→v2
 * 转换，这里把摘要显式告诉用户（识别了多少字段 / 保留了多少行 / 有哪些提醒），
 * 保存成功后宿主把 conversion 置空，提示自然消失。
 */
import { Alert, Button, Typography } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import type { DocumentConversionSummary } from "../../types/resume";
import type { DocumentFieldCatalog, ResumeDocument } from "../../types/resumeDocument";
import DocumentEditor from "../resume-editor/DocumentEditor";
import "./workbench-v2.css";

export interface ResumeWorkbenchV2EditorColumnProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  onHoverPath?: (path: string | null) => void;
  readOnly?: boolean;
  fieldCatalog?: DocumentFieldCatalog | null;
  onAddSection?: () => void;
  /** 旧简历转换摘要；null/缺省 = 不显示（本来就是 v2 或保存后）。 */
  conversion?: DocumentConversionSummary | null;
  onDismissConversion?: () => void;
  /** 中栏顶部的「从资料填入」入口（ProfileFillMenu；由宿主构造，组件本身只读文档+onChange）。 */
  fillMenu?: ReactNode;
}

export default function ResumeWorkbenchV2EditorColumn({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  onHoverPath,
  readOnly = false,
  fieldCatalog = null,
  onAddSection,
  conversion = null,
  onDismissConversion,
  fillMenu = null,
}: ResumeWorkbenchV2EditorColumnProps) {
  useLocale();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const warnings = conversion?.warnings ?? [];
  return (
    <div className="resume-wb-v2-editor">
      {conversion ? (
        <Alert
          type="info"
          showIcon
          className="resume-wb-v2-conversion"
          title={t("document.conversion.title")}
          description={
            <div className="resume-wb-v2-conversion-body">
              <div>{t("document.conversion.body")}</div>
              <div className="resume-wb-v2-conversion-actions">
                <Button size="small" type="link" onClick={() => setSummaryOpen((open) => !open)}>
                  {t("document.conversion.summary")}
                </Button>
                {onDismissConversion ? (
                  <Button size="small" type="link" onClick={onDismissConversion}>
                    {t("document.conversion.dismiss")}
                  </Button>
                ) : null}
              </div>
              {summaryOpen ? (
                <div className="resume-wb-v2-conversion-summary">
                  <div>
                    {t("structure.conversion.fields", { count: conversion.fields_recognized })}
                  </div>
                  <div>
                    {t("structure.conversion.lines", { count: conversion.lines_preserved })}
                  </div>
                  {conversion.empty_sections.length > 0 ? (
                    <div>
                      {t("structure.conversion.emptySections", {
                        sections: conversion.empty_sections.join("\u3001"),
                      })}
                    </div>
                  ) : null}
                  {warnings.length > 0 ? (
                    <div>
                      <Typography.Text strong>{t("structure.conversion.warnings")}</Typography.Text>
                      <ul>
                        {warnings.map((warning, index) => (
                          <li key={`${index}-${warning}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
        />
      ) : null}
      {fillMenu ? <div className="resume-wb-v2-fill-menu">{fillMenu}</div> : null}
      <DocumentEditor
        document={document}
        onChange={onChange}
        selectedPath={selectedPath}
        onSelectPath={onSelectPath}
        onHoverPath={onHoverPath}
        readOnly={readOnly}
        fieldCatalog={fieldCatalog}
        onAddSection={onAddSection}
      />
    </div>
  );
}
