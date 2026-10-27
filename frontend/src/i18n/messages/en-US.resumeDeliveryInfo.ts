// SPDX-License-Identifier: Apache-2.0
/**
 * Delivery info strip: Resume version lineage and delivery records.
 *
 * Covers delivery source labels, the per-record prefix/suffix that keeps "tracked" and
 * "exported" from reading as a real application, destination fallbacks, and the archive
 * download toasts. Retry is the shared `common.retry` action.
 */
const resumeDeliveryInfo = {
  "resumeDeliveryInfo.source.apply": "Apply desk",
  "resumeDeliveryInfo.source.track": "Progress link",
  "resumeDeliveryInfo.source.export": "Export archive",

  "resumeDeliveryInfo.prefix.apply": "Applied to",
  "resumeDeliveryInfo.prefix.track": "Progress link: ",
  "resumeDeliveryInfo.prefix.export": "Export archive: ",
  "resumeDeliveryInfo.prefix.default": "Delivery record: ",

  "resumeDeliveryInfo.suffix.track": " (manually linked, not sent from the Apply desk)",
  "resumeDeliveryInfo.suffix.export": " (exported for the record; this does not mean it was sent)",

  "resumeDeliveryInfo.parent.derivedFrom": "Derived from Resume #{id}",

  "resumeDeliveryInfo.empty.standalone": "Standalone version; no delivery records yet",
  "resumeDeliveryInfo.error.loadFailed":
    "Could not load delivery records (this is not the same as having none); try again",

  "resumeDeliveryInfo.destination.missing": "Destination not recorded (older snapshot)",
  "resumeDeliveryInfo.destination.companyUnknown": "(Company unknown)",
  "resumeDeliveryInfo.destination.jobUnknown": "(Job unknown)",

  "resumeDeliveryInfo.download.action": "Download archive",
  "resumeDeliveryInfo.download.replayed":
    "Downloaded the version regenerated from the archive (original artifact fingerprint {hash}…); each regeneration may differ slightly (for example, random values on the page), but the content matches what was delivered.",
  "resumeDeliveryInfo.download.success": "Delivery archive downloaded",
  "resumeDeliveryInfo.download.failed": "Could not download the delivery archive",
} as const;

export default resumeDeliveryInfo;
