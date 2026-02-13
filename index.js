const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
require("dotenv").config();

const START_URL = process.env.START_URL || "https://www.google.com/";
const OUTPUT_FILE = (process.env.OUTPUT || "cookie-report") + new Date().toISOString().replace(/[:.]/g, "-") + ".md";
const defaultCookies = [{
    name: process.env.SESSION_COOKIE1_NAME || "session_cookie", // essential cookie name pattern
    value: process.env.SESSION_COOKIE1_VALUE || "example_session_value",
    url: START_URL
}]
const MAX_LINKS = Number.parseInt(process.env.MAX_LINKS || "30", 10);
const MAX_LOOKUPS = Number.parseInt(process.env.MAX_LOOKUPS || "20", 10);
const debugMode = process.env.DEBUG === "true";

const TYPE_PATTERNS = [
    { type: "Performance", pattern: /_ga|_gid|_gat|analytics|segment|amplitude|mixpanel/i },
    { type: "Marketing", pattern: /ad|ads|doubleclick|fbp|fbc|marketing|pixel|gtm|gclid/i },
    { type: "Essential", pattern: /session|csrf|xsrf|auth|token|login|consent|prefs?/i }
];

function isHttpUrl(url) {
    return url.startsWith("http://") || url.startsWith("https://");
}

function normalizeLinks(links) {
    const seen = new Set();
    const normalized = [];
    for (const link of links) {
        if (!link || !isHttpUrl(link)) continue;
        const clean = link.split("#")[0];
        if (seen.has(clean)) continue;
        seen.add(clean);
        normalized.push(clean);
    }
    return normalized;
}

function getBaseDomain(hostname) {
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
}

function formatDateFromUnixSeconds(expires) {
    if (!expires || expires <= 0) return "Session";
    const date = new Date(expires * 1000);
    return date.toISOString();
}

function formatDuration(expires) {
    if (!expires || expires <= 0) return "Session";
    const remainingMs = expires * 1000 - Date.now();
    if (remainingMs <= 0) return "Expired";
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.length ? parts.join(" ") : `${totalSeconds}s`;
}

