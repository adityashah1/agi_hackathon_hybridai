import { describe, expect, it } from "vitest";
import { actionKind, describeAction, sameAction } from "../lib/actions";

describe("action shapes from brain/local_brain.py and env/*.py", () => {
  it("reads both the brain shape and the env shape", () => {
    expect(actionKind({ action: "click", x: 1, y: 2 })).toBe("click");
    expect(actionKind({ type: "click", x: 1, y: 2 })).toBe("click");
    expect(actionKind(null)).toBe("?");
  });

  it("describes coordinate clicks with the brain's reason", () => {
    expect(
      describeAction({
        action: "click",
        x: 512,
        y: 96,
        why: "inbox search box",
      })
    ).toBe("click (512, 96) · inbox search box");
    expect(
      describeAction(
        { action: "click", x: 512, y: 96, why: "inbox search box" },
        false
      )
    ).toBe("click (512, 96)");
    expect(describeAction({ type: "key", name: "enter" })).toBe("key enter");
    expect(describeAction({ action: "key", key: "escape" })).toBe("key escape");
    expect(describeAction({ type: "scroll", dx: 0, dy: 3 })).toBe(
      "scroll down"
    );
    expect(describeAction({ action: "scroll", x: 1, y: 2, key: "up" })).toBe(
      "scroll up"
    );
    expect(describeAction({ action: "type", text: "Acme invoice" })).toBe(
      'type "Acme invoice"'
    );
    expect(describeAction({ type: "done" })).toBe("done");
  });

  it("marks proposals the brain rejected as invalid", () => {
    expect(
      describeAction({ action: "click", x: 2000, y: 5, valid: false }, false)
    ).toBe("invalid · click (2000, 5)");
  });

  it("treats nearby clicks as the same decision and far clicks as different", () => {
    const sai = { type: "click", x: 430, y: 268 };
    expect(
      sameAction(sai, { action: "click", x: 436, y: 262, why: "row" })
    ).toBe(true);
    expect(sameAction(sai, { action: "click", x: 530, y: 268 })).toBe(false);
    expect(
      sameAction({ type: "type", text: "a" }, { action: "type", text: "a " })
    ).toBe(false);
    expect(
      sameAction(
        { type: "key", name: "enter" },
        { action: "key", key: "enter" }
      )
    ).toBe(true);
    expect(sameAction(null, { action: "done" })).toBe(false);
  });
});
