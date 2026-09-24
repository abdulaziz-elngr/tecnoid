import { describe, it, expect } from "vitest";
import { evaluateCapacity } from "./capacity";

describe("evaluateCapacity", () => {
  it("returns UNLIMITED when no classroom is assigned yet", () => {
    const result = evaluateCapacity(12, null);
    expect(result.status).toBe("UNLIMITED");
    expect(result.capacity).toBeNull();
    expect(result.availableSeats).toBeNull();
  });

  it("returns AVAILABLE with the correct seat count when under capacity", () => {
    // Spec example: capacity 30, 25 students -> valid, 5 seats available.
    const result = evaluateCapacity(25, 30);
    expect(result.status).toBe("AVAILABLE");
    expect(result.availableSeats).toBe(5);
  });

  it("returns FULL when student count exactly equals capacity", () => {
    const result = evaluateCapacity(30, 30);
    expect(result.status).toBe("FULL");
    expect(result.availableSeats).toBe(0);
  });

  it("returns EXCEEDED with the correct overflow count when over capacity", () => {
    // Spec example: capacity 20, 27 students -> invalid, exceeded by 7.
    const result = evaluateCapacity(27, 20);
    expect(result.status).toBe("EXCEEDED");
    expect(result.availableSeats).toBe(-7);
    expect(result.message).toContain("7");
  });

  it("singularizes the seat/student count in the message", () => {
    expect(evaluateCapacity(29, 30).message).toContain("1 seat available");
    expect(evaluateCapacity(30, 29).message).toContain("1 student");
  });

  it("handles zero students against a real capacity", () => {
    const result = evaluateCapacity(0, 30);
    expect(result.status).toBe("AVAILABLE");
    expect(result.availableSeats).toBe(30);
  });
});
