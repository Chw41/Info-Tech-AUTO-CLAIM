import fs from "fs";
import path from "path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const LOGIN_URL = "https://login-infotech.com/";
const HOME_URL = "https://v2.infotech-cloudhr.com.sg/Administration/Home.aspx";
const CLAIM_URL =
  process.env.CLAIM_URL ||
  "https://v2.infotech-cloudhr.com.sg/ECLaim/ClaimApply.aspx";
const ROOT_DIR = process.cwd();
const ARTIFACT_DIR = path.join(ROOT_DIR, "artifacts");
const STORAGE_STATE_PATH = path.join(ROOT_DIR, ".auth", "storage-state.json");
const CLAIM_TAB_PREFIX = "ContentPlaceHolder1_tabClaimApplyCancel_tabClaimApply";
const CLAIM_GROUP_COMBO_ID = `${CLAIM_TAB_PREFIX}_cbClaimGroup`;
const SUB_CLAIM_COMBO_ID = `${CLAIM_TAB_PREFIX}_cbSubClaim`;

loadDotEnv(path.join(ROOT_DIR, ".env"));

const CLI = parseCliArgs(process.argv.slice(2));
const HEADFUL =
  CLI.headful != null ? CLI.headful : toBoolean(process.env.HEADFUL, true);
const FORCE_LOGIN =
  CLI.forceLogin != null ? CLI.forceLogin : toBoolean(process.env.FORCE_LOGIN, false);
const DRY_RUN =
  CLI.dryRun != null ? CLI.dryRun : toBoolean(process.env.DRY_RUN, false);
const DEBUG_STOP_BEFORE_SAVE = toBoolean(process.env.DEBUG_STOP_BEFORE_SAVE, false);
const CLAIMS_BASE_DIR = process.env.CLAIMS_BASE_DIR || ROOT_DIR;
const MS_EMAIL_ENV = process.env.MS_EMAIL || "";
const MS_PASSWORD_ENV = process.env.MS_PASSWORD || "";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const CLAIM_RULES = [
  claimRule(["mob", "mobile", "phone"], "MOBILE PHONE REIMBURSEMENT", "MOBILE", {
    defaultDay: 25,
    defaultRemarks: "mobile"
  }),
  claimRule(["clothing", "cloth", "allowance", "cloalw"], "CLOTHING ALLOWANCE", "CLOTHIN"),
  claimRule(["health", "medical", "screening", "emphs"], "HEALTH SCREENING", "HEALTH SCREENING"),
  claimRule(["hardware", "hw", "hardwa"], "IT RELATED", "HARDWARE"),
  claimRule(["software", "sw", "softwa", "it", "itrelated"], "IT RELATED", "SOFTWARE"),
  claimRule(["mileage", "miles", "mile", "car"], "MILEAGE CLAIM", "CAR"),
  claimRule(["motorcycle", "motorbike", "bike", "mcycle"], "MILEAGE CLAIM", "MOTOR CYCLE"),
  claimRule(["courier", "dispatch", "couriedispatch"], "MISCELLANEOUS CLAIM", "COURIER / DISPATCH SERVICES"),
  claimRule(["dinner", "annualdinner"], "MISCELLANEOUS CLAIM", "ANNUAL DINNER"),
  claimRule(["lunch", "fridaylunch"], "MISCELLANEOUS CLAIM", "FRIDAY LUNCH"),
  claimRule(["pantry", "pantryitems"], "MISCELLANEOUS CLAIM", "PANTRY ITEMS"),
  claimRule(["misc", "miscellaneous", "other", "sundry"], "MISCELLANEOUS CLAIM", "MISC - OTHER MISCELLANEOUS"),
  claimRule(["marketing", "mktg", "ads", "advertising"], "MARKETING COST", "MARKETING COST"),
  claimRule(["office", "stationery", "accessories"], "OFFICE ACCESSORIES", "OFFICE ACCESSORIES"),
  claimRule(["overseas", "oversea", "travelallowance", "ota", "ta"], "OVERSEAS TRAVEL ALLOWANCE", "OVERSEAS TRAVEL ALLOWANCE"),
  claimRule(["airticket", "air", "flight", "ticket"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "AIR TICKET"),
  claimRule(["winterclothing", "wintercloth"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "WINTER CLOTHING"),
  claimRule(["data", "sim", "simcard", "dataplan"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "SIM CARD, DATA PLAN"),
  claimRule(["ent", "entertainment", "overseasentertainment"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "OVERSEAS ENTERTAINMENT"),
  claimRule(["hotel"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "HOTEL"),
  claimRule(["insure", "insurance", "travelins", "travelinsurance"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "TRAVEL INSURANCE"),
  claimRule(["laundry", "laundr"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "LAUNDRY"),
  claimRule(["meal", "meals", "overseasmeal"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "MEAL OVERSEAS"),
  claimRule(["transport", "overseastransport", "trans"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "TRANSPORT"),
  claimRule(["visa", "visaapplication"], "OVERSEAS / BUSINESS TRAVEL CLAIM", "VISA APPLICATION"),
  claimRule(["parking", "park"], "PARKING", "PARKING"),
  claimRule(["petrol", "gasoline", "fuel", "gas"], "GASOLINE / PETROL", "GASOLINE / PETROL"),
  claimRule(["recruit", "recruitment", "hiring"], "RECRUITMENT COST", "RECRUITMENT COST"),
  claimRule(["training", "course", "seminar", "workshop"], "TRAINING", "TRAINING"),
  claimRule(["bus"], "TAXI / GRAB CLAIM", "BUS"),
  claimRule(["cashcard", "cash", "card"], "TAXI / GRAB CLAIM", "CASH CARD"),
  claimRule(["erp", "erpcharges"], "TAXI / GRAB CLAIM", "ERP CHARGES"),
  claimRule(["parkingcoupon", "parkcoupon", "coupon"], "TAXI / GRAB CLAIM", "PARKING COUPON"),
  claimRule(["parkingcharges", "parkingcharge", "parkcharge", "parkcharges"], "TAXI / GRAB CLAIM", "PARKING CHARGES"),
  claimRule(["taxi", "grab"], "TAXI / GRAB CLAIM", "TAXI"),
  claimRule(["train", "mrt"], "TAXI / GRAB CLAIM", "TRAIN"),
  claimRule(["welfare", "benefit"], "EMPLOYEE WELFARE", "EMPLOYEE WELFARE")
];

function claimRule(tokens, groupName, claimName, extra = {}) {
  const tokenSet = new Set(tokens.map(normalizeClaimTypeToken));
  return {
    test: (k) => tokenSet.has(normalizeClaimTypeToken(k)),
    groupName,
    claimName,
    ...extra
  };
}

function normalizeClaimTypeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function main() {
  ensureDir(path.join(ROOT_DIR, ".auth"));
  ensureDir(ARTIFACT_DIR);

  const prompt = await collectRuntimeInputs();
  const period = parsePeriod(prompt.folderName);
  const claimFolderPath = resolveFolderPath(prompt.folderName);
  const { claims: claimItems, skippedFiles } = buildClaimsFromFolder(claimFolderPath, period);
  const templateName = `${MONTH_NAMES[period.month - 1]} ${period.year} CLAIM`;

  const runPreviewPath = path.join(ARTIFACT_DIR, "claim-run-preview.json");
  fs.writeFileSync(
    runPreviewPath,
    JSON.stringify(
      {
        folderName: prompt.folderName,
        claimFolderPath,
        templateName,
        claims: claimItems,
        skippedFiles
      },
      null,
      2
    ),
    "utf-8"
  );
  log(`Parsed ${claimItems.length} files from folder: ${claimFolderPath}`);
  if (skippedFiles.length) {
    log(`Skipped ${skippedFiles.length} files.`);
    for (const item of skippedFiles.slice(0, 5)) {
      log(`Skip: ${item.file} (${item.reason})`);
    }
  }
  if (DRY_RUN) {
    log("DRY_RUN=true, skip website submission.");
    return;
  }

  const browser = await chromium.launch({ headless: !HEADFUL });
  const canReuseSession = !FORCE_LOGIN && fs.existsSync(STORAGE_STATE_PATH);
  const context = await browser.newContext(
    canReuseSession ? { storageState: STORAGE_STATE_PATH } : {}
  );
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context, prompt.email, prompt.password);
    await openApplyClaim(page);
    await startNewClaim(page, templateName);

    for (let i = 0; i < claimItems.length; i++) {
      const claim = claimItems[i];
      const claimStartedAt = Date.now();
      log(`Submitting claim ${i + 1}/${claimItems.length}: ${claim.sourceFile}`);
      if (claim.dateAdjusted) {
        log(
          `Adjusted future receipt date from ${claim.originalReceiptDate} to ${claim.receiptDate} for ${claim.sourceFile}`
        );
      }
      if (i > 0) {
        await timedStep(`Timing claim ${i + 1}: add more`, () =>
          clickAddMoreClaimsPlus(page, templateName)
        );
      }
      await timedStep(`Timing claim ${i + 1}: template`, () =>
        ensureTextByLabel(page, "Claim Template Name", templateName, true)
      );
      await fillClaimForm(page, claim, i + 1);
      if (DEBUG_STOP_BEFORE_SAVE) {
        await page.screenshot({
          path: path.join(ARTIFACT_DIR, "debug-stop-before-save.png"),
          fullPage: true
        });
        log("DEBUG_STOP_BEFORE_SAVE=true, stopping before SAVE.");
        return;
      }
      await timedStep(`Timing claim ${i + 1}: save click/postback`, () => clickSave(page));
      await timedStep(`Timing claim ${i + 1}: save verify`, () =>
        verifySavedState(page, templateName)
      );
      await waitUntilNotBusy(page, 3000);
      log(
        `Submitted claim ${i + 1}/${claimItems.length} in ${(
          (Date.now() - claimStartedAt) /
          1000
        ).toFixed(1)}s`
      );
    }

    await context.storageState({ path: STORAGE_STATE_PATH });
    await openViewClaimsForFinalScreenshot(page, templateName);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "claim-submission-final.png"),
      fullPage: true
    });
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, "claim-run-result.json"),
      JSON.stringify(
        {
          status: "success",
          timestamp: new Date().toISOString(),
          templateName,
          count: claimItems.length
        },
        null,
        2
      ),
      "utf-8"
    );
    log(`Completed ${claimItems.length} claims.`);
  } catch (err) {
    const errorPayload = {
      status: "failed",
      timestamp: new Date().toISOString(),
      pageUrl: safeGetUrl(page),
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack || "" : ""
    };
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, "claim-run-error.json"),
      JSON.stringify(errorPayload, null, 2),
      "utf-8"
    );
    if (!page.isClosed()) {
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, "claim-run-error.png"),
        fullPage: true
      }).catch(() => {});
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function collectRuntimeInputs() {
  let email = MS_EMAIL_ENV;
  let password = MS_PASSWORD_ENV;
  let folderName = CLI.folderName || "";

  if (!email) email = await askQuestion("Microsoft Email: ");
  if (!password) password = await askHiddenQuestion("Microsoft Password: ");
  if (!folderName) folderName = await askQuestion("Claim Folder Name (e.g. 202604): ");

  if (!email) throw new Error("Microsoft Email is required");
  if (!password) throw new Error("Microsoft Password is required");
  if (!folderName) throw new Error("Claim folder name is required");

  return { email, password, folderName };
}

