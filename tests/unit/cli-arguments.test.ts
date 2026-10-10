import { describe, expect, it } from "vitest";
import { parseArguments } from "../../apps/pms-cli/src/cli/parseArguments.js";

describe("PMS CLI argument parsing", () => {
  it("supports separated and inline option values", () => {
    const parsed = parseArguments([
      "search",
      "topic",
      "--keyword",
      "订单",
      "--filter=status=ACTIVE",
      "--filter",
      "projectId=7",
      "--page",
      "2",
    ]);

    expect(parsed.group).toBe("search");
    expect(parsed.command).toBe("topic");
    expect(parsed.positionals).toEqual([]);
    expect(parsed.options.keyword).toBe("订单");
    expect(parsed.filters).toEqual({ status: "ACTIVE", projectId: "7" });
    expect(parsed.options.page).toBe("2");
  });

  it("rejects unknown flags, missing values, and duplicate scalar options", () => {
    expect(() => parseArguments(["search", "topic", "--wat"])).toThrow(/未知参数/);
    expect(() => parseArguments(["search", "topic", "--keyword"])).toThrow(/缺少参数值/);
    expect(() => parseArguments(["search", "topic", "--filter", "status=ACTIVE", "--filter", "status=DONE"])).toThrow(/重复参数/);
  });

  it("keeps positional arguments after the command", () => {
    const parsed = parseArguments([
      "workflow",
      "action",
      "story",
      "27",
      "complete",
      "--arguments-json",
      "{}",
    ]);

    expect(parsed.group).toBe("workflow");
    expect(parsed.command).toBe("action");
    expect(parsed.positionals).toEqual(["story", "27", "complete"]);
    expect(parsed.options["arguments-json"]).toBe("{}");
  });
});
