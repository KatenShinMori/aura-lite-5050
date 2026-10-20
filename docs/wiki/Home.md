# AURA-LITE-5050 Documentation

Welcome to the technical documentation for **AURA-LITE-5050** — a high-performance, zero-bloat hardware controller and dashboard for ASUS Aura motherboards and ROG Omni wireless peripherals.

---

## 1. Core Philosophy

### "Configure &rarr; Commit to Hardware NVRAM &rarr; Kill Controller"
**Result:** **0 MB background RAM and 0 persistent background processes.**

Traditional OEM vendor software suites (such as ASUS Armoury Crate) install dozens of background services, scheduled tasks, telemetry daemons, and WMI pollers. These services consume between 500 MB and 1.5 GB of system memory, execute continuous CPU wakeups, and introduce driver latency.

**AURA-LITE-5050** is engineered around a radically different paradigm:
1. **Launch On-Demand:** Start the lightweight local service (`npm start`) when you wish to adjust lighting or peripheral configurations.
2. **Apply & Tune:** Interact with hardware in real time via native USB HID feature/output reports.
3. **Commit to Hardware NVRAM:** Send dedicated hardware persistence opcodes (`0xEC 0x3F 0x55` for motherboards; `0x03 0x50 0x03` for ROG mice) that burn current settings into non-volatile memory and onboard EEPROM/Flash.
4. **Kill Controller:** Exit the process cleanly. The motherboards and mice retain all lighting, DPI stages, polling rates, and sleep timers across complete power cycles, reboots, and sleep states with **zero software running in the background**.

---

## 2. Feature Overview

- **Direct Per-LED ARGB Control (`0x40`):**
  - Stream individual RGB color bytes directly to onboard hardware channels.
  - Independent 5-LED gradient control for the ROG I/O Shroud logo (Wing, Eye, Mid, Edge, Tail).
  - External RGB headers (12V RGB headers 1 & 2) and addressable 5V ARGB Gen 2 headers.
- **Autonomous Hardware Effects (`0x35` / `0x36`):**
  - Leverage onboard microcontrollers to run autonomous effects completely offloaded from the OS.
  - Supports Static, Breathing, Color Cycle, Rainbow, Starry Night, and Comet modes with configurable speed and software-scaled brightness.
- **ROG Omni Wireless Mouse Controller (`0x1ACE`):**
  - Complete control for ASUS ROG Gladius III Wireless AimPoint and compatible Omni mice.
  - Real-time battery status, percentage, and charging state queries.
  - 4-Stage independent DPI configuration (100 to 36,000 DPI).
  - Polling rate selection (125 Hz, 250 Hz, 500 Hz, 1000 Hz).
  - Configurable wireless sleep timeout and low battery warning thresholds.
  - Palm logo RGB zone lighting modes and color controls.
- **Live 65-Byte USB HID Packet Inspector:**
  - Real-time bidirectional (`TX` &rarr; / `RX` &larr;) packet inspector displaying exact 65-byte frames in hexadecimal grid format.
  - Live opcode highlighting and byte-level breakdown.
- **Screenshot Privacy Mode (Mask SN):**
  - Instant UI toggle for screenshot and streaming privacy.
  - Masks mouse serial numbers in both UI cards and hex inspector bytes 9–12 (`** ** ** **`) while retaining full unmasking capability at runtime and zero terminal log leakage.
- **Zero-Footprint NVRAM Commit & Exit:**
  - One-click hardware commit and instant server shutdown.

---

## 3. Quick Start & CLI Commands

### Prerequisites
- Node.js 18.0.0 or higher
- Windows 10/11 x64 (with administrative permissions for USB HID access)

### Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/KatenShinMori/aura-lite-5050.git
cd aura-lite-5050
npm install
```

### USB Endpoint Scanner
Discover all connected ASUS USB HID devices, interfaces, Usage Pages, and candidate endpoints:
```bash
npm run scan
```

### Test Suite
Execute the full unit and integration test suite, including guardrails, protocol packet validations, and localhost security checks:
```bash
npm test
```

### Starting the Dashboard
Launch the zero-bloat web controller:
```bash
npm start
```
The dashboard will open at `http://127.0.0.1:5050`.

---

## 4. Documentation Index

- [USB HID Protocol Reference](USB-HID-Protocol-Reference.md) — Comprehensive 65-byte frame layouts, opcodes, and hex dumps.
- [Security & Hardware Safety Architecture](Security-and-Hardware-Safety-Architecture.md) — Hardware guardrails, anti-CSRF, and DNS rebinding protections.
- [Adding New Hardware](Adding-New-Hardware.md) — Guide for contributors to add new motherboards and peripherals.
