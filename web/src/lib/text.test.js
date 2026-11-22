import { describe, expect, test } from "bun:test";

import { commonPrefix, humanize, withoutPrefix } from "@/lib/text";

describe("labels for identifiers nobody titled", () => {
  test("slugs read as words, with the usual abbreviations in capitals", () => {
    expect(humanize("rand_read_4k")).toBe("Rand read 4k");
    expect(humanize("ai-language")).toBe("AI language");
    expect(humanize("latency_p50")).toBe("Latency P50");
    expect(humanize("gpu-inference")).toBe("GPU inference");
    expect(humanize("tls")).toBe("TLS");
  });

  test("the shared prefix of sibling metrics stops before each one's own tail", () => {
    expect(commonPrefix(["accuracy_en", "accuracy_de"])).toBe("accuracy");
    expect(commonPrefix(["rtt_us_east_1", "rtt_us_west_2"])).toBe("rtt_us");
    expect(commonPrefix(["single_core", "multi_core"])).toBe("");
    // Never the whole identifier, and nothing for a single metric.
    expect(commonPrefix(["latency", "latency_p99"])).toBe("");
    expect(commonPrefix(["latency_p50"])).toBe("");
  });

  test("a prefix is only cut at a word boundary", () => {
    expect(withoutPrefix("accuracy_en", "accuracy")).toBe("en");
    expect(withoutPrefix("accuracy_en", "acc")).toBe("accuracy_en");
    expect(withoutPrefix("accuracy_en", "")).toBe("accuracy_en");
  });
});
