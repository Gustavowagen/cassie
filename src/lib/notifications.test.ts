import { describe, it, expect } from "vitest";
import { notificationMessage } from "./notifications";

describe("notificationMessage", () => {
  it("formats a request-created notification for an admin", () => {
    expect(
      notificationMessage({
        type: "chip_request_created",
        payload: { request_id: "r1", amount: 500, requester_username: "nora" },
      })
    ).toBe("nora requested 500.0000 chips");
  });

  it("falls back to 'A member' when the requester username is missing", () => {
    expect(
      notificationMessage({ type: "chip_request_created", payload: { request_id: "r1", amount: 500 } })
    ).toBe("A member requested 500.0000 chips");
  });

  it("formats an accepted notification for the requester", () => {
    expect(
      notificationMessage({ type: "chip_request_accepted", payload: { request_id: "r1", amount: 250 } })
    ).toBe("Your request for 250.0000 chips was accepted");
  });

  it("formats a denied notification for the requester", () => {
    expect(
      notificationMessage({ type: "chip_request_denied", payload: { request_id: "r1", amount: 250 } })
    ).toBe("Your request for 250.0000 chips was denied");
  });
});
