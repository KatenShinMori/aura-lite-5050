# AURA-LITE-5050

> **Zero-Bloat, On-Demand Hardware Controller for ASUS Aura Motherboards and Wireless Mice**  
> Running locally and strictly bound to `http://127.0.0.1:5050` with instant self-termination.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-65%20passing-brightgreen.svg)]()

---

## ⚡ Overview

Official vendor utilities like ASUS Armoury Crate often run 20+ persistent background services, install hundreds of megabytes of runtime binaries, and continuously consume background CPU, RAM, and telemetry bandwidth.

**AURA-LITE-5050** is a clean-room, zero-background-footprint, on-demand local web application:

1. **Zero Residual Footprint**: Launch the controller when you want to change your lighting, DPI, or hardware settings.
2. **Direct Hardware NVRAM Persistence**: Write and commit settings directly into device EEPROM/NVRAM registers.
3. **Instant Self-Termination**: Click **"Commit to Hardware NVRAM & Kill Controller"** to flash the devices, close all USB handles, and cleanly terminate the Node.js process—leaving **0% RAM and 0 background processes**.

---

## 🛡️ Supported Hardware

| Hardware Component | Product Name / Controller | USB VID:PID | Report ID | Supported Features |
| :--- | :--- | :--- | :---: | :--- |
| **Motherboard** | ROG STRIX B550-F GAMING (AURA LED Controller) | `0x0B05:0x19AF`<br>`0x0B05:0x1939` | `0xEC` | • Direct Mode (`0x40`) with isolated ROG I/O Shroud Logo (Unified & 5-LED Gradient)<br>• Independent 12V RGB Headers 1 & 2<br>• 5V Addressable Gen 2 Header (`ADD_GEN2`)<br>• Autonomous Hardware Effects (`0x35/0x36`)<br>• Hardware NVRAM Flash Persistence (`0x3F 0x55`) |
| **Wireless Mouse** | ROG GLADIUS III WIRELESS AIMPOINT (via ROG Omni Receiver) | `0x0B05:0x1ACE` | `0x03` | • Palm Logo RGB Zone (`0x00`)<br>• 4-Stage Independent DPI (100–36,000 DPI)<br>• Active DPI Profile Switching (1..4)<br>• Polling Rate (125 / 250 / 500 / 1000 Hz)<br>• Sleep Timeout & Low Battery Alert<br>• Live Battery Query & Sleep State Detection<br>• Onboard Memory Save (`0x50 0x03`) |
| **Mouse (Direct)** | ROG Gladius III (SpeedNova 2.4G / Wired) | `0x0B05:0x1A72`<br>`0x0B05:0x1A70` | `0x00` | • Same feature set as above, using direct HID Report ID `0x00` |

*Note: All hardware product names are used solely for nominative fair use to describe hardware compatibility.*

---

## 🔬 USB HID Protocol Architecture (65-Byte Packets)

The application communicates directly with USB HID endpoints via standard 65-byte zero-filled buffers where byte 0 specifies the USB HID Report ID.

### Motherboard Aura Protocol (`Report ID: 0xEC`)

- **Gen1 Handshake**: `[0xEC, 0x52, 0x53, 0x00, 0x01, ...]`  
  Initializes the Aura USB controller on startup.
- **Config Table Discovery**: `[0xEC, 0xB0, 0x00, ...]` -> `[0xEC, 0x30, ...]`  
  Queries the board configuration to dynamically determine onboard LED counts and header layouts.
- **Direct Mode RGB Stream (`0x40`)**:  
  `[0xEC, 0x40, (latch ? 0x80 : 0x00) | channel, start_led, count, R0, G0, B0, ...]`  
  - Channel `0x04`: Built-in ROG I/O Shroud Logo (5 LEDs) + 12V Headers 1 & 2.
  - Channel `0x00`: 5V ARGB Gen 2 Header (`ADD_GEN2`), chunked into 20-LED segments with latching on the final packet.
- **Autonomous Firmware Effects (`0x35` / `0x36`)**:  
  - `0x35`: Selects hardware mode (Static `0x01`, Breathing `0x02`, Color Cycle `0x03`, Rainbow `0x04`, Starry Night `0x05`, Comet `0x06`).
  - `0x36`: Sets the RGB color payload and LED bitmask.
- **NVRAM Persistence Commit (`0x3F 0x55`)**:  
  `[0xEC, 0x3F, 0x55, 0x00, ...]`  
  Writes active effects to motherboard EEPROM so colors persist across reboot and shutdown.

### Mouse Protocol (Gladius III AimPoint & Omni Receiver)

- **Report ID Routing**: Omni Receiver (`0x1ACE`) requires Report ID `0x03`. Direct 2.4G (`0x1A72`) and Wired (`0x1A70`) use Report ID `0x00`.
- **Battery & Sleep Query (`0x12 0x07`)**:  
  `[<reportId>, 0x12, 0x07, 0x00, ...]`  
  Returns direct battery percentage (byte 5), charging status (byte 10), or sleep standby flag (`0xFF 0xAA`).
