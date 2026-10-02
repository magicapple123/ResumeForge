/**
 * Listy 行内边距常量：迁移自弃用的 List，用于按语义 styles 还原原密度。
 * - List 默认行内边距为 12px 0；
 * - List size="small" 为 8px 16px（对应 token paddingContentVerticalSM / paddingContentHorizontal）。
 */
export const LISTY_ITEM_PADDING_DEFAULT = { paddingBlock: 12, paddingInline: 0 } as const;

/** Listy 的行内边距：还原 List size="small"（8px 16px）的密度。 */
export const LISTY_ITEM_PADDING_SMALL = { paddingBlock: 8, paddingInline: 16 } as const;
