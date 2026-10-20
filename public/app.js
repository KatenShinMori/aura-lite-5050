/**
 * AURA-Lite-5050 Frontend Application State & Controller
 * Supports:
 * - Direct Mode (0x40): Dedicated ROG I/O Shroud logo (Unified + Per-LED gradient) + Headers 1 & 2 + ADD_GEN2
 * - Autonomous Hardware Effects (0x35 + 0x36 + 0x3F 0x55)
 * - USB HID Debug Diagnostics (/api/debug-hid) & Mock Fallback reason display
 * - Gladius III AimPoint & Omni Receiver (0x1ACE) Lighting, 4-Stage DPI, Polling, Battery
 * - Live 65-Byte Packet Inspector & Zero-Footprint NVRAM Commit + Exit
 */

// Mask serial number for privacy & screenshot safety
function maskSerialNumber(sn) {
  if (!sn || typeof sn !== 'string') return '[SN: REDACTED]';
  const clean = sn.trim();
  if (clean === 'MOCK-GLADIUS3' || clean === '[SN: REDACTED]' || clean.startsWith('[SN:')) return '[SN: REDACTED]';
  if (clean === 'AWAKE') return 'AWAKE';
  if (clean.length <= 6) return clean.slice(0, 2) + '****';
  return clean.slice(0, 4) + '****' + clean.slice(-4);
}

// Hex helper: convert hex string to RGB object
function hexToRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

// Convert RGB to hex string
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Preset Gradients for the 5 ROG I/O Shroud Logo LEDs
const GRADIENT_PRESETS = {
  cyberpunk: ['#FF003F', '#E00070', '#9D00FF', '#00A2FF', '#00D4FF'],
  sunset: ['#FF003F', '#FF4B3A', '#FF8C00', '#FFB700', '#FFE600'],
  aurora: ['#00E5A3', '#00D285', '#00D4FF', '#6A00FF', '#9D00FF'],
  fire: ['#A8002A', '#FF003F', '#FF2B00', '#FF6B00', '#FFB700']
};

// App State
const state = {
  motherboard: {
    arch: 'direct', // 'direct' or 'effect'
    direct: {
      logoMode: 'unified', // 'unified' or 'gradient'
      logoUnified: { hex: '#FF0000', r: 255, g: 0, b: 0 },
      logoLeds: [
        { hex: '#FF0000', r: 255, g: 0, b: 0 },
        { hex: '#FF0080', r: 255, g: 0, b: 128 },
        { hex: '#9D00FF', r: 157, g: 0, b: 255 },
        { hex: '#00D4FF', r: 0, g: 212, b: 255 },
        { hex: '#00E5A3', r: 0, g: 229, b: 163 }
      ],
      header1: { hex: '#00E5A3', r: 0, g: 229, b: 163 },
      header2: { hex: '#00D4FF', r: 0, g: 212, b: 255 },
      argbGen2: { hex: '#9D00FF', r: 157, g: 0, b: 255 },
      brightness: 100
    },
    effect: {
      activeChannel: 0,
      channels: {
        0: { mode: 1, hex: '#FF0000', r: 255, g: 0, b: 0, speed: 0, brightness: 100 },
        1: { mode: 1, hex: '#00E5A3', r: 0, g: 229, b: 163, speed: 0, brightness: 100 }
      }
    }
  },
  mouse: {
    lighting: { mode: 0, hex: '#FF0000', r: 255, g: 0, b: 0, brightness: 100 },
    activeDpiStage: 1,
    dpiStages: [
      { dpi: 400, hex: '#FF0000', r: 255, g: 0, b: 0 },
      { dpi: 800, hex: '#0080FF', r: 0, g: 128, b: 255 },
      { dpi: 1600, hex: '#00FF80', r: 0, g: 255, b: 128 },
      { dpi: 3200, hex: '#FFFF00', r: 255, g: 255, b: 0 }
    ],
    pollingRate: 1000,
    sleepTimeout: 3,
    battery: 85,
    charging: false,
    rawSignature: null
  },
  maskSerial: true,
  packets: []
};