function resolveFolderPath(folderName) {
  const direct = path.isAbsolute(folderName)
    ? folderName
    : path.join(CLAIMS_BASE_DIR, folderName);
  if (!fs.existsSync(direct) || !fs.statSync(direct).isDirectory()) {
    throw new Error(`Claim folder not found: ${direct}`);
  }
  return direct;
}

function parsePeriod(folderName) {
  const match = folderName.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (!match) {
    throw new Error(
      `Folder name must include YYYYMM (example: 202604). Received: ${folderName}`
    );
  }
  return {
    year: Number(match[1]),
    month: Number(match[2])
  };
}

function buildClaimsFromFolder(folderPath, period) {
  const files = walkFiles(folderPath);
  if (!files.length) throw new Error(`No files found in folder: ${folderPath}`);
  const claims = [];
  const skippedFiles = [];
  for (const absPath of files.filter((f) => !path.basename(f).startsWith("."))) {
    const stat = fs.statSync(absPath);
    if (stat.size === 0) {
      skippedFiles.push({
        file: path.relative(folderPath, absPath).replace(/\\/g, "/"),
        reason: "Skipped empty file (size = 0)"
      });
      continue;
    }
    try {
      claims.push(parseClaimFile(absPath, folderPath, period));
    } catch (err) {
      skippedFiles.push({
        file: path.relative(folderPath, absPath).replace(/\\/g, "/"),
        reason: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (!claims.length) throw new Error(`No valid claim files found in: ${folderPath}`);
  return { claims, skippedFiles };
}

function walkFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function parseClaimFile(absPath, rootDir, period) {
  const sourceFile = path.relative(rootDir, absPath).replace(/\\/g, "/");
  const ext = path.extname(sourceFile);
  const noExt = sourceFile.slice(0, sourceFile.length - ext.length);
  const match = noExt.match(/^\s*\[([^\]]+)\]\s*(.+)?$/i);
  if (!match) {
    throw new Error(
      `Invalid filename format: ${sourceFile}. Expected: [type]... (example: [taxi]04-19-127 airport.jpg)`
    );
  }

  const typeRaw = (match[1] || "").trim().toLowerCase();
  const tail = (match[2] || "").trim();
  const rule = CLAIM_RULES.find((r) => r.test(typeRaw));
  if (!rule) {
    throw new Error(`Unsupported claim type [${typeRaw}] in file: ${sourceFile}`);
  }

  const datePart = parseDatePart(tail);
  const amount = parseAmountPart(tail);
  const month = datePart?.month ?? period.month;
  const day = datePart?.day ?? rule.defaultDay;
  if (!day) {
    throw new Error(`Missing date info for file: ${sourceFile}`);
  }

  const remarks = buildRemarks({
    tail,
    rule,
    month,
    day
  });
  const receiptNo = parseReceiptNoPart(tail);
  if (isReceiptNoRequired(rule) && !receiptNo) {
    throw new Error(
      `Receipt No. is required for ${rule.groupName}. Add #number before the file extension (example: [health]04-15-217 checkup#R123.pdf)`
    );
  }
  const effectiveDate = clampToTodayIfFuture(period.year, month, day);

  return {
    sourceFile,
    absolutePath: absPath,
    claimGroupName: rule.groupName,
    claimName: rule.claimName,
    receiptNo,
    receiptDate: `${pad2(effectiveDate.day)}-${pad2(effectiveDate.month)}-${effectiveDate.year}`,
    receiptAmount: amount,
    claimableAmount: amount,
    remarks,
    dateAdjusted: effectiveDate.adjusted,
    originalReceiptDate: `${pad2(day)}-${pad2(month)}-${period.year}`
  };
}

function parseReceiptNoPart(tail) {
  const hashIndex = tail.lastIndexOf("#");
  if (hashIndex < 0) return "";
  return tail.slice(hashIndex + 1).trim();
}

function stripReceiptNoPart(text) {
  return String(text || "").replace(/\s*#[^#]*$/, "").trim();
}

function isReceiptNoRequired(rule) {
  return rule.groupName === "CLOTHING ALLOWANCE" || rule.groupName === "HEALTH SCREENING";
}

function clampToTodayIfFuture(year, month, day) {
  const candidate = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (candidate.getTime() <= today.getTime()) {
    return { year, month, day, adjusted: false };
  }
  return {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
    adjusted: true
  };
}

function parseDatePart(tail) {
  const m = tail.match(
    /^\s*(?:(0?[1-9]|1[0-2])\s*[\/\-:_]\s*(3[01]|[12]\d|0?[1-9])|(0[1-9]|1[0-2])(3[01]|[12]\d|0[1-9]))/
  );
  if (!m) return null;
  return {
    month: Number(m[1] || m[3]),
    day: Number(m[2] || m[4])
  };
}

function parseAmountPart(tail) {
  const dashAmount = tail.match(/-\s*(\d+(?:\.\d{1,2})?)(?!.*-\s*\d)/);
  if (dashAmount) return normalizeMoney(dashAmount[1]);

  const fallback = tail.match(/(\d+(?:\.\d{1,2})?)\s*(?:\D*)$/);
  if (fallback) return normalizeMoney(fallback[1]);

  throw new Error(`Cannot parse amount from: ${tail}`);
}

function normalizeMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${v}`);
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function buildRemarks({ tail, rule, month, day }) {
  if (rule.defaultRemarks) return rule.defaultRemarks;

  let text = stripReceiptNoPart(tail);
  text = text.replace(
    /^\s*(?:(0?[1-9]|1[0-2])\s*[\/\-:_]\s*(3[01]|[12]\d|0?[1-9])|(0[1-9]|1[0-2])(3[01]|[12]\d|0[1-9]))\s*-\s*/,
    ""
  );
  text = text.replace(/^\s*\d+(?:\.\d{1,2})?\s*/, "");
  text = text.trim();
  const dateToken = `${pad2(month)}${pad2(day)}`;
  return `${dateToken}${text ? ` ${text}` : ""}`.trim();
}

async function ensureLoggedIn(page, context, email, password) {
  if (!FORCE_LOGIN) {
    const reused = await tryReuseLoggedInSession(page);
    if (reused) return;
  }

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  const url = page.url();
  const probablyLoggedIn = url.includes("infotech-cloudhr.com.sg");
  if (probablyLoggedIn && !FORCE_LOGIN) return;

  const authPage = await getMicrosoftAuthPage(page, context);
  await waitForAnyUrlContains(
    authPage,
    ["microsoftonline.com", "login.live.com", "login-infotech.com"],
    45000
  ).catch(() => {});

  await clickIfVisible(authPage, ["div[role='button']:has-text('Use another account')"], 2500);
  const emailInput = authPage.locator("input[type='email'], input[name='loginfmt']").first();
  if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
    await emailInput.fill(email);
    await clickIfVisible(authPage, ["input[type='submit']", "button[type='submit']"], 3000);
  }

  const pwdInput = authPage.locator("input[type='password'], input[name='passwd']").first();
  if (await pwdInput.isVisible({ timeout: 15000 }).catch(() => false)) {
    await pwdInput.fill(password);
    await clickIfVisible(authPage, ["input[type='submit']", "button[type='submit']"], 3000);
  }

  await waitForLoginSuccess(page, authPage, ["infotech-cloudhr.com.sg"], 240000);
}

async function tryReuseLoggedInSession(page) {
  await page.goto(CLAIM_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  if (await waitForClaimPageReady(page, 6000)) return true;
  return await page
    .locator("a:has-text('My Claim'), a:has-text('Logout')")
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
}

async function getMicrosoftAuthPage(page, context) {
  const popupPromise = context.waitForEvent("page", { timeout: 7000 }).catch(() => null);
  await clickIfVisible(
    page,
    [
      "button:has-text('Microsoft')",
      "a:has-text('Microsoft')",
      "input#imgbtnLoginAD",
      "text=/microsoft/i"
    ],
    7000
  );
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    return popup;
  }
  return page;
}

async function openApplyClaim(page) {
  if (await waitForClaimPageReady(page, 1000)) return;

  await gotoWithRetry(page, CLAIM_URL, 2).catch(() => {});
  if (await waitForClaimPageReady(page, 12000)) return;

  await gotoWithRetry(page, HOME_URL, 3);
  await clickIfVisible(page, ["a:has-text('My Claim')", "text=My Claim"], 2500);
  const clickedApply = await clickIfVisible(
    page,
    ["a:has-text('Apply Claim')", "text=Apply Claim"],
    3000
  );
  if (!clickedApply) {
    await page.evaluate(() => {
      if (typeof window.__doPostBack === "function") {
        window.__doPostBack("ctl00$rptParentMenu$ctl01$rptSubMenu$ctl00$lnkPageUrl", "");
      }
    }).catch(() => {});
  }
  if (!(await waitForClaimPageReady(page, 12000))) {
    throw new Error(`Cannot open Apply Claim page. Current URL: ${page.url()}`);
  }
}

async function gotoWithRetry(page, url, retries) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return;
    } catch (err) {
      lastErr = err;
      await sleep(800);
    }
  }
  throw lastErr || new Error(`Cannot navigate to ${url}`);
}

async function waitForClaimPageReady(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page
      .evaluate(() => {
        const t = (document.body?.innerText || "").toLowerCase();
        if (!t) return false;
        const hasClaimHints =
          t.includes("new claim") ||
          t.includes("claim template name") ||
          t.includes("add more claims") ||
          t.includes("claim group name");
        const loading = t.includes("getting things ready for you");
        return hasClaimHints && !loading;
      })
      .catch(() => false);
    if (ready) return true;
    await sleep(800);
  }
  return false;
}

async function startNewClaim(page, templateName) {
  const clickedById = await page
    .locator("a[id*='lnkManage'], button[id*='lnkManage']")
    .first()
    .click({ timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!clickedById) {
    await clickByText(page, /\+?\s*new\s*claim/i, true);
  }
  await waitUntilNotBusy(page, 8000);
  await waitForFieldReady(page, "Claim Template Name", ["input"], 30000);
  await setTextByLabel(page, "Claim Template Name", templateName, true);
  await waitUntilNotBusy(page, 5000);
}

async function fillClaimForm(page, claim, claimNumber) {
  await timedStep(`Timing claim ${claimNumber}: claim group`, () =>
    setChoiceByLabel(page, "Claim Group Name", claim.claimGroupName, true)
  );
  await timedStep(`Timing claim ${claimNumber}: claim name`, () =>
    setChoiceByLabel(page, "Claim Name", claim.claimName, true)
  );
  await timedStep(`Timing claim ${claimNumber}: text fields`, async () => {
    if (claim.receiptNo) {
      await timedStep(`Timing claim ${claimNumber}: receipt no`, () =>
        setOptionalReceiptNo(page, claim.receiptNo)
      );
    }
    await timedStep(`Timing claim ${claimNumber}: receipt amount`, () =>
      setTextByLabel(page, "Receipt Amount", claim.receiptAmount, true)
    );
    await timedStep(`Timing claim ${claimNumber}: remarks`, () =>
      setTextByLabel(page, "Remarks", claim.remarks, true)
    );
    await timedStep(`Timing claim ${claimNumber}: claimable amount`, () =>
      setTextByLabel(page, "Claimable Amount", claim.claimableAmount, true)
    );
    await timedStep(`Timing claim ${claimNumber}: receipt date`, () =>
      setTextByLabel(page, "Receipt Date", claim.receiptDate, true)
    );
    await timedStep(`Timing claim ${claimNumber}: receipt date verify`, () =>
      ensureReceiptDatePresent(page, claim.receiptDate, true)
    );
  });
  await timedStep(`Timing claim ${claimNumber}: attachment`, async () => {
    await setAttachment(page, claim.absolutePath, true);
    await waitUntilNotBusy(page, 4000);
    await ensureReceiptDatePresent(page, claim.receiptDate, true);
  });
}

async function clickSave(page) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  const saveElementId = `${tabId}_lnkAddNew`;
  const savePostBackTarget =
    "ctl00$ContentPlaceHolder1$tabClaimApplyCancel$tabClaimApply$lnkAddNew";
  const saveSelectors = [
    `#${CLAIM_TAB_PREFIX}_lnkAddNew`,
    `#${saveElementId}`,
    `#${tabId}_divManage a#${saveElementId}`,
    `#${tabId}_divManage a.ui-btn.theme:has-text('SAVE')`,
    `#${tabId}_divManage a:has-text('SAVE')`,
    `#${tabId}_divManage button:has-text('SAVE')`,
    `#${tabId}_divManage input[type='submit'][value*='SAVE' i]`,
    `a[id*='lnkAddNew']:has-text('SAVE')`
  ];

  for (const selector of saveSelectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: 900 }).catch(() => false);
    if (!visible) continue;
    const clicked = await target
      .click({ timeout: 7000, force: true })
      .then(() => true)
      .catch(() => false);
    if (!clicked) continue;
    await waitForSavePostback(page);
    await assertClaimFormHasNoVisibleErrors(page);
    return await ensureSaveTriggered(page, savePostBackTarget);
  }

  const clicked = await clickByText(page, /^\s*save\s*$/i, false);
  if (!clicked) throw new Error("Cannot click SAVE button");
  await waitForSavePostback(page);
  await assertClaimFormHasNoVisibleErrors(page);
  return await ensureSaveTriggered(page, savePostBackTarget);
}

