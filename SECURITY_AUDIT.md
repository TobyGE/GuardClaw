# GuardClaw Security Audit Report

This report outlines the findings from a full code audit focusing on unsanitized user inputs, SQL injection risks, and unsafe `eval`/`exec` calls on dynamic code.

## 1. Unsanitized User Input

### 1.1 Environment Variable Injection
**File:** `server/routes/config.js`
**Endpoints:** `/api/config/token` and `/api/config/llm`
**Risk Level:** High
**Description:** User-provided inputs from `req.body` (e.g., `token`, `lmstudioUrl`, `ollamaUrl`) are concatenated and written directly to the `.env` file using `fs.writeFileSync`. These inputs are not sanitized for newline characters (`\n`). An attacker can inject newlines to append arbitrary environment variables into the server's configuration, potentially altering backend behavior or exposing secrets.
**Remediation:** Validate and sanitize the inputs to ensure they do not contain newline characters or other control characters before writing to the `.env` file.

### 1.2 Server-Side Request Forgery (SSRF)
**File:** `server/routes/config.js`
**Endpoint:** `/api/config/llm/models`
**Risk Level:** Medium
**Description:** The application takes `req.body.lmstudioUrl` and `req.body.ollamaUrl` and passes them directly into a `fetch()` call to retrieve a list of models. Because the URLs are not validated, an attacker can provide arbitrary URLs, forcing the backend server to make GET requests to internal network addresses or unauthorized external endpoints.
**Remediation:** Implement strict URL validation (allowlisting known good hostnames, enforcing local network restrictions) before passing user-controlled URLs to `fetch()`.

## 2. SQL Injection Risks

**Risk Level:** None detected
**Description:** A thorough review of all database interactions (e.g., in `server/memory.js`, `server/event-store.js`, `server/judge-store.js`, `server/benchmark-store.js`) indicates that dynamic SQL queries are safely constructed. The application correctly utilizes parameterized queries (e.g., `this.db.prepare(...).all(...params)` and `this.db.prepare(...).run(...)`) across its SQLite integrations.
**Remediation:** Continue to strictly adhere to parameterized query practices.

## 3. Eval / Exec Calls on Dynamic Code

### 3.1 OS Command Injection via `exec`
**File:** `plugins/opencode-guardclaw/index.ts`
**Line:** ~75 (`exec(\`osascript -e 'display notification "${msg}" ...'\`)`)
**Risk Level:** Critical
**Description:** The application uses `child_process.exec` to trigger a macOS notification via `osascript`. The `msg` variable, derived from `data.message` (an external API response), is properly escaped for double quotes (`"`) but not for single quotes (`'`). Since the `osascript` payload is wrapped in single quotes within the bash shell execution context, an attacker can supply a payload containing a single quote (e.g., `' ; malicious_command ; '`) to break out of the string and execute arbitrary OS commands.
**Remediation:** Avoid using `exec` with dynamically constructed shell strings. Instead, use `child_process.execFile` or `child_process.spawn` where arguments are passed as an array, completely bypassing the shell.

---
*Audit completed systematically using static code analysis.*