// DOM Elements
const elements = {
  // Badges & Header
  mbBadge: document.getElementById('mb-badge'),
  mbBadgeText: document.getElementById('mb-badge-text'),
  mouseBadge: document.getElementById('mouse-badge'),
  mouseBadgeText: document.getElementById('mouse-badge-text'),
  batteryBadge: document.getElementById('battery-badge'),
  battIcon: document.getElementById('batt-icon'),
  batteryText: document.getElementById('battery-text'),
  batteryFill: document.getElementById('battery-fill'),
  batteryLabel: document.getElementById('battery-label'),
  mouseConnMode: document.getElementById('mouse-conn-mode'),
  btnToggleMaskSerial: document.getElementById('btn-toggle-mask-serial'),
  mbChip: document.getElementById('mb-chip'),
  mouseChip: document.getElementById('mouse-chip'),
  btnRefreshStatus: document.getElementById('btn-refresh-status'),
  btnShowDebug: document.getElementById('btn-show-debug'),

  // Mock Alert Banner
  mockAlertBanner: document.getElementById('mock-alert-banner'),
  mockAlertText: document.getElementById('mock-alert-text'),
  btnBannerDebug: document.getElementById('btn-banner-debug'),

  // Architecture Switch
  btnArchDirect: document.getElementById('btn-arch-direct'),
  btnArchEffect: document.getElementById('btn-arch-effect'),
  directControlsPanel: document.getElementById('direct-controls-panel'),
  effectControlsPanel: document.getElementById('effect-controls-panel'),

  // Direct Mode Elements
  btnLogoUnified: document.getElementById('btn-logo-unified'),
  btnLogoGradient: document.getElementById('btn-logo-gradient'),
  logoUnifiedBox: document.getElementById('logo-unified-box'),
  logoGradientBox: document.getElementById('logo-gradient-box'),
  logoUnifiedPicker: document.getElementById('logo-unified-picker'),
  logoUnifiedHex: document.getElementById('logo-unified-hex'),
  logoBrightness: document.getElementById('logo-brightness'),
  logoBrightnessVal: document.getElementById('logo-brightness-val'),

  header1Picker: document.getElementById('header1-picker'),
  header1Hex: document.getElementById('header1-hex'),
  header2Picker: document.getElementById('header2-picker'),
  header2Hex: document.getElementById('header2-hex'),
  argb2Picker: document.getElementById('argb2-picker'),
  argb2Hex: document.getElementById('argb2-hex'),
  btnApplyDirect: document.getElementById('btn-apply-direct'),
  btnCommitMb: document.getElementById('btn-commit-mb'),
  btnCommitMbEffect: document.getElementById('btn-commit-mb-effect'),

  // Hardware Effect Elements
  mbModes: document.getElementById('mb-modes'),
  mbColorPicker: document.getElementById('mb-color-picker'),
  mbColorHex: document.getElementById('mb-color-hex'),
  mbSpeedSelect: document.getElementById('mb-speed-select'),
  mbBrightness: document.getElementById('mb-brightness'),
  mbBrightnessVal: document.getElementById('mb-brightness-val'),
  btnApplyMb: document.getElementById('btn-apply-mb'),

  // Mouse Elements
  mouseLightingModes: document.getElementById('mouse-lighting-modes'),
  mouseColorPicker: document.getElementById('mouse-color-picker'),
  mouseColorHex: document.getElementById('mouse-color-hex'),
  mouseBrightness: document.getElementById('mouse-brightness'),
  brightnessVal: document.getElementById('brightness-val'),
  pollingRateSelect: document.getElementById('polling-rate-select'),
  sleepTimeoutSelect: document.getElementById('sleep-timeout-select'),
  btnApplyMouse: document.getElementById('btn-apply-mouse'),
  btnCommitMouse: document.getElementById('btn-commit-mouse'),
  btnQueryBatt: document.getElementById('btn-query-batt'),

  // Inspector Elements
  pktCountBadge: document.getElementById('packet-count-badge'),
  pktTarget: document.getElementById('pkt-target'),
  pktDesc: document.getElementById('pkt-desc'),
  hexContainer: document.getElementById('hex-grid-container'),
  btnClearInspector: document.getElementById('btn-clear-inspector'),

  // Hero Actions & Modals
  btnCommitAndExit: document.getElementById('btn-commit-and-exit'),
  killModal: document.getElementById('kill-modal'),
  debugModal: document.getElementById('debug-modal'),
  debugModalContent: document.getElementById('debug-modal-content'),
  btnCloseDebug: document.getElementById('btn-close-debug'),
  btnModalCloseDebug: document.getElementById('btn-modal-close-debug'),
  btnRefreshDebug: document.getElementById('btn-refresh-debug')
};

// -----------------------------------------------------------------------------
// API Calls
// -----------------------------------------------------------------------------

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Motherboard Status
    const mb = data.motherboard;
    if (mb) {
      elements.mbBadgeText.textContent = mb.isMock ? 'Motherboard (Mock)' : 'Motherboard (Online)';
      elements.mbBadge.querySelector('.indicator').className = `indicator ${mb.isMock ? 'amber' : 'green'}`;
      elements.mbBadge.title = mb.isMock ? (mb.mockReason || 'Motherboard running in simulated fallback mode') : 'Hardware link active';
      elements.mbChip.textContent = mb.isMock ? 'Simulated Fallback' : `Online (${mb.config?.totalMainboardLeds || 7} LEDs)`;

      if (mb.controlMode === 'effect' && state.motherboard.arch !== 'effect') {
        elements.btnArchEffect.click();
      } else if (mb.controlMode === 'direct' && state.motherboard.arch !== 'direct') {
        elements.btnArchDirect.click();
      }
    }

    // Mouse Status
    const mouse = data.mouse;
    if (mouse) {
      elements.mouseBadgeText.textContent = mouse.isMock ? 'Mouse (Mock)' : `Mouse (${mouse.pid})`;
      elements.mouseBadge.querySelector('.indicator').className = `indicator ${mouse.isMock ? 'amber' : 'green'}`;
      elements.mouseBadge.title = mouse.isMock ? (mouse.mockReason || 'Mouse running in simulated fallback mode') : 'Hardware link active';
      state.mouse.rawSignature = mouse.signature || null;
      state.mouse.name = mouse.name;
      state.mouse.reportId = mouse.reportId;
      const displaySig = mouse.signature
        ? (state.maskSerial ? maskSerialNumber(mouse.signature) : mouse.signature)
        : null;
      const sigText = displaySig ? (displaySig.startsWith('[') ? ` ${displaySig}` : ` [${displaySig}]`) : '';
      elements.mouseConnMode.textContent = mouse.name + ` · Report ID: ${mouse.reportId}${sigText}`;
      elements.mouseChip.textContent = mouse.isMock ? 'Simulated Fallback' : `${mouse.pid} / Report: ${mouse.reportId}`;

      updateBatteryUI(mouse.battery, mouse.charging, mouse.isMock, mouse.status);
    }

    // Check Mock Mode Banner
    if ((mb && mb.isMock) || (mouse && mouse.isMock)) {
      const reasons = [];
      if (mb && mb.isMock) reasons.push(`Motherboard: ${mb.mockReason || 'Hardware handle failed to open'}`);
      if (mouse && mouse.isMock) reasons.push(`Mouse: ${mouse.mockReason || 'Writable interface probe failed'}`);
      elements.mockAlertText.textContent = `Device Fallback to Mock: ${reasons.join(' | ')}`;
      elements.mockAlertBanner.classList.remove('hidden');
    } else {
      elements.mockAlertBanner.classList.add('hidden');
    }

    fetchPackets();
  } catch (err) {
    console.warn('Status fetch error:', err);
  }
}

