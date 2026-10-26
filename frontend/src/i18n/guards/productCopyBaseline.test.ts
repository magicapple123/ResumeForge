// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  diffProductCopyBudget,
  fingerprintFindings,
  validateProductCopyBudget,
  type ProductCopyBudget,
} from "./productCopyBaseline";
import { scanProductCopy } from "./productCopyAst";

function budget(source: string, file = "fixture.tsx"): ProductCopyBudget {
  const value = fingerprintFindings(scanProductCopy(source, file));
  return { total: value.count, files: { [file]: value } };
}

describe("product copy baseline", () => {
  it("allows moving unchanged copy down without creating an allowance for new text", () => {
    const baseline = budget("const view = <Button>Save changes</Button>;");
    const moved = budget("\n\nconst view = <Button>Save changes</Button>;");
    expect(diffProductCopyBudget(moved, baseline)).toEqual([]);
    const replaced = budget("const view = <Button>Delete profile</Button>;");
    expect(diffProductCopyBudget(replaced, baseline)).toEqual([
      expect.stringContaining("unregistered product copy"),
    ]);
  });

  it("does not allow copying a legacy string into a new file", () => {
    const baseline = budget("const view = <Button>Save changes</Button>;");
    const added = budget("const view = <Button>Save changes</Button>;", "new.tsx");
    expect(diffProductCopyBudget(added, baseline)).toEqual([
      expect.stringContaining("count increased"),
      expect.stringContaining("unregistered product copy"),
    ]);
  });

  it("counts duplicate findings instead of treating them as a set", () => {
    const baseline = budget("const view = <><Button>Save</Button></>;");
    const duplicate = budget("const view = <><Button>Save</Button><Button>Save</Button></>;");
    expect(diffProductCopyBudget(duplicate, baseline)).toContain("Product copy total increased");
    expect(
      diffProductCopyBudget(duplicate, baseline).some((problem) =>
        problem.includes("unregistered"),
      ),
    ).toBe(true);
  });

  it("accepts a decrease and rejects editing only the total", () => {
    const baseline = budget("const view = <Button>Save changes</Button>;");
    expect(diffProductCopyBudget(budget("const view = null;"), baseline)).toEqual([]);
    expect(validateProductCopyBudget({ ...baseline, total: 0 })).toEqual([
      "Product copy total does not match file counts",
    ]);
    const file = baseline.files["fixture.tsx"];
    expect(
      validateProductCopyBudget({ total: 0, files: { "fixture.tsx": { ...file, count: 0 } } }),
    ).toEqual(["fixture.tsx: count does not match fingerprints"]);
  });
});
