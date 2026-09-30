import type { WebFormField } from "../../types";

export function customFieldKey(label: string): string {
  return (
    "CUSTOM_" +
    label
      .trim()
      .replace(/\s+/g, "")
      .replace(/[ \t\r\n\-—–:：·.、,，*＊[\]【】()（）<>《》"'“”‘’]/g, "")
      .slice(0, 40)
  );
}

export function isCustomField(field: WebFormField): boolean {
  return field.key.startsWith("CUSTOM_");
}

export function normalizeFieldLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