async function fetchPackets() {
  try {
    const res = await fetch('/api/packets');
    const data = await res.json();
    if (data.packets) {
      renderPackets(data.packets);
    }
  } catch (err) {
    console.warn('Packet fetch error:', err);
  }
}

async function openDebugModal() {
  elements.debugModalContent.textContent = 'Querying USB HID device tree and interface probes...';
  elements.debugModal.classList.remove('hidden');

  try {
    const res = await fetch('/api/debug-hid');
    const data = await res.json();
    elements.debugModalContent.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    elements.debugModalContent.textContent = `Failed to query /api/debug-hid: ${err.message}`;
  }
}

function updateBatteryUI(pct, charging, isMock = false, status = null) {
  const p = Math.max(0, Math.min(100, pct));
  elements.batteryText.textContent = `${p}%`;

  let statusText = '(Awake)';
  if (charging || status === 'charging') {
    statusText = '(Charging ⚡)';
    if (elements.battIcon) elements.battIcon.textContent = '⚡';
  } else if (status === 'asleep') {
    statusText = '(Asleep / Standby 💤)';
    if (elements.battIcon) elements.battIcon.textContent = '💤';
  } else {
    statusText = isMock ? '(Mock Mode)' : '(Awake)';
    if (elements.battIcon) elements.battIcon.textContent = isMock ? '⚡' : '🔋';
  }

  elements.batteryLabel.textContent = `${p}% ${statusText}`;
  elements.batteryFill.style.width = `${p}%`;

  if (isMock) {
    elements.batteryFill.style.background = 'var(--cyber-amber)';
    return;
  }

  if (p < 20) {
    elements.batteryFill.style.background = 'var(--rog-crimson)';
  } else if (p < 50) {
    elements.batteryFill.style.background = 'linear-gradient(90deg, #ffb700, #00e5a3)';
  } else {
    elements.batteryFill.style.background = 'linear-gradient(90deg, #00d4ff, #00e5a3)';
  }
}

// -----------------------------------------------------------------------------
// Packet Inspector Renderer
// -----------------------------------------------------------------------------

