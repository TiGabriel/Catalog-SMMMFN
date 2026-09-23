import { describe, expect, it } from "vitest";
import { passwordPolicyErrors } from "@/lib/validation/password";

describe("politica de parole", () => {
  it("acceptă o parolă conformă", () => {
    expect(passwordPolicyErrors("Navala#2026")).toEqual([]);
    expect(passwordPolicyErrors("Ștefan-cel-Mare1")).toEqual([]);
  });

  it.each([
    ["Sc#1a", "cel puțin 8"],
    ["navala#2026", "literă mare"],
    ["Navala#Parola", "cifră"],
    ["Navala2026", "caracter special"],
  ])("respinge %s (%s)", (pw, fragment) => {
    const errors = passwordPolicyErrors(pw);
    expect(errors.some((e) => e.includes(fragment))).toBe(true);
  });

  it("respinge parolele prea lungi și cele care conțin numele de utilizator", () => {
    expect(passwordPolicyErrors(`A1#${"x".repeat(130)}`).length).toBeGreaterThan(0);
    expect(passwordPolicyErrors("Prof.popescu#1", "prof.popescu").length).toBeGreaterThan(0);
  });
});
