import { expect, it } from "vitest";
import { hello } from "./index";

it("it works!", () => {
  expect(hello()).toBe("smocket");
});
