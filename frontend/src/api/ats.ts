// SPDX-License-Identifier: Apache-2.0
/** ATS 本地检测接口。 */
import type { AtsCheckResult } from "../types/ats";
import { request } from "./client";

export function runAtsCheck(id: number, jdText: string): Promise<AtsCheckResult> {
  return request(`/resumes/${id}/ats-check`, {
    method: "POST",
    body: JSON.stringify({ jd_text: jdText }),
  });
}
