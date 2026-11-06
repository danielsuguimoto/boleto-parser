import { describe, expect, it } from "vitest";
import { parseBoleto } from "../src/boleto.js";

const BANK_LINE = "23793381286000782713695000063305975520000370000";
const BANK_BARCODE = "23799755200003700003381260007827139500006330";
const COLLECTION_LINE = "858900004609524601791605607593050865831483000010";
const COLLECTION_BARCODE = "84890000000404201622018060519042958603411122";

describe("bank slip digitable line (47 digits)", () => {
  const result = parseBoleto(BANK_LINE);

  it("parses kind and format", () => {
    expect(result.kind).toBe("bank_slip");
    expect(result.inputFormat).toBe("digitable_line");
    expect(result.barcode).toBe(BANK_BARCODE);
  });

  it("validates all check digits", () => {
    expect(result.checkDigits.valid).toBe(true);
  });

  it("extracts bank and currency", () => {
    expect(result.bankCode).toBe("237");
    expect(result.bankName).toBe("Bradesco");
    expect(result.currencyCode).toBe("9");
    expect(result.currency).toBe("BRL");
  });

  it("extracts amount and expiration", () => {
    expect(result.amount).toBe(3700);
    expect(result.expirationFactor).toBe(7552);
    expect(result.expirationDate).toBe("2043-01-31");
    expect(result.expirationDateLegacy).toBe("2018-06-11");
  });

  it("extracts the free field", () => {
    expect(result.freeField).toBe("3381260007827139500006330");
  });

  it("accepts masked input", () => {
    expect(parseBoleto("23793.38128 60007.827136 95000.063305 9 75520000370000").barcode).toBe(BANK_BARCODE);
    expect(parseBoleto("23793-38128 60007.827136-95000.063305 9 75520000370000\n").barcode).toBe(BANK_BARCODE);
  });
});

describe("bank slip barcode (44 digits)", () => {
  const result = parseBoleto(BANK_BARCODE);

  it("matches the digitable line result", () => {
    expect(result.inputFormat).toBe("barcode");
    expect(result.digitableLine).toBe(BANK_LINE);
    expect(result.amount).toBe(3700);
    expect(result.expirationDate).toBe("2043-01-31");
    expect(result.checkDigits.valid).toBe(true);
  });
});

describe("collection bill", () => {
  it("parses a 48-digit digitable line", () => {
    const result = parseBoleto(COLLECTION_LINE);
    expect(result.kind).toBe("collection");
    expect(result.inputFormat).toBe("digitable_line");
    expect(result.barcode).toBe("85890000460524601791606075930508683148300001");
    expect(result.checkDigits.valid).toBe(true);
    expect(result.productCode).toBe("8");
    expect(result.segmentCode).toBe("5");
    expect(result.segmentName).toBe("Órgãos governamentais");
    expect(result.valueTypeCode).toBe("8");
    expect(result.valueTypeName).toBe("Valor efetivo em reais");
    expect(result.amount).toBe(46052.46);
    expect(result.companyId).toBe("0179");
    expect(result.freeField).toBe("1606075930508683148300001");
  });

  it("accepts masked input", () => {
    const masked = "85890000460-9 52460179160-5 60759305086-5 83148300001-0";
    expect(parseBoleto(masked).barcode).toBe("85890000460524601791606075930508683148300001");
  });

  it("parses a 44-digit barcode", () => {
    const result = parseBoleto(COLLECTION_BARCODE);
    expect(result.kind).toBe("collection");
    expect(result.inputFormat).toBe("barcode");
    expect(result.checkDigits.valid).toBe(true);
    expect(result.segmentCode).toBe("4");
    expect(result.valueTypeCode).toBe("8");
    expect(result.amount).toBe(40.42);
    expect(result.companyId).toBe("0162");
    expect(result.freeField).toBe("2018060519042958603411122");
  });
});

describe("expiration factor rules", () => {
  const barcodeWith = (fator: number) => {
    const head = "2379";
    const tail = `${String(fator).padStart(4, "0")}0000000100` + "0".repeat(25);
    const partial = head + "0" + tail;
    let sum = 0;
    let w = 2;
    for (let i = partial.length - 1; i >= 0; i--) {
      if (i === 4) continue;
      sum += Number(partial[i]) * w;
      w = w === 9 ? 2 : w + 1;
    }
    const d = 11 - (sum % 11);
    const dv = d === 0 || d >= 10 ? 1 : d;
    return head + dv + tail;
  };

  it("maps factors before 1000 to the legacy cycle", () => {
    expect(parseBoleto(barcodeWith(500)).expirationDate).toBe("1999-02-19");
  });

  it("maps factor 9999 edge of the old cycle per new rules", () => {
    const r = parseBoleto(barcodeWith(9999));
    expect(r.expirationDate).toBe("2049-10-13");
    expect(r.expirationDateLegacy).toBe("2025-02-21");
  });

  it("maps factor 1000 to 2025-02-22 (new cycle start)", () => {
    const r = parseBoleto(barcodeWith(1000));
    expect(r.expirationDate).toBe("2025-02-22");
    expect(r.expirationDateLegacy).toBe("2000-07-03");
  });

  it("maps factor 1805 to 2027-05-08", () => {
    expect(parseBoleto(barcodeWith(1805)).expirationDate).toBe("2027-05-08");
  });

  it("returns null for factor 0000", () => {
    expect(parseBoleto(barcodeWith(0)).expirationDate).toBeNull();
  });
});

describe("invalid input", () => {
  it("rejects wrong lengths", () => {
    expect(() => parseBoleto("12345")).toThrow(/Invalid length: got 5 digits/);
    expect(() => parseBoleto("1".repeat(46))).toThrow(/Invalid length: got 46 digits/);
    expect(() => parseBoleto("1234567890")).toThrow(/Invalid length: got 10 digits/);
  });

  it("strips non-digit formatting characters before parsing", () => {
    expect(parseBoleto("2379.3381-28 60007.827136 95000.063305 9 75520000370000").barcode).toBe(BANK_BARCODE);
  });

  it("rejects input with no digits", () => {
    expect(() => parseBoleto("abc-def")).toThrow(/contains no digits/);
    expect(() => parseBoleto("")).toThrow(/contains no digits/);
  });

  it("reports invalid check digits without throwing", () => {
    const result = parseBoleto("23791843400000199003812860000000003000000004");
    expect(result.kind).toBe("bank_slip");
    expect(result.checkDigits.valid).toBe(false);
  });
});