function renderPackets(packets) {
  if (!packets || packets.length === 0) return;
  state.packets = packets;
  elements.pktCountBadge.textContent = `Packets: ${packets.length}`;

  const hasRealSerial = state.mouse.rawSignature &&
    state.mouse.rawSignature !== '[SN: REDACTED]' &&
    !state.mouse.rawSignature.startsWith('[SN:') &&
    state.mouse.rawSignature !== 'MOCK-GLADIUS3';

  const formatDesc = (d) => {
    if (!d) return '';
    if (!state.maskSerial) {
      if (hasRealSerial && /Signature:\s*[^\s,;]+/i.test(d)) {
        return d.replace(/Signature:\s*[^\s,;]+/i, `Signature: ${state.mouse.rawSignature}`);
      }
      return d;
    }
    return d.replace(/(?:Signature|Serial|SN):\s*(\[[^\]]+\]|[^\s,;]+)/gi, (match, sn) => {
      const prefix = match.split(':')[0];
      return `${prefix}: ${maskSerialNumber(sn)}`;
    });
  };

  const lastPkt = packets[0];
  elements.pktTarget.textContent = lastPkt.device;
  elements.pktDesc.textContent = formatDesc(lastPkt.description);

  elements.hexContainer.innerHTML = '';

  // Render recent 10 packets
  packets.slice(0, 10).forEach(pkt => {
    const entry = document.createElement('div');
    entry.className = 'packet-entry';
    const isRx = pkt.direction === 'RX' || (pkt.device && (pkt.device.includes('RX') || pkt.device.includes('<-')));
    if (isRx) {
      entry.classList.add('rx');
    }

    const header = document.createElement('div');
    header.className = 'packet-entry-header';
    const dirBadge = isRx
      ? '<span class="pkt-badge pkt-badge-rx">RX &larr;</span> '
      : '<span class="pkt-badge pkt-badge-tx">TX &rarr;</span> ';

    const displayDevice = isRx ? pkt.device.replace(/^RX\s*(?:<-|←)\s*/i, '') : pkt.device;

    header.innerHTML = `
      <span class="packet-entry-device">${dirBadge}${displayDevice}</span>
      <span>${formatDesc(pkt.description)}</span>
      <span>${(pkt.timestamp || '').split('T')[1]?.slice(0, 8) || ''}</span>
    `;

    const dump = document.createElement('div');
    dump.className = 'hex-dump';

    const rawBytes = Array.isArray(pkt.raw) && pkt.raw.length > 0
      ? pkt.raw
      : (pkt.bytes ? pkt.bytes.trim().split(/\s+/).map(h => parseInt(h, 16)) : []);

    const isMotherboard = (pkt.device && pkt.device.toLowerCase().includes('motherboard')) || (rawBytes[0] === 0xEC);

    // Redaction scope: ONLY incoming RX Signature Probe responses, never TX probe padding or Motherboard Direct (0x40)
    const isRxSigResponse = isRx && !isMotherboard && (
      (pkt.description && pkt.description.toLowerCase().includes('signature')) ||
      (pkt.device && pkt.device.toLowerCase().includes('signature')) ||
      ((rawBytes[0] === 0x03 || rawBytes[0] === 0x00) && rawBytes[1] === 0x12 && rawBytes[2] === 0x12 && rawBytes[3] === 0x02)
    );

    rawBytes.forEach((byteVal, idx) => {
      const span = document.createElement('span');
      span.className = 'hex-byte';

      // Live unmasking in UI: if unmasked, display true ASCII byte for RX signature response if raw serial known
      let displayByteVal = byteVal;
      if (!state.maskSerial && isRxSigResponse && hasRealSerial && idx >= 5 && idx < (5 + state.mouse.rawSignature.length)) {
        displayByteVal = state.mouse.rawSignature.charCodeAt(idx - 5);
      }

      // Redaction ONLY triggers on incoming RX Signature Probe responses at byte 9..12 when maskSerial is ON
      const isSerialByteSlot = idx >= 9 && idx <= 12;
      const shouldMaskByte = state.maskSerial && isRxSigResponse && isSerialByteSlot && (byteVal !== 0);

      span.textContent = shouldMaskByte ? '**' : (displayByteVal & 0xFF).toString(16).padStart(2, '0').toUpperCase();

      if (idx === 0 || idx === 1) {
        span.classList.add('opcode');
      } else if (displayByteVal !== 0 && !shouldMaskByte) {
        span.classList.add('nonzero');
      }
      span.title = shouldMaskByte
        ? `Byte ${idx} (0x${idx.toString(16).toUpperCase()}): ** (Masked for Privacy)`
        : `Byte ${idx} (0x${idx.toString(16).toUpperCase()}): 0x${(displayByteVal & 0xFF).toString(16).toUpperCase()}`;
      dump.appendChild(span);
    });

    entry.appendChild(header);
    entry.appendChild(dump);
    elements.hexContainer.appendChild(entry);
  });
}

// -----------------------------------------------------------------------------
// Motherboard Architecture & Zone Controls
// -----------------------------------------------------------------------------

// Switch between Direct Mode (0x40) and Hardware Effects (0x35/0x36)
elements.btnArchDirect.addEventListener('click', () => {
  elements.btnArchDirect.classList.add('active');
  elements.btnArchEffect.classList.remove('active');
  elements.directControlsPanel.classList.remove('hidden');
  elements.effectControlsPanel.classList.add('hidden');
  state.motherboard.arch = 'direct';
});

elements.btnArchEffect.addEventListener('click', () => {
  elements.btnArchEffect.classList.add('active');
  elements.btnArchDirect.classList.remove('active');
  elements.effectControlsPanel.classList.remove('hidden');
  elements.directControlsPanel.classList.add('hidden');
  state.motherboard.arch = 'effect';
});

// Logo Mode Sub-Toggle (Unified vs Per-LED Gradient)
elements.btnLogoUnified.addEventListener('click', () => {
  elements.btnLogoUnified.classList.add('active');
  elements.btnLogoGradient.classList.remove('active');
  elements.logoUnifiedBox.classList.remove('hidden');
  elements.logoGradientBox.classList.add('hidden');
  state.motherboard.direct.logoMode = 'unified';
});

elements.btnLogoGradient.addEventListener('click', () => {
  elements.btnLogoGradient.classList.add('active');
  elements.btnLogoUnified.classList.remove('active');
  elements.logoGradientBox.classList.remove('hidden');
  elements.logoUnifiedBox.classList.add('hidden');
  state.motherboard.direct.logoMode = 'gradient';
});

// Logo Unified Color Inputs
elements.logoUnifiedPicker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.logoUnifiedHex.value = hex;
  const rgb = hexToRgb(hex);
  state.motherboard.direct.logoUnified = { hex, ...rgb };
});

elements.logoUnifiedHex.addEventListener('change', (e) => {
  let hex = e.target.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    elements.logoUnifiedPicker.value = hex;
    const rgb = hexToRgb(hex);
    state.motherboard.direct.logoUnified = { hex: hex.toUpperCase(), ...rgb };
  }
});

