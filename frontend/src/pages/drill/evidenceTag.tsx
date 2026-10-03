import { Tag, Tooltip } from "antd";
import type { EvidenceStatus } from "../../types";
import { EVIDENCE_COLORS, EVIDENCE_HINTS, EVIDENCE_LABELS } from "../../types";

export function evidenceTag(status: EvidenceStatus) {
  return (
    <Tooltip key={status} title={EVIDENCE_HINTS[status]}>
      <Tag color={EVIDENCE_COLORS[status]}>{EVIDENCE_LABELS[status]}</Tag>
    </Tooltip>
  );
}
