// SPDX-License-Identifier: Apache-2.0
/** 提醒表单的默认值：新建提醒的时间必须是**未来**，默认值本身就要合法。 */
import dayjs, { type Dayjs } from "dayjs";

/** 默认提醒时间：1 小时后（抹到分钟）——不是"此刻"。 */
export function defaultRemindAt(): Dayjs {
  return dayjs().add(1, "hour").startOf("minute");
}
