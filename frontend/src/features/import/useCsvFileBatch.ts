// SPDX-License-Identifier: Apache-2.0
/**
 * CSV 批量导入的共用状态机（R1）：一次选/拖/粘贴多个文件，逐文件解析、合并去重、
 * 按后端硬上限分块提交。
 *
 * 为什么抽成 hook：岗位广场与备选岗位两个导入弹窗是同一套两步流（预览 → 确认），
 * 差别只在「哪一列算身份」和「调哪个接口」。把它们共有的部分（串行解析、坏文件隔离、
 * 去重、上限、分块账目）收敛到一处，才能保证两个入口对"最多几个文件、一次几行、
 * 重试时已导入多少"给出**同一套说法**。
 *
 * 三个刻意的做法：
 * 1. **串行解析**：后端每次解析都要读完整文件，多文件并发只会抢带宽并让进度条乱跳；
 *    串行也让"哪个文件失败"与界面上的顺序一一对应。
 * 2. **坏文件只标记自己**：一个文件的解析异常不能把整批拖下水——用户选 5 个文件时，
 *    最需要的是"另外 4 个照常能导"。
 * 3. **超上限拒绝而不是静默截断**：截断会让用户以为全导进去了，事后才发现少了行。
 */
import { useCallback, useMemo, useRef, useState } from "react";

/** 一次最多选几个文件（与后端单文件 2MB 限制配合，避免一次提交压垮浏览器）。 */
export const CSV_MAX_FILES = 10;
/** 合并后最多多少行；后端单次提交硬上限是 500，这里只是前端的分批阈值。 */
export const CSV_MAX_ROWS = 2000;
/** 提交时每块多少行：与后端 `MAX_IMPORT_ROWS` 一致，超过就会被 422 拒绝。 */
export const CSV_CHUNK_SIZE = 500;

export const CSV_TOO_MANY_FILES_MESSAGE = "一次最多 10 个 CSV 文件";
export const CSV_TOO_MANY_ROWS_MESSAGE = "合计超过 2000 行，请分批导入";

export type CsvFileStatus = "pending" | "parsing" | "ok" | "error";

/** 单个文件的解析与合并结果。`importable` / `duplicates` 是合并视角下的统计。 */
export interface CsvFileResult<TRows, TError> {
  /** 稳定的内部标识：同名文件选两次也是两条记录，删除时按它定位。 */
  id: string;
  file: string;
  status: CsvFileStatus;
  rows: TRows[];
  errors: TError[];
  /** 解析失败时的原因（status === "error" 才有）。 */
  message?: string;
  /** 去重后真正会提交的行数。 */
  importable: number;
  /** 该文件里因重复被丢弃的行数。 */
  duplicates: number;
  /** 该文件里解析报错的行数。 */
  errorCount: number;
}

export interface CsvParseResult<TRows, TError> {
  rows: TRows[];
  errors: TError[];
}

export interface UseCsvFileBatchOptions<TRows extends object, TError extends object> {
  parseFile: (file: File) => Promise<CsvParseResult<TRows, TError>>;
  /**
   * 去重键（已归一化的字符串）：返回空串表示这一行不参与去重。
   * 岗位用 `company|title|source_url`，备选岗位用 `title|source_url`。
   */
  dedupeKey?: (row: TRows) => string;
  maxFiles?: number;
  maxRows?: number;
}

export interface CsvFileBatch<TRows extends object, TError extends object> {
  files: CsvFileResult<TRows, TError>[];
  parsing: boolean;
  addFiles: (incoming: FileList | File[]) => Promise<void>;
  removeFile: (id: string) => void;
  reset: () => void;
  /** 合并后的可导入行，每条带 `sourceFile`，方便错误/预览里说清来自哪个文件。 */
  rows: (TRows & { sourceFile: string })[];
  /** 合并后的逐行错误，每条带 `sourceFile`。 */
  errors: (TError & { sourceFile: string })[];
  /** 因重复被丢弃的行总数。 */
  duplicates: number;
  canCommit: boolean;
  /** 需要提示给用户的上限文案（空串=无）。 */
  notice: string;
}

/** 内部状态：只放解析的原始结果，合并统计在渲染期算（删文件后自动重算）。 */
interface ParsedFile<TRows extends object, TError extends object> {
  id: string;
  file: string;
  status: CsvFileStatus;
  rows: TRows[];
  errors: TError[];
  message?: string;
}