async function ensureSaveTriggered(page, savePostBackTarget) {
  const savedState = await detectSavedLikeState(page);
  if (savedState) return true;

  await page
    .evaluate((target) => {
      if (typeof window.__doPostBack === "function") {
        window.__doPostBack(target, "");
      }
    }, savePostBackTarget)
    .catch(() => {});
  await waitForSavePostback(page);
  await assertClaimFormHasNoVisibleErrors(page);
  return true;
}

async function detectSavedLikeState(page) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  return await page
    .evaluate((id) => {
      const root =
        document.getElementById(`${id}_divManage`) ||
        document.getElementById(id) ||
        document.body;
      if (!root) return false;
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const rootText = (root.textContent || "").toLowerCase();
      const hasAddMore = /add\s*more\s*claims/.test(rootText);
      const hasSavedMessage =
        rootText.includes("claim saved successfully") ||
        rootText.includes("status: claim saved successfully");
      return hasAddMore || hasSavedMessage;
    }, tabId)
    .catch(() => false);
}

async function verifySavedState(page, templateName) {
  await waitUntilNotBusy(page, 10000);
  const start = Date.now();
  let last = {
    hasTemplateRow: false,
    hasSaveSuccess: false,
    stillEditing: false
  };

  while (Date.now() - start < 20000) {
    last = await page
      .evaluate(
        ({ tabPrefix, template }) => {
          const tabId = `${tabPrefix}_tabClaimApply`;
          const root =
            document.getElementById(`${tabId}_divManage`) ||
            document.getElementById(tabId) ||
            document.body;
          if (!root) {
            return { hasTemplateRow: false, hasSaveSuccess: false, stillEditing: false };
          }

          const visible = (el) => {
            const s = getComputedStyle(el);
            if (!s || s.display === "none" || s.visibility === "hidden") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const norm = (s) =>
            String(s || "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();

          const tpl = norm(template);
          const rootText = norm(root.textContent || "");
          const hasSaveSuccess =
            rootText.includes("claim saved successfully") ||
            rootText.includes("status: claim saved successfully");

          const saveButton = root.querySelector("a[id*='lnkAddNew'], button, input[type='submit']");
          const stillEditing =
            rootText.includes("add claim to existing template") ||
            (saveButton && visible(saveButton) && norm(saveButton.textContent || saveButton.value || "").includes("save"));

          let hasTemplateRow = false;
          const tables = Array.from(root.querySelectorAll("table")).filter(visible);
          for (const table of tables) {
            const headers = Array.from(table.querySelectorAll("th")).map((th) => norm(th.textContent || ""));
            const looksLikeTemplateList =
              headers.some((h) => h.includes("claim template")) &&
              (headers.some((h) => h.includes("add more claims")) ||
                headers.some((h) => h.includes("view claims")) ||
                headers.some((h) => h.includes("claimable amount")));
            if (!looksLikeTemplateList) continue;
            const rows = Array.from(table.querySelectorAll("tbody tr, tr")).filter(visible);
            if (rows.some((row) => norm(row.textContent || "").includes(tpl))) {
              hasTemplateRow = true;
              break;
            }
          }

          return { hasTemplateRow, hasSaveSuccess, stillEditing };
        },
        {
          tabPrefix: CLAIM_TAB_PREFIX,
          template: templateName
        }
      )
      .catch(() => ({ hasTemplateRow: false, hasSaveSuccess: false, stillEditing: false }));

    if ((last.hasTemplateRow || last.hasSaveSuccess) && !last.stillEditing) return true;
    await sleep(300);
  }

  throw new Error(
    `Save verification failed: templateRow=${last.hasTemplateRow}, saveSuccess=${last.hasSaveSuccess}, stillEditing=${last.stillEditing}`
  );
}

async function clickAddMoreClaimsPlus(page, templateName) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  await clickByText(page, /add\s*more\s*claims/i, false);
  const plusSelectors = [
    `#${CLAIM_TAB_PREFIX}_lnkAdd`,
    `#${tabId}_lnkAdd`,
    `#${CLAIM_TAB_PREFIX}_btnAdd`,
    `#${tabId}_btnAdd`,
    `#${CLAIM_TAB_PREFIX}_lnkAddMore`,
    `#${tabId}_lnkAddMore`,
    `#${tabId} a[id*='lnkAdd']`,
    `#${tabId} button[id*='btnAdd']`,
    `#${tabId} a[title*='add' i]`,
    `#${tabId} button[title*='add' i]`,
    `#${tabId} .fa-plus`,
    `#${tabId} i[class*='plus']`,
    `#${tabId} [class*='plus']`,
    `#${tabId} td:has-text('+')`,
    `#${tabId} span:has-text('+')`,
    `td:has-text('+')`,
    `#${tabId} a:has-text('+')`,
    `#${tabId} button:has-text('+')`
  ];

  let plusClicked = false;
  for (const selector of plusSelectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: 600 }).catch(() => false);
    if (!visible) continue;
    plusClicked = await target
      .click({ timeout: 4000, force: true })
      .then(() => true)
      .catch(() => false);
    if (plusClicked) break;
  }

  if (!plusClicked) {
    plusClicked = await clickByText(page, /^\s*\+\s*$/i, false);
  }

  if (!plusClicked) {
    // fallback: click element that contains '+' near "Add More Claims"
    plusClicked = await page
      .evaluate(() => {
        function visible(el) {
          const s = getComputedStyle(el);
          if (!s || s.display === "none" || s.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        const blocks = Array.from(document.querySelectorAll("*")).filter(
          (el) =>
            visible(el) &&
            /add\s*more\s*claims/i.test((el.textContent || "").replace(/\s+/g, " "))
        );
        for (const b of blocks) {
          const ownText = (b.textContent || "").replace(/\s+/g, " ").trim();
          if (!/add\s*more\s*claims/i.test(ownText)) continue;
          const candidates = Array.from(
            b.querySelectorAll("button, a, span, div, i")
          ).filter(visible);
          for (const c of candidates) {
            const text = (c.textContent || "").replace(/\s+/g, " ").trim();
            const title = (c.getAttribute("title") || "").trim();
            if (text === "+" || /add/i.test(title)) {
              c.click();
              return true;
            }
          }
        }
        return false;
      })
      .catch(() => false);
  }

  if (!plusClicked) {
    plusClicked = await clickAddMoreByTemplateRow(page, templateName);
  }

  if (!plusClicked) {
    const openedTemplate = await openTemplateFromList(page, templateName);
    if (openedTemplate) {
      await waitUntilNotBusy(page, 8000);
      await page.waitForTimeout(600);
      for (const selector of plusSelectors) {
        const target = page.locator(selector).first();
        const visible = await target.isVisible({ timeout: 600 }).catch(() => false);
        if (!visible) continue;
        plusClicked = await target
          .click({ timeout: 4000, force: true })
          .then(() => true)
          .catch(() => false);
        if (plusClicked) break;
      }
      if (!plusClicked) {
        plusClicked = await clickByText(page, /^\s*\+\s*$/i, false);
      }
    }
  }

  if (!plusClicked) {
    const errors = await readVisibleClaimValidationErrors(page);
    const debugButtons = await readVisibleActionButtons(page);
    fs.writeFileSync(
      path.join(ARTIFACT_DIR, "add-more-debug-buttons.json"),
      JSON.stringify(debugButtons, null, 2),
      "utf-8"
    );
    const suffix = errors.length ? ` (validation: ${errors.join(" | ")})` : "";
    throw new Error(`Cannot click Add More Claims + button${suffix}`);
  }
  await waitUntilNotBusy(page, 6000);
  return true;
}

async function openViewClaimsForFinalScreenshot(page, templateName) {
  await waitUntilNotBusy(page, 10000);
  const clicked = await clickViewClaimsByTemplateRow(page, templateName);
  if (clicked) {
    await waitUntilNotBusy(page, 10000);
    await page.waitForTimeout(400);
    return true;
  }

  const debugButtons = await readVisibleActionButtons(page);
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "view-claims-debug-buttons.json"),
    JSON.stringify(debugButtons, null, 2),
    "utf-8"
  );
  log("Cannot open View Claims details before final screenshot; taking current page screenshot.");
  return false;
}

