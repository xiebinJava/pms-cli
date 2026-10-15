import { describe, expect, it } from "vitest";
import { agentWorkSessionSchema } from "../../packages/pms-contracts/src/index.js";
import { toStoryWorkbenchWorkSession } from "../../apps/pms-cli/src/commands/scenarios/agentWorkSession.js";

describe("scenario AgentWorkSession contract", () => {
  it("accepts the story adapter output as the shared contract", () => {
    const context = {
      resource: { type: "story" as const, id: 34 },
      version: 1,
      currentNode: { id: 384, key: "writing", label: "编写" },
      workflow: {
        nodes: [{
          id: 384,
          key: "writing",
          label: "编写",
          position: 0,
          fields: [],
          components: [{
            key: "story-node-workbench",
            label: "故事工作台",
            fields: [],
            actions: [],
            saveContract: {
              command: "development-item.node.field.update",
              itemType: "STORY",
              itemId: 34,
              nodeId: 384,
              version: 1,
              writableFields: ["summary"],
            },
          }],
          fieldValues: {},
          version: 1,
        }],
      },
      allowedActions: [],
    };
    const session = toStoryWorkbenchWorkSession({
      sessionId: "session-1",
      taskId: "task-1",
      context,
      input: {
        contractVersion: "story-workbench/v1",
        resourceType: "story",
        resourceId: 34,
        nodeId: 384,
        version: 1,
        variant: "writing",
        patch: { summary: "草稿" },
        save: false,
      },
    });

    const parsed = agentWorkSessionSchema.parse(session);
    expect(parsed.resource).toEqual({ type: "story", id: 34 });
    expect(parsed.draft?.proposedFieldValues).toEqual({ summary: "草稿" });
    expect(parsed.operation).toBeNull();
    expect(parsed.confirmation.status).toBe("NOT_REQUIRED");
  });
});
