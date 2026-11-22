import { describe, expect, test } from "bun:test";

import { uniformFormat } from "@/lib/format";

describe("one precision per column", () => {
  test("whole numbers stay whole", () => {
    const format = uniformFormat([100, 90, 70]);
    expect([100, 90].map(format)).toEqual(["100", "90"]);
  });

  test("the smallest value decides, so every number carries the same decimals", () => {
    const shares = uniformFormat([100, 92.5, 75]);
    expect([100, 92.5].map(shares)).toEqual(["100.0", "92.5"]);
    const latencies = uniformFormat([238.24, 18.89]);
    expect([238.24, 18.89].map(latencies)).toEqual(["238.2", "18.9"]);
    const small = uniformFormat([0.4, 12.25]);
    expect([0.4, 12.25].map(small)).toEqual(["0.40", "12.25"]);
  });

  test("large values need no decimals", () => {
    expect(uniformFormat([1374.4, 1788.9])(1374.4)).toBe("1,374");
  });
});
