// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { EQUALITY_EXEMPT_KEYS } from "./equalityExemptions";
import {
  isAsciiEnglishSource,
  isAutomaticEqualityToken,
  placeholderSignature,
  validateMessageContract,
} from "./messageContract";

const SAVE = "\u4fdd\u5b58";
const EXEMPT_FIXTURES = {
  "resume.language.en-US": "English",
  "jobs.candidate.import.preview-meta": "{company} · {file}",
  "outline.canvas.highlight.style":
    "background: color-mix(in srgb, currentColor 14%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); border-radius: 2px",
  "research.publications.doiPlaceholder": "10.1000/xyz123",
  "research.publications.volumePagesPlaceholder": "Vol 12, 1-15",
  "typography.inline.linkPlaceholder": "https://example.com",
  "versions.variants.exportOption": "{name}{job}{layout}",
  "versions.variants.exportOption.job": " · {job}",
  "provenance.usage.tokens": "token",
  "trial.export.all": "HTML / PDF / Word",
} satisfies Record<keyof typeof EQUALITY_EXEMPT_KEYS, string>;

describe("message contract failure fixtures", () => {
  it("rejects equal source and English values", () => {
    expect(
      validateMessageContract({ "fixture.equal": SAVE }, { "fixture.equal": SAVE }),
    ).toContainEqual(expect.objectContaining({ code: "untranslated", key: "fixture.equal" }));
  });

  it("rejects CJK in an otherwise translated English value", () => {
    expect(
      validateMessageContract({ "fixture.cjk": SAVE }, { "fixture.cjk": `Save ${SAVE}` }),
    ).toContainEqual(expect.objectContaining({ code: "english-cjk", key: "fixture.cjk" }));
  });

  it("rejects a missing key in either language", () => {
    expect(validateMessageContract({ "fixture.missing": SAVE }, {})).toEqual([
      { code: "missing-key", key: "fixture.missing", detail: "Missing from en-US" },
    ]);
    expect(validateMessageContract({}, { "fixture.extra": "Save" })).toEqual([
      { code: "missing-key", key: "fixture.extra", detail: "Missing from zh-CN" },
    ]);
  });

  it("rejects placeholder name mismatches", () => {
    expect(
      validateMessageContract(
        { "fixture.params": `${SAVE} {name}` },
        { "fixture.params": "Save {title}" },
      ),
    ).toContainEqual(
      expect.objectContaining({ code: "placeholder-mismatch", key: "fixture.params" }),
    );
  });

  it("rejects placeholder occurrence count mismatches", () => {
    expect(
      validateMessageContract(
        { "fixture.params": `${SAVE} {name} {name}` },
        { "fixture.params": "Save {name}" },
      ),
    ).toContainEqual(
      expect.objectContaining({ code: "placeholder-mismatch", key: "fixture.params" }),
    );
  });

  it("accepts a translated fixture with identical placeholder occurrences in another order", () => {
    expect(
      validateMessageContract(
        { "fixture.valid": `${SAVE} {name} {count}` },
        { "fixture.valid": "Save {count} items for {name}" },
      ),
    ).toEqual([]);
    expect(placeholderSignature("{b}{a}{a}")).toEqual(["a", "a", "b"]);
  });
});

describe("automatic invariant tokens", () => {
  it.each(["PDF", "GitHub", "100%", "KB", "v2", "Word", "Markdown", "NSIS", "1:1"])(
    "allows the invariant token %s without a key registration",
    (value) => {
      expect(isAutomaticEqualityToken(value)).toBe(true);
      expect(
        validateMessageContract({ "fixture.token": value }, { "fixture.token": value }),
      ).toEqual([]);
    },
  );

  it.each(["PDF file", "Done.", "Ready!", "and", "or", "but", "1234567890123", ""])(
    "rejects %s as an automatic equality token",
    (value) => expect(isAutomaticEqualityToken(value)).toBe(false),
  );

  it.each(["Save", "Cancel", "English", "Save changes", "Ready", "SAVE", "DELETE", "SaveChanges"])(
    "does not mistake the ASCII English source %s for a technical token",
    (value) => {
      expect(isAsciiEnglishSource(value)).toBe(true);
      expect(
        validateMessageContract({ "fixture.prose": value }, { "fixture.prose": value }),
      ).toContainEqual(
        expect.objectContaining({ code: "source-ascii-english", key: "fixture.prose" }),
      );
    },
  );

  it("requires a key registration for an ASCII English source even if the values differ", () => {
    expect(
      validateMessageContract({ "fixture.prose": "Save changes" }, { "fixture.prose": "Save" }),
    ).toContainEqual(
      expect.objectContaining({ code: "source-ascii-english", key: "fixture.prose" }),
    );
  });
});

describe("documented invariant-key exceptions", () => {
  it("provides a reason and a successful equal-value fixture for every registered key", () => {
    expect(Object.keys(EXEMPT_FIXTURES).sort()).toEqual(Object.keys(EQUALITY_EXEMPT_KEYS).sort());
    for (const [key, reason] of Object.entries(EQUALITY_EXEMPT_KEYS)) {
      expect(reason.trim().length).toBeGreaterThan(0);
      const value = EXEMPT_FIXTURES[key as keyof typeof EXEMPT_FIXTURES];
      expect(validateMessageContract({ [key]: value }, { [key]: value })).toEqual([]);
    }
  });

  it.each(Object.keys(EQUALITY_EXEMPT_KEYS))(
    "cannot exempt CJK or an empty English value at %s",
    (key) => {
      expect(validateMessageContract({ [key]: SAVE }, { [key]: SAVE })).toContainEqual(
        expect.objectContaining({ code: "english-cjk", key }),
      );
      for (const value of ["", "   ", "\n\t"]) {
        expect(validateMessageContract({ [key]: value }, { [key]: value })).toContainEqual(
          expect.objectContaining({ code: "english-empty", key }),
        );
      }
    },
  );

  it("cannot exempt placeholder mismatches", () => {
    expect(
      validateMessageContract(
        { "resume.language.en-US": "{name}" },
        { "resume.language.en-US": "{other}" },
      ),
    ).toContainEqual(expect.objectContaining({ code: "placeholder-mismatch" }));
  });

  it.each(["\u4e00", "\uff1a", "\u3001", "\ud840\udc00"])(
    "rejects Han extensions and CJK/full-width punctuation: %s",
    (value) => {
      expect(
        validateMessageContract({ "fixture.cjk": SAVE }, { "fixture.cjk": value }),
      ).toContainEqual(expect.objectContaining({ code: "english-cjk" }));
    },
  );
});
