// SPDX-License-Identifier: Apache-2.0

/** 一份数据集：一整个数据库，可切换。 */
export interface DatasetInfo {
  id: string;
  name: string;
  /** 落盘的来源展示名（可能是中文，也可能是导入包里自定义的写法）。 */
  source: string;
  /** 来源的稳定代码（`machine` / `created` / `imported` / `restored` / `sample`）；旧后端没有。 */
  source_code?: string;
  size_bytes: number;
  created_at: string | null;
  is_active: boolean;
  exists: boolean;
}

/**
 * 导入备份包的结果。
 *
 * `restored_datasets` 只在两种情况出现：导入的是「导出全部数据集」产生的包（包里随行
 * 带了几份数据集），或那份数据集的路径校验没通过（整包拒收，不会有这个字段）。
 */
export interface DatasetImportResult extends DatasetInfo {
  /** 除主数据集之外随包恢复的那几份（只需 id/name 供界面点名）。 */
  restored_datasets?: Array<Pick<DatasetInfo, "id" | "name">>;
  /** 导出方勾选过「包含 API Key」时为 true：密钥已随包恢复（解不开时仍需重填）。 */
  api_key_included?: boolean;
  /**
   * 恢复过程中确实出现过的问题（附件缺失/内容与清单不符/行数对不上）。RR-03 起：
   * 附件完整性问题默认让整次导入**在写盘前**失败；只有用户显式选择"跳过有问题的
   * 附件"时才会带着这些问题继续，那时这里的每一条都要展示给用户。
   */
  asset_issues?: string[];
  /** 导出时就已知的"这份备份不完整"（附件缺失或与登记哈希不符）。 */
  backup_asset_warnings?: string[];
  /** 上面两类问题任一非空时为 true：界面不得把它呈现成"完整恢复"。 */
  assets_incomplete?: boolean;
  /**
   * 备份包里的全局模型配置合并结果（格式 5）。旧包没有这一段；`error` 表示配置段
   * 损坏或合并失败——数据集本身已恢复，界面只提示配置没回来。
   */
  global_llm?: {
    imported?: number;
    updated?: number;
    skipped?: number;
    invalid?: number;
    active?: boolean;
    profiles?: number;
    error?: string;
  };
  /**
   * 实际恢复到本机 `data/fonts/` 的字体文件数（只在包内带字体时出现）。
   *
   * 字体与附件是两套口径：字体是"导出 PDF 用的资源"，不是简历引用的附件文件。所以
   * 字体没能完全恢复**不算**这份备份「不完整」，`asset_issues` / `assets_incomplete`
   * 也不包含字体问题——它们的文案是"附件不完整"，混进去会让用户以为简历里的附件丢了。
   */
  restored_fonts?: number;
  /** 本机已有同名文件、为免覆盖用户现有字体而保留本机版本的字体数。 */
  skipped_fonts?: number;
  /** 是否把包里的「当前字体」设成了本机当前字体（本机已有其它选择时可能为 false）。 */
  active_font_set?: boolean;
  /**
   * 字体**未能完全恢复**的原因（如单个文件校验失败、超出体积上限）。与附件问题分开
   * 展示：这些只影响 PDF 导出的字形，不影响这份备份里的数据是否完整。
   */
  font_issues?: string[];
  /**
   * R16 嵌套整包：逐份的结果。整包不再"要么全成、要么不动"——一份子包坏了只跳过
   * 那一份，所以失败/跳过的每一份都要能点名给用户看。
   */
  failed?: DatasetImportIssue[];
  skipped?: DatasetImportIssue[];
  summary?: { restored: number; skipped: number; failed: number };
}

/** 嵌套整包里单份数据集没恢复成功（或没被导入）的原因，直接展示给用户。 */
export interface DatasetImportIssue {
  id?: string;
  name?: string;
  error: string;
}
