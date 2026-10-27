// SPDX-License-Identifier: Apache-2.0
/** 导出面板的文案（与 zh-CN.exportPanel.ts 一一对应）。 */
const exportPanel = {
  "exportPanel.title": "Export",
  "exportPanel.action.print": "Browser print",
  "exportPanel.format.title": "Format",
  "exportPanel.format.includePhoto": "Include photo",
  "exportPanel.format.pdfNote":
    "PDF and Word are typeset by the server so the text stays selectable; for custom HTML layouts, open the HTML file in a browser and print from there.",
  "exportPanel.format.pngNote":
    "Images are rendered page by page from the same PDF (300 dpi); multiple pages are packed into one zip.",
  "exportPanel.watermark.title": "Watermark",
  "exportPanel.watermark.aria": "Enable watermark",
  "exportPanel.watermark.placeholder": "Watermark text, e.g. Internal use only",
  "exportPanel.redact.title": "Redaction",
  "exportPanel.redact.aria": "Enable redaction",
  "exportPanel.font.missingPdf":
    "No Chinese font was found on this system; generate the PDF with Browser print instead.",
  "exportPanel.font.missingImage":
    "No Chinese font was found on this system, so images cannot be generated yet; export a PDF with Browser print first.",
  "exportPanel.toast.packDone": "{pages} pages packed into {filename}",
  "exportPanel.toast.needFormat": "Select at least one export format",
  "exportPanel.toast.savedTo": "Saved to {path}",
  "exportPanel.toast.savedBoth": "Also saved to {path}",
  "exportPanel.toast.overLimit":
    "“{format}” is {pages} pages, over the {limit}-page limit you selected.",
  "exportPanel.toast.started": "Export started",
  "exportPanel.toast.failed": "Export failed",
  "exportPanel.toast.printFailed": "Could not open the print window",
  "exportPanel.fileName": "{record}-Resume.pdf",

  "exportPanel.format.pdf": "PDF",
  "exportPanel.format.docx": "Word",
  "exportPanel.format.html": "HTML",
  "exportPanel.format.md": "Markdown",
  "exportPanel.format.txt": "Plain text",
  "exportPanel.format.json": "JSON",
  "exportPanel.format.png": "Image (PNG)",
  "exportPanel.format.pngHint":
    "Images are for job boards that require an image upload; use PDF when the application goes through ATS screening.",
  "exportPanel.redact.name": "Name",
  "exportPanel.redact.phone": "Phone",
  "exportPanel.redact.email": "Email",
  "exportPanel.redact.github": "GitHub",
  "exportPanel.redact.website": "Personal website",
  "exportPanel.redact.company": "Company",
  "exportPanel.redact.school": "School",
  "exportPanel.redact.project": "Project",
  "exportPanel.redact.product": "Product name (in body text)",
} as const;

export default exportPanel;
