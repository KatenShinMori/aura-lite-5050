# USB HID Protocol Reference

This document provides a comprehensive technical specification of the raw 65-byte USB HID protocol frames utilized by **AURA-LITE-5050** to control ASUS Aura motherboards and ROG Omni wireless peripherals.

All packets are fixed 65-byte buffers where **Byte 0** represents the HID Report ID required by Windows `node-hid`.

---

## 1. Motherboard Controller (ROG STRIX B550-F GAMING)

- **Vendor ID (VID):** `0x0B05` (ASUSTeK Computer, Inc.)
- **Product ID (PID):** `0x19AF` / `0x1939` (Aura LED Controller)
- **Report ID:** `0xEC` (Byte 0)
- **Usage Page:** `0xFF72`, **Usage:** `0x00A1`

---

### 1.1 Direct Mode (`0xEC 0x40`)

Direct Mode bypasses the motherboard's autonomous animation engine, streaming RGB color triplets directly to physical LED indices with minimal latency.

#### Direct Mode Initialization Packet (`0x35 ... 0x01`)
Before direct streaming can begin, channel 0 must be switched to Direct Mode:
```hex
EC 35 00 00 01 00 00 00 00 00 00 00 00 00 00 00 ... [65 bytes total]
```

#### Direct Color Frame Layout (`0x40`)
| Byte Offset | Field | Value / Description |
|:---:|:---|:---|
| `0` | Report ID | `0xEC` |
| `1` | Command Opcode | `0x40` (Direct LED Update) |
| `2` | Channel Identifier | `0x84` (Mainboard: 5x Built-in LEDs + 2x 12V RGB) or `0x80` (5V ADD_GEN2 Header) |
| `3` | Start LED Offset | `0x00` (0-indexed starting LED position) |
| `4` | LED Count | `0x05` (Shroud only), `0x07` (Shroud + 12V), or `0x0A` (10 ARGB Gen2 LEDs) |
| `5..7` | LED 0 RGB | Red, Green, Blue bytes (`0x00` - `0xFF`) |
| `8..10` | LED 1 RGB | Red, Green, Blue bytes (`0x00` - `0xFF`) |
| `11..13` | LED 2 RGB | Red, Green, Blue bytes (`0x00` - `0xFF`) |
| `14..16` | LED 3 RGB | Red, Green, Blue bytes (`0x00` - `0xFF`) |
| `17..19` | LED 4 RGB | Red, Green, Blue bytes (`0x00` - `0xFF`) |
| `20..22` | LED 5 RGB | Header 1 RGB (when channel = `0x84`, count = 7) |
| `23..25` | LED 6 RGB | Header 2 RGB (when channel = `0x84`, count = 7) |
| `26..64` | Padding | Zero padding (`0x00`) |

#### Built-in I/O Shroud LED Mapping (Channel `0x84`)
The ROG STRIX B550-F Gaming features 5 discrete addressable LEDs embedded within the translucent I/O shroud ROG eye emblem:
1. **LED 0:** Wing (Upper left sweep)
2. **LED 1:** Eye (Inner pupil accent)
3. **LED 2:** Mid (Central diagonal wing)
4. **LED 3:** Edge (Lower perimeter slash)
5. **LED 4:** Tail (Lower right wing tip)

#### Example Hex Stream (Cyberpunk Gradient on Shroud Logo):
```hex
EC 40 84 00 05 FF 00 3F E0 00 70 9D 00 FF 00 A2 FF 00 D4 FF 00 00 ... 00
```

---

### 1.2 Mode Switch & Autonomous Hardware Effects (`0xEC 0x35` & `0xEC 0x36`)

Autonomous effects run entirely within the motherboard's embedded microcontroller. They require no CPU execution or background software once configured.

#### Channels
- Channel `0x00`: Onboard ROG Logo + 12V RGB Headers 1 & 2
- Channel `0x01`: 5V Addressable Gen 2 Header (ADD_GEN2)

#### Effect Mode IDs
| Mode ID | Name | Parameters Required |
|:---:|:---|:---|
| `0x00` | OFF | None (Dark) |
| `0x01` | Static | Color (R, G, B) |
| `0x02` | Breathing | Color (R, G, B), Speed (`0x00` Slow, `0x01` Normal, `0x02` Fast) |
| `0x03` | Color Cycle | Speed |
| `0x04` | Rainbow | Speed |
| `0x05` | Starry Night | Color (R, G, B), Speed |
| `0x06` | Comet | Color (R, G, B), Speed |

