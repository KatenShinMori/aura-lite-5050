/**
 * AURA-Lite-5050 Server
 * Zero-Bloat, On-Demand Local Web Controller for Aura and Compatible Hardware
 * Strictly bound to 127.0.0.1:5050 with localhost security & instant self-termination
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeviceManager } from './hid/deviceManager.js';
import { normalizeRgb } from './hid/b550fAura.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5050;
const HOST = '127.0.0.1';

// Strict Localhost Binding Guardrail: Prevent binding to 0.0.0.0 or any external interface
if (HOST !== '127.0.0.1') {
  throw new Error('[Security Guardrail] AURA-Lite-5050 server must bind strictly to 127.0.0.1 (never 0.0.0.0)');
}

// CLI flags (e.g. node server.js --mock)
const isMock = process.argv.includes('--mock');

const app = express();
const deviceManager = new DeviceManager({ mock: isMock });

// Strict Localhost Security & Anti-CSRF Middleware
app.use((req, res, next) => {
  const allowedOrigins = [
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:5050`,
    `http://localhost:5050`
  ];

  const isAllowedOrigin = (orig) => {
    if (!orig) return false;
    if (allowedOrigins.includes(orig)) return true;
    if (process.env.NODE_ENV === 'test' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(orig)) return true;
    return false;
  };

  // 1. Block unauthorized Cross-Origin requests
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    console.warn(`[Security] Blocked unauthorized cross-origin request from: ${origin}`);
    return res.status(403).json({ error: 'Forbidden cross-origin access' });
  }

  // 2. Block cross-site fetch metadata (Sec-Fetch-Site)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite === 'cross-site') {
    console.warn(`[Security] Blocked cross-site request (Sec-Fetch-Site: ${secFetchSite})`);
    return res.status(403).json({ error: 'Forbidden cross-origin access' });
  }

  // 3. Verify Referer if present
  const referer = req.headers.referer;
  let refererOrigin = null;
  if (referer) {
    try {
      const refUrl = new URL(referer);
      refererOrigin = refUrl.origin;
      if (!isAllowedOrigin(refererOrigin)) {
        console.warn(`[Security] Blocked unauthorized referer: ${referer}`);
        return res.status(403).json({ error: 'Forbidden cross-origin access' });
      }
    } catch (e) {
      return res.status(403).json({ error: 'Invalid Referer' });
    }
  }

  // 4. Strict State-Changing Request (POST/PUT/DELETE/PATCH) Validation
  // Mandates that state-changing requests MUST originate from an allowed localhost origin
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
  if (isStateChanging) {
    const requestOrigin = origin || refererOrigin;
    if (!requestOrigin || !isAllowedOrigin(requestOrigin)) {
      console.warn(`[Security] Blocked state-changing request without valid origin: ${requestOrigin || 'NONE'} (${req.method} ${req.path})`);
      return res.status(403).json({ error: 'Forbidden cross-origin access' });
    }
  }

  // 5. Ensure localhost Host header (prevent DNS rebinding)
  const host = req.headers.host;
  const validHost = host && (
    host === `127.0.0.1:${PORT}` ||
    host === `localhost:${PORT}` ||
    host === `127.0.0.1:5050` ||
    host === `localhost:5050` ||
    (process.env.NODE_ENV === 'test' && /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host))
  );

  if (!validHost) {
    console.warn(`[Security] Blocked invalid host header: ${host}`);
    return res.status(403).json({ error: 'Invalid Host' });
  }

  // Anti-clickjacking & strict security headers (no permissive CORS)
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Packet recorder helper
const onPacket = (pkt) => deviceManager.recordPacket(pkt);

// --- REST API ENDPOINTS ---

// 1. Hardware Status
app.get('/api/status', (req, res) => {
  try {
    res.json({
      status: 'online',
      host: `${HOST}:${PORT}`,
      ...deviceManager.getStatus()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1b. Debug HID Diagnostics
app.get('/api/debug-hid', (req, res) => {
  try {
    res.json(deviceManager.getDebugInfo());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Motherboard Dedicated Direct Mode (0x40) Control
app.post('/api/motherboard/direct', (req, res) => {
  try {
    const { logoMode, logoColor, logoLeds, header1, header2, argbGen2, argbGen2Leds, argbGen2Count } = req.body;
    const packets = deviceManager.motherboard.setDirectLighting({
      logoMode,
      logoColor,
      logoLeds,
      header1,
      header2,
      argbGen2,
      argbGen2Leds,
      argbGen2Count
    }, onPacket);
    res.json({
      success: true,
      controlMode: 'direct',
      packetsHex: packets.map(p => p.toString('hex').toUpperCase())
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Motherboard Autonomous Hardware Effect (0x35 + 0x3B + 0x3F 0x55)
app.post('/api/motherboard/effect', (req, res) => {
  try {
    const { channel = 0, mode = 1, speed = 0, brightness = 100 } = req.body;
    let r = req.body.r !== undefined ? req.body.r : 255;
    let g = req.body.g !== undefined ? req.body.g : 0;
    let b = req.body.b !== undefined ? req.body.b : 0;

    if (req.body.color || req.body.hex) {
      const parsed = normalizeRgb(req.body.color || req.body.hex, { r: 255, g: 0, b: 0 });
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
    }

    const effectBuf = deviceManager.motherboard.setHardwareEffect(
      Number(channel), Number(mode), Number(r), Number(g), Number(b), Number(speed), Number(brightness), onPacket
    );
    res.json({
      success: true,
      channel: Number(channel),
      mode: Number(mode),
      r: Number(r),
      g: Number(g),
      b: Number(b),
      speed: Number(speed),
      brightness: Number(brightness),
      packetHex: effectBuf ? effectBuf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Motherboard NVRAM Commit
app.post('/api/motherboard/commit', (req, res) => {
  try {
    const commitBuf = deviceManager.motherboard.commitToNvram(onPacket);
    res.json({
      success: true,
      message: 'Motherboard settings committed to NVRAM',
      packetHex: commitBuf ? commitBuf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Mouse Lighting Control
app.post('/api/mouse/lighting', (req, res) => {
  try {
    const { mode = 0, brightness = 100 } = req.body;
    let r = req.body.r !== undefined ? req.body.r : 255;
    let g = req.body.g !== undefined ? req.body.g : 0;
    let b = req.body.b !== undefined ? req.body.b : 0;

    if (req.body.color || req.body.hex) {
      const parsed = normalizeRgb(req.body.color || req.body.hex, { r: 255, g: 0, b: 0 });
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
    }

    const buf = deviceManager.mouse.setLighting(Number(mode), Number(r), Number(g), Number(b), Number(brightness), onPacket);
    res.json({
      success: true,
      mode: Number(mode),
      r: Number(r),
      g: Number(g),
      b: Number(b),
      brightness: Number(brightness),
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Mouse DPI Stage Control
app.post('/api/mouse/dpi', (req, res) => {
  try {
    const { stageIndex = 0, dpi = 800 } = req.body;
    let r = req.body.r !== undefined ? req.body.r : 255;
    let g = req.body.g !== undefined ? req.body.g : 0;
    let b = req.body.b !== undefined ? req.body.b : 0;

    if (req.body.color || req.body.hex) {
      const parsed = normalizeRgb(req.body.color || req.body.hex, { r: 255, g: 0, b: 0 });
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
    }

    const buf = deviceManager.mouse.setDpiStage(Number(stageIndex), Number(dpi), Number(r), Number(g), Number(b), onPacket);
    res.json({
      success: true,
      stageIndex: Number(stageIndex),
      dpi: Number(dpi),
      r: Number(r),
      g: Number(g),
      b: Number(b),
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Mouse Active DPI Stage Selection (G-Helper Profile Switch)
const handleDpiStageSelect = (req, res) => {
  try {
    const { stageIndex, profile, stage } = req.body;
    let selectedProfile = 1;
    if (profile !== undefined) {
      selectedProfile = Number(profile);
    } else if (stage !== undefined) {
      selectedProfile = Number(stage);
    } else if (stageIndex !== undefined) {
      selectedProfile = Number(stageIndex) + 1;
    }
    const buf = deviceManager.mouse.setActiveDpiStage(selectedProfile, onPacket);
    res.json({
      success: true,
      profile: selectedProfile,
      stageIndex: selectedProfile - 1,
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/api/mouse/dpi/stage', handleDpiStageSelect);
app.post('/api/mouse/dpi-stage', handleDpiStageSelect);

// 6. Mouse Polling Rate
app.post('/api/mouse/polling-rate', (req, res) => {
  try {
    const { rateHz = 1000 } = req.body;
    const buf = deviceManager.mouse.setPollingRate(Number(rateHz), onPacket);
    res.json({
      success: true,
      rateHz,
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Mouse Sleep Timeout
app.post('/api/mouse/sleep-timeout', (req, res) => {
  try {
    const { minutes = 3, lowBatteryWarning = 20 } = req.body;
    const buf = deviceManager.mouse.setSleepTimeout(Number(minutes), Number(lowBatteryWarning), onPacket);
    res.json({
      success: true,
      minutes,
      lowBatteryWarning,
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Mouse Live Battery Query
app.get('/api/mouse/battery', (req, res) => {
  try {
    const batt = deviceManager.mouse.queryBattery(onPacket);
    res.json({
      success: true,
      battery: batt.battery,
      charging: batt.charging,
      status: batt.status,
      isMock: batt.isMock,
      rawHex: batt.rawHex,
      raw: batt.raw,
      packetHex: batt.packetHex
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Mouse Onboard Memory Commit
app.post('/api/mouse/commit', (req, res) => {
  try {
    const buf = deviceManager.mouse.commitToOnboard(onPacket);
    res.json({
      success: true,
      message: 'Mouse settings flushed to onboard memory (0x50 0x03)',
      packetHex: buf ? buf.toString('hex').toUpperCase() : ''
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Live Packet Inspector Stream
app.get('/api/packets', (req, res) => {
  try {
    res.json({
      packets: deviceManager.packetHistory
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10b. Force Hardware Rescan
app.post(['/api/rescan', '/api/debug/rescan'], async (req, res) => {
  try {
    console.log('[Server] Triggering hardware re-enumeration...');
    await deviceManager.init();
    res.json({
      success: true,
      status: deviceManager.getStatus(),
      debug: deviceManager.getDebugInfo()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Zero-Footprint Lifecycle: Commit NVRAM to Both Devices & Terminate
app.post('/api/commit-and-exit', (req, res) => {
  console.log('\n[LIFECYCLE] Received Commit & Exit command. Committing hardware NVRAM...');
  try {
    // 1. Commit Motherboard NVRAM
    deviceManager.motherboard.commitToNvram(onPacket);

    // 2. Commit Mouse Onboard Memory
    deviceManager.mouse.commitToOnboard(onPacket);

    // 3. Cleanly close all HID devices
    deviceManager.closeAll();

    // 4. Send response to client before exiting
    res.json({
      status: 'saved_and_terminated',
      message: 'Hardware NVRAM committed successfully. Server terminated with 0 background processes.'
    });

    if (process.env.NODE_ENV !== 'test') {
      console.log('[LIFECYCLE] Hardware NVRAM committed. Terminating Node.js process in 300ms...');
      setTimeout(() => {
        console.log('[LIFECYCLE] Process exited. Zero RAM / background footprint.');
        process.exit(0);
      }, 300);
    }
  } catch (err) {
    console.error(`[LIFECYCLE] Error during commit-and-exit: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Start listening strictly on 127.0.0.1:5050
let server = null;
const isDirectRun = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith('server.js')
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, HOST, async () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                     AURA-Lite-5050 Local Web Controller                       ║
║        Zero-Bloat Armoury Crate Replacement running on http://${HOST}:${PORT}       ║
║                                                                               ║
║  Hardware Target (Nominative Compatibility):                                  ║
║    - Motherboard: ROG Strix B550-F Gaming (AURA USB 0x0B05:0x19AF/0x1939)     ║
║    - Mouse: ROG Gladius III Wireless AimPoint (Omni 0x1ACE / 2.4G / Wired)   ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

    await deviceManager.init();
    console.log(`[Server] Ready for user control at http://${HOST}:${PORT}`);
  });
}

export { app, server, deviceManager, PORT, HOST };
