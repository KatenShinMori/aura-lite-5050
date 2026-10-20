/**
 * ASUS ROG Gladius III Wireless AimPoint & ROG Omni Receiver Driver
 * Supports:
 * - 0x1A72 (SpeedNova Wireless, Report ID: 0x00)
 * - 0x1A70 (USB-C Wired, Report ID: 0x00)
 * - 0x1ACE (ROG Omni Receiver, Report ID: 0x03 - Critical Protocol Difference)
 */

import { formatHex, normalizeRgb } from './b550fAura.js';

export const MOUSE_MODES = {
  STATIC: 0x00,
  BREATHING: 0x01,
  COLOR_CYCLE: 0x02,
  RAINBOW: 0x03,
  REACTIVE: 0x04,
  COMET: 0x05,
  BATTERY_MODE: 0x06
};

export const MOUSE_POLLING_RATES = {
  125: 0x00,
  250: 0x01,
  500: 0x02,
  1000: 0x03
};

export const MOUSE_SLEEP_TIMEOUTS = {
  1: 0x00,
  2: 0x01,
  3: 0x02,
  5: 0x03,
  10: 0x04,
  0: 0xFF,   // Never
  never: 0xFF
};

/**
 * Creates a zero-filled 65-byte Buffer with specified Report ID as byte 0
 */
export function createMouseBuffer(reportId = 0x00) {
  const buf = Buffer.alloc(65, 0);
  buf[0] = reportId & 0xFF;
  return buf;
}

/**
 * Device Signature Handshake Probe Packet
 * Probing [0x03, 0x12, 0x12, 0x02, ...] on 0x1ACE
 */
export function buildProbePacket(reportId = 0x03) {
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x12;
  buf[2] = 0x12;
  buf[3] = 0x02;
  return buf;
}

/**
 * Battery Status Query Packet
 * [<reportId>, 0x12, 0x07, ...]
 */
export function buildBatteryQueryPacket(reportId = 0x00) {
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x12;
  buf[2] = 0x07;
  return buf;
}

/**
 * Parses Battery Response Packet
 * Matches G-Helper (seerge/g-helper AsusMouse.cs):
 * - If report ID present at index 0 (e.g. 0x03): response[1] == 0x12 && response[2] == 0x07
 *   - response[5] = battery % (0-100 direct percentage)
 *   - response[6] = PowerOffSetting
 *   - response[7] = LowBatteryWarning
 *   - response[10] > 0 = charging
 * - If report ID stripped: response[0] == 0x12 && response[1] == 0x07
 *   - response[4] = battery %
 *   - response[5] = PowerOffSetting
 *   - response[6] = LowBatteryWarning
 *   - response[9] > 0 = charging
 * - If standby/asleep response: response[1] == 0xFF && response[2] == 0xAA (or [0]==0xFF && [1]==0xAA)
 *   - status = 'asleep'
 */
export function parseBatteryResponse(response, reportId = 0x03) {
  if (!response || response.length < 2) {
    return { battery: -1, charging: false, status: 'unknown', valid: false };
  }

  // Standby / Asleep response: [reportId, 0xFF, 0xAA, ...] or [0xFF, 0xAA, ...]
  if ((response[1] === 0xFF && response[2] === 0xAA) || (response[0] === 0xFF && response[1] === 0xAA)) {
    return {
      battery: -1,
      charging: false,
      status: 'asleep',
      valid: true,
      isStandby: true,
      isAsleep: true
    };
  }

  // 1. Full packet with Report ID: [reportId, 0x12, 0x07, ...]
  if (response.length >= 11 && response[1] === 0x12 && response[2] === 0x07) {
    const rawBattery = response[5];
    const charging = response[10] > 0;
    const isAsleep = (rawBattery === 0 && !charging);
    const status = charging ? 'charging' : (isAsleep ? 'asleep' : 'awake');
    return {
      battery: isAsleep ? 0 : Math.min(100, Math.max(0, rawBattery)),
      charging,
      status,
      isAsleep,
      powerOffSetting: response[6],
      lowBatteryWarning: response[7],
      valid: true
    };
  }

  // 2. Report ID stripped: [0x12, 0x07, ...]
  if (response.length >= 10 && response[0] === 0x12 && response[1] === 0x07) {
    const rawBattery = response[4];
    const charging = response[9] > 0;
    const isAsleep = (rawBattery === 0 && !charging);
    const status = charging ? 'charging' : (isAsleep ? 'asleep' : 'awake');
    return {
      battery: isAsleep ? 0 : Math.min(100, Math.max(0, rawBattery)),
      charging,
      status,
      isAsleep,
      powerOffSetting: response[5],
      lowBatteryWarning: response[6],
      valid: true
    };
  }

  // Strictly reject stale ACK packets (e.g. 0x51 0x28, 0x51 0x31, 0x51 0x37)
  return { battery: -1, charging: false, status: 'unknown', valid: false };
}

