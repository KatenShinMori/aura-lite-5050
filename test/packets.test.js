import test from 'node:test';
import assert from 'node:assert/strict';

import {
  B550F_MODES,
  B550F_CHANNELS,
  buildInitPacket,
  buildConfigTablePacket,
  parseConfigTable,
  buildModePacket,
  buildEffectPacket,
  buildEffectColorPacket,
  buildColorPacket,
  buildDirectModeEnablePacket,
  buildDirectColorPacket,
  buildCommitPacket as buildMbCommitPacket,
  formatHex,
  normalizeRgb,
  B550FAuraController
} from '../hid/b550fAura.js';

import {
  MOUSE_MODES,
  MOUSE_POLLING_RATES,
  MOUSE_SLEEP_TIMEOUTS,
  buildProbePacket,
  buildBatteryQueryPacket,
  parseBatteryResponse,
  buildLightingPacket,
  buildDpiPacket,
  buildDpiStageSelectPacket,
  buildPollingRatePacket,
  buildSleepTimeoutPacket,
  buildCommitPacket as buildMouseCommitPacket,
  GladiusAimpointController
} from '../hid/gladiusAimpoint.js';

// =============================================================================
// Motherboard (B550-F Aura) Unit Tests
// =============================================================================

test('Motherboard: All packet builders return exactly 65-byte buffers', () => {
  const init = buildInitPacket();
  const config = buildConfigTablePacket();
  const mode = buildModePacket(B550F_CHANNELS.CHANNEL_0, B550F_MODES.STATIC);
  const effectColor = buildEffectColorPacket(0x00, 255, 0, 0, 7, 100);
  const directEnable = buildDirectModeEnablePacket();
  const directColor = buildDirectColorPacket(B550F_CHANNELS.MAINBOARD, 0, [{ r: 255, g: 0, b: 0 }]);
  const commit = buildMbCommitPacket();

  assert.equal(init.length, 65);
  assert.equal(config.length, 65);
  assert.equal(mode.length, 65);
  assert.equal(effectColor.length, 65);
  assert.equal(directEnable.length, 65);
  assert.equal(directColor.length, 65);
  assert.equal(commit.length, 65);
});

test('Motherboard: buildInitPacket matches Gen1 Aura handshake', () => {
  const buf = buildInitPacket();
  assert.equal(buf[0], 0xEC);
  assert.equal(buf[1], 0x52);
  assert.equal(buf[2], 0x53);
  assert.equal(buf[3], 0x00);
  assert.equal(buf[4], 0x01);
});

test('Motherboard: buildConfigTablePacket and parseConfigTable handle startup query', () => {
  const query = buildConfigTablePacket();
  assert.equal(query[0], 0xEC);
  assert.equal(query[1], 0xB0);
  assert.equal(query[2], 0x00);

  // Mock 65-byte config table response: 5 onboard LEDs, 2 RGB headers, 1 ARGB channel
  const mockResp = Buffer.alloc(65, 0);
  mockResp[0] = 0xEC;
  mockResp[1] = 0x30;
  mockResp[31] = 5; // onboard ROG logo LEDs
  mockResp[33] = 2; // RGB 12V headers
  mockResp[34] = 1; // ARGB Gen 2 header

  const parsed = parseConfigTable(mockResp);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.onboardLeds, 5);
  assert.equal(parsed.rgbHeaders, 2);
  assert.equal(parsed.totalMainboardLeds, 7);
  assert.equal(parsed.argbChannels, 1);
  assert.equal(parsed.mainboardDirectChannel, 0x04);
});

test('Motherboard: buildModePacket encodes OpenRGB 0x35 mode selection properly', () => {
  const bufCh0 = buildModePacket(0x00, B550F_MODES.BREATHING);
  assert.equal(bufCh0[0], 0xEC);
  assert.equal(bufCh0[1], 0x35);
  assert.equal(bufCh0[2], 0x00); // Channel 0
  assert.equal(bufCh0[3], 0x00);
  assert.equal(bufCh0[4], 0x00);
  assert.equal(bufCh0[5], 0x02); // Breathing mode opcode

  const bufCh1 = buildModePacket(0x01, B550F_MODES.RAINBOW);
  assert.equal(bufCh1[0], 0xEC);
  assert.equal(bufCh1[1], 0x35);
  assert.equal(bufCh1[2], 0x01); // Channel 1
  assert.equal(bufCh1[5], 0x04); // Rainbow mode opcode
});

test('Motherboard: buildEffectColorPacket encodes OpenRGB 0x36 color payload with bitmask properly', () => {
  const buf = buildEffectColorPacket(0x00, 255, 64, 32, 7, 100);
  assert.equal(buf[0], 0xEC);
  assert.equal(buf[1], 0x36); // 0x36 instead of 0x3B
  // Channel 0x00 has 7 LEDs: mask = (1 << 7) - 1 = 0x7F
  assert.equal(buf[2], 0x00); // mask >> 8
  assert.equal(buf[3], 0x7F); // mask & 0xFF
  assert.equal(buf[4], 0x00);
  assert.equal(buf[5], 255);  // R
  assert.equal(buf[6], 64);   // G
  assert.equal(buf[7], 32);   // B
});

test('Motherboard: buildEffectColorPacket scales RGB for brightness', () => {
  const buf50 = buildEffectColorPacket(0x00, 255, 0, 0, 7, 50);
  assert.equal(buf50[1], 0x36);
  assert.equal(buf50[5], 128); // 255 * 0.5 rounded
  assert.equal(buf50[6], 0);
  assert.equal(buf50[7], 0);

  const buf0 = buildEffectColorPacket(0x00, 255, 0, 0, 7, 0);
  assert.equal(buf0[5], 0);
  assert.equal(buf0[6], 0);
  assert.equal(buf0[7], 0);
});