#### 1. Mode Selection Packet (`0x35`)
| Byte Offset | Value | Description |
|:---:|:---:|:---|
| `0` | `0xEC` | Report ID |
| `1` | `0x35` | Effect Mode Command |
| `2` | `0x00` | Channel ID (`0x00` = Mainboard, `0x01` = ADD_GEN2) |
| `3` | `0x00` | Reserved |
| `4` | `0x00` | Reserved |
| `5` | `0x02` | Mode ID (e.g. `0x02` = Breathing) |
| `6..64` | `0x00` | Zero padding |

#### 2. Effect Color & LED Bitmask Packet (`0x36`)
The `0x36` frame sets the active color for each individual LED assigned to the channel. A 16-bit big-endian bitmask specifies which LEDs receive the color payload. For Channel 0 (7 LEDs total), the mask is `0x007F` (`(1 << 7) - 1`):
| Byte Offset | Value | Description |
|:---:|:---:|:---|
| `0` | `0xEC` | Report ID |
| `1` | `0x36` | Effect Color Command |
| `2` | `0x00` | LED Bitmask High Byte (`mask >> 8`, e.g. `0x00`) |
| `3` | `0x7F` | LED Bitmask Low Byte (`mask & 0xFF`, e.g. `0x7F` = LEDs 0..6) |
| `4` | `0x00` | Reserved |
| `5..7` | `R G B` | LED 0 RGB (Software-scaled for brightness) |
| `8..10` | `R G B` | LED 1 RGB |
| `11..13` | `R G B` | LED 2 RGB |
| `14..16` | `R G B` | LED 3 RGB |
| `17..19` | `R G B` | LED 4 RGB |
| `20..22` | `R G B` | LED 5 RGB (12V Header 1) |
| `23..25` | `R G B` | LED 6 RGB (12V Header 2) |
| `26..64` | `0x00` | Zero padding |

---

### 1.3 Motherboard NVRAM Hardware Commit (`0xEC 0x3F 0x55`)

To persist hardware effect mode configurations across system reboots, shutdowns, and cold power states without background software, the controller commits the working registers to the motherboard's onboard NVRAM:
| Byte Offset | Value | Description |
|:---:|:---:|:---|
| `0` | `0xEC` | Report ID |
| `1` | `0x3F` | NVRAM Flash Command |
| `2` | `0x55` | Write Confirmation Key |
| `3..64` | `0x00` | Zero padding |

```hex
EC 3F 55 00 00 00 00 00 00 00 00 00 00 00 00 00 ... 00
```

---

## 2. Wireless Peripheral Controller (ROG Omni Receiver & Gladius III AimPoint)

- **Vendor ID (VID):** `0x0B05` (ASUS)
- **Product ID (PID):**
  - `0x1ACE` (ROG Omni Wireless Receiver — Requires Report ID `0x03`)
  - `0x1A72` (Gladius III AimPoint 2.4GHz RF — Report ID `0x00`)
  - `0x1A70` (Gladius III AimPoint USB-C Wired — Report ID `0x00`)
- **Usage Page:** `0xFF01` (Primary writable control interface for PID `0x1ACE`)

---

### 2.1 Device Signature Probe (`0x12 0x12 0x02`)

The controller transmits a signature probe to authenticate the peripheral and acquire its manufacturing serial number.

#### Outgoing TX Packet
```hex
03 12 12 02 00 00 00 00 00 00 00 00 00 00 00 00 ... 00
```
- Bytes 0..3: `0x03 0x12 0x12 0x02`
- Bytes 4..64: `0x00` (Padding — **must never be masked in packet inspector**)

#### Incoming RX Response Packet
| Byte Offset | Value | Description |
|:---:|:---|:---|
| `0` | `0x03` | Report ID |
| `1..3` | `0x12 0x12 0x02` | Echoed Probe Header |
| `4` | `0x00` | Reserved |
| `5..8` | ASCII | Serial Number Prefix (e.g. `RA19`) |
| `9..12` | ASCII / `0x2A` | Middle Serial Digits (Masked to `** ** ** **` in UI / Sanitized to `0x2A` in logs) |
| `13..16` | ASCII | Serial Number Suffix (e.g. `2927`) |
| `17..64` | `0x00` | Zero padding |

---

### 2.2 Battery Level & Status Query (`0x12 0x07`)

Queries current battery percentage, sleep settings, and active charging state.

