const DAY_MS = 86_400_000;

const OLD_CYCLE_BASE = Date.UTC(1997, 9, 7);
const NEW_CYCLE_BASE = Date.UTC(2025, 1, 22);
const NEW_CYCLE_MIN_FACTOR = 1000;

const BANKS: Record<string, string> = {
  "001": "Banco do Brasil",
  "003": "Banco da Amazônia",
  "004": "Banco do Nordeste do Brasil",
  "021": "Banestes",
  "025": "Banco Alfa",
  "033": "Santander",
  "037": "Banco do Estado do Pará",
  "041": "Banrisul",
  "047": "Banese",
  "070": "BRB - Banco de Brasília",
  "077": "Banco Inter",
  "085": "Ailos",
  "104": "Caixa Econômica Federal",
  "136": "Unicred",
  "197": "Stone Pagamentos",
  "208": "BTG Pactual",
  "212": "Banco Original",
  "218": "BS2",
  "237": "Bradesco",
  "260": "Nubank",
  "290": "PagBank",
  "318": "BMG",
  "320": "Banco CCB Brasil",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú Unibanco",
  "380": "PicPay",
  "389": "Banco Mercantil do Brasil",
  "403": "Cora",
  "422": "Banco Safra",
  "453": "Banco Rural",
  "623": "Banco Pan",
  "637": "Banco Sofisa",
  "655": "Banco Votorantim / Neon",
  "707": "Banco Daycoval",
  "748": "Sicredi",
  "752": "BNP Paribas Brasil",
  "756": "Sicoob",
};

const SEGMENTS: Record<string, string> = {
  "1": "Prefeituras",
  "2": "Saneamento",
  "3": "Energia elétrica e gás",
  "4": "Telecomunicações",
  "5": "Órgãos governamentais",
  "6": "Carnês e assemelhados / demais arrecadações",
  "7": "Multas de trânsito",
  "9": "Uso exclusivo interno dos bancos",
};

const VALUE_TYPES: Record<string, { name: string; isAmount: boolean; modulus: 10 | 11 }> = {
  "6": { name: "Valor efetivo em reais", isAmount: true, modulus: 10 },
  "7": { name: "Quantidade de moeda", isAmount: false, modulus: 10 },
  "8": { name: "Valor efetivo em reais", isAmount: true, modulus: 11 },
  "9": { name: "Quantidade de moeda", isAmount: false, modulus: 11 },
};

export interface CheckDigitDetail {
  field: string;
  expected: number;
  provided: number;
  valid: boolean;
}

export interface BoletoParseResult {
  kind: "bank_slip" | "collection";
  inputFormat: "barcode" | "digitable_line";
  barcode: string;
  digitableLine: string;
  checkDigits: { valid: boolean; details: CheckDigitDetail[] };
  bankCode?: string;
  bankName?: string;
  currencyCode?: string;
  currency?: string;
  amount?: number;
  quantity?: number;
  expirationFactor?: number;
  expirationDate?: string | null;
  expirationDateLegacy?: string;
  productCode?: string;
  productName?: string;
  segmentCode?: string;
  segmentName?: string;
  valueTypeCode?: string;
  valueTypeName?: string;
  companyId?: string;
  freeField?: string;
}

function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const product = Number(digits[i]) * weight;
    sum += product > 9 ? product - 9 : product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(digits: string, skipIndex = -1): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    if (i === skipIndex) continue;
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum;
}

function mod11Bank(barcode: string): number {
  const digit = 11 - (mod11Sum(barcode, 4) % 11);
  return digit === 0 || digit >= 10 ? 1 : digit;
}