test('Motherboard: Direct Mode builders encode 0x35 enable and 0x40 direct color stream with Channel 0x04', () => {
  const enableBuf = buildDirectModeEnablePacket();
  assert.equal(enableBuf[0], 0xEC);
  assert.equal(enableBuf[1], 0x35);
  assert.equal(enableBuf[2], 0x00);
  assert.equal(enableBuf[3], 0x00);
  assert.equal(enableBuf[4], 0x01); // 0x01 enables direct control

  const leds = [
    { r: 255, g: 0, b: 0 },   // LED 0 Pure Red
    { r: 0, g: 229, b: 163 }   // LED 1
  ];
  const streamBuf = buildDirectColorPacket(0x04, 0, leds, true);
  assert.equal(streamBuf[0], 0xEC);
  assert.equal(streamBuf[1], 0x40);
  assert.equal(streamBuf[2], 0x80 | 0x04); // 0x80 latch bit + channel 4 (0x84)
  assert.equal(streamBuf[3], 0x00);        // startLed
  assert.equal(streamBuf[4], 0x02);        // count
  // LED 0
  assert.equal(streamBuf[5], 255);
  assert.equal(streamBuf[6], 0);
  assert.equal(streamBuf[7], 0);
  // LED 1
  assert.equal(streamBuf[8], 0);
  assert.equal(streamBuf[9], 229);
  assert.equal(streamBuf[10], 163);
});

test('Motherboard: buildDirectColorPacket scales RGB for brightness and handles 0%', () => {
  const leds = [{ r: 255, g: 100, b: 50 }];
  const buf50 = buildDirectColorPacket(0x04, 0, leds, true, 50);
  assert.equal(buf50[5], 128);
  assert.equal(buf50[6], 50);
  assert.equal(buf50[7], 25);

  const buf0 = buildDirectColorPacket(0x04, 0, leds, true, 0);
  assert.equal(buf0[5], 0);
  assert.equal(buf0[6], 0);
  assert.equal(buf0[7], 0);
});

test('Motherboard: buildCommitPacket matches NVRAM persist signature', () => {
  const buf = buildMbCommitPacket();
  assert.equal(buf[0], 0xEC);
  assert.equal(buf[1], 0x3F);
  assert.equal(buf[2], 0x55);
  assert.equal(buf[3], 0x00);
});

// =============================================================================
// Mouse (Gladius III AimPoint & Omni Receiver) Unit Tests
// =============================================================================

test('Mouse: All packet builders return exactly 65-byte buffers', () => {
  const probe = buildProbePacket(0x03);
  const battQuery = buildBatteryQueryPacket(0x03);
  const lighting = buildLightingPacket(0x03, MOUSE_MODES.STATIC, 255, 0, 0, 4);
  const dpi = buildDpiPacket(0x03, 0, 800, 255, 0, 0);
  const polling = buildPollingRatePacket(0x03, 0x03);
  const sleep = buildSleepTimeoutPacket(0x03, 3, 20);
  const commit = buildMouseCommitPacket(0x03);

  assert.equal(probe.length, 65);
  assert.equal(battQuery.length, 65);
  assert.equal(lighting.length, 65);
  assert.equal(dpi.length, 65);
  assert.equal(polling.length, 65);
  assert.equal(sleep.length, 65);
  assert.equal(commit.length, 65);
});

test('Mouse: Dynamic Report ID handles 0x03 for Omni (0x1ACE) vs 0x00 for 0x1A72 / 0x1A70', () => {
  const omniLighting = buildLightingPacket(0x03, MOUSE_MODES.STATIC, 255, 255, 255);
  assert.equal(omniLighting[0], 0x03);

  const directLighting = buildLightingPacket(0x00, MOUSE_MODES.STATIC, 255, 255, 255);
  assert.equal(directLighting[0], 0x00);
});

test('Mouse: buildProbePacket encodes [reportId, 0x12, 0x12, 0x02]', () => {
  const buf = buildProbePacket(0x03);
  assert.equal(buf[0], 0x03);
  assert.equal(buf[1], 0x12);
  assert.equal(buf[2], 0x12);
  assert.equal(buf[3], 0x02);
});

test('Mouse: parseBatteryResponse parses battery % and charging state accurately', () => {
  // Full response with reportId: [reportId, 0x12, 0x07, 0, 0, 85, 0, 0, 0, 0, 1, 0, ...]
  const mockResp = Buffer.alloc(65, 0);
  mockResp[0] = 0x03;
  mockResp[1] = 0x12;
  mockResp[2] = 0x07;
  mockResp[5] = 85;  // 85% battery
  mockResp[10] = 1;  // Charging = true

  const parsed = parseBatteryResponse(mockResp);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.battery, 85);
  assert.equal(parsed.charging, true);
  assert.equal(parsed.status, 'charging');

  // Awake non-charging status
  mockResp[10] = 0;
  const parsedAwake = parseBatteryResponse(mockResp);
  assert.equal(parsedAwake.charging, false);
  assert.equal(parsedAwake.status, 'awake');

  // Stripped Report ID response (starts with 0x12 0x07)
  const strippedResp = Buffer.alloc(64, 0);
  strippedResp[0] = 0x12;
  strippedResp[1] = 0x07;
  strippedResp[4] = 72; // battery % at offset 4
  strippedResp[9] = 1;  // charging at offset 9
  const parsedStripped = parseBatteryResponse(strippedResp);
  assert.equal(parsedStripped.valid, true);
  assert.equal(parsedStripped.battery, 72);
  assert.equal(parsedStripped.charging, true);
  assert.equal(parsedStripped.status, 'charging');

  // Standby / Asleep response: [reportId, 0xFF, 0xAA]
  const standbyResp = Buffer.alloc(65, 0);
  standbyResp[0] = 0x03;
  standbyResp[1] = 0xFF;
  standbyResp[2] = 0xAA;
  const parsedStandby = parseBatteryResponse(standbyResp);
  assert.equal(parsedStandby.valid, true);
  assert.equal(parsedStandby.isStandby, true);
  assert.equal(parsedStandby.status, 'asleep');

  // Asleep when 0% battery and not charging
  const zeroBattResp = Buffer.alloc(65, 0);
  zeroBattResp[0] = 0x03;
  zeroBattResp[1] = 0x12;
  zeroBattResp[2] = 0x07;
  zeroBattResp[5] = 0;
  zeroBattResp[10] = 0;
  const parsedZero = parseBatteryResponse(zeroBattResp);
  assert.equal(parsedZero.valid, true);
  assert.equal(parsedZero.battery, 0);
  assert.equal(parsedZero.status, 'asleep');

  // CRITICAL: Stale ACK packets MUST be rejected and NOT return 2% or 3%
  const staleAckRgb = Buffer.alloc(65, 0);
  staleAckRgb[0] = 0x03;
  staleAckRgb[1] = 0x51;
  staleAckRgb[2] = 0x28;
  staleAckRgb[5] = 2; // Old bug took byte 5 as 2%!
  assert.equal(parseBatteryResponse(staleAckRgb).valid, false);

  const staleAckSleep = Buffer.alloc(65, 0);
  staleAckSleep[0] = 0x03;
  staleAckSleep[1] = 0x51;
  staleAckSleep[2] = 0x37;
  staleAckSleep[5] = 2; // 2 min sleep code
  assert.equal(parseBatteryResponse(staleAckSleep).valid, false);

  // Test empty/invalid response
  const invalidResp = Buffer.alloc(1, 0);
  const parsedInvalid = parseBatteryResponse(invalidResp);
  assert.equal(parsedInvalid.valid, false);
});

