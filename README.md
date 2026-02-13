# Cookie Scanner

Playwright-based cookie scanner that opens links in new tabs, logs cookies, enriches with optional lookups, and writes a Markdown report.

## Requirements
- Node.js 18+ (recommended)
- pnpm (recommended) or npm

## Install
```
pnpm install
```

npm alternative:
```
npm install
```

## Run
```
pnpm run scan
```

npm alternative:
```
npm run scan
```

Clean old reports:
```
pnpm run clean
```

## Configuration
Set environment variables before running:
- START_URL: Start page URL (default: https://www.google.com/)
- OUTPUT: Report file prefix (default: cookie-report). The script appends a timestamp and .md
- SESSION_COOKIE1_NAME: Session cookie name to inject before navigation (default: session_cookie)
- SESSION_COOKIE1_VALUE: Session cookie value to inject (default: example_session_value)
- MAX_LINKS: Max links to visit (default: 30)
- MAX_LOOKUPS: Max cookie name lookups (default: 20)
- DEBUG: Set to true to run browsers headful (default: false)

Example (PowerShell):
```
$env:START_URL = "https://example.com"; \
$env:OUTPUT = "report"; \
$env:SESSION_COOKIE1_NAME = "attendee_session"; \
$env:SESSION_COOKIE1_VALUE = "h35"; \
$env:MAX_LINKS = "15"; \
$env:MAX_LOOKUPS = "10"; \
$env:DEBUG = "true"; \
pnpm run scan
```

Example (bash):
```
START_URL="https://example.com" \
OUTPUT="report" \
SESSION_COOKIE1_NAME="attendee_session" \
SESSION_COOKIE1_VALUE="h35" \
MAX_LINKS="15" \
MAX_LOOKUPS="10" \
DEBUG="true" \
pnpm run scan
```

## Output
The report is a Markdown table with:
- URL
- Cookie name
- Domain
- Path
- Period
- Duration
- Initiator
- Type (Performance/Marketing/Essential/Unknown)
- Party (First/Third)
- HttpOnly
- Secure
- SameSite

## Notes
- The scan uses a headful browser first, then performs headless lookups.
- A simple "Accept all" consent click is attempted after each page load.
- Cookie classification uses name patterns and optional search text.
