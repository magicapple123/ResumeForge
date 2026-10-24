// SPDX-License-Identifier: Apache-2.0
/** `useWorkbenchPreflight` 与 `PreflightModal` 共用的 props 类型（只做转出，避免 hook import JSX）。 */
import type PreflightModal from "./preflight/PreflightModal";
import type { ComponentProps } from "react";

export type PreflightModalProps = ComponentProps<typeof PreflightModal>;