/**
 * Build Single RGB Zone Lighting Packet (Palm Logo Zone 0x00)
 * [<reportId>, 0x51, 0x28, 0x00, 0x00, <Mode>, <Brightness>, <R>, <G>, <B>, 0x00, 0x00, <Speed>]
 *
 * @param {number} reportId - 0x00 or 0x03
 * @param {number} mode - MOUSE_MODES value
 * @param {number} r - 0-255
 * @param {number} g - 0-255
 * @param {number} b - 0-255
 * @param {number} brightness - 0-100 (Gladius III AimPoint MaxBrightness = 100 / 0x64)
 * @param {number} speed - 0x05 (fast), 0x07 (medium), 0x09 (slow)
 */
export function buildLightingPacket(reportId = 0x00, mode = MOUSE_MODES.STATIC, r = 255, g = 0, b = 0, brightness = 100, speed = 0x07) {
  const rgb = normalizeRgb({ r, g, b }, { r: 255, g: 0, b: 0 });
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x51;
  buf[2] = 0x28;
  buf[3] = 0x00; // Zone 0x00 (Logo)
  buf[4] = 0x00;
  buf[5] = mode & 0xFF;
  const clampedBrightness = Math.min(100, Math.max(0, Math.round(Number(brightness !== undefined ? brightness : 100))));
  buf[6] = clampedBrightness & 0xFF; // Brightness level 0x00..0x64 (0-100)
  buf[7] = rgb.r & 0xFF;
  buf[8] = rgb.g & 0xFF;
  buf[9] = rgb.b & 0xFF;
  buf[10] = 0x00; // Animation Direction
  buf[11] = 0x00; // Random Color flag
  buf[12] = (mode === MOUSE_MODES.STATIC || mode === 0) ? 0x00 : (speed & 0xFF);
  return buf;
}

/**
 * Build DPI Setting Packet
 * Formula: dpiEncoded = (DPI - 50) / 50
 * [<reportId>, 0x51, 0x31, <stageIndex>, 0x00, (dpiLow), (dpiHigh), <R>, <G>, <B>]
 *
 * @param {number} reportId - 0x00 or 0x03
 * @param {number} stageIndex - 0 to 3
 * @param {number} dpi - 100 to 36000
 * @param {number} r - Stage Color R
 * @param {number} g - Stage Color G
 * @param {number} b - Stage Color B
 */
export function buildDpiPacket(reportId = 0x00, stageIndex = 0, dpi = 800, r = 255, g = 0, b = 0) {
  const clampedDpi = Math.min(36000, Math.max(100, Math.round(dpi / 50) * 50));
  const dpiEncoded = Math.floor((clampedDpi - 50) / 50);
  const rgb = normalizeRgb({ r, g, b }, { r: 255, g: 0, b: 0 });
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x51;
  buf[2] = 0x31;
  buf[3] = stageIndex & 0x03; // Stage 0..3
  buf[4] = 0x00;
  buf[5] = dpiEncoded & 0xFF;
  buf[6] = (dpiEncoded >> 8) & 0xFF;
  buf[7] = rgb.r & 0xFF;
  buf[8] = rgb.g & 0xFF;
  buf[9] = rgb.b & 0xFF;
  return buf;
}

/**
 * Build Active DPI Stage Selection Packet
 * [<reportId>, 0x51, 0x31, 0x09, 0x00, <Profile>]
 * Profile is 1..4 (G-Helper / ASUS ROG protocol)
 *
 * @param {number} reportId - 0x00 or 0x03
 * @param {number} profile - 1 to 4
 */
export function buildDpiStageSelectPacket(reportId = 0x00, profile = 1) {
  let p = Number(profile);
  if (p < 1) p = 1;
  if (p > 4) p = 4;
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x51;
  buf[2] = 0x31;
  buf[3] = 0x09;
  buf[4] = 0x00;
  buf[5] = p & 0xFF;
  return buf;
}

