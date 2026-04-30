import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT_DIR, "auto-claim.html");
const UPLOAD_SCRIPT_PATH = path.join(ROOT_DIR, "src", "auto-claim-upload.js");
const ARTIFACT_DIR = path.join(ROOT_DIR, "artifacts");

let activeRun = null;
let pageRef = null;

async function main() {
  if (!fs.existsSync(HTML_PATH)) {
    throw new Error(`UI file not found: ${HTML_PATH}`);
  }
  if (!fs.existsSync(UPLOAD_SCRIPT_PATH)) {
    throw new Error(`Claim script not found: ${UPLOAD_SCRIPT_PATH}`);
  }

  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1280,820"]
  });
  const context = await browser.newContext({
    viewport: null
  });
  const page = await context.newPage();
  pageRef = page;

  await page.exposeBinding("autoClaimListFolders", () => listClaimFolders());
  await page.exposeBinding("autoClaimRun", (_source, payload) => runAutoClaim(payload));
  await page.exposeBinding("autoClaimCancel", () => cancelActiveRun());

  await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: "domcontentloaded" });

  await new Promise((resolve) => {
    page.once("close", resolve);
    browser.once("disconnected", resolve);
  });

  await cancelActiveRun().catch(() => {});
  await browser.close().catch(() => {});
}

function listClaimFolders() {
  const ignored = new Set([".auth", ".git", "artifacts", "node_modules", "src"]);
  return fs
    .readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !ignored.has(name))
    .filter((name) => /(20\d{2})(0[1-9]|1[0-2])/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

async function runAutoClaim(payload) {
  if (activeRun) {
    throw new Error("Another auto-claim run is already active.");
  }

  const options = normalizePayload(payload);
  const args = [
    UPLOAD_SCRIPT_PATH,
    options.folderName,
    options.dryRun ? "--dry-run" : "--live",
    options.headful ? "--headful" : "--headless",
    options.forceLogin ? "--force-login" : "--reuse-session"
  ];

  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: buildChildEnv(options),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    sendEvent("stderr", `${message}\n`);
    sendEvent("status", { text: "FAILED", tone: "err" });
    return { ok: false, code: 1, signal: null, artifacts: collectRunArtifacts(false) };
  }

  activeRun = child;
  sendEvent("status", { text: "RUNNING", tone: "warn" });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => sendEvent("stdout", chunk));
  child.stderr.on("data", (chunk) => sendEvent("stderr", chunk));

  return await new Promise((resolve) => {
    child.once("error", (error) => {
      activeRun = null;
      sendEvent("stderr", `${error.message}\n`);
      sendEvent("status", { text: "FAILED", tone: "err" });
      resolve({ ok: false, code: 1, signal: null, artifacts: collectRunArtifacts(false) });
    });
    child.once("close", (code, signal) => {
      activeRun = null;
      const ok = code === 0;
      sendEvent("status", { text: ok ? "COMPLETED" : "FAILED", tone: ok ? "ok" : "err" });
      resolve({ ok, code, signal, artifacts: collectRunArtifacts(ok) });
    });
  });
}

function collectRunArtifacts(ok) {
  const resultPath = path.join(ARTIFACT_DIR, "claim-run-result.json");
  const previewPath = path.join(ARTIFACT_DIR, "claim-run-preview.json");
  const errorPath = path.join(ARTIFACT_DIR, "claim-run-error.json");
  const finalImagePath = path.join(ARTIFACT_DIR, "claim-submission-final.png");
  const errorImagePath = path.join(ARTIFACT_DIR, "claim-run-error.png");
  const stamp = Date.now();

  return {
    result: readJsonFile(resultPath),
    preview: readJsonFile(previewPath),
    error: readJsonFile(errorPath),
    finalImageUrl: ok && fs.existsSync(finalImagePath)
      ? `artifacts/claim-submission-final.png?ts=${stamp}`
      : "",
    errorImageUrl: !ok && fs.existsSync(errorImagePath)
      ? `artifacts/claim-run-error.png?ts=${stamp}`
      : ""
  };
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function normalizePayload(payload) {
  const options = {
    email: String(payload?.email || "").trim(),
    password: String(payload?.password || ""),
    folderName: String(payload?.folderName || "").trim(),
    dryRun: Boolean(payload?.dryRun),
    headful: payload?.headful !== false,
    forceLogin: Boolean(payload?.forceLogin)
  };

  if (!options.email) throw new Error("Microsoft Email is required.");
  if (!options.password) throw new Error("Microsoft Password is required.");
  if (!options.folderName) throw new Error("Claim folder is required.");
  if (!folderExists(options.folderName)) {
    throw new Error(`Claim folder not found: ${options.folderName}`);
  }

  return options;
}

function buildChildEnv(options) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes("\0") || value == null || String(value).includes("\0")) continue;
    env[key] = String(value);
  }

  env.MS_EMAIL = options.email;
  env.MS_PASSWORD = options.password;
  env.HEADFUL = String(options.headful);
  env.FORCE_LOGIN = String(options.forceLogin);
  env.DRY_RUN = String(options.dryRun);
  return env;
}

function folderExists(folderName) {
  const target = path.isAbsolute(folderName) ? folderName : path.join(ROOT_DIR, folderName);
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

async function cancelActiveRun() {
  const child = activeRun;
  if (!child) return { ok: true, active: false };

  sendEvent("status", { text: "CANCELLING", tone: "warn" });
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  return { ok: true, active: true };
}

function sendEvent(type, payload) {
  const page = pageRef;
  if (!page || page.isClosed()) return;
  page
    .evaluate(
      ({ eventType, eventPayload }) => {
        window.dispatchEvent(
          new CustomEvent("auto-claim-event", {
            detail: { type: eventType, payload: eventPayload }
          })
        );
      },
      { eventType: type, eventPayload: payload }
    )
    .catch(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
