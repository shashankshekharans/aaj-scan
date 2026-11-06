import { describe, expect, it } from "vitest";
import { contactsCsv, formatPhoneForHubSpot } from "./csv";

const row = { firstName: "Ada", lastName: "Lovelace", company: "Acme", email: "ada@example.com", jobTitle: null, phone: "+91 98765 43210", eventName: "Expo" };

describe("formatPhoneForHubSpot", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["+91-98200 46401", "+919820046401"],
    ["+971-585819219", "+971585819219"],
    ["+1 (415) 555-0132", "+14155550132"],
  ])("converts %j with a country code to international format", (input, expected) => {
    expect(formatPhoneForHubSpot(input)).toBe(expected);
  });

  it("keeps a number without a country code as printed (the country is never guessed)", () => {
    expect(formatPhoneForHubSpot("98114 77778")).toBe("98114 77778");
  });

  it("keeps an invalid number as printed for the reviewer to see", () => {
    expect(formatPhoneForHubSpot("+91 123")).toBe("+91 123");
  });

  it("returns an empty string for a missing number", () => {
    expect(formatPhoneForHubSpot(null)).toBe("");
    expect(formatPhoneForHubSpot("  ")).toBe("");
  });
});

describe("contactsCsv", () => {
  it("writes the seven HubSpot columns with no byte-order mark", () => {
    expect(contactsCsv([])).toBe('"First Name","Last Name","Company Name","Email","Job Title","Phone Number","Event Name"');
  });

  it("exports phone numbers without the spreadsheet apostrophe HubSpot would store", () => {
    const [, line] = contactsCsv([row]).split("\r\n");
    expect(line).toBe('"Ada","Lovelace","Acme","ada@example.com","","+919876543210","Expo"');
  });

  it("still neutralises formula-like text, including in the phone column", () => {
    const [, line] = contactsCsv([{ ...row, firstName: "=1+1", lastName: "+A", phone: "+cmd|' /C calc'!A0" }]).split("\r\n");
    expect(line).toBe(`"'=1+1","'+A","Acme","ada@example.com","","'+cmd|' /C calc'!A0","Expo"`);
  });
});
