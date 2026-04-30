# auto-infotech

Automate Infotech CloudHR expense claim submission with Microsoft login, Claim Template creation, and Add More Claims handling.

This project provides:

- A CLI workflow powered by Playwright.
- A local Chromium-based UI launcher for non-technical users.
- Filename-based parsing for claim category, receipt date, amount, remarks, attachment, and optional receipt number.

## One-Click Launchers

For the local UI:

- macOS: double-click `MAC-Start.command`.
- Windows: double-click `WINDOWS-Start.cmd`.

## Open Source Notice

Before publishing this repository, make sure you do not commit real company or personal data:

- `.env`
- `.auth/`
- `artifacts/`
- monthly claim folders such as `202604/`
- real receipt PDFs, screenshots, logs, or exported browser state
- `.DS_Store`

The default `.gitignore` is configured to exclude these common local files, but you should still review the final `git status` before pushing.

## Requirements

- Node.js 18 or newer
- npm
- Playwright Chromium
- A Microsoft account that can log in to the target Infotech CloudHR tenant

The setup scripts can install Node.js and Playwright Chromium on macOS and Windows.

## Filename Format

Put claim files in a folder named with the claim period, for example `202604`.

Each claim attachment should use this format:

```text
[type]date-amount remarks#receipt-number.ext
```

Examples:

```text
[TAXI]04:01-666 TEST conference.pdf
[TaXi] 04 : 01 - 666 TEST conference.pdf
[taxi]04_01-666 TEST conference.pdf
[taxi]0401-666 TEST conference.pdf
[grab]04-01-666 TEST conference.jpg
[mob]599.pdf
[health]04-15-217 health screening#R12345.pdf
```

Rules:

- `type`: claim type token inside square brackets, such as `[taxi]`.
- `date`: supports `MM-DD`, `MM:DD`, `MM/DD`, `MM_DD`, or `MMDD`.
- `amount`: integer or decimal, such as `666` or `666.50`.
- `remarks`: optional free text.
- `#receipt-number`: optional for most categories. The script only fills Receipt No. when `#` exists in the filename.
- `CLOTHING ALLOWANCE` and `HEALTH SCREENING` require Receipt No.; files in those categories must include `#receipt-number` before the extension.

Windows filenames cannot contain `:` or `/`. Use Windows-safe formats such as:

```text
[taxi]04-19-127 airport.pdf
[health]04-15-217 health screening#R12345.pdf
```

## Quick Start

Install dependencies and Playwright Chromium:

```bash
bash setup.sh
```

Create a local environment file if you want to store default runtime options:

```bash
cp .env.example .env
```

Common `.env` values:

```text
MS_EMAIL=your_account@company.com
MS_PASSWORD=your_password
HEADFUL=true
FORCE_LOGIN=false
DRY_RUN=false
CLAIMS_BASE_DIR=
CLAIM_URL=https://v2.infotech-cloudhr.com.sg/ECLaim/ClaimApply.aspx
```

Run a dry run first:

```bash
npm run auto-claim -- 202604 --dry-run
```

Review `artifacts/claim-run-preview.json`, then submit for real:

```bash
npm run auto-claim -- 202604 --live
```

## CLI Usage

Basic usage:

```bash
npm run auto-claim -- 202604
```

The folder argument can also be an absolute path:

```bash
npm run auto-claim -- /Users/you/Claims/202604
```

Supported options:

| Option | Description |
|---|---|
| `--dry-run` | Parse files only. Does not log in or submit claims. Writes `artifacts/claim-run-preview.json`. |
| `--live` | Submit claims for real. Overrides `DRY_RUN=true` from `.env`. |
| `--headful` | Show the Chromium browser window. Useful for login and troubleshooting. |
| `--headless` | Run Chromium without a visible browser window. |
| `--force-login` | Ignore `.auth/storage-state.json` and perform Microsoft login again. |
| `--reuse-session` | Reuse `.auth/storage-state.json` when possible; login again if the session is invalid. |

Examples:

```bash
# Parse filenames and category mapping only
npm run auto-claim -- 202604 --dry-run

# Run in the background and reuse an existing login session
npm run auto-claim -- 202604 --headless --reuse-session

# Show the browser and force a fresh login
npm run auto-claim -- 202604 --headful --force-login
```

Dry-run shortcut:

```bash
npm run auto-claim:dry-run -- 202604
```

## Local UI

The UI is a local HTML page opened by Playwright Chromium. It lists claim folders, accepts login credentials for the run, streams CLI output, and shows run artifacts.

Start it directly:

```bash
node src/auto-claim-ui.js
```

Or use the platform launchers:

- macOS: double-click `MAC-Start.command`
- Windows: double-click `WINDOWS-Start.cmd`

The launchers check Node.js, npm dependencies, and Playwright Chromium before opening the UI.

## What the Automation Does

For `npm run auto-claim -- 202604`, the script:

1. Reads claim attachments from the `202604` folder.
2. Parses category, date, amount, remarks, and optional receipt number from each filename.
3. Builds the Claim Template Name, such as `April 2026 CLAIM`.
4. Logs in to Infotech CloudHR through Microsoft authentication.
5. Opens the Claim Apply page and creates a new claim.
6. Fills Claim Group Name, Claim Name, Receipt Amount, Remarks, Claimable Amount, Attachment, Receipt Date, and Receipt No. when available.
7. Saves each claim item and uses Add More Claims for the next item.

CloudHR performs server-side partial refreshes after Claim Template Name, Claim Group Name, and Claim Name changes. The script waits for the page to stop loading before it fills later fields.

Future receipt dates are automatically clamped to today to avoid CloudHR validation errors such as `Receipt date must be less than or equal to the current date`.

## Output Files

Runtime files are written to `artifacts/`:

| File | Purpose |
|---|---|
| `claim-run-preview.json` | Parsed dry-run or pre-submit claim data. |
| `claim-run-result.json` | Summary after a successful submission. |
| `claim-run-error.json` | Failure message, current URL, and stack trace. |
| `claim-run-error.png` | Screenshot captured at failure time. |
| `claim-submission-final.png` | Final screenshot after successful completion. |

Login state is saved in `.auth/storage-state.json`. Use `--force-login` if the saved session expires.

## Claim Type Mapping

Use one of the filename tokens in the first column, for example `[taxi]04-14-212.pdf`.

