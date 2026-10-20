/**
 * B550-F Gaming Aura LED Controller Driver & 65-Byte Packet Builder
 * VID: 0x0B05, PID: 0x19AF (and 0x1939 Aura USB controllers)
 * UsagePage: 0xFF72
 *
 * Implements OpenRGB-grounded AsusAuraMainboardController / AsusAuraUSBController protocol:
 * - 65-byte zero-filled buffers with Report ID 0xEC as byte 0 on Windows node-hid
 * - Config table discovery on startup (0xEC 0xB0 query / 0xEC 0x30 response)
 * - Hardware effect mode: 0x35 mode selection + 0x36 color/speed + 0x3F 0x55 NVRAM commit
 * - Direct mode: 0x35 0x00 0x00 0x01 enable + 0x40 0x80|<channel> streaming
 * - Independent control separating built-in ROG I/O shroud logo from 12V headers
 */

export const B550F_MODES = {
  OFF: 0x00,
  STATIC: 0x01,
  BREATHING: 0x02,
  COLOR_CYCLE: 0x03,
  RAINBOW: 0x04,
  STARRY_NIGHT: 0x05,
  COMET: 0x06
};

export const B550F_CHANNELS = {
  MAINBOARD: 0x04,           // Built-in ROG Shroud Logo + 12V RGB (Direct Mode channel 0x04)
  CHANNEL_0: 0x04,           // Mainboard Direct Channel = 0x04 (0x84 latched)
  CHANNEL_1: 0x00,           // 5V Addressable Gen 2 Header (Direct Mode channel 0x00)
  ONBOARD_AND_12V_RGB: 0x04, // Alias for backwards compatibility
  ARGB_GEN2: 0x00            // Alias for backwards compatibility
};

export const B550F_DIRECT_CHANNELS = {
  MAINBOARD: 0x04,
  ARGB_GEN2: 0x00
};

export const B550F_EFFECT_CHANNELS = {
  MAINBOARD: 0x00,
  ARGB_GEN2: 0x01
};

/**
 * Normalizes any color representation (hex string, RGB object, etc.) to { r, g, b } clamped 0-255
 */
export function normalizeRgb(color, defaultRgb = { r: 255, g: 0, b: 0 }) {
  if (color === null || color === undefined) {
    return { ...defaultRgb };
  }
  if (typeof color === 'string') {
    const hex = color.replace('#', '').trim();
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return {
        r: isNaN(r) ? defaultRgb.r : r,
        g: isNaN(g) ? defaultRgb.g : g,
        b: isNaN(b) ? defaultRgb.b : b
      };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return {
        r: isNaN(r) ? defaultRgb.r : r,
        g: isNaN(g) ? defaultRgb.g : g,
        b: isNaN(b) ? defaultRgb.b : b
      };
    }
    return { ...defaultRgb };
  }
  if (Array.isArray(color)) {
    return {
      r: Math.min(255, Math.max(0, isNaN(Number(color[0])) ? defaultRgb.r : Math.round(Number(color[0])))),
      g: Math.min(255, Math.max(0, isNaN(Number(color[1])) ? defaultRgb.g : Math.round(Number(color[1])))),
      b: Math.min(255, Math.max(0, isNaN(Number(color[2])) ? defaultRgb.b : Math.round(Number(color[2]))))
    };
  }
  if (typeof color === 'object') {
    if (typeof color.hex === 'string' && color.r === undefined) {
      return normalizeRgb(color.hex, defaultRgb);
    }
    if (typeof color.color === 'string' && color.r === undefined) {
      return normalizeRgb(color.color, defaultRgb);
    }
    const r = color.r !== undefined ? Number(color.r) : (color.red !== undefined ? Number(color.red) : defaultRgb.r);
    const g = color.g !== undefined ? Number(color.g) : (color.green !== undefined ? Number(color.green) : defaultRgb.g);
    const b = color.b !== undefined ? Number(color.b) : (color.blue !== undefined ? Number(color.blue) : defaultRgb.b);
    return {
      r: Math.min(255, Math.max(0, isNaN(r) ? defaultRgb.r : Math.round(r))),
      g: Math.min(255, Math.max(0, isNaN(g) ? defaultRgb.g : Math.round(g))),
      b: Math.min(255, Math.max(0, isNaN(b) ? defaultRgb.b : Math.round(b)))
    };
  }
  return { ...defaultRgb };
}

