// SPDX-License-Identifier: Apache-2.0
/**
 * App-wide file drop (`components/GlobalFileDrop.tsx`): the drop overlay, the
 * `.zip` backup import confirmation, `.json` resume creation, the `.csv`
 * hand-off to the Jobs page, and the prompts for several files or unsupported types.
 *
 * Cancel reuses `common.action.cancel`.
 */
const globalFileDrop = {
  "globalFileDrop.dragOverlay.title": "Drop to import",
  "globalFileDrop.dragOverlay.hint":
    "Supports .zip dataset backups, .csv job tables and .json resume content",

  "globalFileDrop.zipImport.title": "Import this backup as a new dataset?",
  "globalFileDrop.zipImport.content":
    "{name} will be added as a new dataset. The data you are using now stays untouched, and you can switch to it at any time.",
  "globalFileDrop.zipImport.confirm": "Import",
  "globalFileDrop.zipImport.success": "Imported dataset “{name}”",

  "globalFileDrop.jsonImport.title": "Create a resume from this JSON?",
  "globalFileDrop.jsonImport.content":
    "{name} will be saved as a new manual resume, with its body filled in from the file.",
  "globalFileDrop.jsonImport.confirm": "Create resume",
  "globalFileDrop.jsonImport.parseError":
    "This JSON could not be parsed; check that the file is not damaged",
  "globalFileDrop.jsonImport.shapeError":
    "The JSON must be a single resume object with fields such as name and experience",
  "globalFileDrop.jsonImport.success": "Created resume “{name}”",

  "globalFileDrop.csvImport.title": "Import CSV from the Jobs page",
  "globalFileDrop.csvImport.content":
    "Import CSV on the Jobs page accepts several files at once, lets you paste table content directly, and previews each row before importing.",
  "globalFileDrop.csvImport.confirm": "Go to Jobs",

  "globalFileDrop.fileInfo.multiple":
    "Drop one file at a time. To select several job CSVs, use Import CSV on the Jobs page",
  "globalFileDrop.fileInfo.unsupported":
    "Unsupported file type “{extension}”. You can drop {formats} (.zip for a dataset backup, .csv for a job table and .json for resume content)",

  "globalFileDrop.resume.defaultTitle": "Imported resume",
} as const;

export default globalFileDrop;