test('Mouse: GladiusAimpointController queryBattery retains last known battery level when mouse enters sleep', () => {
  // Mock HID handle that queues responses only after write() is called (matching real USB hardware)
  let pendingResponses = [];
  let currentResponse = null;

  const fakeHandle = {
    write: () => {
      currentResponse = pendingResponses.shift() || [];
      return 65;
    },
    readTimeout: () => {
      const resp = currentResponse;
      currentResponse = null;
      return resp || [];
    }
  };

  const controller = new GladiusAimpointController(fakeHandle, 0x03, 0x1ACE, false);
  controller.battery = 91; // Currently awake at 91%
  controller.status = 'awake';

  // 1. Mouse enters standby and returns [0x03, 0xFF, 0xAA] upon query
  const standbyResp = Buffer.alloc(65, 0);
  standbyResp[0] = 0x03;
  standbyResp[1] = 0xFF;
  standbyResp[2] = 0xAA;
  pendingResponses.push(Array.from(standbyResp));

  const res1 = controller.queryBattery();
  assert.equal(res1.battery, 91, 'Must retain 91% battery when entering standby');
  assert.equal(res1.status, 'asleep');
  assert.equal(controller.battery, 91);
  assert.equal(controller.status, 'asleep');

  // 2. Mouse reports 0% battery while asleep [0x03, 0x12, 0x07, 0, 0, 0, ...] upon query
  const zeroBattResp = Buffer.alloc(65, 0);
  zeroBattResp[0] = 0x03;
  zeroBattResp[1] = 0x12;
  zeroBattResp[2] = 0x07;
  zeroBattResp[5] = 0; // 0%
  zeroBattResp[10] = 0; // Not charging
  pendingResponses.push(Array.from(zeroBattResp));

  const res2 = controller.queryBattery();
  assert.equal(res2.battery, 91, 'Must retain 91% battery when RF link reports 0% in sleep');
  assert.equal(res2.status, 'asleep');
  assert.equal(controller.battery, 91);

  // 3. Mouse wakes up and returns live 88% battery upon query
  const wakeResp = Buffer.alloc(65, 0);
  wakeResp[0] = 0x03;
  wakeResp[1] = 0x12;
  wakeResp[2] = 0x07;
  wakeResp[5] = 88; // 88%
  wakeResp[10] = 0;
  pendingResponses.push(Array.from(wakeResp));

  const res3 = controller.queryBattery();
  assert.equal(res3.battery, 88, 'Must update to live 88% battery when mouse wakes up');
  assert.equal(res3.status, 'awake');
  assert.equal(controller.battery, 88);
  assert.equal(controller.status, 'awake');
});

test('Mouse: buildLightingPacket encodes Palm Logo Zone 0x00 correctly', () => {
  const buf = buildLightingPacket(0x03, MOUSE_MODES.COLOR_CYCLE, 255, 0, 128, 3, 0x07);
  assert.equal(buf[0], 0x03);
  assert.equal(buf[1], 0x51);
  assert.equal(buf[2], 0x28);
  assert.equal(buf[3], 0x00); // Zone 0x00 (Logo)
  assert.equal(buf[4], 0x00);
  assert.equal(buf[5], 0x02); // Color Cycle
  assert.equal(buf[6], 3);    // Brightness level
  assert.equal(buf[7], 255);  // R
  assert.equal(buf[8], 0);    // G
  assert.equal(buf[9], 128);  // B
  assert.equal(buf[12], 0x07); // Speed
});

test('Mouse: buildLightingPacket supports 0-100 brightness and pure red default', () => {
  const buf100 = buildLightingPacket(0x03, MOUSE_MODES.STATIC, 255, 0, 0, 100);
  assert.equal(buf100[6], 100); // 0x64
  assert.equal(buf100[7], 255);
  assert.equal(buf100[8], 0);
  assert.equal(buf100[9], 0);

  const bufDefault = buildLightingPacket(0x03);
  assert.equal(bufDefault[6], 100);
  assert.equal(bufDefault[7], 255);
  assert.equal(bufDefault[8], 0);
  assert.equal(bufDefault[9], 0); // Pure Red default
});

test('Mouse: buildDpiStageSelectPacket encodes [reportId, 0x51, 0x31, 0x09, 0x00, profile]', () => {
  const buf1 = buildDpiStageSelectPacket(0x03, 1);
  assert.equal(buf1[0], 0x03);
  assert.equal(buf1[1], 0x51);
  assert.equal(buf1[2], 0x31);
  assert.equal(buf1[3], 0x09);
  assert.equal(buf1[4], 0x00);
  assert.equal(buf1[5], 0x01);

  const buf4 = buildDpiStageSelectPacket(0x03, 4);
  assert.equal(buf4[5], 0x04);
});

