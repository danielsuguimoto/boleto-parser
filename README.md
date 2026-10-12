# boleto-parser

MCP server running on Cloudflare Workers that decodes the digits of a Brazilian
bank bill (boleto) barcode or digitable line (linha digitável) and returns the
information encoded in it.

## Tool

### `parse_boleto`

**Input**

| Field  | Type   | Description                                                                                                  |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------ |
| digits | string | Barcode or digitable line digits. All non-digit characters (spaces, dots, dashes, etc.) are stripped before parsing. Lengths: 44 (barcode), 47 or 48 (digitable line) |

**Output** — JSON object (also returned as `structuredContent`).

Bank slips (`kind: "bank_slip"`):

| Field                  | Description                                                                       |
| ---------------------- | --------------------------------------------------------------------------------- |
| barcode                | 44-digit barcode                                                                  |
| digitableLine          | 47-digit digitable line                                                           |
| bankCode / bankName    | COMPE bank code and name (when known)                                             |
| currencyCode / currency | `9` → `BRL`                                                                      |
| amount                 | Bill value in BRL                                                                 |
| expirationFactor       | FEBRABAN due-date factor                                                          |
| expirationDate         | Due date (ISO 8601). `null` when factor is `0000`                                  |
| expirationDateLegacy   | Pre-2025 cycle interpretation, present when factor ≥ 1000 is ambiguous             |
| freeField              | 25-digit bank-defined field (agency, account, nosso número, etc.)                 |
| checkDigits            | Per-field check digit verification (`valid`, `expected`, `provided`)               |

Collection/utility bills (`kind: "collection"`, barcodes starting with `8`):

| Field                        | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| productCode / productName    | `8` → `Arrecadação`                                             |
| segmentCode / segmentName    | Segment (prefeitura, saneamento, energia, telecom, gov, etc.)   |
| valueTypeCode / valueTypeName | Effective value in BRL vs. currency quantity (sets DV modulus) |
| amount / quantity            | Value in BRL, or raw quantity for "quantidade de moeda" types    |
| companyId                    | 4-digit company/agency identifier                               |
| freeField                    | 25-digit free field                                             |
| checkDigits                  | Per-field check digit verification                               |

**Due-date factor (FEBRABAN):** the 4-digit factor restarted at `1000` on
2025-02-22 after reaching `9999` on 2025-02-21. Factors ≥ 1000 therefore map to
the new cycle (`expirationDate`), and the old-cycle date is reported in
`expirationDateLegacy` for reference.

## Authentication

Requests to `/mcp` require an `Authorization: Bearer <token>` header matching
the `MCP_AUTH_TOKEN` environment value. Requests with a missing or wrong token
get `401`. If the variable is unset, every request to `/mcp` is rejected.

```sh
# production (Worker secret — never commit it)
npx wrangler secret put MCP_AUTH_TOKEN

# local dev — .dev.vars is gitignored
echo 'MCP_AUTH_TOKEN=my-local-token' > .dev.vars
```

## Development

```sh
npm install
npm run dev        # wrangler dev — MCP endpoint at http://localhost:8787/mcp
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

## Deploy

```sh
npx wrangler login   # once
npm run deploy       # wrangler deploy
```

Then connect MCP clients to `https://boleto-parser.<account>.workers.dev/mcp`
(streamable HTTP transport) with the configured bearer token.