// 5 Per-LED Gradient Inputs
[0, 1, 2, 3, 4].forEach(idx => {
  const picker = document.getElementById(`logo-led-${idx}`);
  const hexLabel = document.getElementById(`logo-led-hex-${idx}`);

  picker.addEventListener('input', (e) => {
    const hex = e.target.value.toUpperCase();
    hexLabel.textContent = hex;
    const rgb = hexToRgb(hex);
    state.motherboard.direct.logoLeds[idx] = { hex, ...rgb };
  });
});

// Quick Gradient Presets
document.querySelectorAll('.gradient-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const presetKey = chip.getAttribute('data-gradient');
    const colors = GRADIENT_PRESETS[presetKey];
    if (!colors) return;

    colors.forEach((hex, idx) => {
      const picker = document.getElementById(`logo-led-${idx}`);
      const hexLabel = document.getElementById(`logo-led-hex-${idx}`);
      if (picker && hexLabel) {
        picker.value = hex;
        hexLabel.textContent = hex;
        state.motherboard.direct.logoLeds[idx] = { hex, ...hexToRgb(hex) };
      }
    });
  });
});

// Header 1 inputs
elements.header1Picker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.header1Hex.value = hex;
  state.motherboard.direct.header1 = { hex, ...hexToRgb(hex) };
});
elements.header1Hex.addEventListener('change', (e) => {
  let hex = e.target.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    elements.header1Picker.value = hex;
    state.motherboard.direct.header1 = { hex: hex.toUpperCase(), ...hexToRgb(hex) };
  }
});

// Header 2 inputs
elements.header2Picker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.header2Hex.value = hex;
  state.motherboard.direct.header2 = { hex, ...hexToRgb(hex) };
});
elements.header2Hex.addEventListener('change', (e) => {
  let hex = e.target.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    elements.header2Picker.value = hex;
    state.motherboard.direct.header2 = { hex: hex.toUpperCase(), ...hexToRgb(hex) };
  }
});

// ARGB Gen 2 inputs
elements.argb2Picker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.argb2Hex.value = hex;
  state.motherboard.direct.argbGen2 = { hex, ...hexToRgb(hex) };
});
elements.argb2Hex.addEventListener('change', (e) => {
  let hex = e.target.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    elements.argb2Picker.value = hex;
    state.motherboard.direct.argbGen2 = { hex: hex.toUpperCase(), ...hexToRgb(hex) };
  }
});

// Preset Color Buttons Dispatcher
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const hex = btn.getAttribute('data-hex').toUpperCase();
    const target = btn.getAttribute('data-target');
    const rgb = hexToRgb(hex);

    if (target === 'logo-unified') {
      elements.logoUnifiedPicker.value = hex;
      elements.logoUnifiedHex.value = hex;
      state.motherboard.direct.logoUnified = { hex, ...rgb };
    } else if (target === 'header1') {
      elements.header1Picker.value = hex;
      elements.header1Hex.value = hex;
      state.motherboard.direct.header1 = { hex, ...rgb };
    } else if (target === 'header2') {
      elements.header2Picker.value = hex;
      elements.header2Hex.value = hex;
      state.motherboard.direct.header2 = { hex, ...rgb };
    } else if (target === 'argb2') {
      elements.argb2Picker.value = hex;
      elements.argb2Hex.value = hex;
      state.motherboard.direct.argbGen2 = { hex, ...rgb };
    } else if (target === 'mb-effect') {
      elements.mbColorPicker.value = hex;
      elements.mbColorHex.value = hex;
      const ch = state.motherboard.effect.activeChannel;
      state.motherboard.effect.channels[ch] = {
        ...state.motherboard.effect.channels[ch],
        hex, ...rgb
      };
    } else if (target === 'mouse') {
      elements.mouseColorPicker.value = hex;
      elements.mouseColorHex.value = hex;
      state.mouse.lighting.hex = hex;
      state.mouse.lighting.r = rgb.r;
      state.mouse.lighting.g = rgb.g;
      state.mouse.lighting.b = rgb.b;
    }
  });
});

// Direct Brightness Slider Listener
if (elements.logoBrightness) {
  elements.logoBrightness.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    state.motherboard.direct.brightness = val;
    if (elements.logoBrightnessVal) elements.logoBrightnessVal.textContent = `${val}%`;
  });
}

// Apply Direct Lighting (0x40)
elements.btnApplyDirect.addEventListener('click', async () => {
  elements.btnApplyDirect.textContent = 'Streaming Direct 0x40...';
  try {
    const accordion = document.querySelector('.external-headers-accordion');
    const isAccordionOpen = accordion && accordion.open;
    const payload = {
      logoMode: state.motherboard.direct.logoMode,
      logoColor: state.motherboard.direct.logoUnified,
      logoLeds: state.motherboard.direct.logoLeds,
      brightness: state.motherboard.direct.brightness ?? 100
    };
    if (isAccordionOpen) {
      payload.header1 = state.motherboard.direct.header1;
      payload.header2 = state.motherboard.direct.header2;
      payload.argbGen2 = state.motherboard.direct.argbGen2;
    }

    const res = await fetch('/api/motherboard/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      fetchPackets();
    }
  } catch (err) {
    console.error('Failed to apply Direct Mode lighting:', err);
  } finally {
    elements.btnApplyDirect.textContent = 'Apply Direct Lighting (0x40)';
  }
});