| Filename token | Claim Group Name | Claim Name |
|---|---|---|
| `mob`, `mobile`, `phone` | MOBILE PHONE REIMBURSEMENT | MOBILE |
| `clothing`, `cloth`, `allowance`, `cloalw` | CLOTHING ALLOWANCE | CLOTHIN |
| `health`, `medical`, `screening`, `emphs` | HEALTH SCREENING | HEALTH SCREENING |
| `hardware`, `hw`, `hardwa` | IT RELATED | HARDWARE |
| `software`, `sw`, `softwa`, `it`, `itrelated` | IT RELATED | SOFTWARE |
| `mileage`, `miles`, `mile`, `car` | MILEAGE CLAIM | CAR |
| `motorcycle`, `motorbike`, `bike`, `mcycle` | MILEAGE CLAIM | MOTOR CYCLE |
| `courier`, `dispatch`, `couriedispatch` | MISCELLANEOUS CLAIM | COURIER / DISPATCH SERVICES |
| `dinner`, `annualdinner` | MISCELLANEOUS CLAIM | ANNUAL DINNER |
| `lunch`, `fridaylunch` | MISCELLANEOUS CLAIM | FRIDAY LUNCH |
| `pantry`, `pantryitems` | MISCELLANEOUS CLAIM | PANTRY ITEMS |
| `misc`, `miscellaneous`, `other`, `sundry` | MISCELLANEOUS CLAIM | MISC - OTHER MISCELLANEOUS |
| `marketing`, `mktg`, `ads`, `advertising` | MARKETING COST | MARKETING COST |
| `office`, `stationery`, `accessories` | OFFICE ACCESSORIES | OFFICE ACCESSORIES |
| `overseas`, `oversea`, `travelallowance`, `ota`, `ta` | OVERSEAS TRAVEL ALLOWANCE | OVERSEAS TRAVEL ALLOWANCE |
| `airticket`, `air`, `flight`, `ticket` | OVERSEAS / BUSINESS TRAVEL CLAIM | AIR TICKET |
| `winterclothing`, `wintercloth` | OVERSEAS / BUSINESS TRAVEL CLAIM | WINTER CLOTHING |
| `data`, `sim`, `simcard`, `dataplan` | OVERSEAS / BUSINESS TRAVEL CLAIM | SIM CARD, DATA PLAN |
| `ent`, `entertainment`, `overseasentertainment` | OVERSEAS / BUSINESS TRAVEL CLAIM | OVERSEAS ENTERTAINMENT |
| `hotel` | OVERSEAS / BUSINESS TRAVEL CLAIM | HOTEL |
| `insure`, `insurance`, `travelins`, `travelinsurance` | OVERSEAS / BUSINESS TRAVEL CLAIM | TRAVEL INSURANCE |
| `laundry`, `laundr` | OVERSEAS / BUSINESS TRAVEL CLAIM | LAUNDRY |
| `meal`, `meals`, `overseasmeal` | OVERSEAS / BUSINESS TRAVEL CLAIM | MEAL OVERSEAS |
| `transport`, `overseastransport`, `trans` | OVERSEAS / BUSINESS TRAVEL CLAIM | TRANSPORT |
| `visa`, `visaapplication` | OVERSEAS / BUSINESS TRAVEL CLAIM | VISA APPLICATION |
| `parking`, `park` | PARKING | PARKING |
| `petrol`, `gasoline`, `fuel`, `gas` | GASOLINE / PETROL | GASOLINE / PETROL |
| `recruit`, `recruitment`, `hiring` | RECRUITMENT COST | RECRUITMENT COST |
| `training`, `course`, `seminar`, `workshop` | TRAINING | TRAINING |
| `bus` | TAXI / GRAB CLAIM | BUS |
| `cashcard`, `cash`, `card` | TAXI / GRAB CLAIM | CASH CARD |
| `erp`, `erpcharges` | TAXI / GRAB CLAIM | ERP CHARGES |
| `parkingcoupon`, `parkcoupon`, `coupon` | TAXI / GRAB CLAIM | PARKING COUPON |
| `parkingcharges`, `parkingcharge`, `parkcharge`, `parkcharges` | TAXI / GRAB CLAIM | PARKING CHARGES |
| `taxi`, `grab` | TAXI / GRAB CLAIM | TAXI |
| `train`, `mrt` | TAXI / GRAB CLAIM | TRAIN |
| `welfare`, `benefit` | EMPLOYEE WELFARE | EMPLOYEE WELFARE |

Notes:

- `parking` / `park` maps to the standalone PARKING category.
- Taxi / Grab parking items should use `parkingcoupon` or `parkingcharges`.
- `it` / `itrelated` maps to SOFTWARE by default. Use `hardware` for hardware claims.
- If your tenant uses different CloudHR claim names, update `CLAIM_RULES` in `src/auto-claim-upload.js`.

## macOS Command Line

```bash
cd ~/Downloads
unzip auto-infotech-share.zip -d auto-infotech
cd auto-infotech
bash setup.sh
cp .env.example .env
npm run auto-claim -- 202604
```

## Windows PowerShell

Most users can double-click `WINDOWS-Start.cmd`.

If you prefer the command line:

```powershell
cd $HOME\Downloads
Expand-Archive .\auto-infotech-share.zip -DestinationPath .\auto-infotech -Force
cd .\auto-infotech
powershell -ExecutionPolicy Bypass -File .\setup.ps1
Copy-Item .\.env.example .\.env
npm run auto-claim -- 202604
```

If PowerShell reports `running scripts is disabled on this system`, use the bypass command above or launch through `WINDOWS-Start.cmd`.

## Development Notes

This repository intentionally does not include automated tests yet. At minimum, verify filename parsing with `--dry-run` before any CloudHR submission.

Useful local checks:

```bash
node --check src/auto-claim-upload.js
node --check src/auto-claim-ui.js
npm run auto-claim -- 202604 --dry-run
```