test('Mouse: buildDpiPacket encodes (DPI - 50) / 50 formula and handles boundary values', () => {
  // Test 100 DPI (minimum)
  // (100 - 50) / 50 = 1 = 0x0001
  const buf100 = buildDpiPacket(0x03, 0, 100, 255, 0, 0);
  assert.equal(buf100[0], 0x03);
  assert.equal(buf100[1], 0x51);
  assert.equal(buf100[2], 0x31);
  assert.equal(buf100[3], 0); // Stage 0
  assert.equal(buf100[5], 0x01); // Low byte
  assert.equal(buf100[6], 0x00); // High byte

  // Test 800 DPI
  // (800 - 50) / 50 = 15 = 0x000F
  const buf800 = buildDpiPacket(0x03, 1, 800, 0, 128, 255);
  assert.equal(buf800[3], 1); // Stage 1
  assert.equal(buf800[5], 0x0F);
  assert.equal(buf800[6], 0x00);
  assert.equal(buf800[7], 0);
  assert.equal(buf800[8], 128);
  assert.equal(buf800[9], 255);

  // Test 1600 DPI
  // (1600 - 50) / 50 = 31 = 0x001F
  const buf1600 = buildDpiPacket(0x03, 2, 1600);
  assert.equal(buf1600[5], 0x1F);
  assert.equal(buf1600[6], 0x00);

  // Test 36,000 DPI (maximum sensor limit)
  // (36000 - 50) / 50 = 719 = 0x02CF
  const buf36k = buildDpiPacket(0x03, 3, 36000);
  assert.equal(buf36k[5], 0xCF); // 719 & 0xFF
  assert.equal(buf36k[6], 0x02); // 719 >> 8

  // Clamping test: values exceeding 36000 clamped to 36000
  const bufExcess = buildDpiPacket(0x03, 0, 50000);
  assert.equal(bufExcess[5], 0xCF);
  assert.equal(bufExcess[6], 0x02);

  // Clamping test: values below 100 clamped to 100
  const bufUnder = buildDpiPacket(0x03, 0, 20);
  assert.equal(bufUnder[5], 0x01);
  assert.equal(bufUnder[6], 0x00);
});

test('Mouse: buildPollingRatePacket encodes rate codes accurately', () => {
  assert.equal(buildPollingRatePacket(0x03, 0x00)[5], 0x00); // 125 Hz
  assert.equal(buildPollingRatePacket(0x03, 0x01)[5], 0x01); // 250 Hz
  assert.equal(buildPollingRatePacket(0x03, 0x02)[5], 0x02); // 500 Hz
  assert.equal(buildPollingRatePacket(0x03, 0x03)[5], 0x03); // 1000 Hz
});

test('Mouse: buildSleepTimeoutPacket maps minute codes and never-sleep (0xFF)', () => {
  assert.equal(buildSleepTimeoutPacket(0x03, 1)[5], 0x00);
  assert.equal(buildSleepTimeoutPacket(0x03, 2)[5], 0x01);
  assert.equal(buildSleepTimeoutPacket(0x03, 3)[5], 0x02);
  assert.equal(buildSleepTimeoutPacket(0x03, 5)[5], 0x03);
  assert.equal(buildSleepTimeoutPacket(0x03, 10)[5], 0x04);
  assert.equal(buildSleepTimeoutPacket(0x03, 0)[5], 0xFF); // Never
  assert.equal(buildSleepTimeoutPacket(0x03, 'never')[5], 0xFF); // Never
});

test('Mouse: buildCommitPacket encodes [reportId, 0x50, 0x03]', () => {
  const buf = buildMouseCommitPacket(0x03);
  assert.equal(buf[0], 0x03);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x03);
});

test('FormatHex utility outputs cleanly formatted hex string', () => {
  const buf = Buffer.from([0xEC, 0x35, 0x00, 0xFF]);
  assert.equal(formatHex(buf), 'EC 35 00 FF');
});

// =============================================================================
// Edge Cases, Normalization & Slot Allocation Tests
// =============================================================================

