import { describe, expectTypeOf, it } from "vitest";
import type { ConcreteModel, ThinkingLevel } from "./api.js";

describe("profile API", () => {
  it("exports concrete model and thinking contracts", () => {
    expectTypeOf<ConcreteModel>().toMatchTypeOf<{
      provider: string;
      id: string;
      thinkingLevels: string[];
    }>();
    expectTypeOf<ThinkingLevel>().toMatchTypeOf<string>();
  });
});
