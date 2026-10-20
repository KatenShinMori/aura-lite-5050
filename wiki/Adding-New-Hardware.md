# Adding New Hardware: Contributor Guide

This guide outlines the step-by-step process for contributors who wish to add support for additional ASUS Aura motherboards, graphics cards, ROG mice, keyboards, or Omni wireless peripherals to **AURA-LITE-5050**.

---

## 1. Discovery: USB Endpoint Scanning

Before modifying any source code, identify the physical USB Vendor ID (VID), Product ID (PID), Interface numbers, and Usage Pages exposed by your device.

Run the built-in USB endpoint scanner:
```bash
npm run scan
```

### Example Scanner Output:
```text
===================================================================
[ASUS HID Device Discovery]
Found 11 ASUS USB HID endpoints:
 [0] PID: 0x1ACE | UsagePage: 0xFF01 | Interface: 2 | Path: \\?\HID#VID_0B05&PID_1ACE&MI_02...
 [1] PID: 0x1939 | UsagePage: 0xFF72 | Interface: 2 | Path: \\?\HID#VID_0B05&PID_1939&MI_02...
===================================================================
```

### Key Values to Note:
1. **VID:** Must be `0x0B05` (ASUSTeK Computer, Inc.).
2. **PID:** The 4-digit hex product identifier (e.g., `0x19AF`, `0x1939`, `0x1ACE`, `0x1A72`).
3. **UsagePage / Usage:**
   - Motherboards typically use `UsagePage: 0xFF72`, `Usage: 0x00A1`.
   - Omni wireless receivers and ROG mice typically present writable control endpoints on `UsagePage: 0xFF01` or `0xFF02`.
4. **Report ID:**
   - Standard ASUS USB controllers and wired mice usually operate on Report ID `0x00` (or `0xEC` on motherboards).
   - ROG Omni wireless receivers (`0x1ACE`) strictly require Report ID `0x03` at Byte 0.

---

## 2. Safe Testing in Simulated Fallback (Mock Mode)

The controller features an integrated Mock Fallback mode. If no compatible physical hardware is attached or if a device is locked by another driver, the driver automatically instantiates simulated devices without crashing or throwing unhandled errors:
- Hardware handles remain `null`.
- Diagnostic endpoints like `/api/status` and `/api/debug-hid` accurately report `isMock: true` and detail the exact `mockReason`.
- All API routes, UI controls, and packet inspectors remain fully functional, simulating responses for fast UI and protocol iteration.

---

## 3. Adding a New Device PID to the Allowlist

### 3.1 Motherboard Allowlist
Open `hid/b550fAura.js`:
Locate the `ALLOWED_MB_PIDS` constant:
```javascript
export const ALLOWED_MB_PIDS = [
  0x19AF, // ROG STRIX B550-F GAMING (Wi-Fi)
  0x1939, // ROG STRIX B550-F GAMING (Non-Wi-Fi / Rev 2)
  0x18F3  // Add new motherboard PID here
];
```
Also update `hid/deviceManager.js` if necessary to recognize the device description during auto-probing:
```javascript
if (d.productId === 0x19AF || d.productId === 0x1939 || d.productId === 0x18F3) {
  // Candidate matched
}
```

### 3.2 Mouse or Omni Peripheral Allowlist
Open `hid/gladiusAimpoint.js`:
Locate the `ALLOWED_MOUSE_PIDS` constant:
```javascript
export const ALLOWED_MOUSE_PIDS = [
  0x1ACE, // ROG Omni Receiver (Gladius III AimPoint Wireless)
  0x1A72, // ROG Gladius III AimPoint Wireless (Direct 2.4GHz)
  0x1A70, // ROG Gladius III AimPoint (USB-C Wired)
  0x1A8F  // Add new ROG mouse PID here
];
```

If your mouse uses a different Report ID (for instance, wired modes often use `0x00` while multi-device Omni receivers use `0x03`), ensure the report ID resolution logic in `deviceManager.js` sets `reportId` accordingly:
```javascript
const reportId = (pid === 0x1ACE) ? 0x03 : 0x00;
```

---

## 4. Verifying Guardrails and Running Tests

Every new PID and packet builder must pass the project's automated test suite.

Run the test suite:
```bash
npm test
```

### What `npm test` Validates:
1. **Device Guardrails:** Ensures `validateDeviceGuardrails()` permits writes to the newly added PID while strictly blocking invalid PIDs and non-ASUS VIDs.
2. **Buffer Length Assertions:** Confirms all packet outputs are exactly 65 bytes in length with appropriate Report IDs.
3. **Localhost Security:** Verifies anti-CSRF, host header filtering, and cross-site fetch blocking remain impervious.
4. **Packet History & Inspector Integrity:** Confirms incoming RX packets, outgoing TX packets, and unmasking behaviors work correctly.

---

## 5. Submitting Your Contribution

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feat/support-b650-e
   ```
2. Verify all tests pass:
   ```bash
   npm test
   ```
3. Commit your changes following standard conventional commits:
   ```bash
   git commit -m "feat(hid): add support for ROG STRIX B650-E motherboard (PID 0x18F3)"
   ```
4. Push to your fork and submit a Pull Request to `main`.
