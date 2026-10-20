# Security and Hardware Safety Architecture

Controlling physical computer hardware via low-level USB Human Interface Device (HID) APIs and local web dashboards introduces distinct security and electrical safety considerations. A flawed byte sequence or rogue network request can corrupt microcontroller firmware registers, overwrite flash memory sectors, or alter hardware states.

**AURA-LITE-5050** incorporates a multi-layer defense-in-depth model spanning both **hardware-level guardrails** and **web-level transport security**.

---

## 1. Hardware Guardrails (`validateDeviceGuardrails`)

Every interaction with low-level USB endpoints passes through synchronous guardrail validation before any raw byte is dispatched to the operating system's HID driver or USB bus.

```javascript
validateDeviceGuardrails(buf = null) {
  const numVid = typeof this.vid === 'string' ? parseInt(this.vid, 16) : Number(this.vid);
  const numPid = typeof this.pid === 'string' ? parseInt(this.pid, 16) : Number(this.pid);
  if (numVid !== ASUS_VID || !ALLOWED_MB_PIDS.includes(numPid)) {
    throw new Error(`[Security Guardrail] Hardware VID:PID validation failed (${vidHex}:${pidHex}). Writes blocked to prevent NVRAM register corruption on unsupported hardware.`);
  }
  if (buf && (!Buffer.isBuffer(buf) || buf.length !== 65)) {
    throw new Error(`[Security Guardrail] Invalid packet length (${buf ? buf.length : 0} bytes).`);
  }
}
```

### Why Strict Guardrails are Necessary

1. **Firmware and Register Protection:**
   The motherboard Aura chip (ENE/ITE microcontrollers) and ROG Omni wireless receiver expose memory-mapped control registers. Writing an invalid packet structure, incorrect opcode, or targeting an unintended USB interface can lock the MCU into an unrecoverable state (bricking the RGB controller or peripheral wireless pairing table).
2. **Strict VID Enforcement (`0x0B05`):**
   Only devices explicitly identified as ASUSTeK Computer, Inc. (`VID 0x0B05`) are ever opened or probed. Devices from other manufacturers sharing similar HID collections are strictly ignored.
3. **PID Allowlisting:**
   The driver maintains an explicit allowlist of tested Product IDs (e.g., `0x19AF`, `0x1939` for B550 motherboards; `0x1ACE`, `0x1A72`, `0x1A70` for Gladius III AimPoint mice). Any device with an unrecognized PID is barred from receiving write operations or NVRAM commit commands.
4. **Strict 65-Byte Buffer Assertion:**
   ASUS Aura controllers require a 64-byte payload preceded by a 1-byte Report ID (yielding exactly 65 bytes in Node.js `node-hid`). Buffers that are truncated (e.g. 64 bytes without Report ID) or oversized will trigger an immediate exception prior to calling the platform write API.
5. **Pre-Commit Assertion:**
   Prior to triggering NVRAM write operations (`0xEC 0x3F 0x55` or `0x03 0x50 0x03`), `validateDeviceGuardrails()` is executed independently to ensure that write cycles are only committed to authentic, verified hardware.

---

## 2. Localhost Anti-CSRF & DNS Rebinding Protection

Hardware utilities exposing an HTTP API on `localhost` or `127.0.0.1` are prime targets for cross-origin browser attacks:
- **Drive-By CSRF:** A malicious website visited in any tab can fire cross-origin `fetch()` or hidden `<form method="POST">` requests to `http://127.0.0.1:5050/api/...` to manipulate physical hardware, exhaust EEPROM write cycles, or flash unwanted settings.
- **DNS Rebinding:** An attacker can point a malicious domain to an external IP, serve a script, rapidly switch the DNS TTL to `127.0.0.1`, and bypass the browser's Same-Origin Policy (SOP).

`server.js` systematically mitigates these threats through 5 defense mechanisms:

### 2.1 Loopback-Only Interface Binding
The HTTP server binds exclusively to the IPv4 loopback interface:
```javascript
const HOST = '127.0.0.1';
server.listen(PORT, HOST, () => ...);
```
Binding to `127.0.0.1` rather than `0.0.0.0` prevents other devices on the local area network (LAN) or Wi-Fi from discovering or accessing the controller endpoints.

### 2.2 Strict Host Header Allowlisting (Anti-DNS Rebinding)
Every incoming request must present an explicit localhost `Host` header:
```javascript
const host = req.headers.host;
const validHost = host && (
  host === `127.0.0.1:${PORT}` ||
  host === `localhost:${PORT}` ||
  host === `127.0.0.1:5050` ||
  host === `localhost:5050`
);
if (!validHost) {
  return res.status(403).json({ error: 'Invalid Host' });
}
```
If an attacker uses DNS rebinding (e.g. `http://attacker-controlled-domain.com:5050/api/commit-and-exit`), the browser automatically transmits `Host: attacker-controlled-domain.com:5050`. The controller immediately returns `403 Forbidden` and terminates execution before parsing the body.

### 2.3 Sec-Fetch-Site: cross-site Blocking
Modern browsers automatically attach Fetch Metadata headers (`Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`) which cannot be overridden or forged by JavaScript:
```javascript
const secFetchSite = req.headers['sec-fetch-site'];
if (secFetchSite && secFetchSite === 'cross-site') {
  return res.status(403).json({ error: 'Forbidden cross-origin access' });
}
```
Any request originating from a third-party webpage (`sec-fetch-site: cross-site`) is rejected outright.

### 2.4 Origin and Referer Validation for State-Changing Requests
State-altering HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`) must originate from the approved local origin:
```javascript
const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
if (isStateChanging) {
  const requestOrigin = origin || refererOrigin;
  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
    return res.status(403).json({ error: 'Forbidden cross-origin access' });
  }
}
```
This blocks simple cross-origin POST requests (such as form posts or `<script>` tags) that do not trigger CORS preflight checks.

### 2.5 Security Headers (Anti-Clickjacking & No-Store)
To prevent embedding the dashboard in malicious iframes or caching sensitive diagnostics:
```javascript
res.setHeader('X-Frame-Options', 'DENY');
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Cache-Control', 'no-store');
```

---

## 3. Privacy & Serial Number Protection

Hardware serial numbers (PII) are often targeted by screenshots or streams:
- **Terminal Log Redaction:** The mouse signature probe sanitizes serial bytes 9–12 in runtime packet logs (`0x2A` / ASCII `*`) to ensure terminal consoles never output raw serial numbers.
- **UI Screenshot Masking:** The UI defaults to `Mask SN: ON`, redacting middle characters and hex grid entries as `** ** ** **`.
- **Runtime Unmasking:** The operator can toggle `Mask SN: OFF` at runtime to inspect live unmasked values directly in the local UI without exposing them to log aggregators.