/**
 * Build Polling Rate Packet
 * [<reportId>, 0x51, 0x31, 0x04, 0x00, <RateCode>]
 *
 * @param {number} reportId - 0x00 or 0x03
 * @param {number} rateCode - 0=125Hz, 1=250Hz, 2=500Hz, 3=1000Hz
 */
export function buildPollingRatePacket(reportId = 0x00, rateCode = 0x03) {
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x51;
  buf[2] = 0x31;
  buf[3] = 0x04;
  buf[4] = 0x00;
  buf[5] = rateCode & 0xFF;
  return buf;
}

/**
 * Build Wireless Sleep Timeout Packet (Auto Power Off)
 * [<reportId>, 0x51, 0x37, 0x00, 0x00, <TimeoutCode>, 0x00, <LowBatteryWarning>]
 *
 * @param {number} reportId - 0x00 or 0x03
 * @param {number} timeoutMinutes - 1, 2, 3, 5, 10, or 0 (Never)
 * @param {number} lowBatteryWarning - default 20%
 */
export function buildSleepTimeoutPacket(reportId = 0x00, timeoutMinutes = 3, lowBatteryWarning = 20) {
  let timeoutCode = MOUSE_SLEEP_TIMEOUTS[timeoutMinutes];
  if (timeoutCode === undefined) timeoutCode = 0x02; // default 3 min

  const buf = createMouseBuffer(reportId);
  buf[1] = 0x51;
  buf[2] = 0x37;
  buf[3] = 0x00;
  buf[4] = 0x00;
  buf[5] = timeoutCode & 0xFF;
  buf[6] = 0x00;
  buf[7] = Math.min(100, Math.max(5, lowBatteryWarning)) & 0xFF;
  return buf;
}

/**
 * Build Onboard Profile Save / Flush Packet
 * [<reportId>, 0x50, 0x03]
 */
export function buildCommitPacket(reportId = 0x00) {
  const buf = createMouseBuffer(reportId);
  buf[1] = 0x50;
  buf[2] = 0x03;
  return buf;
}

// Strict Hardware VID:PID Guardrails
export const ASUS_VID = 0x0B05;
export const ALLOWED_MOUSE_PIDS = [0x1ACE, 0x1A72, 0x1A70];

/**
 * ROG Gladius III Wireless AimPoint Controller Wrapper
 */
export class GladiusAimpointController {
  constructor(hidHandle = null, reportId = 0x03, pid = 0x1ACE, isMock = false, vid = ASUS_VID) {
    this.hidHandle = hidHandle;
    this.reportId = reportId; // 0x03 for Omni (0x1ACE), 0x00 for 0x1A72 / 0x1A70
    this.pid = pid;
    this.vid = vid;
    this.isMock = isMock;
    this.name = this.getDisplayName();
    this.battery = 85;
    this.charging = false;
    this.currentSettings = {
      lighting: { mode: MOUSE_MODES.STATIC, r: 255, g: 0, b: 0, brightness: 100 },
      dpiStages: [
        { dpi: 400, r: 255, g: 0, b: 0 },
        { dpi: 800, r: 0, g: 128, b: 255 },
        { dpi: 1600, r: 0, g: 255, b: 128 },
        { dpi: 3200, r: 255, g: 255, b: 0 }
      ],
      activeDpiStage: 1, // Stage 2 (800 DPI, profile 2)
      pollingRate: 1000,
      sleepTimeout: 3,
      lowBatteryWarning: 20
    };
  }

  getDisplayName() {
    if (this.pid === 0x1ACE) return 'ROG Gladius III AimPoint (Omni Receiver 0x1ACE)';
    if (this.pid === 0x1A72) return 'ROG Gladius III AimPoint (SpeedNova 2.4G 0x1A72)';
    if (this.pid === 0x1A70) return 'ROG Gladius III AimPoint (USB-C Wired 0x1A70)';
    return 'ROG Gladius III AimPoint (Mock Mode)';
  }

  setConnection(handle, reportId, pid, vid = ASUS_VID) {
    this.hidHandle = handle;
    this.reportId = reportId;
    this.pid = pid;
    this.vid = vid;
    this.isMock = !handle;
    this.name = this.getDisplayName();
  }