export function useCsvFileBatch<TRows extends object, TError extends object>({
  parseFile,
  dedupeKey,
  maxFiles = CSV_MAX_FILES,
  maxRows = CSV_MAX_ROWS,
}: UseCsvFileBatchOptions<TRows, TError>): CsvFileBatch<TRows, TError> {
  const [parsedFiles, setParsedFiles] = useState<ParsedFile<TRows, TError>[]>([]);
  const [parsing, setParsing] = useState(false);
  const [notice, setNotice] = useState("");
  // 状态之外再留一份镜像：`addFiles` 是异步的，判断"再加会不会超过 10 个"必须读
  // 最新的已选列表，不能依赖闭包里的旧值。
  const filesRef = useRef<ParsedFile<TRows, TError>[]>([]);
  const nextIdRef = useRef(0);
  const pendingRef = useRef(0);

  const applyFiles = useCallback(
    (updater: (previous: ParsedFile<TRows, TError>[]) => ParsedFile<TRows, TError>[]) => {
      filesRef.current = updater(filesRef.current);
      setParsedFiles(filesRef.current);
    },
    [],
  );

  const addFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (list.length === 0) return;
      // 文件数上限：整批拒绝。只导前 10 个会让用户以为剩下的也进了。
      if (filesRef.current.length + list.length > maxFiles) {
        setNotice(CSV_TOO_MANY_FILES_MESSAGE);
        return;
      }
      setNotice("");
      pendingRef.current += 1;
      setParsing(true);
      try {
        for (const file of list) {
          const id = `f${nextIdRef.current++}`;
          applyFiles((previous) => [
            ...previous,
            { id, file: file.name, status: "parsing", rows: [], errors: [] },
          ]);
          try {
            const result = await parseFile(file);
            applyFiles((previous) =>
              previous.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      status: "ok",
                      rows: result.rows ?? [],
                      errors: result.errors ?? [],
                    }
                  : item,
              ),
            );
          } catch (error) {
            // 坏文件只标记自己：其它文件照常可导入。
            applyFiles((previous) =>
              previous.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      status: "error",
                      rows: [],
                      errors: [],
                      message: error instanceof Error ? error.message : "解析 CSV 失败",
                    }
                  : item,
              ),
            );
          }
        }
      } finally {
        pendingRef.current -= 1;
        setParsing(pendingRef.current > 0);
      }
    },
    [applyFiles, maxFiles, parseFile],
  );

  const removeFile = useCallback(
    (id: string) => {
      applyFiles((previous) => previous.filter((item) => item.id !== id));
      setNotice("");
    },
    [applyFiles],
  );

  const reset = useCallback(() => {
    filesRef.current = [];
    setParsedFiles([]);
    setNotice("");
  }, []);

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const rows: (TRows & { sourceFile: string })[] = [];
    const errors: (TError & { sourceFile: string })[] = [];
    const stats = new Map<string, { importable: number; duplicates: number }>();
    let duplicates = 0;
    for (const item of parsedFiles) {
      const stat = { importable: 0, duplicates: 0 };
      stats.set(item.id, stat);
      if (item.status !== "ok") continue;
      for (const row of item.rows) {
        const key = dedupeKey ? dedupeKey(row).trim() : "";
        if (key) {
          if (seen.has(key)) {
            stat.duplicates += 1;
            duplicates += 1;
            continue;
          }
          seen.add(key);
        }
        stat.importable += 1;
        rows.push({ ...row, sourceFile: item.file });
      }
      for (const error of item.errors) errors.push({ ...error, sourceFile: item.file });
    }
    return { rows, errors, duplicates, stats, limitExceeded: rows.length > maxRows };
  }, [dedupeKey, maxRows, parsedFiles]);

  const files = useMemo<CsvFileResult<TRows, TError>[]>(
    () =>
      parsedFiles.map((item) => ({
        ...item,
        importable: merged.stats.get(item.id)?.importable ?? 0,
        duplicates: merged.stats.get(item.id)?.duplicates ?? 0,
        errorCount: item.errors.length,
      })),
    [merged.stats, parsedFiles],
  );

  return {
    files,
    parsing,
    addFiles,
    removeFile,
    reset,
    rows: merged.rows,
    errors: merged.errors,
    duplicates: merged.duplicates,
    canCommit: files.length > 0 && !parsing && !merged.limitExceeded && merged.rows.length > 0,
    notice: merged.limitExceeded ? CSV_TOO_MANY_ROWS_MESSAGE : notice,
  };
}

/** 把待提交行按 `size` 切块（默认 500，与后端单次上限一致）。 */
export function chunkRows<TRow>(rows: TRow[], size: number = CSV_CHUNK_SIZE): TRow[][] {
  const step = size > 0 ? size : CSV_CHUNK_SIZE;
  const chunks: TRow[][] = [];
  for (let index = 0; index < rows.length; index += step) {
    chunks.push(rows.slice(index, index + step));
  }
  return chunks;
}

export interface CsvChunkCommit<TRow, TError> {
  rows: TRow[];
  /** 提交一块；返回值与后端响应的账目字段一致。 */
  commitRows: (chunk: TRow[]) => Promise<{ imported: number; failed: TError[] }>;
  chunkSize?: number;
}

export interface CsvCommitOutcome<TError> {
  imported: number;
  failed: TError[];
  /** 第几块（1 基）请求失败；全部成功时为 undefined，此时后续块不再提交。 */
  failedChunk?: number;
  /** 失败块的原因文案（由调用方展示）。 */
  failedMessage?: string;
}

/**
 * 按块顺序提交。任一块抛错就停在这里：继续提交既可能重复入库，也会让"已导入 N 条"
 * 这个账目失去意义。
 */
export async function commitRowsInChunks<TRow, TError>({
  rows,
  commitRows,
  chunkSize = CSV_CHUNK_SIZE,
}: CsvChunkCommit<TRow, TError>): Promise<CsvCommitOutcome<TError>> {
  const chunks = chunkRows(rows, chunkSize);
  const failed: TError[] = [];
  let imported = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    try {
      const result = await commitRows(chunks[index]);
      imported += result.imported;
      failed.push(...result.failed);
    } catch (error) {
      return {
        imported,
        failed,
        failedChunk: index + 1,
        failedMessage: error instanceof Error ? error.message : "导入失败",
      };
    }
  }
  return { imported, failed };
}