async function clickViewClaimsByTemplateRow(page, templateName) {
  return await page
    .evaluate((template) => {
      const target = String(template || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!target) return false;

      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const norm = (s) =>
        String(s || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

      const tables = Array.from(document.querySelectorAll("table"));
      for (const table of tables) {
        if (!visible(table)) continue;
        const headers = Array.from(table.querySelectorAll("th")).map((th) => norm(th.textContent || ""));
        if (!headers.some((h) => h.includes("claim template"))) continue;

        const viewClaimsIndex = headers.findIndex(
          (h) => h.includes("view claims") || h.includes("view claim")
        );
        if (viewClaimsIndex < 0) continue;

        const rows = Array.from(table.querySelectorAll("tbody tr"));
        for (const row of rows) {
          if (!visible(row)) continue;
          const rowText = norm(row.textContent || "");
          if (!rowText.includes(target)) continue;

          const cell = row.querySelector(`td:nth-child(${viewClaimsIndex + 1})`);
          if (!cell || !visible(cell)) continue;

          const clickable = cell.querySelector(
            "a,button,input[type='button'],input[type='submit'],img,i,span,div"
          );
          if (clickable && visible(clickable)) {
            clickable.click();
            return true;
          }
          cell.click();
          return true;
        }
      }

      return false;
    }, templateName)
    .catch(() => false);
}

async function clickAddMoreByTemplateRow(page, templateName) {
  return await page
    .evaluate((template) => {
      const target = String(template || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!target) return false;

      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const norm = (s) =>
        String(s || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

      const tables = Array.from(document.querySelectorAll("table"));
      for (const table of tables) {
        if (!visible(table)) continue;
        const headers = Array.from(table.querySelectorAll("th")).map((th) => norm(th.textContent || ""));
        if (!headers.some((h) => h.includes("claim template"))) continue;

        const addMoreIndex = headers.findIndex((h) => h.includes("add more claims"));
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        for (const row of rows) {
          if (!visible(row)) continue;
          const rowText = norm(row.textContent || "");
          if (!rowText.includes(target)) continue;

          if (addMoreIndex >= 0) {
            const cell = row.querySelector(`td:nth-child(${addMoreIndex + 1})`);
            if (cell && visible(cell)) {
              const clickable = cell.querySelector("a,button,span,i,div,input[type='button'],input[type='submit']");
              if (clickable && visible(clickable)) {
                clickable.click();
                return true;
              }
              cell.click();
              return true;
            }
          }

          const fallback = row.querySelector(
            "[id*='lnkAdd'], [id*='btnAdd'], [class*='plus'], .fa-plus, [title*='add' i], a, button"
          );
          if (fallback && visible(fallback)) {
            fallback.click();
            return true;
          }
        }
      }
      return false;
    }, templateName)
    .catch(() => false);
}

async function openTemplateFromList(page, templateName) {
  const normalized = String(templateName || "").trim();
  if (!normalized) return false;
  const exact = page.getByText(new RegExp(`^\\s*${escapeForRegex(normalized)}\\s*$`, "i")).first();
  if (await exact.isVisible({ timeout: 1500 }).catch(() => false)) {
    const clicked = await exact
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
  }

  const partial = page.getByText(new RegExp(escapeForRegex(normalized), "i")).first();
  if (await partial.isVisible({ timeout: 1200 }).catch(() => false)) {
    const clicked = await partial
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
  }

  return await page
    .evaluate((name) => {
      const target = String(name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const nodes = Array.from(document.querySelectorAll("a,button,td,span,div")).filter(visible);
      for (const n of nodes) {
        const txt = (n.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!txt) continue;
        if (txt === target || txt.includes(target)) {
          n.click();
          return true;
        }
      }

      const templateLabels = Array.from(
        document.querySelectorAll("[id*='gvClaimApply_lblCliamTemplate_'], [id*='gvClaimApply_lblClaimTemplate_']")
      ).filter(visible);
      for (const label of templateLabels) {
        const txt = (label.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!txt || (!txt.includes(target) && txt !== target)) continue;
        const row = label.closest("tr");
        if (row) {
          const clickable = row.querySelector("a,button,input[type='button'],input[type='submit']");
          if (clickable) {
            clickable.click();
            return true;
          }
          row.click();
          return true;
        }
        label.click();
        return true;
      }
      return false;
    }, templateName)
    .catch(() => false);
}

async function setAttachment(page, filePath, required) {
  const uploadPayload = prepareAttachmentPayload(filePath);
  const locator = page.locator("input[type='file']").first();
  if ((await locator.count().catch(() => 0)) > 0) {
    await locator.setInputFiles(uploadPayload);
    await page.waitForTimeout(250).catch(() => {});
    return true;
  }

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
  await clickByText(page, /attachment|upload|browse/i, false);
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(uploadPayload);
    return true;
  }
  if (required) {
    throw new Error(`Cannot set attachment input for file: ${filePath}`);
  }
  return false;
}

function prepareAttachmentPayload(filePath) {
  const originalBase = path.basename(filePath);
  if (/^[\w .()-]+$/.test(originalBase) && originalBase.length <= 90) {
    return filePath;
  }

  const ext = path.extname(originalBase).toLowerCase() || ".bin";
  const baseNoExt = path.basename(originalBase, path.extname(originalBase));
  const safeBase =
    baseNoExt
      .normalize("NFKD")
      .replace(/[^\w .()-]+/g, "_")
      .replace(/\s+/g, " ")
      .replace(/_+/g, "_")
      .trim()
      .slice(0, 70)
      .replace(/[ ._-]+$/g, "") || "attachment";
  return {
    name: `${safeBase}${ext}`,
    mimeType: guessMimeType(ext),
    buffer: fs.readFileSync(filePath)
  };
}

function guessMimeType(ext) {
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return mimeTypes[ext] || "application/octet-stream";
}

async function setTextByLabel(page, label, value, required) {
  const labelLower = label.toLowerCase();
  if (labelLower.includes("receipt date")) {
    return await setReceiptDate(page, String(value), required);
  }

  const field = await findField(page, label, ["input", "textarea"]);
  if (!field) {
    if (required) throw new Error(`Cannot find field: ${label}`);
    return false;
  }

  await field.click({ timeout: 3000 }).catch(() => {});
  await field.fill(String(value)).catch(async () => {
    await field.evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(value));
  });
  await field.press("Tab").catch(() => {});
  return true;
}

async function ensureTextByLabel(page, label, value, required) {
  const field = await findField(page, label, ["input", "textarea"]);
  if (!field) {
    if (required) throw new Error(`Cannot find field: ${label}`);
    return false;
  }

  const expected = normalizeLoose(value);
  const current = normalizeLoose(await field.inputValue().catch(() => ""));
  if (current && (current === expected || current.includes(expected) || expected.includes(current))) {
    return true;
  }

  await field.click({ timeout: 2500 }).catch(() => {});
  await field.fill(String(value)).catch(async () => {
    await field.evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(value));
  });
  await field.press("Tab").catch(() => {});
  await waitUntilNotBusy(page, 2500);
  return true;
}