  /**
   * Strict USB VID:PID allowlist validation guardrail
   * Blocks writes to unsupported devices to protect hardware NVRAM registers from corruption
   */
  validateDeviceGuardrails(buf = null) {
    const numVid = typeof this.vid === 'string' ? parseInt(this.vid, 16) : Number(this.vid);
    const numPid = typeof this.pid === 'string' ? parseInt(this.pid, 16) : Number(this.pid);
    if (numVid !== ASUS_VID || !ALLOWED_MOUSE_PIDS.includes(numPid)) {
      const vidHex = this.vid !== null && this.vid !== undefined ? '0x' + numVid.toString(16).toUpperCase().padStart(4, '0') : 'UNKNOWN';
      const pidHex = this.pid !== null && this.pid !== undefined ? '0x' + numPid.toString(16).toUpperCase().padStart(4, '0') : 'UNKNOWN';
      throw new Error(`[Security Guardrail] Hardware VID:PID validation failed (${vidHex}:${pidHex}). Mouse writes blocked to prevent NVRAM register corruption on unsupported hardware.`);
    }
    if (buf && (!Buffer.isBuffer(buf) || buf.length !== 65)) {
      throw new Error(`[Security Guardrail] Invalid packet length (${buf ? buf.length : 0} bytes). Mouse requires exactly 65-byte buffers.`);
    }
  }

  drainInput(timeoutMs = 5) {
    if (!this.hidHandle || this.isMock) return 0;
    let drainedCount = 0;
    try {
      while (drainedCount < 100) {
        const resp = this.hidHandle.readTimeout(timeoutMs);
        if (!resp || resp.length === 0) break;
        drainedCount++;
      }
    } catch (e) {
      // Ignore drain errors
    }
    return drainedCount;
  }

  writePacket(buf, desc = 'Mouse HID Packet', onPacketSent = null, drainAck = true) {
    this.validateDeviceGuardrails(buf);
    if (this.hidHandle && !this.isMock) {
      try {
        this.hidHandle.write(buf);
        this.lastError = null;
        if (drainAck) {
          // Drain the single ACK response from Omni Receiver (0x1ACE) so input buffer never fills up
          try {
            this.hidHandle.readTimeout(15);
          } catch (e) {}
        }
      } catch (err) {
        console.warn(`[Mouse] HID Write Warning: ${err.message}. Falling back to mock.`);
        this.lastError = err.message;
        this.isMock = true;
      }
    }
    if (onPacketSent) {
      onPacketSent({
        direction: 'TX',
        device: 'Mouse (Gladius III)',
        description: desc,
        bytes: formatHex(buf),
        timestamp: new Date().toISOString(),
        raw: Array.from(buf)
      });
    }
    return buf;
  }

  writeAndRead(buf, desc = 'Mouse HID Write & Read', timeoutMs = 1000, onPacketSent = null) {
    this.drainInput(5);
    this.writePacket(buf, desc, onPacketSent, false);
    if (this.hidHandle && !this.isMock) {
      try {
        const resp = this.hidHandle.readTimeout(timeoutMs);
        return resp && resp.length > 0 ? Buffer.from(resp) : null;
      } catch (err) {
        console.warn(`[Mouse] HID Read Warning: ${err.message}`);
        this.lastError = err.message;
        return null;
      }
    }
    return null;
  }

  probeSignature(onPacketSent = null) {
    const probeBuf = buildProbePacket(this.reportId);
    const resp = this.writeAndRead(probeBuf, 'Omni Mouse Signature Probe', 1000, onPacketSent);
    if (resp && resp.length >= 17) {
      const sigBuffer = resp.slice(5, 17);
      const signatureStr = sigBuffer.toString('ascii').replace(/\0/g, '').trim();
      if (onPacketSent) {
        const maskedSig = signatureStr
          ? (signatureStr.length > 6 ? signatureStr.slice(0, 4) + '****' + signatureStr.slice(-4) : signatureStr.slice(0, 2) + '****')
          : 'ACK';
        // Sanitize middle bytes of serial number in logged packet to prevent terminal & inspector PII leakage
        const sanitizedResp = Buffer.from(resp);
        if (signatureStr && signatureStr.length > 6) {
          for (let b = 9; b < 13 && b < 17; b++) {
            sanitizedResp[b] = 0x2A; // ASCII '*'
          }
        }
        onPacketSent({
          direction: 'RX',
          device: 'RX <- Mouse (Gladius III Signature Probe)',
          description: `Signature: ${maskedSig}`,
          bytes: formatHex(sanitizedResp),
          timestamp: new Date().toISOString(),
          raw: Array.from(sanitizedResp)
        });
      }
      return { awake: true, signature: signatureStr, rawHex: sigBuffer.toString('hex') };
    }
    return { awake: !this.isMock, signature: this.isMock ? '[SN: REDACTED]' : null, rawHex: '' };
  }