// -----------------------------------------------------------------------------
// Autonomous Hardware Effects Controls (0x35 + 0x36)
// -----------------------------------------------------------------------------

document.querySelectorAll('.tab-switch .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-switch .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const ch = Number(btn.getAttribute('data-channel'));
    state.motherboard.effect.activeChannel = ch;

    const chData = state.motherboard.effect.channels[ch];
    elements.mbColorPicker.value = chData.hex;
    elements.mbColorHex.value = chData.hex.toUpperCase();
    if (elements.mbSpeedSelect) {
      elements.mbSpeedSelect.value = String(chData.speed ?? 0);
    }
    if (elements.mbBrightness) {
      elements.mbBrightness.value = String(chData.brightness ?? 100);
      if (elements.mbBrightnessVal) elements.mbBrightnessVal.textContent = `${chData.brightness ?? 100}%`;
    }

    document.querySelectorAll('#mb-modes .mode-btn').forEach(mBtn => {
      mBtn.classList.toggle('active', Number(mBtn.getAttribute('data-mode')) === chData.mode);
    });
  });
});

document.querySelectorAll('#mb-modes .mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mb-modes .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = Number(btn.getAttribute('data-mode'));
    const ch = state.motherboard.effect.activeChannel;
    state.motherboard.effect.channels[ch].mode = mode;
  });
});

if (elements.mbSpeedSelect) {
  elements.mbSpeedSelect.addEventListener('change', (e) => {
    const ch = state.motherboard.effect.activeChannel;
    state.motherboard.effect.channels[ch].speed = Number(e.target.value);
  });
}

if (elements.mbBrightness) {
  elements.mbBrightness.addEventListener('input', (e) => {
    const ch = state.motherboard.effect.activeChannel;
    const val = Number(e.target.value);
    state.motherboard.effect.channels[ch].brightness = val;
    if (elements.mbBrightnessVal) elements.mbBrightnessVal.textContent = `${val}%`;
  });
}

elements.mbColorPicker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.mbColorHex.value = hex;
  const rgb = hexToRgb(hex);
  const ch = state.motherboard.effect.activeChannel;
  state.motherboard.effect.channels[ch].hex = hex;
  state.motherboard.effect.channels[ch].r = rgb.r;
  state.motherboard.effect.channels[ch].g = rgb.g;
  state.motherboard.effect.channels[ch].b = rgb.b;
});

if (elements.mbColorHex) {
  const updateMbHex = (e) => {
    let hex = e.target.value.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      elements.mbColorPicker.value = hex;
      const rgb = hexToRgb(hex);
      const ch = state.motherboard.effect.activeChannel;
      state.motherboard.effect.channels[ch].hex = hex.toUpperCase();
      state.motherboard.effect.channels[ch].r = rgb.r;
      state.motherboard.effect.channels[ch].g = rgb.g;
      state.motherboard.effect.channels[ch].b = rgb.b;
    }
  };
  elements.mbColorHex.addEventListener('input', updateMbHex);
  elements.mbColorHex.addEventListener('change', updateMbHex);
}

// Apply Hardware Effect
elements.btnApplyMb.addEventListener('click', async () => {
  const ch = state.motherboard.effect.activeChannel;
  const data = state.motherboard.effect.channels[ch];

  try {
    const res = await fetch('/api/motherboard/effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: ch,
        mode: data.mode,
        r: data.r,
        g: data.g,
        b: data.b,
        speed: data.speed ?? 0,
        brightness: data.brightness ?? 100
      })
    });
    const result = await res.json();
    if (result.success) {
      fetchPackets();
    }
  } catch (err) {
    console.error('Failed to apply MB hardware effect:', err);
  }
});

// Commit Motherboard NVRAM
const commitMotherboardNvram = async () => {
  try {
    const res = await fetch('/api/motherboard/commit', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert('Motherboard settings saved to hardware NVRAM! (Persists across shutdown/reboot)');
      fetchPackets();
    }
  } catch (err) {
    console.error('Failed to commit MB NVRAM:', err);
  }
};

elements.btnCommitMb.addEventListener('click', commitMotherboardNvram);
if (elements.btnCommitMbEffect) {
  elements.btnCommitMbEffect.addEventListener('click', commitMotherboardNvram);
}

// -----------------------------------------------------------------------------
// Mouse Controls
// -----------------------------------------------------------------------------

document.querySelectorAll('#mouse-lighting-modes .mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#mouse-lighting-modes .mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mouse.lighting.mode = Number(btn.getAttribute('data-mouse-mode'));
  });
});

elements.mouseColorPicker.addEventListener('input', (e) => {
  const hex = e.target.value.toUpperCase();
  elements.mouseColorHex.value = hex;
  const rgb = hexToRgb(hex);
  state.mouse.lighting.hex = hex;
  state.mouse.lighting.r = rgb.r;
  state.mouse.lighting.g = rgb.g;
  state.mouse.lighting.b = rgb.b;
});

