# Supplier Catalogue Validation

A browser tool that checks a supplier's raw catalogue against the **WS Item List (report 1014)** and produces a cleaned Excel file.
All processing happens in the browser. Files are never uploaded to a server.

## Input files

| File | Source | Notes |
|---|---|---|
| WS Item List | Report **"Item List 1014"** exported from the supplier module | Title rows above the header are fine; the header row is found automatically and can be changed. |
| Supplier file | Raw data from the supplier (`.xlsx`, `.xls`, `.csv`) | Must contain an article number column. The header name can be anything. You map it in step 2. |

## Workflow

1. **Upload files.** Drop both files. For each file, pick the sheet and header row.
2. **Map headers.** The standard headers from report 1014 are listed on the left: *WS No., Item name, Article no., GTIN, Order Unit, Packaging unit*. Each is mapped to a column in report 1014 (auto-detected) and to a column in the supplier file (chosen from a dropdown). **Article no.** is required. A live preview shows the status counts as you map.
   Optional matching settings: ignore leading zeros, and ignore spaces, dashes and dots.
3. **Map units (optional, can be skipped).** Each distinct order unit used by the supplier's *Existing Items* is shown on the left. Pick the FutureLog unit for each from the dropdown (126 units from `data/Unit_List.xls`). Common spellings are suggested automatically, e.g. `PCS → PC`, `Litre → LI`, `Bag → BT`.
4. **Result.** Preview the result, filter by status, and download the Excel file.

## Status logic (lookup on Article no. only)

| Status | Meaning | Sheet |
|---|---|---|
| `Existing Item` | Article no. is in both files | Supplier Validation |
| `New Item` | Article no. is only in the supplier file | Supplier Validation |
| `Only in WS Item List` | Article no. is only in report 1014 | **Only in WS Item List** (second sheet) |
| `Missing Article No.` | Supplier row has no article no., so it cannot be looked up | Supplier Validation |

Matching ignores upper/lower case and spaces before or after the value.

**Unit Change** applies to Existing Items only. The mapped supplier order unit is compared with the WS order unit. If they differ, the column shows, for example, `Changed: WS KG (Kilogram) -> Supplier BT (Bag)`. A supplier unit that was left unmapped is also flagged. If the unit step is skipped, the column is left empty.

## Output workbook

- **Supplier Validation**: Status, Unit Change, the 6 standard fields (supplier values; WS No. taken from report 1014), Order Unit (FutureLog code), WS Item name / GTIN / Order Unit / Packaging unit for comparison, Remark (duplicates, missing values), then all remaining supplier columns.
- **Only in WS Item List**: the report 1014 rows that are not in the supplier file.
- **Summary**: counts per status and whether the unit check ran.

## Development

```bash
npm install        # no runtime dependencies
npm run build      # downloads the SheetJS browser bundle (0.20.3) to public/vendor/
npm test           # unit tests for the matching logic (public/js/logic.js)
npm run dev        # local preview with wrangler
```

`public/` is a static site with no server code:

- `public/js/logic.js` holds the pure matching and output logic, covered by tests in `test/`.
- `public/js/app.js` holds the UI.
- `public/js/units.js` holds the FutureLog unit list, generated from `data/Unit_List.xls`.

## Deploy to Cloudflare

The site is a Cloudflare **Workers static-assets** site, configured in `wrangler.toml`. `npx wrangler deploy` runs `npm run build` itself and then uploads `public/`.

**Option A: Cloudflare Git integration (recommended)**
In Cloudflare, go to *Workers & Pages → Create → Import a repository* and select this repository. Use these settings:
- Build command: leave empty, or use `npm run build`
- Deploy command: `npx wrangler deploy`
- The Worker name must match `name` in `wrangler.toml` (`suppliercataluguevalidation`). If you pick another name, change `wrangler.toml` to match.

**Option B: GitHub Actions** (`.github/workflows/deploy.yml`)
Add the repository secrets `CLOUDFLARE_API_TOKEN` (with the *Workers Scripts: Edit* permission) and `CLOUDFLARE_ACCOUNT_ID`. Every push to `main` runs the tests and deploys. Pull requests run the tests only. The deploy step is skipped until the secrets exist.
