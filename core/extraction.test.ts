import { describe, expect, it } from "vitest";
import { parseExtraction } from "./extraction";
import { parseOcrText } from "./ocrParse";

describe("parseExtraction", () => {
  it("accepts JSON wrapped in a code fence and fills missing fields with null", () => {
    const e = parseExtraction('```json\n{"is_business_card":true,"language":"EN","full_name":"A B","emails":["a@b.com"],"phones":[{"number":"123456789","type":"cell"}]}\n```');
    expect(e.language).toBe("en");
    expect(e.company).toBeNull();
    expect(e.phones).toEqual([{ number: "123456789", type: "unknown" }]);
  });

  it("rejects responses without JSON", () => {
    expect(() => parseExtraction("Sorry, I can't read this.")).toThrow();
  });
});

describe("parseOcrText", () => {
  it("pulls structured fields from typical card text", () => {
    const e = parseOcrText(
      ["ACME FREIGHT PVT LTD", "Priya Nair", "Head of Logistics", "M: +91 98450 12345", "T: +91 80 4123 4567", "priya.nair@acmefreight.in", "www.acmefreight.in"].join("\n"),
    );
    expect(e.company).toBe("ACME FREIGHT PVT LTD");
    expect(e.first_name).toBe("Priya");
    expect(e.last_name).toBe("Nair");
    expect(e.job_title).toBe("Head of Logistics");
    expect(e.emails).toEqual(["priya.nair@acmefreight.in"]);
    expect(e.website).toBe("www.acmefreight.in");
    expect(e.phones).toEqual([
      { number: "+91 98450 12345", type: "mobile" },
      { number: "+91 80 4123 4567", type: "office" },
    ]);
  });

  it("does not mistake a line after an email line for contact data", () => {
    const e = parseOcrText(["a.b@acme.com", "Priya Nair", "x.y@acme.com", "Rahul Mehta"].join("\n"));
    expect(e.full_name).toBe("Priya Nair");
    expect(e.emails).toHaveLength(2);
  });
});
