import fs from "node:fs"
import path from "node:path"
import { chromium } from "playwright-core"

function arg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

const url = arg("--url")
const out = arg("--out")
const role = arg("--role", "public")
const pin = arg("--pin", "")
const mobile = hasFlag("--mobile")
const fullPage = hasFlag("--full-page")
const click = arg("--click", "")
const waitFor = arg("--wait-for", "")
const waitMs = Number(arg("--wait-ms", "1500"))
const width = Number(arg("--width", mobile ? "390" : "1280"))
const height = Number(arg("--height", mobile ? "844" : "900"))

if (!url || !out) {
  throw new Error("Usage: node screenshot.mjs --url <url> --out <file> [--role public|app] [--pin 1234]")
}

const browserCandidates = [
  arg("--browser", ""),
  process.env.SCREENSHOT_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean)

const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate))
if (!executablePath) {
  throw new Error("No Chrome or Edge browser found. Set SCREENSHOT_BROWSER to the browser executable.")
}

fs.mkdirSync(path.dirname(out), { recursive: true })

const parsed = new URL(url)
const baseUrl = `${parsed.protocol}//${parsed.host}`

const browser = await chromium.launch({ executablePath, headless: true })

try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  })
  const page = await context.newPage()

  if (role === "app") {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error("app screenshots need a 4-6 digit --pin, or AGENT_SCREENSHOT_PIN.")
    }

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(".pin-grid button", { timeout: 15000 })

    for (const digit of pin) {
      await page.getByRole("button", { name: digit, exact: true }).click()
    }
    await page.getByRole("button", { name: "OK", exact: true }).click()

    try {
      await page.waitForSelector(".topnav", { timeout: 20000 })
    } catch {
      throw new Error("PIN login failed. Check AGENT_SCREENSHOT_PIN and that the PIN is set for this database.")
    }
  }

  await page.goto(url, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(waitMs)

  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 15000 })
  }

  if (click) {
    await page.click(click)
    await page.waitForTimeout(waitMs)
  }

  await page.screenshot({ path: out, fullPage })
  console.log(JSON.stringify({ path: out, url, role, width, height, mobile }))
} finally {
  await browser.close()
}