#### Outgoing TX Query
```hex
03 12 07 00 00 00 00 00 00 00 00 00 00 00 00 00 ... 00
```

#### Incoming RX Response
| Byte Offset | Description |
|:---:|:---|
| `0` | Report ID (`0x03`) |
| `1..2` | Echo opcode (`0x12 0x07`) |
| `5` | **Battery Percentage** (`0` to `100` direct integer) |
| `6` | Configured Sleep Timeout Code (`0x00` = 1m, `0x01` = 2m, `0x02` = 3m, `0x03` = 5m, `0x04` = 10m) |
| `7` | Configured Low Battery Warning Percentage (`20`%) |
| `10` | Charging State (`0` = On Battery, `1` = Charging via USB / Dock) |

*Note: If the mouse enters RF power saving or sleep standby, it responds with `[0x03, 0xFF, 0xAA, ...]`, which the driver parses as `asleep`.*

---

### 2.3 Mouse RGB Zone Lighting (`0x51 0x28`)

Sets lighting mode, brightness, and color for Zone `0x00` (ROG Palm Logo).
| Byte Offset | Value | Description |
|:---:|:---:|:---|
| `0` | `0x03` | Report ID |
| `1` | `0x51` | Peripheral Command Opcode |
| `2` | `0x28` | Lighting Sub-command |
| `3` | `0x00` | Zone ID (`0x00` = Palm Logo) |
| `4` | `0x00` | Mode ID (`0x00` Static, `0x01` Breathing, `0x02` Color Cycle, `0x03` Rainbow, `0x06` Battery Mode) |
| `5` | `0x00` | Animation Speed |
| `6` | `0x64` | Brightness (`0` - `100` percentage) |
| `7..9` | `R G B` | RGB Color Triplet |
| `10..64` | `0x00` | Zero padding |

---

### 2.4 DPI Stages, Polling Rate & Sleep Timeout

#### DPI Stage Configuration (`0x51 0x31`)
Configures the sensor CPI/DPI value and indicator color for one of the 4 onboard stages:
- **Formula:** `dpiEncoded = (DPI - 50) / 50`
- Byte 0: `<reportId>` (`0x03` on Omni Receiver, `0x00` on Wired/2.4G)
- Byte 1..2: `0x51 0x31`
- Byte 3: Stage Index (`0x00` Stage 1, `0x01` Stage 2, `0x02` Stage 3, `0x03` Stage 4)
- Byte 4: `0x00`
- Bytes 5..6: Encoded DPI Value (16-bit Little-Endian, e.g. `1600 DPI` &rarr; `(1600 - 50) / 50 = 31` = `0x001F` &rarr; `buf[5]=0x1F, buf[6]=0x00`)
- Bytes 7..9: Stage Indicator RGB Color (`R G B`)

#### Active DPI Stage Select (`0x51 0x31 0x09`)
Switches the active DPI profile on the fly:
```hex
03 51 31 09 00 <profile: 0x01..0x04> 00 00 ... 00
```

#### Polling Rate (`0x51 0x31 0x04`)
- Opcode: `[<reportId>, 0x51, 0x31, 0x04, 0x00, <rate_code>]`
- `125 Hz` &rarr; `0x00`
- `250 Hz` &rarr; `0x01`
- `500 Hz` &rarr; `0x02`
- `1000 Hz` &rarr; `0x03`
```hex
03 51 31 04 00 <rate_code> 00 00 ... 00
```

#### Wireless Sleep Timeout (`0x51 0x37`)
- Opcode: `[<reportId>, 0x51, 0x37, 0x00, 0x00, <timeout_code>, 0x00, <low_battery_warning>]`
- Byte 5: Sleep Timeout Code (`0x00` = 1 min, `0x01` = 2 min, `0x02` = 3 min, `0x03` = 5 min, `0x04` = 10 min, `0xFF` = Never)
- Byte 7: Low Battery Warning Threshold Percentage (Default: `20`%)
```hex
03 51 37 00 00 02 00 14 00 00 ... 00
```

---

### 2.5 Mouse Onboard Flash Persistence (`0x50 0x03`)

Flushes all staging registers into the mouse's internal EEPROM / Flash memory:
```hex
03 50 03 00 00 00 00 00 00 00 00 00 00 00 00 00 ... 00
```
Once executed, the mouse retains all 4 DPI stages, chosen polling rate, sleep timeout, and lighting settings permanently across reboots and when connected to different host computers.
