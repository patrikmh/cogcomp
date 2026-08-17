import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { usePreferences } from "@/state/preferences";
import { extractIfFindingsEnabledAfterSave } from "./Journal";

describe("journal extraction privacy gate", () => {
  afterEach(() => {
    usePreferences.setState({ findings: true });
    vi.restoreAllMocks();
  });

  it("suppresses extraction when findings are disabled before the save resolves", async () => {
    const extract = vi.spyOn(api, "extract").mockResolvedValue({
      observation_id: "observation-id",
      nodes: 0,
      edges: 0,
    });
    let resolveSave!: (value: { id: string }) => void;
    const save = new Promise<{ id: string }>((resolve) => {
      resolveSave = resolve;
    });

    expect(usePreferences.getState().findings).toBe(true);
    const extraction = extractIfFindingsEnabledAfterSave(save);
    usePreferences.getState().setFindings(false);
    resolveSave({ id: "observation-id" });
    await extraction;

    expect(extract).not.toHaveBeenCalled();
  });

  it("extracts when findings remain enabled after the save resolves", async () => {
    const extract = vi.spyOn(api, "extract").mockResolvedValue({
      observation_id: "observation-id",
      nodes: 0,
      edges: 0,
    });

    await extractIfFindingsEnabledAfterSave(Promise.resolve({ id: "observation-id" }));

    expect(extract).toHaveBeenCalledWith("observation-id");
  });
});