async function setOptionalReceiptNo(page, value) {
  await page
    .evaluate(
      ({ tabPrefix, receiptNo }) => {
        const tabId = `${tabPrefix}_tabClaimApply`;
        const root =
          document.getElementById(`${tabId}_divManage`) ||
          document.getElementById(tabId) ||
          document.body;
        if (!root) return false;

        const candidates = [
          `#${tabId}_txtReceiptNo`,
          "input[id*='txtReceiptNo']",
          "input[name*='txtReceiptNo']",
          "input[id*='ReceiptNo']",
          "input[name*='ReceiptNo']"
        ];
        const input = candidates
          .map((selector) => root.querySelector(selector) || document.querySelector(selector))
          .find(Boolean);
        if (!input) return false;

        input.removeAttribute("readonly");
        input.removeAttribute("disabled");
        input.value = String(receiptNo || "");
        input.setAttribute("value", String(receiptNo || ""));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      },
      { tabPrefix: CLAIM_TAB_PREFIX, receiptNo: value }
    )
    .catch(() => false);
  return true;
}

async function setReceiptDate(page, value, required) {
  let lastReason = "unknown";
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

  for (let attempt = 0; attempt < 3; attempt++) {
    await waitUntilNotBusy(page, 1200);

    const field = await findReceiptDateInput(page);
    if (field) {
      await field.click({ timeout: 3000 }).catch(() => {});
      await field.fill(value).catch(() => {});
      await field
        .evaluate((el, v) => {
          const input = el;
          input.removeAttribute("readonly");
          input.removeAttribute("disabled");
          input.value = v;
          input.setAttribute("value", v);
          if (
            window.jQuery &&
            window.jQuery.fn &&
            typeof window.jQuery.fn.datepicker === "function"
          ) {
            try {
              window.jQuery(input).datepicker("setDate", v);
            } catch {}
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
        }, value)
        .catch(() => {});
      await field.press("Tab").catch(() => {});
      await page.waitForTimeout(120).catch(() => {});

      const current = await field.inputValue().catch(() => "");
      if (normalizeDateText(current).includes(normalizeDateText(value))) {
        return true;
      }
    }

    const fallback = await setReceiptDateByDomHeuristic(page, value);
    if (fallback.ok) return true;
    lastReason = fallback.reason || "unknown";
    await page.waitForTimeout(120).catch(() => {});
  }

  if (required) {
    const fallback = await setReceiptDateByDomHeuristic(page, value);
    if (fallback.candidates?.length) {
      fs.writeFileSync(
        path.join(ARTIFACT_DIR, "receipt-date-candidates.json"),
        JSON.stringify(fallback, null, 2),
        "utf-8"
      );
    }
    throw new Error(
      `Cannot set Receipt Date input field. expected=${value}, reason=${lastReason}`
    );
  }
  return false;
}

async function ensureReceiptDatePresent(page, expectedDate, required) {
  for (let i = 0; i < 3; i++) {
    if (await isReceiptDateSet(page, expectedDate)) return true;
    await setReceiptDate(page, expectedDate, false);
    await page.waitForTimeout(150).catch(() => {});
  }

  if (required) {
    throw new Error(
      `Receipt Date missing before save. expected=${expectedDate}`
    );
  }
  return false;
}

async function findReceiptDateInput(page) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  const selectors = [
    `#${CLAIM_TAB_PREFIX}_txtReceiptDate`,
    `#${tabId}_txtReceiptDate`,
    `#${tabId}_divManage input[placeholder*='DD-MM-YYYY']`,
    `#${tabId}_divManage input[id*='ReceiptDate']`,
    `#${tabId}_divManage input[name*='ReceiptDate']`,
    `#${tabId}_divManage input[id*='Date']`,
    `#${tabId}_divManage input[name*='Date']`,
    `#${tabId}_divManage input[class*='date']`,
    `#${tabId}_divManage input[id*='txtDate']`,
    `#${tabId}_divManage input[name*='txtDate']`,
    `input[placeholder*='DD-MM-YYYY']`,
    `input[id*='ReceiptDate']`,
    `input[name*='ReceiptDate']`
  ];
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    const visible = await loc.isVisible({ timeout: 600 }).catch(() => false);
    if (!visible) continue;
    return loc;
  }
  return await findField(page, "Receipt Date", ["input"]);
}

