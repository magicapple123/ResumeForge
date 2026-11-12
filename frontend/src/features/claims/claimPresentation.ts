// SPDX-License-Identifier: Apache-2.0
import type { VerificationStatus } from "../../types";

// Shared by the ledger and resume evidence view: a status must keep the same color.
export const STATUS_COLORS: Record<VerificationStatus, string> = {
  已确认: "green",
  待确认: "gold",
  已过期: "volcano",
  不采用: "default",
};

export const RESPONSIBILITY_COLORS: Record<string, string> = {
  参与: "default",
  负责模块: "blue",
  主导方案或交付: "purple",
  项目负责人: "magenta",
};

function ownColor(colors: Readonly<Record<string, string>>, value: string): string {
  return Object.prototype.hasOwnProperty.call(colors, value)
    ? (colors[value] ?? "default")
    : "default";
}

export function claimStatusColor(value: string): string {
  return ownColor(STATUS_COLORS, value);
}

export function claimResponsibilityColor(value: string): string {
  return ownColor(RESPONSIBILITY_COLORS, value);
}
