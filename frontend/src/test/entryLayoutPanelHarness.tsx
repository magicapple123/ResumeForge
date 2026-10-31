// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」测试的受控 Harness（只导出组件，满足 react-refresh 规则）。
 *
 * 面板写回后立刻 re-render，与真实宿主（工作台历史/保存）的行为一致；
 * 纯数据夹具在 `entryLayoutPanelFixtures.ts`。
 */
import { useState } from "react";
import type { DocumentFieldCatalog, ResumeDocument } from "../types/resumeDocument";
import EntryLayoutPanel from "../components/resume/EntryLayoutPanel";

export function Harness({
  initial,
  selectedPath,
  onChange,
  fieldCatalog,
  onNotice,
}: {
  initial: ResumeDocument;
  selectedPath?: string | null;
  onChange?: (doc: ResumeDocument) => void;
  fieldCatalog?: DocumentFieldCatalog | null;
  onNotice?: (message: string) => void;
}) {
  const [document, setDocument] = useState(initial);
  return (
    <EntryLayoutPanel
      document={document}
      selectedPath={selectedPath}
      fieldCatalog={fieldCatalog}
      onNotice={onNotice}
      onChange={(next) => {
        setDocument(next);
        onChange?.(next);
      }}
    />
  );
}
