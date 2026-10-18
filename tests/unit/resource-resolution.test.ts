import { describe, expect, it, vi } from "vitest";
import { resolveResourceReference } from "../../apps/pms-cli/src/commands/core/resolve.js";

describe("resource name resolution", () => {
  it("resolves an exact resource name without using a fuzzy match", async () => {
    const client = {
      query: vi.fn(async () => ({
        resourceType: "story",
        items: [
          { type: "story", id: 34, name: "项目管理标准", summary: {} },
          { type: "story", id: 35, name: "项目管理标准化", summary: {} },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
        totalPage: 1,
        queryScope: "current-user-readable",
      })),
    };

    await expect(resolveResourceReference(client as never, "story", "项目管理标准"))
      .resolves.toEqual({ resourceType: "story", resourceId: 34, resourceName: "项目管理标准" });
    expect(client.query).toHaveBeenCalledWith({
      resourceType: "story",
      keyword: "项目管理标准",
      filters: {},
      page: 1,
      pageSize: 100,
    });
  });

  it("rejects a missing name instead of guessing from a partial result", async () => {
    const client = {
      query: vi.fn(async () => ({
        resourceType: "requirement",
        items: [{ type: "requirement", id: 24, name: "PMS 项目管理系统建设", summary: {} }],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPage: 1,
        queryScope: "current-user-readable",
      })),
    };

    await expect(resolveResourceReference(client as never, "requirement", "PMS 项目管理"))
      .rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("requires a follow-up when the exact name is ambiguous", async () => {
    const client = {
      query: vi.fn(async () => ({
        resourceType: "topic",
        items: [
          { type: "topic", id: 10, name: "项目管理", summary: {} },
          { type: "topic", id: 11, name: "项目管理", summary: {} },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
        totalPage: 1,
        queryScope: "current-user-readable",
      })),
    };

    await expect(resolveResourceReference(client as never, "topic", "项目管理"))
      .rejects.toMatchObject({ code: "RESOURCE_AMBIGUOUS" });
  });
});