  queryBattery(onPacketSent = null) {
    if (this.isMock || !this.hidHandle) {
      const mockRx = Buffer.alloc(65, 0);
      mockRx[0] = this.reportId;
      mockRx[1] = 0x12;
      mockRx[2] = 0x07;
      mockRx[5] = this.battery;
      mockRx[6] = 0x03; // 5 min sleep
      mockRx[7] = 20;   // 20% alert
      mockRx[10] = this.charging ? 1 : 0;

      const status = this.charging ? 'charging' : (this.battery === 0 ? 'asleep' : 'awake');
      this.status = status;

      if (onPacketSent) {
        onPacketSent({
          direction: 'RX',
          device: 'RX <- Mouse (Gladius III Battery Response)',
          description: `Battery: ${this.battery}%, Status: ${this.charging ? 'Charging ⚡' : 'Awake'} (Mock)`,
          bytes: formatHex(mockRx),
          timestamp: new Date().toISOString(),
          raw: Array.from(mockRx)
        });
      }

      return {
        success: true,
        battery: this.battery,
        charging: this.charging,
        status: this.status,
        isMock: true,
        rawHex: formatHex(mockRx),
        raw: Array.from(mockRx),
        packetHex: mockRx.toString('hex').toUpperCase()
      };
    }

    // 1. Drain pending stale packets in node-hid read queue
    this.drainInput(5);

    // 2. Build query packet: [reportId, 0x12, 0x07, 0x00, ...]
    const queryBuf = buildBatteryQueryPacket(this.reportId);

    // 3. Send query packet (without draining ACK, so reply can be read)
    this.writePacket(queryBuf, 'Mouse Battery Query (0x12 0x07)', onPacketSent, false);

    // 4. Retry loop (up to 5 reads with readTimeout(60)) matching 0x12 0x07 response header
    let matchedResp = null;
    let standbyResp = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resp = this.hidHandle.readTimeout(60);
        if (!resp || resp.length === 0) continue;
        const buf = Buffer.from(resp);

        // Explicit header match for battery response:
        // [reportId, 0x12, 0x07, ...] or [0x12, 0x07, ...]
        const isBatteryHeader = (buf[0] === this.reportId && buf[1] === 0x12 && buf[2] === 0x07) ||
                                (buf[0] === 0x12 && buf[1] === 0x07);
        if (isBatteryHeader) {
          matchedResp = buf;
          break;
        }

        // Check standby / asleep response: [reportId, 0xFF, 0xAA] or [0xFF, 0xAA]
        const isStandbyHeader = (buf[0] === this.reportId && buf[1] === 0xFF && buf[2] === 0xAA) ||
                                (buf[0] === 0xFF && buf[1] === 0xAA);
        if (isStandbyHeader) {
          standbyResp = buf;
          break;
        }
      } catch (err) {
        console.warn(`[Mouse] HID Read Warning during battery query: ${err.message}`);
        this.lastError = err.message;
        break;
      }
    }

    const finalResp = matchedResp || standbyResp;

    if (matchedResp) {
      const parsed = parseBatteryResponse(matchedResp, this.reportId);
      if (parsed.valid) {
        if (parsed.isAsleep) {
          // Device reported 0% / standby: retain last known battery level
          this.status = 'asleep';
          this.charging = false;
        } else {
          this.battery = parsed.battery;
          this.charging = parsed.charging;
          this.status = parsed.status;
        }
        this.lastRxBuffer = matchedResp;
      }
    } else if (standbyResp) {
      this.status = 'asleep';
      this.charging = false;
      this.lastRxBuffer = standbyResp;
    } else {
      // No response across all attempts; mouse is unreachable / asleep
      this.status = 'asleep';
      this.charging = false;
    }

    // 5. Show incoming RX packet in Live Packet Inspector
    if (onPacketSent && finalResp) {
      const statusLabel = this.status === 'charging'
        ? 'Charging ⚡'
        : (this.status === 'asleep' ? 'Asleep / Standby 💤' : 'Awake');
      const desc = this.status === 'asleep'
        ? `Status: Asleep / Standby 💤 · Last Battery: ${this.battery}%`
        : `Battery: ${this.battery}% · Status: ${statusLabel}`;

      onPacketSent({
        direction: 'RX',
        device: 'RX <- Mouse (Gladius III Battery Response)',
        description: desc,
        bytes: formatHex(finalResp),
        timestamp: new Date().toISOString(),
        raw: Array.from(finalResp)
      });
    }

    return {
      success: true,
      battery: this.battery,
      charging: this.charging,
      status: this.status || (this.charging ? 'charging' : 'awake'),
      isMock: false,
      rawHex: finalResp ? formatHex(finalResp) : (this.lastRxBuffer ? formatHex(this.lastRxBuffer) : ''),
      raw: finalResp ? Array.from(finalResp) : (this.lastRxBuffer ? Array.from(this.lastRxBuffer) : []),
      packetHex: finalResp ? finalResp.toString('hex').toUpperCase() : (this.lastRxBuffer ? this.lastRxBuffer.toString('hex').toUpperCase() : '')
    };
  }

  setLighting(mode, r, g, b, brightness = 100, onPacketSent = null) {
    const buf = buildLightingPacket(this.reportId, mode, r, g, b, brightness);
    this.writePacket(buf, `Mouse Set Lighting (Mode: 0x0${mode}, Brightness: ${brightness})`, onPacketSent);
    this.currentSettings.lighting = { mode, r, g, b, brightness };
    return buf;
  }

  setActiveDpiStage(profile, onPacketSent = null) {
    let prof = Number(profile);
    if (prof < 1) prof = 1;
    if (prof > 4) prof = 4;
    const buf = buildDpiStageSelectPacket(this.reportId, prof);
    this.writePacket(buf, `Mouse Switch Active DPI Stage (Profile: ${prof})`, onPacketSent);
    this.currentSettings.activeDpiStage = prof - 1; // 0-indexed stage for UI state
    return buf;
  }

  setDpiStage(stageIndex, dpi, r, g, b, onPacketSent = null) {
    const buf = buildDpiPacket(this.reportId, stageIndex, dpi, r, g, b);
    this.writePacket(buf, `Mouse Set DPI Stage ${stageIndex + 1} (${dpi} DPI)`, onPacketSent);
    if (!this.currentSettings.dpiStages[stageIndex]) {
      this.currentSettings.dpiStages[stageIndex] = {};
    }
    this.currentSettings.dpiStages[stageIndex].dpi = dpi;
    if (r !== undefined && g !== undefined && b !== undefined) {
      this.currentSettings.dpiStages[stageIndex].r = r;
      this.currentSettings.dpiStages[stageIndex].g = g;
      this.currentSettings.dpiStages[stageIndex].b = b;
    }
    return buf;
  }

  setPollingRate(rateHz, onPacketSent = null) {
    const code = MOUSE_POLLING_RATES[rateHz] !== undefined ? MOUSE_POLLING_RATES[rateHz] : 0x03;
    const buf = buildPollingRatePacket(this.reportId, code);
    this.writePacket(buf, `Mouse Set Polling Rate (${rateHz} Hz)`, onPacketSent);
    this.currentSettings.pollingRate = rateHz;
    return buf;
  }

  setSleepTimeout(minutes, lowBatteryWarning = 20, onPacketSent = null) {
    const buf = buildSleepTimeoutPacket(this.reportId, minutes, lowBatteryWarning);
    this.writePacket(buf, `Mouse Set Sleep Timeout (${minutes} min, Alert: ${lowBatteryWarning}%)`, onPacketSent);
    this.currentSettings.sleepTimeout = minutes;
    this.currentSettings.lowBatteryWarning = lowBatteryWarning;
    return buf;
  }

  commitToOnboard(onPacketSent = null) {
    this.validateDeviceGuardrails();
    const buf = buildCommitPacket(this.reportId);
    this.writePacket(buf, 'Mouse Flush Settings to Onboard Memory (0x50 0x03)', onPacketSent);
    return buf;
  }
}