- **Signature & Serial Probe (`0x12 0x12 0x02`)**:  
  `[<reportId>, 0x12, 0x12, 0x02, ...]`  
  Probes the active paired wireless mouse and queries its device signature.
- **RGB Lighting (`0x51 0x28`)**:  
  `[<reportId>, 0x51, 0x28, 0x00, 0x00, mode, brightness, R, G, B, 0x00, 0x00, speed]`  
  Controls Palm Logo zone lighting and 0–100 brightness levels.
- **DPI Stage Configuration (`0x51 0x31`)**:  
  `[<reportId>, 0x51, 0x31, stageIndex, 0x00, dpiLow, dpiHigh, R, G, B]`  
  Formula: `encoded = (DPI - 50) / 50`.
- **Active DPI Stage Switch (`0x51 0x31 0x09`)**:  
  `[<reportId>, 0x51, 0x31, 0x09, 0x00, profile]`  
  Selects active profile (1..4).
- **Polling Rate (`0x51 0x31 0x04`)**:  
  `[<reportId>, 0x51, 0x31, 0x04, 0x00, rateCode]` (125 Hz: `0x00`, 250 Hz: `0x01`, 500 Hz: `0x02`, 1000 Hz: `0x03`).
- **Sleep Timeout & Low Battery Alert (`0x51 0x37`)**:  
  `[<reportId>, 0x51, 0x37, 0x00, 0x00, timeoutCode, 0x00, lowBatteryWarning]`
- **Onboard Profile Save (`0x50 0x03`)**:  
  `[<reportId>, 0x50, 0x03, ...]`  
  Flushes all mouse settings to onboard memory.

---

## 🔒 Security & Localhost Lockdown

1. **Strict Localhost Binding**: The Express HTTP server binds strictly to `127.0.0.1:5050` (never `0.0.0.0`).
2. **Anti-CSRF & Origin Lockdown**:  
   - All state-changing endpoints (`POST`, `PUT`, `DELETE`) require `Origin` and `Host` headers matching `http://127.0.0.1:5050` or `http://localhost:5050`.
   - Cross-origin browser requests (`Sec-Fetch-Site: cross-site`) are rejected with `403 Forbidden` to prevent malicious websites from executing unauthorized NVRAM writes.
   - Permissive CORS headers (e.g., `Access-Control-Allow-Origin: *`) are completely forbidden.
3. **Hardware VID:PID Guardrails**:  
   - Backend HID controllers enforce strict allowlist checks for ASUS Vendor ID (`0x0B05`) and supported Product IDs (`0x19AF`, `0x1939`, `0x1ACE`, etc.) before any packet transmission.
   - Any attempt to write raw HID packets to an unverified device immediately aborts with an explicit error to prevent accidental NVRAM corruption.
4. **Serial Number & PII Sanitization**:  
   - Device hardware serial numbers are dynamically masked in the UI (e.g., `RA19****2927`).
   - A **"Mask SN"** screenshot toggle allows instant masking/unmasking in both device cards and the live packet inspector.
   - Simulated/mock device fallbacks never leak real hardware identifiers.

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- Windows with administrative access (required by `node-hid` to communicate with USB devices)

### Installation

```bash
git clone https://github.com/katenshinmori/aura-lite-5050.git
cd aura-lite-5050
npm install
```

### Running the Controller

```bash
# Start on-demand controller
npm start

# Run hardware USB interface scan
npm run scan

# Run test suite
npm test
```

Open **`http://127.0.0.1:5050`** in your browser. Configure your settings, inspect live packets, and click **"Commit to Hardware NVRAM & Kill Controller"** when finished.

---

## ⚖️ Legal & Trademark Disclaimer

**Independent open-source hardware controller. Not affiliated with, endorsed by, or sponsored by ASUSTeK Computer Inc.**

All product names, logos, brands, trademarks, and registered trademarks—including `"ASUS"`, `"ROG"`, `"Republic of Gamers"`, `"Armoury Crate"`, `"Aura Sync"`, `"Strix"`, and `"Gladius"`—are the property of their respective owners. Their use in this project is strictly for **nominative fair use** to identify the specific hardware devices and components compatible with this software.

---

## ⚠️ Hardware NVRAM Risk Disclaimer

**COMMUNICATING DIRECTLY WITH HARDWARE EEPROM / NVRAM REGISTERS CARRIES INHERENT RISK.**

While AURA-LITE-5050 incorporates strict VID:PID allowlists, boundary clamping, and safety guardrails, this software is provided **"AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED**, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, hardware malfunction, firmware bricking, or other liability arising from the use of this software.

---

## This project was vibecoded via antigravity cli using Gemini Argon 4 high.