/**
 * Creates a zero-filled 65-byte Buffer with Report ID 0xEC at byte 0
 */
export function create65ByteBuffer() {
  const buf = Buffer.alloc(65, 0);
  buf[0] = 0xEC;
  return buf;
}

/**
 * Format a Buffer into a clean uppercase hex string
 * e.g. "EC 35 00 00 01 FF 00 00 ..."
 */
export function formatHex(buf) {
  if (!buf) return '';
  return Array.from(buf)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

/**
 * Build Gen1 Initialization Packet
 * [0xEC, 0x52, 0x53, 0x00, 0x01, ...] (65 bytes)
 */
export function buildInitPacket() {
  const buf = create65ByteBuffer();
  buf[1] = 0x52;
  buf[2] = 0x53;
  buf[3] = 0x00;
  buf[4] = 0x01;
  return buf;
}

/**
 * Build Config Table Request Packet
 * [0xEC, 0xB0, 0x00, ...] (65 bytes)
 */
export function buildConfigTablePacket() {
  const buf = create65ByteBuffer();
  buf[1] = 0xB0;
  buf[2] = 0x00;
  return buf;
}

/**
 * Parse 65-byte Config Table Response Packet
 * Expects response[0] == 0xEC && response[1] == 0x30 (or response[0] == 0x30 if report ID stripped)
 */
export function parseConfigTable(resp) {
  if (!resp || resp.length < 32) {
    return {
      valid: false,
      totalMainboardLeds: 7,
      onboardLeds: 5,
      rgbHeaders: 2,
      argbChannels: 1
    };
  }

  // Handle both 65-byte buffers (resp[0] == 0xEC && resp[1] == 0x30)
  // and 64-byte responses where Report ID 0xEC is stripped (resp[0] == 0x30)
  let offset = 0;
  if (resp[0] === 0xEC && resp[1] === 0x30) {
    offset = 0;
    if (resp.length < 35) {
      return {
        valid: false,
        totalMainboardLeds: 7,
        onboardLeds: 5,
        rgbHeaders: 2,
        argbChannels: 1
      };
    }
  } else if (resp[0] === 0x30) {
    offset = -1;
    if (resp.length < 34) {
      return {
        valid: false,
        totalMainboardLeds: 7,
        onboardLeds: 5,
        rgbHeaders: 2,
        argbChannels: 1
      };
    }
  } else {
    return {
      valid: false,
      totalMainboardLeds: 7,
      onboardLeds: 5,
      rgbHeaders: 2,
      argbChannels: 1
    };
  }

  const idxOnboard = 31 + offset;
  const idxHeaders = 33 + offset;
  const idxArgb = 34 + offset;

  // Response indices:
  // Byte 31 (0x1F): onboard LEDs (e.g. 5 for ROG Strix I/O Shroud logo)
  // Byte 33 (0x21): 12V RGB headers count (e.g. 2 for RGB_HEADER1 & RGB_HEADER2)
  // Byte 34 (0x22): 5V ARGB Gen 2 header count (e.g. 1 for ADD_GEN2)
  const onboardLeds = (resp[idxOnboard] !== undefined && resp[idxOnboard] > 0) ? resp[idxOnboard] : 5;
  const rgbHeaders = (resp[idxHeaders] !== undefined && resp[idxHeaders] > 0) ? resp[idxHeaders] : 2;
  const argbChannels = (resp[idxArgb] !== undefined && resp[idxArgb] > 0) ? resp[idxArgb] : 1;
  const totalMainboardLeds = onboardLeds + rgbHeaders;

  return {
    valid: true,
    totalMainboardLeds,
    onboardLeds,
    rgbHeaders,
    argbChannels,
    mainboardDirectChannel: 0x04,
    rawHex: formatHex(resp.slice(0, 36))
  };
}

/**
 * Build Hardware Effect Mode Selection Packet
 * [0xEC, 0x35, <channel>, 0x00, 0x00, <mode>, ...] (65 bytes)
 *
 * @param {number} channel - 0x00 or 0x01
 * @param {number} mode - Mode opcode (1=Static, 2=Breathing, etc.)
 */
export function buildModePacket(channel, mode) {
  const buf = create65ByteBuffer();
  buf[1] = 0x35;
  buf[2] = channel & 0xFF;
  buf[3] = 0x00;
  buf[4] = 0x00;
  buf[5] = mode & 0xFF;
  return buf;
}

/**
 * Backwards-compatible alias for buildModePacket
 */
export function buildEffectPacket(channel, mode, r = 255, g = 0, b = 0) {
  return buildModePacket(channel, mode);
}

/**
 * Build Hardware Effect Color Packet (0x36)
 * [0xEC, 0x36, (mask >> 8), (mask & 0xFF), 0x00, R0, G0, B0, ...] (65 bytes)
 * Sets RGB color slots for active hardware effects on ASUS Aura motherboards (PID 0x19AF / 0x1939)
 *
 * @param {number} channel - 0x00 (Fixed/Mainboard) or 0x01 (Addressable Header)
 * @param {number} r - 0-255 Red
 * @param {number} g - 0-255 Green
 * @param {number} b - 0-255 Blue
 * @param {number} speedOrLeds - Animation speed or LED count (default 7)
 * @param {number} brightness - 0-100% or 0-255 software brightness scale (default 100)
 */
export function buildEffectColorPacket(channel = 0, r = 255, g = 0, b = 0, speedOrLeds = 7, brightness = 100) {
  const norm = normalizeRgb({ r, g, b }, { r: 255, g: 0, b: 0 });
  const brt = brightness !== undefined ? Number(brightness) : 100;
  const scale = brt > 100 ? (brt / 255) : (Math.max(0, Math.min(100, brt)) / 100);
  const scaledR = Math.round(norm.r * scale);
  const scaledG = Math.round(norm.g * scale);
  const scaledB = Math.round(norm.b * scale);

  const buf = create65ByteBuffer();
  buf[1] = 0x36; // AURA_MAINBOARD_CONTROL_MODE_EFFECT_COLOR (0x36 instead of 0x3B)

  const isAddressable = (channel === 0x01);
  const ledCount = (speedOrLeds >= 1 && speedOrLeds <= 20) ? speedOrLeds : 7;

  if (!isAddressable) {
    // Channel 0x00: Mainboard Fixed Zone (Starts at LED 0, spans ledCount LEDs)
    const mask = ((1 << ledCount) - 1) & 0xFFFF;
    buf[2] = (mask >> 8) & 0xFF;
    buf[3] = mask & 0xFF;
    buf[4] = 0x00;

    for (let i = 0; i < ledCount && (5 + i * 3 + 2) < 65; i++) {
      buf[5 + i * 3 + 0] = scaledR & 0xFF;
      buf[5 + i * 3 + 1] = scaledG & 0xFF;
      buf[5 + i * 3 + 2] = scaledB & 0xFF;
    }
  } else {
    // Channel 0x01: Addressable header (Starts after fixed mainboard LEDs, e.g. index 7)
    const startLed = 7;
    const mask = (1 << startLed) & 0xFFFF;
    buf[2] = (mask >> 8) & 0xFF;
    buf[3] = mask & 0xFF;
    buf[4] = 0x00;

    const offset = 5 + startLed * 3;
    if (offset + 2 < 65) {
      buf[offset + 0] = scaledR & 0xFF;
      buf[offset + 1] = scaledG & 0xFF;
      buf[offset + 2] = scaledB & 0xFF;
    }
  }

  return buf;
}

/**
 * Legacy Color Packet (0x36) builder for compatibility
 */
export function buildColorPacket(channel, r = 255, g = 0, b = 0, ledCount = 8) {
  return buildEffectColorPacket(channel, r, g, b, ledCount, 100);
}

/**
 * Build Direct Mode Enable Packet
 * [0xEC, 0x35, 0x00, 0x00, 0x01, 0x00, ...] (65 bytes)
 */
export function buildDirectModeEnablePacket() {
  const buf = create65ByteBuffer();
  buf[1] = 0x35;
  buf[2] = 0x00;
  buf[3] = 0x00;
  buf[4] = 0x01; // Enable direct software control
  buf[5] = 0x00;
  return buf;
}

/**
 * Build Direct Mode RGB Stream Packet
 * [0xEC, 0x40, (latch ? 0x80 : 0x00) | <channel>, <start_led>, <led_count>, R0, G0, B0, R1, G1, B1, ...] (65 bytes)
 * Bit 0x80 on byte 2 triggers immediate hardware latch
 *
 * @param {number} channel - 0x04 (Mainboard Fixed Zone) or 0x00 (Addressable Header 1)
 * @param {number} startLed - starting LED index (0-indexed)
 * @param {Array<{r: number, g: number, b: number}|string>} leds - array of RGB objects or hex strings (up to 20 per packet)
 * @param {boolean} latch - whether to trigger immediate hardware latch (bit 0x80)
 * @param {number} brightness - 0-100% or 0-255 software brightness scale (default 100)
 */
export function buildDirectColorPacket(channel = 0x04, startLed = 0, leds = [], latch = true, brightness = 100) {
  const brt = brightness !== undefined ? Number(brightness) : 100;
  const scale = brt > 100 ? (brt / 255) : (Math.max(0, Math.min(100, brt)) / 100);

  const buf = create65ByteBuffer();
  buf[1] = 0x40;
  buf[2] = ((latch ? 0x80 : 0x00) | (channel & 0x7F)) & 0xFF;
  buf[3] = startLed & 0xFF;
  const count = Math.min(leds.length, 20); // 20 LEDs * 3 bytes + 5 header bytes = 65 bytes max
  buf[4] = count & 0xFF;

  for (let i = 0; i < count; i++) {
    const rawLed = leds[i];
    const led = normalizeRgb(rawLed, { r: 0, g: 0, b: 0 });
    const offset = 5 + i * 3;
    if (offset + 2 < 65) {
      buf[offset + 0] = Math.round(led.r * scale) & 0xFF;
      buf[offset + 1] = Math.round(led.g * scale) & 0xFF;
      buf[offset + 2] = Math.round(led.b * scale) & 0xFF;
    }
  }
  return buf;
}

/**
 * Build Commit to NVRAM Packet (Persist after shutdown)
 * [0xEC, 0x3F, 0x55, 0x00, ...] (65 bytes)
 */
export function buildCommitPacket() {
  const buf = create65ByteBuffer();
  buf[1] = 0x3F;
  buf[2] = 0x55;
  buf[3] = 0x00;
  return buf;
}

// Strict Hardware VID:PID Guardrails
export const ASUS_VID = 0x0B05;
export const ALLOWED_MB_PIDS = [0x19AF, 0x1939, 0x18F3, 0x1AA6, 0x1BED];

/**
 * B550-F Controller Wrapper
 */
export class B550FAuraController {
  constructor(hidHandle = null, isMock = false, vid = ASUS_VID, pid = 0x19AF) {
    this.hidHandle = hidHandle;
    this.isMock = isMock;
    this.vid = vid;
    this.pid = pid;
    this.name = 'ASUS ROG Strix B550-F Gaming (AURA LED Controller)';
    this.controlMode = 'direct'; // 'direct' or 'effect'

    this.config = {
      valid: false,
      totalMainboardLeds: 7,
      onboardLeds: 5,
      rgbHeaders: 2,
      argbChannels: 1
    };

    // Direct mode state separating Built-in ROG Logo from RGB headers
    this.directSettings = {
      brightness: 100,
      logoMode: 'unified', // 'unified' or 'gradient'
      logoColor: { r: 255, g: 0, b: 0, hex: '#FF0000' },
      logoLeds: [
        { r: 255, g: 0, b: 0, hex: '#FF0000' },
        { r: 255, g: 0, b: 128, hex: '#FF0080' },
        { r: 157, g: 0, b: 255, hex: '#9D00FF' },
        { r: 0, g: 212, b: 255, hex: '#00D4FF' },
        { r: 0, g: 229, b: 163, hex: '#00E5A3' }
      ],
      header1: { r: 0, g: 229, b: 163, hex: '#00E5A3' },
      header2: { r: 0, g: 212, b: 255, hex: '#00D4FF' },
      argbGen2: { r: 157, g: 0, b: 255, hex: '#9D00FF' }
    };

    // Autonomous Hardware Effect state
    this.currentSettings = {
      channel0: { mode: B550F_MODES.STATIC, r: 255, g: 0, b: 0, speed: 0, brightness: 100 },
      channel1: { mode: B550F_MODES.STATIC, r: 0, g: 229, b: 163, speed: 0, brightness: 100 }
    };
  }

  setHandle(handle, vid = ASUS_VID, pid = 0x19AF) {
    this.hidHandle = handle;
    this.vid = vid;
    this.pid = pid;
    this.isMock = !handle;
  }

  /**
   * Strict USB VID:PID allowlist validation guardrail
   * Blocks writes to unsupported devices to protect hardware NVRAM registers from corruption
   */
  validateDeviceGuardrails(buf = null) {
    const numVid = typeof this.vid === 'string' ? parseInt(this.vid, 16) : Number(this.vid);
    const numPid = typeof this.pid === 'string' ? parseInt(this.pid, 16) : Number(this.pid);
    if (numVid !== ASUS_VID || !ALLOWED_MB_PIDS.includes(numPid)) {
      const vidHex = this.vid !== null && this.vid !== undefined ? '0x' + numVid.toString(16).toUpperCase().padStart(4, '0') : 'UNKNOWN';
      const pidHex = this.pid !== null && this.pid !== undefined ? '0x' + numPid.toString(16).toUpperCase().padStart(4, '0') : 'UNKNOWN';
      throw new Error(`[Security Guardrail] Hardware VID:PID validation failed (${vidHex}:${pidHex}). Motherboard writes blocked to prevent NVRAM register corruption on unsupported hardware.`);
    }
    if (buf && (!Buffer.isBuffer(buf) || buf.length !== 65)) {
      throw new Error(`[Security Guardrail] Invalid packet length (${buf ? buf.length : 0} bytes). Motherboard requires exactly 65-byte buffers with Report ID 0xEC.`);
    }
  }

  writePacket(buf, desc = 'Motherboard HID Packet', onPacketSent = null) {
    this.validateDeviceGuardrails(buf);
    if (this.hidHandle && !this.isMock) {
      try {
        this.hidHandle.write(buf);
        this.lastError = null;
      } catch (err) {
        console.warn(`[B550F] HID Write Warning: ${err.message}. Falling back to mock.`);
        this.lastError = err.message;
        this.isMock = true;
      }
    }
    if (onPacketSent) {
      onPacketSent({
        device: 'Motherboard (B550-F)',
        description: desc,
        bytes: formatHex(buf),
        timestamp: new Date().toISOString(),
        raw: Array.from(buf)
      });
    }
    return buf;
  }

  writeAndRead(buf, desc = 'Motherboard HID Write & Read', timeoutMs = 1000, onPacketSent = null) {
    this.writePacket(buf, desc, onPacketSent);
    if (this.hidHandle && !this.isMock) {
      try {
        const resp = this.hidHandle.readTimeout(timeoutMs);
        return resp ? Buffer.from(resp) : null;
      } catch (err) {
        console.warn(`[B550F] HID Read Warning: ${err.message}`);
        this.lastError = err.message;
        return null;
      }
    }
    return null;
  }

  init(onPacketSent = null) {
    // 1. Send Gen1 Initialization Handshake
    const initBuf = buildInitPacket();
    this.writePacket(initBuf, 'Motherboard Gen1 Initialization (0x52 0x53)', onPacketSent);

    // 2. Query Config Table (0xEC 0xB0) and read 0xEC 0x30 response
    const configQuery = buildConfigTablePacket();
    const configResp = this.writeAndRead(configQuery, 'Motherboard Config Table Query (0xB0)', 1000, onPacketSent);
    if (configResp) {
      this.config = parseConfigTable(configResp);
      console.log(`[B550F] Config table received: ${this.config.onboardLeds} onboard ROG logo LEDs, ` +
                  `${this.config.rgbHeaders}x 12V RGB headers (total Channel 0 = ${this.config.totalMainboardLeds} LEDs), ` +
                  `${this.config.argbChannels}x 5V ARGB Gen 2 header.`);
    } else {
      console.log('[B550F] Using default configuration: 5 onboard LEDs, 2x 12V headers, 1x ARGB Gen 2.');
    }

    return initBuf;
  }

  /**
   * Dedicated Direct Mode Lighting Controller (0x40)
   * Separates Built-in ROG I/O Shroud Logo from 12V RGB Headers 1 & 2
   */
  setDirectLighting(options = {}, onPacketSent = null) {
    this.controlMode = 'direct';

    // Normalize and merge options into directSettings
    if (options.logoMode) this.directSettings.logoMode = options.logoMode;
    if (options.logoColor) {
      this.directSettings.logoColor = normalizeRgb(options.logoColor, { r: 255, g: 0, b: 0 });
    }
    if (Array.isArray(options.logoLeds)) {
      this.directSettings.logoLeds = options.logoLeds.map(c => normalizeRgb(c, { r: 255, g: 0, b: 0 }));
    }
    if (options.header1) {
      this.directSettings.header1 = normalizeRgb(options.header1, { r: 0, g: 229, b: 163 });
    }
    if (options.header2) {
      this.directSettings.header2 = normalizeRgb(options.header2, { r: 0, g: 212, b: 255 });
    }
    if (options.argbGen2) {
      this.directSettings.argbGen2 = normalizeRgb(options.argbGen2, { r: 157, g: 0, b: 255 });
    }

    const brt = options.brightness !== undefined
      ? Number(options.brightness)
      : (this.directSettings.brightness !== undefined ? Number(this.directSettings.brightness) : 100);
    this.directSettings.brightness = brt;
    const scale = brt > 100 ? (brt / 255) : (Math.max(0, Math.min(100, brt)) / 100);

    const packetsSent = [];

    // Step 1: Switch controller into Direct Mode (0x35 00 00 01)
    const enableBuf = buildDirectModeEnablePacket();
    this.writePacket(enableBuf, 'Motherboard Switch to Direct Mode (0x35 ... 0x01)', onPacketSent);
    packetsSent.push(enableBuf);

    // Step 2: Mainboard Onboard Fixed Zone (Built-In ROG I/O Shroud Logo)
    // Uses Direct Channel 0x04 (0x84 when latched with 0x80)
    const DIRECT_CHANNEL_MAINBOARD = 0x04;
    const totalMb = Math.max(3, this.config.totalMainboardLeds || 7);
    const logoLedCount = Math.max(1, (this.config.onboardLeds || (totalMb - 2))); // 5 onboard logo LEDs on B550-F

    const hasExternalHeaders = (options.header1 !== undefined || options.header2 !== undefined);
    const ledCount = hasExternalHeaders ? totalMb : logoLedCount;
    const chFixedLeds = new Array(ledCount);

    const isGradient = this.directSettings.logoMode === 'gradient';
    const defaultLogo = this.directSettings.logoColor || { r: 255, g: 0, b: 0 };

    for (let i = 0; i < logoLedCount; i++) {
      let rawColor = defaultLogo;
      if (isGradient && this.directSettings.logoLeds && this.directSettings.logoLeds[i]) {
        rawColor = this.directSettings.logoLeds[i];
      }
      chFixedLeds[i] = normalizeRgb(rawColor, { r: 255, g: 0, b: 0 });
    }

    if (hasExternalHeaders) {
      // 12V RGB Header 1 (index totalMb - 2)
      const h1Idx = totalMb - 2;
      chFixedLeds[h1Idx] = normalizeRgb(this.directSettings.header1, { r: 0, g: 229, b: 163 });

      // 12V RGB Header 2 (index totalMb - 1)
      const h2Idx = totalMb - 1;
      chFixedLeds[h2Idx] = normalizeRgb(this.directSettings.header2, { r: 0, g: 212, b: 255 });
    }

    // Send Mainboard Direct Packet on Channel 0x04 (0x84 latch bit) with brightness scaling
    const ch0Buf = buildDirectColorPacket(DIRECT_CHANNEL_MAINBOARD, 0, chFixedLeds, true, brt);
    const descText = hasExternalHeaders
      ? `Motherboard Direct Ch 0x04 (ROG Logo [${logoLedCount} LEDs] + Headers 1 & 2)`
      : `Motherboard Direct Ch 0x04 (Built-in ROG Logo [${logoLedCount} LEDs])`;
    this.writePacket(ch0Buf, descText, onPacketSent);
    packetsSent.push(ch0Buf);

    // Step 3: Addressable Headers (Channel 0x00 in Direct Mode)
    // Only send if external addressable headers are explicitly requested
    if (options.argbGen2 || options.argbGen2Leds) {
      let ch1Leds = [];
      if (Array.isArray(options.argbGen2Leds) && options.argbGen2Leds.length > 0) {
        ch1Leds = options.argbGen2Leds.map(c => normalizeRgb(c, { r: 157, g: 0, b: 255 }));
      } else {
        const argbColor = normalizeRgb(this.directSettings.argbGen2, { r: 157, g: 0, b: 255 });
        const count = Number(options.argbGen2Count) > 0 ? Number(options.argbGen2Count) : 10;
        ch1Leds = new Array(count).fill(argbColor);
      }

      // Addressable Header 1 uses direct channel 0x00
      const DIRECT_CHANNEL_ARGB1 = 0x00;
      const chunkSize = 20;
      for (let offset = 0; offset < ch1Leds.length; offset += chunkSize) {
        const chunk = ch1Leds.slice(offset, offset + chunkSize);
        const isLast = (offset + chunkSize >= ch1Leds.length);
        const ch1Buf = buildDirectColorPacket(DIRECT_CHANNEL_ARGB1, offset, chunk, isLast, brt);
        this.writePacket(ch1Buf, `Motherboard Direct Ch 0x00 (5V ARGB Gen 2 Header LEDs ${offset}..${offset + chunk.length - 1})`, onPacketSent);
        packetsSent.push(ch1Buf);
      }
    }

    return packetsSent;
  }

  /**
   * Autonomous Hardware Effect Mode Controller (0x35 + 0x36 + 0x3F 0x55)
   */
  setHardwareEffect(channel, mode, r, g, b, speed = 0x00, brightness = 100, onPacketSent = null) {
    this.controlMode = 'effect';

    const normalized = normalizeRgb({ r, g, b }, { r: 255, g: 0, b: 0 });
    const spd = Math.min(255, Math.max(0, Number(speed) || 0));
    const brt = brightness !== undefined ? Number(brightness) : 100;

    // If brightness is set to 0%, either send hardware mode 0x00 (Off) or R=0,G=0,B=0
    const effectiveMode = (brt === 0) ? 0x00 : mode;

    // Effect channel for mainboard is 0x00
    const effChannel = (channel === 0x04) ? 0x00 : (channel & 0xFF);

    // 1. Send Mode Selection Packet (0x35)
    const modeBuf = buildModePacket(effChannel, effectiveMode);
    this.writePacket(modeBuf, `Motherboard Set Effect Mode (Ch: 0x0${effChannel}, Mode: 0x0${effectiveMode})`, onPacketSent);

    // 2. Send Color Payload Packet (0x36)
    const totalLeds = this.config.totalMainboardLeds || 7;
    const colorBuf = buildEffectColorPacket(effChannel, normalized.r, normalized.g, normalized.b, totalLeds, brt);
    this.writePacket(colorBuf, `Motherboard Set Effect Color (0x36, Ch: 0x0${effChannel}, RGB: ${normalized.r},${normalized.g},${normalized.b}, Brt: ${brt}%)`, onPacketSent);

    // 3. Send NVRAM Commit Packet (0x3F 0x55)
    const commitBuf = buildCommitPacket();
    this.writePacket(commitBuf, 'Motherboard Hardware Effect Commit (0x3F 0x55)', onPacketSent);

    if (effChannel === 0x00) {
      this.currentSettings.channel0 = { mode: effectiveMode, r: normalized.r, g: normalized.g, b: normalized.b, speed: spd, brightness: brt };
    } else {
      this.currentSettings.channel1 = { mode: effectiveMode, r: normalized.r, g: normalized.g, b: normalized.b, speed: spd, brightness: brt };
    }

    return modeBuf;
  }

  /**
   * Backwards-compatible setEffect invocation
   */
  setEffect(channel, mode, r, g, b, onPacketSent = null) {
    return this.setHardwareEffect(channel, mode, r, g, b, 0x00, 0xFF, onPacketSent);
  }

  commitToNvram(onPacketSent = null) {
    this.validateDeviceGuardrails();
    const commitBuf = buildCommitPacket();
    return this.writePacket(commitBuf, 'Motherboard Commit to NVRAM (Persist Shutdown)', onPacketSent);
  }
}
