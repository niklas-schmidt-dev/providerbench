import { describe, expect, test } from "bun:test";

import { getProvider, providerColors } from "@/lib/providers";

describe("series colors for providers nobody registered", () => {
  test("a registered provider keeps its own hue", () => {
    const colors = providerColors(["hetzner", "acme"]);
    expect(colors.get("hetzner")).toBe("var(--provider-hetzner)");
    expect(colors.get("acme")).not.toBe("var(--provider-hetzner)");
  });

  test("the others take free palette slots in name order, whatever order they arrive in", () => {
    const forward = providerColors(["acme", "globex", "initech"]);
    const backward = providerColors(["initech", "globex", "acme"]);
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
    expect(new Set(forward.values()).size).toBe(3);
  });

  test("past the palette, providers share the neutral swatch instead of a made-up hue", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const colors = providerColors(many);
    expect(new Set(many.slice(0, 5).map((slug) => colors.get(slug))).size).toBe(5);
    expect(colors.get("f")).toBe("var(--provider-other)");
    expect(colors.get("g")).toBe("var(--provider-other)");
    // A hue a registered provider on the page owns is not handed out twice.
    expect([...providerColors(["digitalocean", "a"]).values()]).toEqual([
      "var(--provider-digitalocean)",
      "var(--provider-hetzner)",
    ]);
  });

  test("an unregistered provider still has a name, and a logo where the company is known", () => {
    expect(getProvider("acme")).toMatchObject({ name: "Acme", company: undefined });
    expect(getProvider("anthropic")).toMatchObject({ name: "Anthropic", company: "anthropic" });
  });
});