test('Motherboard: normalizeRgb handles 3-char, 6-char, array, object, and clamping', () => {
  // 3-char hex with #
  assert.deepEqual(normalizeRgb('#F03'), { r: 255, g: 0, b: 51 });
  // 6-char hex with #
  assert.deepEqual(normalizeRgb('#00E5A3'), { r: 0, g: 229, b: 163 });
  // 6-char hex without #
  assert.deepEqual(normalizeRgb('00D4FF'), { r: 0, g: 212, b: 255 });
  // Array [r, g, b]
  assert.deepEqual(normalizeRgb([255, 128, 0]), { r: 255, g: 128, b: 0 });
  // Object with { hex }
  assert.deepEqual(normalizeRgb({ hex: '#FF003F' }), { r: 255, g: 0, b: 63 });
  // Object with { color }
  assert.deepEqual(normalizeRgb({ color: '#00E5A3' }), { r: 0, g: 229, b: 163 });
  // Object with { r, g, b } and clamping
  assert.deepEqual(normalizeRgb({ r: 999, g: -20, b: 128.8 }), { r: 255, g: 0, b: 129 });
  // Object with { red, green, blue }
  assert.deepEqual(normalizeRgb({ red: 10, green: 20, blue: 30 }), { r: 10, g: 20, b: 30 });
  // Null / undefined falls back to default
  assert.deepEqual(normalizeRgb(null, { r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
  assert.deepEqual(normalizeRgb(undefined, { r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
  assert.deepEqual(normalizeRgb('invalid-hex', { r: 1, g: 2, b: 3 }), { r: 1, g: 2, b: 3 });
});

test('Motherboard: parseConfigTable handles 64-byte response (report ID stripped) and short responses', () => {
  // 64-byte response starting with 0x30 (report ID 0xEC stripped)
  const mockResp64 = Buffer.alloc(64, 0);
  mockResp64[0] = 0x30;
  mockResp64[30] = 5; // onboard LEDs (31 - 1)
  mockResp64[32] = 2; // RGB headers (33 - 1)
  mockResp64[33] = 1; // ARGB channel (34 - 1)

  const parsed64 = parseConfigTable(mockResp64);
  assert.equal(parsed64.valid, true);
  assert.equal(parsed64.onboardLeds, 5);
  assert.equal(parsed64.rgbHeaders, 2);
  assert.equal(parsed64.totalMainboardLeds, 7);
  assert.equal(parsed64.argbChannels, 1);

  // Short response
  const shortResp = Buffer.alloc(20, 0);
  const parsedShort = parseConfigTable(shortResp);
  assert.equal(parsedShort.valid, false);
  assert.equal(parsedShort.totalMainboardLeds, 7);
});

test('Motherboard: buildDirectColorPacket supports hex string array directly', () => {
  const hexLeds = ['#FF0000', '#00FF00', '#0000FF'];
  const buf = buildDirectColorPacket(0x00, 0, hexLeds, true);
  assert.equal(buf[0], 0xEC);
  assert.equal(buf[1], 0x40);
  assert.equal(buf[2], 0x80); // Latch bit + Ch 0
  assert.equal(buf[3], 0);    // startLed
  assert.equal(buf[4], 3);    // count
  // LED 0: Red
  assert.equal(buf[5], 255);
  assert.equal(buf[6], 0);
  assert.equal(buf[7], 0);
  // LED 1: Green
  assert.equal(buf[8], 0);
  assert.equal(buf[9], 255);
  assert.equal(buf[10], 0);
  // LED 2: Blue
  assert.equal(buf[11], 0);
  assert.equal(buf[12], 0);
  assert.equal(buf[13], 255);
});

test('Motherboard: setDirectLighting allocates Channel 0x04 slots strictly (0..4 logo, 5 header1, 6 header2)', () => {
  const mb = new B550FAuraController(null, true);
  mb.config = {
    valid: true,
    totalMainboardLeds: 7,
    onboardLeds: 5,
    rgbHeaders: 2,
    argbChannels: 1
  };

  const packets = mb.setDirectLighting({
    logoMode: 'gradient',
    logoLeds: [
      '#FF0000', // LED 0 (Wing)
      '#FF0080', // LED 1 (Eye)
      '#9D00FF', // LED 2 (Mid)
      '#00D4FF', // LED 3 (Edge)
      '#00E5A3'  // LED 4 (Tail)
    ],
    header1: '#FFFFFF', // Index 5 (Header 1)
    header2: '#FFAA00', // Index 6 (Header 2)
    argbGen2: '#0000FF',
    argbGen2Count: 5
  });

  // Packets: [0] = Direct Enable (0x35), [1] = Mainboard (0x40 Ch 0x04), [2] = ARGB (0x40 Ch 0x00)
  assert.equal(packets.length, 3);

  const ch0 = packets[1];
  assert.equal(ch0[0], 0xEC);
  assert.equal(ch0[1], 0x40);
  assert.equal(ch0[2], 0x84); // 0x80 latch bit + Channel 4 (0x84)
  assert.equal(ch0[3], 0);    // startLed 0
  assert.equal(ch0[4], 7);    // 7 total LEDs

  // Check LED 0 (Logo LED 0: #FF0000)
  assert.equal(ch0[5], 255);
  assert.equal(ch0[6], 0);
  assert.equal(ch0[7], 0);

  // Check LED 4 (Logo LED 4: #00E5A3)
  assert.equal(ch0[5 + 4 * 3 + 0], 0);
  assert.equal(ch0[5 + 4 * 3 + 1], 229);
  assert.equal(ch0[5 + 4 * 3 + 2], 163);

  // Check LED 5 (Header 1: #FFFFFF)
  assert.equal(ch0[5 + 5 * 3 + 0], 255);
  assert.equal(ch0[5 + 5 * 3 + 1], 255);
  assert.equal(ch0[5 + 5 * 3 + 2], 255);

  // Check LED 6 (Header 2: #FFAA00)
  assert.equal(ch0[5 + 6 * 3 + 0], 255);
  assert.equal(ch0[5 + 6 * 3 + 1], 170);
  assert.equal(ch0[5 + 6 * 3 + 2], 0);
});

test('Motherboard: setDirectLighting chunks Channel 0x00 into 20-LED packets with final latch', () => {
  const mb = new B550FAuraController(null, true);
  // Request 25 ARGB LEDs on Addressable Header
  const packets = mb.setDirectLighting({
    logoColor: '#FF003F',
    header1: '#00E5A3',
    header2: '#00D4FF',
    argbGen2: '#9D00FF',
    argbGen2Count: 25
  });

  // Packets: [0] = Direct Enable, [1] = Ch 0x04 (7 LEDs), [2] = ARGB Chunk 1 (20 LEDs), [3] = ARGB Chunk 2 (5 LEDs)
  assert.equal(packets.length, 4);

  const chunk1 = packets[2];
  assert.equal(chunk1[0], 0xEC);
  assert.equal(chunk1[1], 0x40);
  assert.equal(chunk1[2], 0x00); // Channel 0, latch = false (0x80 not set)
  assert.equal(chunk1[3], 0);    // startLed = 0
  assert.equal(chunk1[4], 20);   // count = 20

  const chunk2 = packets[3];
  assert.equal(chunk2[0], 0xEC);
  assert.equal(chunk2[1], 0x40);
  assert.equal(chunk2[2], 0x80); // Channel 0, latch = true (0x80 set)
  assert.equal(chunk2[3], 20);   // startLed = 20
  assert.equal(chunk2[4], 5);    // count = 5
});

test('Motherboard: setDirectLighting targets only 5 built-in logo LEDs when external headers are omitted', () => {
  const mb = new B550FAuraController(null, true);
  mb.config = {
    valid: true,
    totalMainboardLeds: 7,
    onboardLeds: 5,
    rgbHeaders: 2,
    argbChannels: 1
  };

  // Only pass logo settings, omit header1, header2, argbGen2
  const packets = mb.setDirectLighting({
    logoMode: 'unified',
    logoColor: '#FF0000',
    brightness: 100
  });

  // Exactly 2 packets: [0] = Direct Enable (0x35), [1] = Mainboard (0x40 Ch 0x04)
  assert.equal(packets.length, 2);

  const ch0 = packets[1];
  assert.equal(ch0[0], 0xEC);
  assert.equal(ch0[1], 0x40);
  assert.equal(ch0[2], 0x84); // Channel 0x04 latched
  assert.equal(ch0[3], 0);    // startLed = 0
  assert.equal(ch0[4], 5);    // Exactly 5 onboard logo LEDs, no headers

  // All 5 LEDs pure red
  for (let i = 0; i < 5; i++) {
    assert.equal(ch0[5 + i * 3 + 0], 255);
    assert.equal(ch0[5 + i * 3 + 1], 0);
    assert.equal(ch0[5 + i * 3 + 2], 0);
  }
});

test('Mouse: MOUSE_MODES opcodes match G-Helper protocol', () => {
  assert.equal(MOUSE_MODES.STATIC, 0x00);
  assert.equal(MOUSE_MODES.BREATHING, 0x01);
  assert.equal(MOUSE_MODES.COLOR_CYCLE, 0x02);
  assert.equal(MOUSE_MODES.RAINBOW, 0x03);
  assert.equal(MOUSE_MODES.REACTIVE, 0x04);
  assert.equal(MOUSE_MODES.COMET, 0x05);
  assert.equal(MOUSE_MODES.BATTERY_MODE, 0x06);
});

test('Mouse: buildLightingPacket sets speed byte 12 to 0x00 for Static mode and retains speed for animation modes', () => {
  const staticBuf = buildLightingPacket(0x03, MOUSE_MODES.STATIC, 255, 0, 0, 100, 0x07);
  assert.equal(staticBuf[5], 0x00);
  assert.equal(staticBuf[12], 0x00); // Speed must be 0x00 for Static mode

  const breathingBuf = buildLightingPacket(0x03, MOUSE_MODES.BREATHING, 255, 0, 0, 100, 0x07);
  assert.equal(breathingBuf[5], 0x01);
  assert.equal(breathingBuf[12], 0x07); // Speed retained for Breathing

  const rainbowBuf = buildLightingPacket(0x03, MOUSE_MODES.RAINBOW, 255, 0, 0, 100, 0x05);
  assert.equal(rainbowBuf[5], 0x03);
  assert.equal(rainbowBuf[12], 0x05); // Speed retained for Rainbow
});

// =============================================================================
// Security Guardrails & Sanitization Unit Tests
// =============================================================================

test('Motherboard: validateDeviceGuardrails blocks writes when VID or PID is not in allowlist', () => {
  // Invalid Vendor ID
  const mbBadVid = new B550FAuraController(null, true, 0x1234, 0x19AF);
  assert.throws(() => {
    mbBadVid.setHardwareEffect(0, 1, 255, 0, 0);
  }, /Security Guardrail.*Hardware VID:PID validation failed/);

  // Invalid Product ID
  const mbBadPid = new B550FAuraController(null, true, 0x0B05, 0x9999);
  assert.throws(() => {
    mbBadPid.commitToNvram();
  }, /Security Guardrail.*Hardware VID:PID validation failed/);

  // Supported Motherboard (0x0B05:0x19AF and 0x1939) passes guardrails
  const mbGood = new B550FAuraController(null, true, 0x0B05, 0x19AF);
  assert.doesNotThrow(() => {
    mbGood.setDirectLighting({ logoColor: '#FF0000' });
  });
});

test('Mouse: validateDeviceGuardrails blocks writes and NVRAM commit when VID or PID is not in allowlist', () => {
  // Invalid Vendor ID
  const mouseBadVid = new GladiusAimpointController(null, 0x03, 0x1ACE, true, 0x9999);
  assert.throws(() => {
    mouseBadVid.setLighting(0, 255, 0, 0);
  }, /Security Guardrail.*Hardware VID:PID validation failed/);

  // Invalid Product ID
  const mouseBadPid = new GladiusAimpointController(null, 0x03, 0x8888, true, 0x0B05);
  assert.throws(() => {
    mouseBadPid.commitToOnboard();
  }, /Security Guardrail.*Hardware VID:PID validation failed/);

  // Supported Mouse (0x0B05:0x1ACE Omni Receiver) passes guardrails
  const mouseGood = new GladiusAimpointController(null, 0x03, 0x1ACE, true, 0x0B05);
  assert.doesNotThrow(() => {
    mouseGood.setLighting(0, 255, 0, 0);
  });
});

test('Mouse: probeSignature mock fallback returns [SN: REDACTED] placeholder', () => {
  const mouseMock = new GladiusAimpointController(null, 0x03, 0x1ACE, true, 0x0B05);
  const sig = mouseMock.probeSignature();
  assert.equal(sig.signature, '[SN: REDACTED]');
});

test('Motherboard: validateDeviceGuardrails rejects buffers with invalid lengths', () => {
  const mb = new B550FAuraController(null, true, 0x0B05, 0x19AF);
  const shortBuf = Buffer.alloc(32, 0);
  assert.throws(() => {
    mb.validateDeviceGuardrails(shortBuf);
  }, /Security Guardrail.*Invalid packet length/);

  const longBuf = Buffer.alloc(70, 0);
  assert.throws(() => {
    mb.validateDeviceGuardrails(longBuf);
  }, /Security Guardrail.*Invalid packet length/);
});

test('Mouse: validateDeviceGuardrails rejects buffers with invalid lengths', () => {
  const mouse = new GladiusAimpointController(null, 0x03, 0x1ACE, true, 0x0B05);
  const shortBuf = Buffer.alloc(10, 0);
  assert.throws(() => {
    mouse.validateDeviceGuardrails(shortBuf);
  }, /Security Guardrail.*Invalid packet length/);
});

test('Motherboard & Mouse: validateDeviceGuardrails normalizes hex string VID and PID formats', () => {
  const mbStr = new B550FAuraController(null, true, '0x0B05', '0x19AF');
  assert.doesNotThrow(() => {
    mbStr.validateDeviceGuardrails();
  });

  const mouseStr = new GladiusAimpointController(null, 0x03, '0x1ACE', true, '0x0B05');
  assert.doesNotThrow(() => {
    mouseStr.validateDeviceGuardrails();
  });
});

test('Mouse: probeSignature sanitizes middle serial bytes in onPacketSent log to prevent terminal leakage', () => {
  // Mock handle returning hardware-like probe response with synthetic serial "MOCK12345678"
  const fakeResp = Buffer.alloc(65, 0);
  fakeResp[0] = 0x03;
  fakeResp[1] = 0x12;
  fakeResp[2] = 0x12;
  fakeResp[3] = 0x02;
  fakeResp.set(Buffer.from('MOCK12345678', 'ascii'), 5);

  const fakeHandle = {
    write: () => 65,
    readTimeout: () => Array.from(fakeResp)
  };

  const mouse = new GladiusAimpointController(fakeHandle, 0x03, 0x1ACE, false, 0x0B05);
  let loggedPacket = null;
  const sig = mouse.probeSignature((pkt) => {
    if (pkt.direction === 'RX') loggedPacket = pkt;
  });

  assert.equal(sig.signature, 'MOCK12345678');
  assert.ok(loggedPacket, 'Must record RX packet');
  assert.equal(loggedPacket.description, 'Signature: MOCK****5678');
  // Check that middle 4 ASCII characters (bytes 9..12) were sanitized to '*' (0x2A) in raw bytes
  assert.equal(loggedPacket.raw[9], 0x2A);
  assert.equal(loggedPacket.raw[10], 0x2A);
  assert.equal(loggedPacket.raw[11], 0x2A);
  assert.equal(loggedPacket.raw[12], 0x2A);
  // Head and tail remain intact
  assert.equal(loggedPacket.raw[5], 0x4D); // 'M'
  assert.equal(loggedPacket.raw[6], 0x4F); // 'O'
  assert.equal(loggedPacket.raw[15], 0x37); // '7'
  assert.equal(loggedPacket.raw[16], 0x38); // '8'
});

test('Packet Inspector: TX probe packets retain 0x00 padding and are never masked as serial bytes', () => {
  const probeBuf = buildProbePacket(0x03);
  assert.equal(probeBuf[0], 0x03);
  assert.equal(probeBuf[1], 0x12);
  assert.equal(probeBuf[2], 0x12);
  assert.equal(probeBuf[3], 0x02);
  // Bytes 9..12 must remain 0x00
  assert.equal(probeBuf[9], 0x00);
  assert.equal(probeBuf[10], 0x00);
  assert.equal(probeBuf[11], 0x00);
  assert.equal(probeBuf[12], 0x00);
});

test('Packet Inspector: Motherboard Direct Mode (0x40) packets retain RGB payload at bytes 9..12 without masking', () => {
  const directPacket = buildDirectColorPacket(0x84, 5, [
    { r: 0xFF, g: 0x00, b: 0x00 },
    { r: 0x12, g: 0x34, b: 0x56 },
    { r: 0x78, g: 0x9A, b: 0xBC }
  ]);
  assert.equal(directPacket[0], 0xEC);
  assert.equal(directPacket[1], 0x40);
  assert.equal(directPacket[9], 0x34);
  assert.equal(directPacket[10], 0x56);
  assert.equal(directPacket[11], 0x78);
  assert.equal(directPacket[12], 0x9A);
});

// Helper simulating public/app.js hex grid byte formatting logic
function formatInspectorByte(pkt, byteVal, idx, maskSerial, rawSignature = null) {
  const isRx = pkt.direction === 'RX' || (pkt.device && (pkt.device.includes('RX') || pkt.device.includes('<-')));
  const rawBytes = Array.isArray(pkt.raw) && pkt.raw.length > 0
    ? pkt.raw
    : (pkt.bytes ? pkt.bytes.trim().split(/\s+/).map(h => parseInt(h, 16)) : []);

  const isMotherboard = (pkt.device && pkt.device.toLowerCase().includes('motherboard')) || (rawBytes[0] === 0xEC);

  const isRxSigResponse = isRx && !isMotherboard && (
    (pkt.description && pkt.description.toLowerCase().includes('signature')) ||
    (pkt.device && pkt.device.toLowerCase().includes('signature')) ||
    ((rawBytes[0] === 0x03 || rawBytes[0] === 0x00) && rawBytes[1] === 0x12 && rawBytes[2] === 0x12 && rawBytes[3] === 0x02)
  );

  const hasRealSerial = rawSignature &&
    rawSignature !== '[SN: REDACTED]' &&
    !rawSignature.startsWith('[SN:') &&
    rawSignature !== 'MOCK-GLADIUS3';

  let displayByteVal = byteVal;
  if (!maskSerial && isRxSigResponse && hasRealSerial && idx >= 5 && idx < (5 + rawSignature.length)) {
    displayByteVal = rawSignature.charCodeAt(idx - 5);
  }

  const isSerialByteSlot = idx >= 9 && idx <= 12;
  const shouldMaskByte = maskSerial && isRxSigResponse && isSerialByteSlot && (byteVal !== 0);

  return {
    text: shouldMaskByte ? '**' : (displayByteVal & 0xFF).toString(16).padStart(2, '0').toUpperCase(),
    masked: shouldMaskByte
  };
}

test('Packet Inspector Formatting: Outgoing TX probe packets with 00 padding are never masked as **', () => {
  const txPacket = {
    direction: 'TX',
    device: 'Mouse (Gladius III)',
    description: 'Omni Mouse Signature Probe',
    raw: Array.from(buildProbePacket(0x03))
  };

  for (let b = 9; b <= 12; b++) {
    const res = formatInspectorByte(txPacket, txPacket.raw[b], b, true, null);
    assert.equal(res.text, '00', `Byte ${b} must remain 00 in TX probe packet`);
    assert.equal(res.masked, false);
  }
});

test('Packet Inspector Formatting: Motherboard Direct Mode (0x40) packets are never masked', () => {
  const mbPacket = {
    direction: 'TX',
    device: 'Motherboard (B550-F)',
    description: 'Motherboard Direct Ch 0x04',
    raw: Array.from(buildDirectColorPacket(0x84, 5, [
      { r: 0xFF, g: 0x00, b: 0x00 },
      { r: 0x12, g: 0x34, b: 0x56 },
      { r: 0x78, g: 0x9A, b: 0xBC }
    ]))
  };

  assert.equal(formatInspectorByte(mbPacket, mbPacket.raw[9], 9, true).text, '34');
  assert.equal(formatInspectorByte(mbPacket, mbPacket.raw[10], 10, true).text, '56');
  assert.equal(formatInspectorByte(mbPacket, mbPacket.raw[11], 11, true).text, '78');
  assert.equal(formatInspectorByte(mbPacket, mbPacket.raw[12], 12, true).text, '9A');
  assert.equal(formatInspectorByte(mbPacket, mbPacket.raw[9], 9, true).masked, false);
});

test('Packet Inspector Formatting: Incoming RX Signature Probe response redacts bytes 9..12 when Mask SN is ON', () => {
  const rxRaw = new Array(65).fill(0);
  rxRaw[0] = 0x03;
  rxRaw[1] = 0x12;
  rxRaw[2] = 0x12;
  rxRaw[3] = 0x02;
  // Serial "MOCK****5678"
  Buffer.from('MOCK****5678', 'ascii').forEach((c, i) => { rxRaw[5 + i] = c; });

  const rxPacket = {
    direction: 'RX',
    device: 'RX <- Mouse (Gladius III Signature Probe)',
    description: 'Signature: MOCK****5678',
    raw: rxRaw
  };

  // Prefix bytes 5..8 remain unmasked
  assert.equal(formatInspectorByte(rxPacket, rxRaw[5], 5, true).text, '4D'); // 'M'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[6], 6, true).text, '4F'); // 'O'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[7], 7, true).text, '43'); // 'C'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[8], 8, true).text, '4B'); // 'K'

  // Middle bytes 9..12 are redacted as **
  assert.equal(formatInspectorByte(rxPacket, rxRaw[9], 9, true).text, '**');
  assert.equal(formatInspectorByte(rxPacket, rxRaw[10], 10, true).text, '**');
  assert.equal(formatInspectorByte(rxPacket, rxRaw[11], 11, true).text, '**');
  assert.equal(formatInspectorByte(rxPacket, rxRaw[12], 12, true).text, '**');
  assert.equal(formatInspectorByte(rxPacket, rxRaw[9], 9, true).masked, true);

  // Suffix bytes 13..16 remain unmasked
  assert.equal(formatInspectorByte(rxPacket, rxRaw[13], 13, true).text, '35'); // '5'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[14], 14, true).text, '36'); // '6'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[15], 15, true).text, '37'); // '7'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[16], 16, true).text, '38'); // '8'
});

test('Packet Inspector Formatting: Runtime Unmasking displays true ASCII hex when Mask SN is OFF', () => {
  const rxRaw = new Array(65).fill(0);
  rxRaw[0] = 0x03;
  rxRaw[1] = 0x12;
  rxRaw[2] = 0x12;
  rxRaw[3] = 0x02;
  Buffer.from('MOCK****5678', 'ascii').forEach((c, i) => { rxRaw[5 + i] = c; });

  const rxPacket = {
    direction: 'RX',
    device: 'RX <- Mouse (Gladius III Signature Probe)',
    description: 'Signature: MOCK****5678',
    raw: rxRaw
  };

  const fullSerial = 'MOCK12345678';

  // When Mask SN is OFF, bytes 9..12 reveal true unmasked ASCII bytes
  assert.equal(formatInspectorByte(rxPacket, rxRaw[9], 9, false, fullSerial).text, '31'); // '1'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[10], 10, false, fullSerial).text, '32'); // '2'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[11], 11, false, fullSerial).text, '33'); // '3'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[12], 12, false, fullSerial).text, '34'); // '4'
  assert.equal(formatInspectorByte(rxPacket, rxRaw[9], 9, false, fullSerial).masked, false);
});

test('Packet Inspector Formatting: Empty or short serial responses (00 padding at 9..12) are not redacted to **', () => {
  const rxRaw = new Array(65).fill(0);
  rxRaw[0] = 0x03;
  rxRaw[1] = 0x12;
  rxRaw[2] = 0x12;
  rxRaw[3] = 0x02;
  Buffer.from('MOCK', 'ascii').forEach((c, i) => { rxRaw[5 + i] = c; });

  const rxPacket = {
    direction: 'RX',
    device: 'RX <- Mouse (Gladius III Signature Probe)',
    description: 'Signature: MOCK****',
    raw: rxRaw
  };

  for (let b = 9; b <= 12; b++) {
    const res = formatInspectorByte(rxPacket, rxRaw[b], b, true, null);
    assert.equal(res.text, '00', `Byte ${b} with value 00 must not be redacted to **`);
    assert.equal(res.masked, false);
  }
});

test('Packet Inspector Formatting: Mock fallback placeholder [SN: REDACTED] is never unmasked as fake serial bytes', () => {
  const rxRaw = new Array(65).fill(0);
  rxRaw[0] = 0x03;
  rxRaw[1] = 0x12;
  rxRaw[2] = 0x12;
  rxRaw[3] = 0x02;

  const rxPacket = {
    direction: 'RX',
    device: 'RX <- Mouse (Gladius III Signature Probe)',
    description: 'Signature: [SN: REDACTED]',
    raw: rxRaw
  };

  // When rawSignature is the mock string, toggling maskSerial to false does NOT synthesize ASCII chars for bytes 5..18
  for (let b = 5; b <= 16; b++) {
    const res = formatInspectorByte(rxPacket, rxRaw[b], b, false, '[SN: REDACTED]');
    assert.equal(res.text, '00');
  }
});




