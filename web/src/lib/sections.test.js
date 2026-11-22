import { describe, expect, test } from "bun:test";

import { categoryMeta } from "@/lib/categories";
import { buildSections, collectTests } from "@/lib/sections";

function stat(unit, higherIsBetter = true) {
  return { p50: 1, p10: 1, p90: 1, p99: 1, mean: 1, hosts: 1, unit, higherIsBetter };
}

function plan(metrics, outcomes) {
  return { id: "row", metrics, outcomes };
}

// The tests and metrics as the reports list them: here, in the order the
// fixture names them. `tests` maps a test to its metric names.
function orderOf(tests) {
  return { tests: Object.keys(tests), metrics: new Map(Object.entries(tests)) };
}

function layout(slug, plans, tests, catalog = []) {
  const meta = categoryMeta(slug);
  const described = collectTests(meta, plans, orderOf(tests), catalog);
  return { tests: described, sections: buildSections(meta, described, plans) };
}

describe("a dashboard laid out from its reports", () => {
  test("a test with mixed metrics becomes a suite with a metric switch", () => {
    const { sections } = layout(
      "gpu-inference",
      [plan({ "decode.tokens_per_second": stat("tok/s"), "decode.time_to_first_token_p50": stat("ms", false) })],
      { decode: ["tokens_per_second", "time_to_first_token_p50"] },
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ kind: "suite", id: "decode", title: "Decode" });
    expect(sections[0].metrics.map((m) => m.label)).toEqual(["Tokens per second", "Time to first token P50"]);
    expect(sections[0].metrics[1]).toMatchObject({ unit: "ms", higherIsBetter: false });
  });

  test("four or more like-for-like metrics become one matrix, three stay a suite", () => {
    const four = Object.fromEntries([1, 4, 16, 64].map((b) => [`batch.throughput_b${b}`, stat("tok/s")]));
    const three = Object.fromEntries(["create", "read", "delete"].map((op) => [`files.file_${op}`, stat("ops/s")]));
    const { sections } = layout("gpu-inference", [plan({ ...four, ...three })], {
      batch: [1, 4, 16, 64].map((b) => `throughput_b${b}`),
      files: ["file_create", "file_read", "file_delete"],
    });
    expect(sections.map((s) => [s.kind, s.id])).toEqual([
      ["matrix", "batch"],
      ["suite", "files"],
    ]);
    expect(sections[0].columns.map((c) => c.label)).toEqual(["B1", "B4", "B16", "B64"]);
  });

  test("metrics that differ in unit or direction never share a scale", () => {
    const mixed = {
      "s3.ttfb_p50": stat("ms", false),
      "s3.list_p50": stat("ms", false),
      "s3.small_get_p50": stat("ms", false),
      "s3.upload_throughput": stat("MB/s", true),
    };
    const order = { s3: ["ttfb_p50", "list_p50", "small_get_p50", "upload_throughput"] };
    expect(layout("storage", [plan(mixed)], order).sections[0].kind).toBe("suite");
  });

  test("tests that share a set of metrics share one matrix, named after what the metrics have in common", () => {
    const metrics = {};
    for (const name of ["arithmetic", "ordering"]) {
      for (const lang of ["en", "de", "es", "zh"]) metrics[`${name}.accuracy_${lang}`] = stat("%");
    }
    const outcome = { solved: [1, 0], unanswered: [0, 0], reports: 1 };
    const outcomes = { arithmetic: { de: outcome, en: outcome, es: outcome, zh: outcome } };
    // The second test lists the same metrics in another order: still one matrix.
    const { sections } = layout("ai-language", [plan(metrics, outcomes)], {
      arithmetic: ["accuracy_en", "accuracy_de", "accuracy_es", "accuracy_zh"],
      ordering: ["accuracy_zh", "accuracy_es", "accuracy_de", "accuracy_en"],
    });

    expect(sections.map((s) => s.kind)).toEqual(["matrix", "outcomes"]);
    const [matrix, items] = sections;
    expect(matrix.id).toBe("accuracy");
    expect(matrix.title).toBe("Problems solved by input language");
    expect(matrix.tests.map((t) => t.test)).toEqual(["arithmetic", "ordering"]);
    // The registry names the variants; the reports set their order.
    expect(matrix.columns.map((c) => c.label)).toEqual(["English", "German", "Spanish", "Chinese"]);
    expect(items.tests.map((t) => t.test)).toEqual(["arithmetic"]);
    expect(items.variants.map((v) => v.label)).toEqual(["English", "German", "Spanish", "Chinese"]);
    expect(items.groups).toEqual({ count: 5, label: "Level" });
  });

  test("the items view sits under the chart of the tests it details, not at the end", () => {
    const metrics = { "quiz.right": stat("%"), "quiz.fast": stat("ms", false), "later.value": stat("x") };
    const outcome = { solved: [1, 0], unanswered: [0, 0], reports: 1 };
    const { sections } = layout("trivia", [plan(metrics, { quiz: { easy: outcome } })], {
      quiz: ["right", "fast"],
      later: ["value"],
    });
    expect(sections.map((s) => s.id)).toEqual(["quiz", "outcomes", "later"]);
    expect(sections[1].variants).toEqual([{ key: "easy", label: "Easy" }]);
  });

  test("section ids stay unique when a test is named like a generated section", () => {
    const metrics = { "outcomes.score": stat("points") };
    for (const name of ["accuracy", "recall"]) {
      for (const lang of ["en", "de", "es", "zh"]) metrics[`${name}.accuracy_${lang}`] = stat("%");
    }
    const outcome = { solved: [1], unanswered: [0], reports: 1 };
    const languages = ["en", "de", "es", "zh"].map((lang) => `accuracy_${lang}`);
    const { sections } = layout("quiz", [plan(metrics, { accuracy: { en: outcome } })], {
      outcomes: ["score"],
      accuracy: languages,
      recall: languages,
    });
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("outcomes"); // the test keeps its name ...
    expect(ids).toContain("outcomes-2"); // ... and the items view steps aside
    expect(ids).toContain("accuracy-2");
  });

  test("a test named like a part of the page does not take that part's place", () => {
    const { sections } = layout("odd", [plan({ "board.rank": stat("x"), "method.cost": stat("x") })], {
      board: ["rank"],
      method: ["cost"],
    });
    expect(sections.map((s) => [s.id, s.title])).toEqual([
      ["board-2", "Board"],
      ["method-2", "Method"],
    ]);
  });

  test("a test with a dot in its name stays one test", () => {
    const metrics = {
      "tls.handshake.single_core": stat("ops/s"),
      "tls.resume.single_core": stat("ops/s"),
    };
    const outcome = { solved: [1], unanswered: [0], reports: 1 };
    const { tests, sections } = layout("odd", [plan(metrics, { "tls.resume": { a: outcome } })], {
      "tls.handshake": ["single_core"],
      "tls.resume": ["single_core"],
    });
    expect(tests.map((t) => t.test)).toEqual(["tls.handshake", "tls.resume"]);
    expect(sections.map((s) => s.kind)).toEqual(["suite", "suite", "outcomes"]);
    expect(sections[2].tests).toEqual([{ test: "tls.resume", label: "TLS resume" }]);
  });

  test("a metric only superseded cohorts report gets no empty chart", () => {
    const { tests } = layout("odd", [plan({ "now.value": stat("x") })], { now: ["value", "gone"], before: ["value"] });
    expect(tests.map((t) => [t.test, t.metrics.map((m) => m.metric)])).toEqual([["now", ["value"]]]);
  });

  test("tests follow the curated order, then the CLI's, then the reports'", () => {
    const metrics = Object.fromEntries(
      ["steal", "cpu", "cpu_sustained", "extra", "memory"].map((name) => [`${name}.value`, stat("x")]),
    );
    const catalog = ["cpu", "cpu_sustained", "memory", "steal"].map((name) => ({
      name,
      profile: "standard",
      description: `${name} description`,
    }));
    const order = Object.fromEntries(["extra", "steal", "cpu", "cpu_sustained", "memory"].map((name) => [name, ["value"]]));
    const { tests } = layout("compute", [plan(metrics)], order, catalog);
    expect(tests.map((t) => t.test)).toEqual(["cpu", "memory", "steal", "cpu_sustained", "extra"]);
    expect(tests.find((t) => t.test === "cpu_sustained").summary).toBe("cpu_sustained description");
    // Only a test the CLI lists is known to live in a file named after it.
    expect(tests.find((t) => t.test === "cpu").sourceUrl).toMatch(/internal\/tests\/compute\/cpu\.go$/);
    expect(tests.find((t) => t.test === "extra").sourceUrl).toMatch(/internal\/tests$/);
  });
});