if (elements.mouseColorHex) {
  const updateMouseHex = (e) => {
    let hex = e.target.value.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      elements.mouseColorPicker.value = hex;
      const rgb = hexToRgb(hex);
      state.mouse.lighting.hex = hex.toUpperCase();
      state.mouse.lighting.r = rgb.r;
      state.mouse.lighting.g = rgb.g;
      state.mouse.lighting.b = rgb.b;
    }
  };
  elements.mouseColorHex.addEventListener('input', updateMouseHex);
  elements.mouseColorHex.addEventListener('change', updateMouseHex);
}

elements.mouseBrightness.addEventListener('input', (e) => {
  const level = Number(e.target.value);
  state.mouse.lighting.brightness = level;
  elements.brightnessVal.textContent = `${level}%`;
});

// DPI Stage Box Setup with Sequential Queue & 20ms delays
let dpiActionChain = Promise.resolve();
function queueDpiAction(actionFn) {
  dpiActionChain = dpiActionChain.then(actionFn).catch(err => console.warn('DPI queue error:', err));
  return dpiActionChain;
}

const delayMs = (ms = 20) => new Promise(r => setTimeout(r, ms));

[0, 1, 2, 3].forEach(idx => {
  const slider = document.getElementById(`dpi-slider-${idx}`);
  const display = document.getElementById(`dpi-val-${idx}`);
  const colorPicker = document.getElementById(`dpi-color-${idx}`);
  const box = document.querySelector(`.dpi-stage-box[data-stage="${idx}"]`);

  slider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    display.textContent = `${val} DPI`;
    state.mouse.dpiStages[idx].dpi = val;
  });

  slider.addEventListener('change', () => {
    queueDpiAction(async () => {
      const stage = state.mouse.dpiStages[idx];
      await fetch('/api/mouse/dpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageIndex: idx,
          dpi: stage.dpi,
          r: stage.r,
          g: stage.g,
          b: stage.b
        })
      });
      await delayMs(20);
      if (state.mouse.activeDpiStage === idx) {
        await fetch('/api/mouse/dpi/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageIndex: idx, profile: idx + 1 })
        });
        await delayMs(20);
      }
      await fetch('/api/mouse/commit', { method: 'POST' });
      await fetchPackets();
    });
  });

  colorPicker.addEventListener('input', (e) => {
    const hex = e.target.value.toUpperCase();
    const rgb = hexToRgb(hex);
    state.mouse.dpiStages[idx].hex = hex;
    state.mouse.dpiStages[idx].r = rgb.r;
    state.mouse.dpiStages[idx].g = rgb.g;
    state.mouse.dpiStages[idx].b = rgb.b;
  });

  colorPicker.addEventListener('change', () => {
    queueDpiAction(async () => {
      const stage = state.mouse.dpiStages[idx];
      await fetch('/api/mouse/dpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageIndex: idx,
          dpi: stage.dpi,
          r: stage.r,
          g: stage.g,
          b: stage.b
        })
      });
      await delayMs(20);
      await fetch('/api/mouse/commit', { method: 'POST' });
      await fetchPackets();
    });
  });

  box.addEventListener('click', (e) => {
    if (e.target.tagName.toLowerCase() === 'input') return;
    document.querySelectorAll('.dpi-stage-box').forEach(b => b.classList.remove('active'));
    box.classList.add('active');
    state.mouse.activeDpiStage = idx;

    // Sequentially program stage DPI, switch active profile, and flush to onboard EEPROM
    queueDpiAction(async () => {
      const stage = state.mouse.dpiStages[idx];
      try {
        await fetch('/api/mouse/dpi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stageIndex: idx,
            dpi: stage.dpi,
            r: stage.r,
            g: stage.g,
            b: stage.b
          })
        });
        await delayMs(20);

        await fetch('/api/mouse/dpi/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stageIndex: idx, profile: idx + 1 })
        });
        await delayMs(20);

        await fetch('/api/mouse/commit', { method: 'POST' });
        await fetchPackets();
      } catch (err) {
        console.warn('Failed to switch active DPI stage:', err);
      }
    });
  });
});

elements.pollingRateSelect.addEventListener('change', (e) => {
  state.mouse.pollingRate = Number(e.target.value);
});

elements.sleepTimeoutSelect.addEventListener('change', (e) => {
  state.mouse.sleepTimeout = Number(e.target.value);
});

// Query live battery
elements.btnQueryBatt.addEventListener('click', async () => {
  elements.btnQueryBatt.textContent = 'Probing...';
  try {
    const res = await fetch('/api/mouse/battery');
    const data = await res.json();
    if (data.success) {
      updateBatteryUI(data.battery, data.charging, data.isMock, data.status);
      await fetchPackets();
    }
  } catch (err) {
    console.error('Battery query failed:', err);
  } finally {
    elements.btnQueryBatt.textContent = 'Query Battery';
  }
});

