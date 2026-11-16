// SPDX-License-Identifier: Apache-2.0
/**
 * 兼容转发：**这一行的实现在 `ConnectionListRow.tsx`**。
 *
 * issue I-09 把 A/B 组的 `ConnectionRow` 与 C 组 `SystemSourcesCard` 里内联的
 * `SystemRow` 合并成一个受控组件（`variant: "secret" | "value"`），避免两份几乎
 * 相同的实现继续漂移。本文件保留下来只为一件事：`connection-row` 这个类名与
 * `ConnectionRow` 这个导入路径在两处用例与旧调用点里出现过，删文件会让它们找不到模块。
 *
 * 新代码请直接 `import ConnectionListRow from "./ConnectionListRow"`，
 * 并显式传 `variant`。
 */

export { ConnectionListRow as default, ConnectionListRow } from "./ConnectionListRow";
export type { ConnectionListRowProps, ConnectionRowVariant } from "./ConnectionListRow";