function splitSetCookieHeader(headerValue) {
    if (!headerValue) return [];
    const parts = headerValue
        .split(/,(?=[^;]+?=)/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
    return parts;
}

function classifyType(cookieName, lookupText) {
    for (const { type, pattern } of TYPE_PATTERNS) {
        if (pattern.test(cookieName)) return type;
    }
    if (lookupText) {
        const text = lookupText.toLowerCase();
        if (text.includes("analytics") || text.includes("performance")) return "Performance";
        if (text.includes("advertising") || text.includes("marketing")) return "Marketing";
        if (text.includes("session") || text.includes("security")) return "Essential";
    }
    return "Unknown";
}

async function lookupCookieInfo(cookies) {
    const lookupResults = new Map();
    if (cookies.length === 0) return lookupResults;

    console.log(`Performing lookups for up to ${MAX_LOOKUPS} cookies...`);
    const browser = await chromium.launch({ headless: !debugMode });
    const context = await browser.newContext();
    const page = await context.newPage();

    let lookupCount = 0;
    for (const cookie of cookies) {
        if (lookupCount >= MAX_LOOKUPS) break;
        const query = encodeURIComponent(`${cookie.name}`);
        const url = `https://cookiedatabase.org/?s=${query}&lang=en`;
        let text = "";
        try {
            console.log(`Opening lookup page for cookie "${cookie.name}" at`);
            await page.goto(url, { waitUntil: "load", timeout: 30000 });
            await page.waitForLoadState("networkidle", { timeout: 10000 });
            text = await page.textContent("body > div.elementor.elementor-83257.elementor-location-archive > section.elementor-section.elementor-top-section.elementor-element.elementor-element-cff7622.elementor-section-content-top.elementor-section-boxed.elementor-section-height-default.elementor-section-height-default > div > div.elementor-column.elementor-col-50.elementor-top-column.elementor-element.elementor-element-1040f2c");
            if (text) {
                lookupResults.set(cookie.name, text.replace(/(\s+)|(\n+)|(\t+)/g, " ").slice(0, 500));
            }
        } catch (error) {
            lookupResults.set(cookie.name, "");
        }
        console.log(`Lookup for cookie "${cookie.name}" completed. Text: ${text ? text.slice(0, 200) : "No results"}`);
        lookupCount += 1;
    }

    await browser.close();
    return lookupResults;
}

async function main() {
    const startUrl = START_URL;
    const startHost = new URL(startUrl).hostname;
    const baseDomain = getBaseDomain(startHost);
    const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
    const visitedLinks = new Set();
    const initiatorByName = new Map();

    const tryAcceptAll = async (page) => {
        const selectors = [
            "button:has-text('Accept all cookies')",
            "button:has-text('Accept All')",
            "button:has-text('I Accept')",
            "button:has-text('I agree')",
            "text=/accept all/i"
        ];

        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                if (await locator.isVisible({ timeout: 2000 })) {
                    await locator.click({ timeout: 2000 });
                    break;
                }
            } catch (error) {
                // Ignore consent handler errors.
                console.warn(`Consent handler not found for selector: ${selector}`);
            }
        }
    };

    const browser = await chromium.launch({ headless: !debugMode });
    const context = await browser.newContext();

    await context.addCookies([
        ...defaultCookies
    ]);

    const attachResponseListener = (page) => {
        page.on("response", async (response) => {
            const headers = response.headers();
            const setCookieHeader = headers["set-cookie"];
            if (!setCookieHeader) return;

            const cookies = splitSetCookieHeader(setCookieHeader);
            for (const rawCookie of cookies) {
                const name = rawCookie.split("=")[0]?.trim();
                if (!name) continue;
                if (!initiatorByName.has(name)) initiatorByName.set(name, response.url());
            }
        });
    };

    const page = await context.newPage();
    attachResponseListener(page);

    console.log(`Navigating to start URL: ${startUrl}`);
    await page.goto(startUrl, { waitUntil: "load", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => { });
    await tryAcceptAll(page);

    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"), (anchor) => anchor.href)
    );

    const filteredLinks = normalizeLinks(links).slice(0, MAX_LINKS);
    for (const link of filteredLinks) {
        if (visitedLinks.has(link)) continue;
        visitedLinks.add(link);
        const newPage = await context.newPage();
        attachResponseListener(newPage);
        try {
            console.log(`Visiting link: ${link}`);
            await newPage.goto(link, { waitUntil: "load", timeout: 45000 });
            await newPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => { });
            await tryAcceptAll(newPage);
        } catch (error) {
            // Ignore navigation errors and continue scanning.
        } finally {
            await newPage.close();
        }
    }

    console.log(`Visited ${visitedLinks.size} links. Extracting cookies...`);

    const cookies = await context.cookies();
    await browser.close();

    console.log(`Extracted ${cookies.length} cookies. Performing lookups...`);

    const lookupResults = await lookupCookieInfo(cookies);

    const rows = cookies.map((cookie) => {
        const initiator = initiatorByName.get(cookie.name) || "unknown";
        const lookupText = lookupResults.get(cookie.name) || "";
        const type = classifyType(cookie.name, lookupText);
        const party = cookie.domain.endsWith(baseDomain) ? "First" : "Third";
        const period = formatDateFromUnixSeconds(cookie.expires);
        const duration = formatDuration(cookie.expires);

        console.log({
            url: initiator,
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            value: cookie.value,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
            period,
            duration,
            type,
            party,
            lookupSnippet: lookupText.slice(0, 200)
        });

        return {
            url: initiator,
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
            period,
            duration,
            initiator,
            type,
            party,
            httpOnly: cookie.httpOnly ? "Yes" : "No",
            secure: cookie.secure ? "Yes" : "No",
            sameSite: cookie.sameSite || ""
        };
    });

    const headerLines = [
        "# Cookie Report",
        `- Start URL: ${startUrl}`,
        `- Scan date: ${new Date().toISOString()}`,
        `- Links visited: ${visitedLinks.size}`,
        `- Cookies found: ${rows.length}`,
        "",
        "| URL | Cookie Name | Domain | Path | Period | Duration | Initiator | Type | Party | HttpOnly | Secure | SameSite |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    ];

    const bodyLines = rows.map((row) =>
        `| ${row.url} | ${row.name} | ${row.domain} | ${row.path} | ${row.period} | ${row.duration} | ${row.initiator} | ${row.type} | ${row.party} | ${row.httpOnly} | ${row.secure} | ${row.sameSite} |`
    );

    const report = headerLines.concat(bodyLines).join("\n");
    fs.writeFileSync(outputPath, report, "utf8");

    console.log(`Report written to ${outputPath}`);
}

main().catch((error) => {
    console.error("Cookie scan failed:", error);
    process.exitCode = 1;
});