// Apply Mouse Settings (with 25ms delay between consecutive packets over Omni Receiver)
elements.btnApplyMouse.addEventListener('click', async () => {
  elements.btnApplyMouse.textContent = 'Applying...';
  const delay = (ms = 25) => new Promise(r => setTimeout(r, ms));
  try {
    await fetch('/api/mouse/lighting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.mouse.lighting)
    });
    await delay(25);

    for (let i = 0; i < 4; i++) {
      const stage = state.mouse.dpiStages[i];
      await fetch('/api/mouse/dpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageIndex: i,
          dpi: stage.dpi,
          r: stage.r,
          g: stage.g,
          b: stage.b
        })
      });
      await delay(25);
    }

    // Switch active DPI stage
    await fetch('/api/mouse/dpi/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stageIndex: state.mouse.activeDpiStage,
        profile: state.mouse.activeDpiStage + 1
      })
    });
    await delay(25);

    await fetch('/api/mouse/polling-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rateHz: state.mouse.pollingRate })
    });
    await delay(25);

    await fetch('/api/mouse/sleep-timeout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minutes: state.mouse.sleepTimeout,
        lowBatteryWarning: 20
      })
    });
    await delay(25);

    // Commit all mouse settings to onboard EEPROM memory (0x50 0x03)
    await fetch('/api/mouse/commit', { method: 'POST' });

    fetchPackets();
  } catch (err) {
    console.error('Failed to apply mouse settings:', err);
  } finally {
    elements.btnApplyMouse.textContent = 'Apply Mouse Settings';
  }
});

// Commit Mouse Settings Onboard
elements.btnCommitMouse.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/mouse/commit', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert('Settings flushed to mouse onboard EEPROM memory (0x50 0x03)!');
      fetchPackets();
    }
  } catch (err) {
    console.error('Failed to commit mouse settings:', err);
  }
});

// -----------------------------------------------------------------------------
// Debug Diagnostics Modal & Inspector Controls
// -----------------------------------------------------------------------------

elements.btnShowDebug.addEventListener('click', openDebugModal);
elements.btnBannerDebug.addEventListener('click', openDebugModal);
elements.btnRefreshDebug.addEventListener('click', async () => {
  elements.btnRefreshDebug.textContent = 'Probing...';
  try {
    await fetch('/api/rescan', { method: 'POST' });
  } catch (e) {}
  await openDebugModal();
  elements.btnRefreshDebug.textContent = 'Refresh HID Tree';
});
elements.btnCloseDebug.addEventListener('click', () => elements.debugModal.classList.add('hidden'));
elements.btnModalCloseDebug.addEventListener('click', () => elements.debugModal.classList.add('hidden'));

elements.btnClearInspector.addEventListener('click', () => {
  state.packets = [];
  elements.hexContainer.innerHTML = '<div class="hex-empty-state">Inspector cleared. Trigger an action to see new packets.</div>';
  elements.pktCountBadge.textContent = 'Packets: 0';
  elements.pktTarget.textContent = 'None';
  elements.pktDesc.textContent = 'Waiting for hardware interaction...';
});

if (elements.btnToggleMaskSerial) {
  elements.btnToggleMaskSerial.addEventListener('click', () => {
    state.maskSerial = !state.maskSerial;
    elements.btnToggleMaskSerial.textContent = `Mask SN: ${state.maskSerial ? 'ON' : 'OFF'}`;
    elements.btnToggleMaskSerial.classList.toggle('active', state.maskSerial);
    if (state.mouse.rawSignature) {
      const displaySig = state.maskSerial ? maskSerialNumber(state.mouse.rawSignature) : state.mouse.rawSignature;
      const sigText = displaySig ? (displaySig.startsWith('[') ? ` ${displaySig}` : ` [${displaySig}]`) : '';
      elements.mouseConnMode.textContent = (state.mouse.name || 'ASUS ROG Omni Receiver') + ` · Report ID: ${state.mouse.reportId || '0x03'}${sigText}`;
    }
    if (state.packets && state.packets.length > 0) {
      renderPackets(state.packets);
    }
  });
}

elements.btnRefreshStatus.addEventListener('click', async () => {
  elements.btnRefreshStatus.textContent = '⟳ Probing...';
  try {
    await fetch('/api/rescan', { method: 'POST' });
  } catch (e) {}
  await fetchStatus();
  elements.btnRefreshStatus.textContent = '⟳ Sync';
});

// Big Hero Action: Commit to Hardware NVRAM & Terminate Utility
elements.btnCommitAndExit.addEventListener('click', async () => {
  const confirmed = confirm(
    'Save and commit all current settings to hardware NVRAM on both Motherboard and Mouse, and kill the local server process (0% RAM / 0 background tasks)?'
  );

  if (!confirmed) return;

  elements.btnCommitAndExit.disabled = true;
  elements.btnCommitAndExit.style.opacity = '0.5';

  try {
    const res = await fetch('/api/commit-and-exit', { method: 'POST' });
    const result = await res.json();

    if (res.ok && result.status === 'saved_and_terminated') {
      elements.killModal.classList.remove('hidden');
    } else {
      alert(`Commit & Exit failed: ${result.error || 'Server error'}`);
      elements.btnCommitAndExit.disabled = false;
      elements.btnCommitAndExit.style.opacity = '1';
    }
  } catch (err) {
    // Socket close indicates server exited immediately, which is expected success
    elements.killModal.classList.remove('hidden');
  }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  if (elements.btnToggleMaskSerial) {
    elements.btnToggleMaskSerial.classList.toggle('active', state.maskSerial);
  }
  fetchStatus();
  setInterval(fetchPackets, 3000);
  setInterval(fetchStatus, 5000);
});