async function isReceiptDateSet(page, expectedDate) {
  const target = normalizeDateText(expectedDate);
  const field = await findReceiptDateInput(page);
  if (field) {
    const current = await field.inputValue().catch(() => "");
    if (normalizeDateText(current).includes(target)) return true;
  }

  const probe = await page
    .evaluate((tabPrefix) => {
      const tabId = `${tabPrefix}_tabClaimApply`;
      const root =
        document.getElementById(`${tabId}_divManage`) ||
        document.getElementById(tabId) ||
        document.body;
      if (!root) return [];
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const inputs = Array.from(root.querySelectorAll("input:not([type='hidden'])")).filter(visible);
      const rows = [];
      for (const el of inputs) {
        const id = el.id || "";
        const name = el.getAttribute("name") || "";
        const ph = el.getAttribute("placeholder") || "";
        const cls = el.className || "";
        const val = el.value || "";
        rows.push({ id, name, ph, cls, val });
      }
      return rows;
    }, CLAIM_TAB_PREFIX)
    .catch(() => []);

  for (const row of probe) {
    const key = normalizeDateText(`${row.id} ${row.name} ${row.ph} ${row.cls}`);
    if (key.includes("receiptdate") || key.includes("dd-mm-yyyy")) {
      if (normalizeDateText(row.val).includes(target)) return true;
    }
  }
  return false;
}

async function setReceiptDateByDomHeuristic(page, value) {
  return await page
    .evaluate(
      ({ tabPrefix, dateValue }) => {
        const tabId = `${tabPrefix}_tabClaimApply`;
        const root =
          document.getElementById(`${tabId}_divManage`) ||
          document.getElementById(tabId) ||
          document.body;
        if (!root) {
          return { ok: false, reason: "dom_not_ready", candidates: [] };
        }
        const visible = (el) => {
          const s = getComputedStyle(el);
          if (!s || s.display === "none" || s.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const norm = (s) =>
          String(s || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

        const candidates = [];
        const inputs = Array.from(root.querySelectorAll("input:not([type='hidden'])")).filter(visible);
        for (const el of inputs) {
          const id = el.id || "";
          const name = el.getAttribute("name") || "";
          const ph = el.getAttribute("placeholder") || "";
          const cls = el.className || "";
          const type = el.getAttribute("type") || "";
          const key = norm(`${id} ${name} ${ph} ${cls}`);
          const boxText = norm(el.closest("tr, .row, .form-group, td, div")?.textContent || "");

          let score = 0;
          if (key.includes("receiptdate")) score += 100;
          if (key.includes("dd-mm-yyyy")) score += 90;
          if (key.includes("date")) score += 45;
          if (key.includes("datepicker")) score += 40;
          if (boxText.includes("receipt date")) score += 80;
          if (boxText.includes("from date") || boxText.includes("to date")) score -= 90;
          if (boxText.includes("date filter") || boxText.includes("claim approved date")) score -= 60;
          if (type === "date") score += 30;

          candidates.push({
            score,
            id,
            name,
            ph,
            cls,
            value: el.value || "",
            boxText: boxText.slice(0, 160)
          });
        }

        candidates.sort((a, b) => b.score - a.score);
        if (!candidates.length) {
          return { ok: false, reason: "no_visible_input", candidates: [] };
        }

        const pick = candidates[0];
        const targetEl = inputs.find((el) => (el.id || "") === pick.id) || inputs[0];
        if (!targetEl) {
          return { ok: false, reason: "no_target_after_rank", candidates: candidates.slice(0, 8) };
        }

        targetEl.removeAttribute("readonly");
        targetEl.removeAttribute("disabled");
        targetEl.value = dateValue;
        targetEl.setAttribute("value", dateValue);
        if (
          window.jQuery &&
          window.jQuery.fn &&
          typeof window.jQuery.fn.datepicker === "function"
        ) {
          try {
            window.jQuery(targetEl).datepicker("setDate", dateValue);
          } catch {}
        }
        targetEl.dispatchEvent(new Event("input", { bubbles: true }));
        targetEl.dispatchEvent(new Event("change", { bubbles: true }));
        targetEl.dispatchEvent(new Event("blur", { bubbles: true }));

        const finalValue = targetEl.value || "";
        const ok =
          norm(finalValue).replace(/\//g, "-") ===
          norm(dateValue).replace(/\//g, "-");
        return {
          ok,
          reason: ok ? "set_success" : "value_mismatch",
          finalValue,
          picked: pick,
          candidates: candidates.slice(0, 8)
        };
      },
      { tabPrefix: CLAIM_TAB_PREFIX, dateValue: value }
    )
    .catch((err) => ({
      ok: false,
      reason: `evaluate_failed: ${err && err.message ? err.message : String(err)}`,
      candidates: []
    }));
}

async function setChoiceByLabel(page, label, value, required) {
  const labelLower = label.toLowerCase();
  if (labelLower.includes("claim group")) {
    return await setCustomComboById(page, CLAIM_GROUP_COMBO_ID, value, required);
  }
  if (labelLower.includes("claim name")) {
    return await setCustomComboById(page, SUB_CLAIM_COMBO_ID, value, required);
  }

  const selectField = await findField(page, label, ["select"]);
  if (selectField) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (label.toLowerCase().includes("claim group")) {
        await waitForSelectOptions(selectField, 4000);
      }
      if (label.toLowerCase().includes("claim name")) {
        await waitForSelectOptions(selectField, 6000);
      }

      const chosenBySelect = await selectOptionByText(selectField, value);
      if (chosenBySelect) return true;

      const chosenFromPopup = await chooseFromDropdownLike(page, selectField, value);
      if (chosenFromPopup) return true;

      await sleep(800);
    }
    if (required) {
      const options = await readOptionTexts(selectField);
      throw new Error(
        `Option not found for ${label}: ${value}. Available options: ${options.join(" | ")}`
      );
    }
    return false;
  }

  const inputLike = await findField(page, label, ["input", "textarea", "[role='combobox']"]);
  if (inputLike) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await inputLike.click({ timeout: 3000 }).catch(() => {});
      await inputLike.fill(value).catch(async () => {
        await inputLike.type(value, { delay: 20 }).catch(() => {});
      });
      await inputLike.press("Enter").catch(() => {});

      const chosenFromPopup = await chooseFromDropdownLike(page, inputLike, value);
      if (chosenFromPopup || attempt === 2) return true;
      await sleep(800);
    }
  }

  if (required) throw new Error(`Cannot find choice field: ${label}`);
  return false;
}

async function setCustomComboById(page, comboId, value, required) {
  const input = page.locator(`#${comboId}_Input`).first();
  const dropDiv = page.locator(`#${comboId}_DropDiv`).first();
  const dropDown = page.locator(`#${comboId}_DropDown`).first();
  const itemLocator = page.locator(`div[id^='${comboId}_item_']`);

  if ((await input.count().catch(() => 0)) === 0) {
    if (required) throw new Error(`Combo input not found: ${comboId}_Input`);
    return false;
  }

  const targetNorm = normalizeLoose(value);
  const currentInputValue = normalizeLoose(await input.inputValue().catch(() => ""));
  if (comboMatchScore(currentInputValue, targetNorm) >= 45) return true;
  const currentHiddenValue = normalizeLoose(
    await page
      .locator(`#${comboId}_Data`)
      .first()
      .inputValue()
      .catch(() => "")
  );
  if (comboMatchScore(currentHiddenValue, targetNorm) >= 45) return true;

  const directSelected = await selectCustomComboItemDirect(page, comboId, value);
  if (directSelected) return true;

  for (let attempt = 0; attempt < 3; attempt++) {
    const keyword = firstKeyword(value);
    if (keyword) {
      // Fast path: type keyword and select first matching option.
      await input.click({ timeout: 2000 }).catch(() => {});
      await input.fill(keyword).catch(() => {});
      await input.press("ArrowDown").catch(() => {});
      await input.press("Enter").catch(() => {});
      await input.press("Tab").catch(() => {});
      await waitUntilNotBusy(page, 3000);
      const quickSelected = normalizeLoose(await input.inputValue().catch(() => ""));
      if (comboMatchScore(quickSelected, targetNorm) >= 45) return true;
    }

    await input.click({ timeout: 3000 }).catch(() => {});
    await dropDiv.click({ timeout: 3000 }).catch(() => {});
    await input.press("ArrowDown").catch(() => {});
    await dropDown.waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
    await sleep(120);

    const count = await itemLocator.count().catch(() => 0);
    let bestIndex = -1;
    let bestScore = -1;
    const allTexts = [];

    for (let i = 0; i < count; i++) {
      const item = itemLocator.nth(i);
      const txt = (await item.textContent().catch(() => "")) || "";
      const textNorm = normalizeLoose(txt);
      if (!textNorm) continue;
      allTexts.push(txt.replace(/\s+/g, " ").trim());
      const score = comboMatchScore(textNorm, targetNorm);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= 50) {
      const targetItem = itemLocator.nth(bestIndex);
      const targetItemId = await targetItem.getAttribute("id").catch(() => "");

      await targetItem.scrollIntoViewIfNeeded().catch(() => {});
      await targetItem
        .click({ timeout: 5000, force: true })
        .catch(async () => {
          if (!targetItemId) return;
          await page
            .evaluate((id) => {
              const el = document.getElementById(id);
              if (!el) return;
              el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
              el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            }, targetItemId)
            .catch(() => {});
        });

      await input.press("Enter").catch(() => {});
      await input.press("Tab").catch(() => {});
      await waitUntilNotBusy(page, 4000);

      const selectedValue = normalizeLoose(await input.inputValue().catch(() => ""));
      const hiddenDataValue = normalizeLoose(
        await page
          .locator(`#${comboId}_Data`)
          .first()
          .inputValue()
          .catch(() => "")
      );

      if (
        comboMatchScore(selectedValue, targetNorm) >= 45 ||
        comboMatchScore(hiddenDataValue, targetNorm) >= 45
      ) {
        return true;
      }
    }

    if (attempt === 2 && required) {
      throw new Error(
        `Option not found for combo ${comboId}: ${value}. Available options: ${allTexts.join(" | ")}`
      );
    }
    await sleep(250);
  }

  return false;
}

async function selectCustomComboItemDirect(page, comboId, value) {
  const input = page.locator(`#${comboId}_Input`).first();
  const dropDiv = page.locator(`#${comboId}_DropDiv`).first();
  const dropDown = page.locator(`#${comboId}_DropDown`).first();
  const itemLocator = page.locator(`div[id^='${comboId}_item_']`);
  const targetNorm = normalizeLoose(value);

  await input.click({ timeout: 1200 }).catch(() => {});
  await dropDiv.click({ timeout: 1200 }).catch(() => {});
  await input.press("ArrowDown").catch(() => {});
  await dropDown.waitFor({ state: "visible", timeout: 1200 }).catch(() => {});
  await sleep(120);

  const count = await itemLocator.count().catch(() => 0);
  let bestIndex = -1;
  let bestScore = -1;
  for (let i = 0; i < count; i++) {
    const txt = (await itemLocator.nth(i).textContent().catch(() => "")) || "";
    const score = comboMatchScore(normalizeLoose(txt), targetNorm);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < 50) return false;

  const targetItem = itemLocator.nth(bestIndex);
  await targetItem.scrollIntoViewIfNeeded().catch(() => {});
  await targetItem.click({ timeout: 1500, force: true }).catch(async () => {
    const targetItemId = await targetItem.getAttribute("id").catch(() => "");
    if (!targetItemId) return;
    await page
      .evaluate((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }, targetItemId)
      .catch(() => {});
  });

  await input.press("Tab").catch(() => {});
  await waitUntilNotBusy(page, 3500);

  const selectedValue = normalizeLoose(await input.inputValue().catch(() => ""));
  const hiddenDataValue = normalizeLoose(
    await page
      .locator(`#${comboId}_Data`)
      .first()
      .inputValue()
      .catch(() => "")
  );
  return (
    comboMatchScore(selectedValue, targetNorm) >= 45 ||
    comboMatchScore(hiddenDataValue, targetNorm) >= 45
  );
}

function comboMatchScore(optionNorm, targetNorm) {
  if (!optionNorm || !targetNorm) return 0;
  if (optionNorm === targetNorm) return 100;
  if (optionNorm.includes(targetNorm)) return 90;
  if (targetNorm.includes(optionNorm)) return 80;

  const targetTokens = targetNorm.split(" ").filter(Boolean);
  const optionTokens = optionNorm.split(" ").filter(Boolean);
  if (!targetTokens.length) return 0;

  let hit = 0;
  for (const t of targetTokens) {
    if (optionTokens.some((o) => o.includes(t) || t.includes(o))) hit++;
  }
  const ratio = hit / targetTokens.length;
  return Math.round(ratio * 70);
}

function normalizeLoose(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstKeyword(v) {
  const words = String(v || "")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words[0] || "";
}

async function selectOptionByText(selectLocator, text) {
  const options = await readOptionTexts(selectLocator);
  const target = options.find((o) => normalizeText(o).includes(normalizeText(text)));
  if (!target) return false;
  await selectLocator.selectOption({ label: target }).catch(async () => {
    await selectLocator.selectOption({ index: options.indexOf(target) });
  });
  return true;
}

async function readOptionTexts(selectLocator) {
  return await selectLocator
    .locator("option")
    .allTextContents()
    .then((arr) => arr.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean))
    .catch(() => []);
}

async function waitForSelectOptions(selectLocator, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const options = await readOptionTexts(selectLocator);
    if (options.length > 0) return true;
    await sleep(300);
  }
  return false;
}