function mod11Collection(digits: string, skipIndex = -1): number {
  const rest = mod11Sum(digits, skipIndex) % 11;
  return rest <= 1 ? 0 : 11 - rest;
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function expirationFromFactor(factor: number): { expirationDate: string | null; expirationDateLegacy?: string } {
  if (factor === 0) return { expirationDate: null };
  if (factor < NEW_CYCLE_MIN_FACTOR) {
    return { expirationDate: isoDate(OLD_CYCLE_BASE + factor * DAY_MS) };
  }
  return {
    expirationDate: isoDate(NEW_CYCLE_BASE + (factor - NEW_CYCLE_MIN_FACTOR) * DAY_MS),
    expirationDateLegacy: isoDate(OLD_CYCLE_BASE + factor * DAY_MS),
  };
}

function bankBarcodeToDigitableLine(barcode: string): string {
  const campo1 = barcode.slice(0, 4) + barcode.slice(19, 24);
  const campo2 = barcode.slice(24, 34);
  const campo3 = barcode.slice(34, 44);
  const campo4 = barcode[4] + barcode.slice(5, 19);
  return campo1 + mod10(campo1) + campo2 + mod10(campo2) + campo3 + mod10(campo3) + campo4;
}

function bankDigitableLineToBarcode(line: string): string {
  return line.slice(0, 4) + line[32] + line.slice(33, 47) + line.slice(4, 9) + line.slice(10, 20) + line.slice(21, 31);
}

function collectionBarcodeToDigitableLine(barcode: string, modulus: 10 | 11): string {
  const blocks = [barcode.slice(0, 11), barcode.slice(11, 22), barcode.slice(22, 33), barcode.slice(33, 44)];
  return blocks.map((block) => block + (modulus === 10 ? mod10(block) : mod11Collection(block))).join("");
}

function collectionDigitableLineToBarcode(line: string): string {
  return line.slice(0, 11) + line.slice(12, 23) + line.slice(24, 35) + line.slice(36, 47);
}

function parseBankSlip(barcode: string, inputFormat: BoletoParseResult["inputFormat"], line?: string): BoletoParseResult {
  const details: CheckDigitDetail[] = [];
  if (line) {
    const campos = [line.slice(0, 9), line.slice(10, 20), line.slice(21, 31)];
    const provided = [Number(line[9]), Number(line[20]), Number(line[31])];
    campos.forEach((campo, i) => {
      const expected = mod10(campo);
      details.push({ field: `digitable_line_field_${i + 1}`, expected, provided: provided[i], valid: expected === provided[i] });
    });
  }
  const expectedGeral = mod11Bank(barcode);
  const providedGeral = Number(barcode[4]);
  details.push({ field: "barcode", expected: expectedGeral, provided: providedGeral, valid: expectedGeral === providedGeral });

  const bankCode = barcode.slice(0, 3);
  const currencyCode = barcode[3];
  const factor = Number(barcode.slice(5, 9));
  const amount = Number(barcode.slice(9, 19)) / 100;

  return {
    kind: "bank_slip",
    inputFormat,
    barcode,
    digitableLine: bankBarcodeToDigitableLine(barcode),
    checkDigits: { valid: details.every((d) => d.valid), details },
    bankCode,
    ...(BANKS[bankCode] ? { bankName: BANKS[bankCode] } : {}),
    currencyCode,
    ...(currencyCode === "9" ? { currency: "BRL" } : {}),
    amount,
    expirationFactor: factor,
    ...expirationFromFactor(factor),
    freeField: barcode.slice(19, 44),
  };
}

function parseCollection(barcode: string, inputFormat: BoletoParseResult["inputFormat"], line?: string): BoletoParseResult {
  const valueTypeCode = barcode[2];
  const valueType = VALUE_TYPES[valueTypeCode];
  const modulus = valueType?.modulus ?? 10;

  const details: CheckDigitDetail[] = [];
  if (line) {
    const campos = [line.slice(0, 11), line.slice(12, 23), line.slice(24, 35), line.slice(36, 47)];
    const provided = [Number(line[11]), Number(line[23]), Number(line[35]), Number(line[47])];
    campos.forEach((campo, i) => {
      const expected = modulus === 10 ? mod10(campo) : mod11Collection(campo);
      details.push({ field: `digitable_line_field_${i + 1}`, expected, provided: provided[i], valid: expected === provided[i] });
    });
  }
  const expectedGeral = modulus === 10 ? mod10(barcode.slice(0, 3) + barcode.slice(4)) : mod11Collection(barcode, 3);
  const providedGeral = Number(barcode[3]);
  details.push({ field: "barcode", expected: expectedGeral, provided: providedGeral, valid: expectedGeral === providedGeral });

  const segmentCode = barcode[1];
  const rawValue = Number(barcode.slice(4, 15));

  return {
    kind: "collection",
    inputFormat,
    barcode,
    digitableLine: collectionBarcodeToDigitableLine(barcode, modulus),
    checkDigits: { valid: details.every((d) => d.valid), details },
    productCode: barcode[0],
    productName: barcode[0] === "8" ? "Arrecadação" : undefined,
    segmentCode,
    ...(SEGMENTS[segmentCode] ? { segmentName: SEGMENTS[segmentCode] } : {}),
    valueTypeCode,
    ...(valueType ? { valueTypeName: valueType.name } : {}),
    ...(valueType?.isAmount === false ? { quantity: rawValue } : { amount: rawValue / 100 }),
    companyId: barcode.slice(15, 19),
    freeField: barcode.slice(19, 44),
  };
}

export function parseBoleto(input: string): BoletoParseResult {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) {
    throw new Error("Input contains no digits.");
  }
  switch (digits.length) {
    case 44:
      return digits[0] === "8" ? parseCollection(digits, "barcode") : parseBankSlip(digits, "barcode");
    case 47:
      return parseBankSlip(bankDigitableLineToBarcode(digits), "digitable_line", digits);
    case 48:
      return parseCollection(collectionDigitableLineToBarcode(digits), "digitable_line", digits);
    default:
      throw new Error(
        `Invalid length: got ${digits.length} digits after removing non-digit characters. Expected 44 (barcode), 47 (bank slip digitable line) or 48 (collection/utility digitable line).`,
      );
  }
}