async function chooseFromDropdownLike(page, fieldLocator, value) {
  await fieldLocator.click({ timeout: 3000 }).catch(() => {});
  await fieldLocator.press("ArrowDown").catch(() => {});
  await sleep(300);

  const safe = escapeForText(value);
  const candidates = [
    page.getByRole("option", { name: new RegExp(escapeForRegex(value), "i") }).first(),
    page.locator(`li:has-text("${safe}")`).first(),
    page.locator(`a:has-text("${safe}")`).first(),
    page.locator(`span:has-text("${safe}")`).first(),
    page.locator(`div:has-text("${safe}")`).first()
  ];

  for (const loc of candidates) {
    const ok = await loc.isVisible({ timeout: 900 }).catch(() => false);
    if (ok) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }

  return await page
    .evaluate((targetValue) => {
      const target = String(targetValue || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const nodes = Array.from(
        document.querySelectorAll("[role='option'], li, a, span, div, option")
      );
      function visible(el) {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      for (const n of nodes) {
        const txt = (n.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!txt || txt.length > 160) continue;
        if (!visible(n)) continue;
        if (txt.includes(target)) {
          n.click();
          return true;
        }
      }
      return false;
    }, value)
    .catch(() => false);
}

async function findField(page, label, kinds) {
  const labelLower = label.toLowerCase();
  const byHints = await findFieldByKnownIds(page, labelLower, kinds);
  if (byHints) return byHints;

  const kindsXPath = kinds
    .map((k) =>
      k.startsWith("[") ? `@role='combobox'` : `self::${k}`
    )
    .join(" or ");

  const labelNode = page.locator(
    `xpath=(//label[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${escapeForXPath(
      labelLower
    )}")])[1]`
  );

  if ((await labelNode.count().catch(() => 0)) > 0) {
    const forId = await labelNode.getAttribute("for");
    if (forId) {
      const byId = page.locator(`[id="${cssEscapeAttribute(forId)}"]`).first();
      if ((await byId.count().catch(() => 0)) > 0) return byId;
    }

    const following = page.locator(
      `xpath=(//label[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${escapeForXPath(
        labelLower
      )}")])[1]/following::*[${kindsXPath}][1]`
    );
    if ((await following.count().catch(() => 0)) > 0) return following;
  }

  const fallbackInput = page.locator(
    `xpath=(//*[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${escapeForXPath(
      labelLower
    )}")])[1]/following::*[${kindsXPath}][1]`
  );
  if ((await fallbackInput.count().catch(() => 0)) > 0) return fallbackInput;

  return null;
}

async function waitForFieldReady(page, label, kinds, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await waitUntilNotBusy(page, 1500);
    const field = await findField(page, label, kinds);
    if (field && (await field.isVisible({ timeout: 500 }).catch(() => false))) {
      return field;
    }
    await sleep(200);
  }
  throw new Error(`Timeout waiting for field: ${label}`);
}

async function findFieldByKnownIds(page, labelLower, kinds) {
  const hints = getLabelIdHints(labelLower);
  if (!hints.length) return null;

  const selectors = [];
  for (const hint of hints) {
    if (kinds.includes("select")) {
      selectors.push(`select[id*="${hint}"]`, `select[name*="${hint}"]`);
    }
    if (kinds.includes("input") || kinds.includes("textarea")) {
      selectors.push(
        `input[id*="${hint}"]`,
        `textarea[id*="${hint}"]`,
        `input[name*="${hint}"]`,
        `textarea[name*="${hint}"]`
      );
    }
    if (kinds.includes("[role='combobox']")) {
      selectors.push(
        `[role='combobox'][id*="${hint}"]`,
        `[role='combobox'][name*="${hint}"]`
      );
    }
  }

  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

function getLabelIdHints(labelLower) {
  if (labelLower.includes("claim template")) return ["claimtemplate", "template"];
  if (labelLower.includes("claim group")) return ["claimgroup", "claimgroup", "group"];
  if (labelLower.includes("claim name")) return ["claimname", "subclaim", "claim"];
  if (labelLower.includes("receipt no")) return ["receiptno", "receipt_no", "receipt"];
  if (labelLower.includes("receipt amount")) return ["receiptamount", "receipt_amt", "amount"];
  if (labelLower.includes("receipt date")) return ["receiptdate", "date"];
  if (labelLower.includes("claimable amount")) return ["claimableamount", "claimable_amt"];
  if (labelLower.includes("remark")) return ["remarks", "remark"];
  if (labelLower.includes("attachment")) return ["attachment", "upload", "file"];
  return [];
}

async function clickByText(page, regex, required) {
  const candidates = [
    page.getByRole("button", { name: regex }).first(),
    page.getByRole("link", { name: regex }).first(),
    page
      .locator("input[type='button'], input[type='submit']")
      .filter({ has: page.locator(`[value]`) })
      .first(),
    page.getByText(regex).first()
  ];
  for (const locator of candidates) {
    const ok = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (!ok) continue;
    const textMatches = await locator
      .evaluate(
        (el, pattern) =>
          new RegExp(pattern, "i").test(
            (el.textContent || el.getAttribute("value") || "").replace(/\s+/g, " ").trim()
          ),
        regex.source
      )
      .catch(() => false);
    if (!textMatches) continue;

    const clicked = await locator
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
  }

  const clicked = await page
    .evaluate((pattern) => {
      const re = new RegExp(pattern, "i");
      const nodes = Array.from(
        document.querySelectorAll(
          "button,a,span,div,td,th,input[type='button'],input[type='submit']"
        )
      );
      function visible(el) {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      for (const n of nodes) {
        const text = (n.textContent || n.getAttribute("value") || "").replace(/\s+/g, " ").trim();
        if (!text || !visible(n)) continue;
        if (re.test(text)) {
          n.click();
          return true;
        }
      }
      return false;
    }, regex.source)
    .catch(() => false);

  if (!clicked && required) {
    throw new Error(`Cannot click element by text: ${regex}`);
  }
  return clicked;
}

async function waitForSavePostback(page) {
  await page.waitForTimeout(100).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 7000 }).catch(() => {});
  await waitUntilNotBusy(page, 5000);
}

async function assertClaimFormHasNoVisibleErrors(page) {
  const errors = await readVisibleClaimValidationErrors(page);
  if (errors.length) {
    throw new Error(`Save blocked by validation: ${errors.join(" | ")}`);
  }
}

async function readVisibleClaimValidationErrors(page) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  return await page
    .evaluate((rootId) => {
      const root =
        document.getElementById(`${rootId}_divManage`) ||
        document.getElementById(rootId) ||
        document.body;
      const selectors = [
        "span[id*='rfv']",
        "span[id*='rev']",
        "span[id*='Required']",
        "span[id*='Validator']",
        ".field-validation-error",
        ".validation-summary-errors",
        ".error",
        ".alert",
        ".alert-danger",
        ".alert-warning",
        ".text-danger"
      ];
      const nodes = Array.from(root.querySelectorAll(selectors.join(",")));
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const texts = [];
      for (const n of nodes) {
        if (!visible(n)) continue;
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        if (/required|incorrect|invalid|enter|must be|cannot|error|failed/i.test(t)) {
          texts.push(t);
        }
      }
      return Array.from(new Set(texts));
    }, tabId)
    .catch(() => []);
}

async function readVisibleActionButtons(page) {
  const tabId = `${CLAIM_TAB_PREFIX}_tabClaimApply`;
  return await page
    .evaluate((rootId) => {
      const root =
        document.getElementById(`${rootId}_divManage`) ||
        document.getElementById(rootId) ||
        document.body;
      if (!root) return [];
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (!s || s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return Array.from(
        root.querySelectorAll("a,button,input[type='button'],input[type='submit'],span,div")
      )
        .filter(visible)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          cls: el.className || "",
          text: (el.textContent || el.getAttribute("value") || "").replace(/\s+/g, " ").trim()
        }))
        .filter((x) => x.text && x.text.length <= 80)
        .slice(0, 300);
    }, tabId)
    .catch(() => []);
}

async function waitUntilNotBusy(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const busy = await page
      .evaluate(() => {
        const txt = (document.body?.innerText || "").toLowerCase();
        if (txt.includes("getting things ready for you")) return true;
        const loading = document.querySelector(
          "#divloadingexp, [id*='loading' i], [class*='loading' i], [class*='loader' i], [class*='spinner' i]"
        );
        if (!loading) return false;
        const style = window.getComputedStyle(loading);
        if (!style) return false;
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          return false;
        }
        const rect = loading.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .catch(() => false);
    if (!busy) return;
    await sleep(120);
  }
}

async function clickIfVisible(page, selectors, timeoutMs) {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (visible) {
      await target.click({ timeout: timeoutMs }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function waitForAnyUrlContains(page, keywords, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (urlContains(page, keywords)) return;
    await sleep(400);
  }
  throw new Error(`Timeout waiting URL contains one of: ${keywords.join(", ")}`);
}

async function waitForLoginSuccess(page, authPage, keywords, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await clickThroughMicrosoftPrompts(page);
    if (authPage && authPage !== page) await clickThroughMicrosoftPrompts(authPage);
    if (urlContains(page, keywords)) return;
    if (authPage && !authPage.isClosed() && urlContains(authPage, keywords)) return;
    await sleep(500);
  }
  throw new Error(`Login timeout waiting URL contains one of: ${keywords.join(", ")}`);
}

async function clickThroughMicrosoftPrompts(page) {
  if (!page || page.isClosed()) return;
  await clickIfVisible(
    page,
    [
      "input#idSIButton9",
      "button:has-text('Yes')",
      "input[type='submit'][value='Yes']",
      "button:has-text('Continue')"
    ],
    1000
  );
}

function urlContains(page, keywords) {
  if (!page || page.isClosed()) return false;
  const url = page.url();
  return keywords.some((k) => url.includes(k));
}

function cssEscapeAttribute(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForXPath(value) {
  return String(value).replace(/"/g, '\\"');
}

function escapeForRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeForText(value) {
  return String(value).replace(/"/g, '\\"');
}

async function askQuestion(prompt) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function askHiddenQuestion(prompt) {
  if (!process.stdin.isTTY) {
    return askQuestion(prompt);
  }

  return await new Promise((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    const stdout = process.stdout;

    function cleanup() {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(buf) {
      const s = buf.toString("utf8");
      if (s === "\u0003") {
        cleanup();
        reject(new Error("Input cancelled"));
        return;
      }
      if (s === "\r" || s === "\n") {
        stdout.write("\n");
        cleanup();
        resolve(value.trim());
        return;
      }
      if (s === "\u007f" || s === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (s.startsWith("\u001b")) return;

      value += s;
      stdout.write("*");
    }

    stdout.write(prompt);
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function normalizeDateText(v) {
  return String(v || "")
    .replace(/\s+/g, "")
    .replace(/\//g, "-")
    .toLowerCase();
}

function safeGetUrl(page) {
  if (!page || page.isClosed()) return "";
  try {
    return page.url();
  } catch {
    return "";
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function timedStep(label, fn) {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    log(`${label}: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
}

function parseCliArgs(args) {
  const out = {
    folderName: "",
    dryRun: null,
    headful: null,
    forceLogin: null
  };

  for (const arg of args) {
    if (!arg) continue;
    if (!arg.startsWith("--") && !out.folderName) {
      out.folderName = arg.trim();
      continue;
    }

    if (arg === "--dry-run") out.dryRun = true;
    if (arg === "--live") out.dryRun = false;
    if (arg === "--headful") out.headful = true;
    if (arg === "--headless") out.headful = false;
    if (arg === "--force-login") out.forceLogin = true;
    if (arg === "--reuse-session") out.forceLogin = false;
  }

  return out;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function toBoolean(value, defaultValue) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
