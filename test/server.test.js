process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { app, deviceManager } from '../server.js';

test('Server Integration & Localhost Security Suite', async (t) => {
  // Start server on a test port (e.g. 5051)
  const TEST_PORT = 5051;
  const testServer = http.createServer(app);

  await new Promise((resolve) => testServer.listen(TEST_PORT, '127.0.0.1', resolve));

  const makeRequest = (options, postData = null) => {
    return new Promise((resolve, reject) => {
      const headers = { Connection: 'close', ...(options.headers || {}) };
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          ...options,
          headers
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data
              });
            } catch (e) {
              resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (postData) {
        req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
      }
      req.end();
    });
  };

  await t.test('Security: Blocks external cross-origin requests (Origin: http://evil.com)', async () => {
    const res = await makeRequest({
      path: '/api/status',
      method: 'GET',
      headers: {
        Origin: 'http://evil.com',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden cross-origin access');
  });

  await t.test('Security: Blocks cross-site requests with Sec-Fetch-Site: cross-site', async () => {
    const res = await makeRequest({
      path: '/api/status',
      method: 'GET',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden cross-origin access');
  });

  await t.test('Security: Blocks unauthorized Referer header on state-changing requests', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/commit',
        method: 'POST',
        headers: {
          Referer: 'http://evil-attacker.org/malicious-page',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden cross-origin access');
  });

  await t.test('Security: Blocks invalid Host header (prevent DNS rebinding)', async () => {
    const res = await makeRequest({
      path: '/api/status',
      method: 'GET',
      headers: {
        Host: 'evil-host.com'
      }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Invalid Host');
  });

  await t.test('Security: Rejects cross-origin state-changing POST requests with 403 Forbidden', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/commit',
        method: 'POST',
        headers: {
          Origin: 'http://malicious-web-tracker.com',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden cross-origin access');
  });

  await t.test('Security: Blocks state-changing POST requests when Origin and Referer are missing', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/commit',
        method: 'POST',
        headers: {
          Host: `127.0.0.1:${TEST_PORT}`
        }
      }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'Forbidden cross-origin access');
  });

  await t.test('Security: Allows state-changing POST requests with valid Referer header', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/commit',
        method: 'POST',
        headers: {
          Referer: `http://127.0.0.1:5050/`,
          Host: `127.0.0.1:${TEST_PORT}`
        }
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });

  await t.test('Security: Rejects GET requests on hardware rescan endpoint (/api/rescan)', async () => {
    const res = await makeRequest({
      path: '/api/rescan',
      method: 'GET',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    // Since rescan is now app.post, GET returns 404
    assert.equal(res.statusCode, 404);
  });

  await t.test('Security: Allows same-origin localhost requests', async () => {
    const res = await makeRequest({
      path: '/api/status',
      method: 'GET',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'online');
    assert.ok(res.body.motherboard);
    assert.ok(res.body.mouse);
  });

  await t.test('Debug HID API: /api/debug-hid returns complete hardware diagnostic tree', async () => {
    const res = await makeRequest({
      path: '/api/debug-hid',
      method: 'GET',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.allAsusDevices));
    assert.ok(res.body.mouse);
    assert.ok(res.body.motherboard);
  });

  await t.test('Motherboard API: /api/motherboard/direct streams 0x40 separated zone packets', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/direct',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      {
        logoMode: 'unified',
        logoColor: { r: 255, g: 0, b: 63 },
        header1: { r: 0, g: 229, b: 163 },
        header2: { r: 0, g: 212, b: 255 },
        argbGen2: { r: 157, g: 0, b: 255 }
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.controlMode, 'direct');
    assert.ok(Array.isArray(res.body.packetsHex));
    // Check direct enable packet: EC 35 00 00 01
    assert.ok(res.body.packetsHex[0].startsWith('EC35000001'));
    // Check mainboard direct stream packet: EC 40 84 (Channel 0x04 latched)
    assert.ok(res.body.packetsHex[1].startsWith('EC40840007'));
  });

  await t.test('Motherboard API: /api/motherboard/effect applies static mode (0x35 + 0x36)', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/effect',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { channel: 0, mode: 1, r: 255, g: 0, b: 0, speed: 0, brightness: 100 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    // Mode selection packet starts with EC 35 00 00 00 01
    assert.ok(res.body.packetHex.startsWith('EC3500000001'));
  });

  await t.test('Motherboard API: /api/motherboard/commit sends NVRAM packet', async () => {
    const res = await makeRequest({
      path: '/api/motherboard/commit',
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.packetHex.startsWith('EC3F5500'));
  });

  await t.test('Mouse API: /api/mouse/lighting applies lighting packet', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/lighting',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { mode: 0, r: 255, g: 0, b: 63, brightness: 4 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    // Report ID 0x03 or 0x00 followed by 512800000004FF003F
    assert.ok(res.body.packetHex.includes('512800000004FF003F'));
  });

  await t.test('Mouse API: /api/mouse/dpi sets DPI stage 1', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/dpi',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { stageIndex: 1, dpi: 1600, r: 0, g: 255, b: 128 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    // 1600 DPI: (1600-50)/50 = 31 = 0x001F
    assert.ok(res.body.packetHex.includes('513101001F0000FF80'));
  });

  await t.test('Mouse API: /api/mouse/polling-rate sets 1000 Hz', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/polling-rate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { rateHz: 1000 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.packetHex.includes('5131040003'));
  });

  await t.test('Mouse API: /api/mouse/sleep-timeout sets timeout minutes', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/sleep-timeout',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { minutes: 3, lowBatteryWarning: 20 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.packetHex.includes('51370000020014'));
  });

  await t.test('Mouse API: /api/mouse/commit flushes to onboard memory', async () => {
    const res = await makeRequest({
      path: '/api/mouse/commit',
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.packetHex.includes('5003'));
  });

  await t.test('Mouse API: /api/mouse/battery queries battery and returns 65-byte RX buffer and status', async () => {
    const res = await makeRequest({
      path: '/api/mouse/battery',
      method: 'GET',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.battery, 'number');
    assert.equal(typeof res.body.charging, 'boolean');
    assert.equal(typeof res.body.status, 'string');
    assert.ok(res.body.rawHex && res.body.rawHex.length > 0);
  });

  await t.test('Inspector API: /api/packets returns transmitted packet history including RX packets', async () => {
    const res = await makeRequest({
      path: '/api/packets',
      method: 'GET',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.packets));
    assert.ok(res.body.packets.length > 0);
    const rxPkt = res.body.packets.find(p => p.device.includes('RX') || p.direction === 'RX');
    assert.ok(rxPkt, 'Must contain at least one RX packet in inspector');
    assert.ok(rxPkt.device.includes('RX <- Mouse (Gladius III Battery Response)'));
  });

  await t.test('Rescan API: /api/rescan re-enumerates hardware and returns diagnostic status', async () => {
    const res = await makeRequest({
      path: '/api/rescan',
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.status);
    assert.ok(res.body.debug);
  });

  await t.test('Motherboard API: /api/motherboard/direct accepts hex string inputs and gradient logo', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/direct',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      {
        logoMode: 'gradient',
        logoLeds: ['#FF0000', '#FF0080', '#9D00FF', '#00D4FF', '#00E5A3'],
        header1: '#FFFFFF',
        header2: '#FFAA00',
        argbGen2: '#0000FF'
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.packetsHex));
    // Verify Mainboard packet has byte 2 = 0x84 (Channel 0x04 latched)
    assert.ok(res.body.packetsHex[1].startsWith('EC40840007'));
  });

  await t.test('Motherboard API: /api/motherboard/direct isolates built-in ROG logo (5 LEDs) when external headers omitted', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/direct',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      {
        logoMode: 'unified',
        logoColor: '#FF0000',
        brightness: 100
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.packetsHex));
    // Exactly 2 packets: direct enable and Channel 0x04 with 5 LEDs (EC40840005)
    assert.equal(res.body.packetsHex.length, 2);
    assert.ok(res.body.packetsHex[0].startsWith('EC35000001'));
    assert.ok(res.body.packetsHex[1].startsWith('EC40840005'));
  });

  await t.test('Motherboard API: /api/motherboard/effect accepts color hex, speed, and brightness', async () => {
    const res = await makeRequest(
      {
        path: '/api/motherboard/effect',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      {
        channel: 0,
        mode: 2, // Breathing
        color: '#00E5A3',
        speed: 3,
        brightness: 180
      }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mode, 2);
    assert.equal(res.body.r, 0);
    assert.equal(res.body.g, 229);
    assert.equal(res.body.b, 163);
    assert.equal(res.body.speed, 3);
    assert.equal(res.body.brightness, 180);
  });

  await t.test('Mouse API: /api/mouse/lighting accepts pure red hex and 0-100 brightness', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/lighting',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { mode: 0, hex: '#FF0000', brightness: 100 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.r, 255);
    assert.equal(res.body.g, 0);
    assert.equal(res.body.b, 0); // Pure Red, not 63
    assert.equal(res.body.brightness, 100);
  });

  await t.test('Mouse API: /api/mouse/dpi/stage sets active DPI profile (1..4)', async () => {
    const res = await makeRequest(
      {
        path: '/api/mouse/dpi/stage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:5050',
          Host: `127.0.0.1:${TEST_PORT}`
        }
      },
      { stageIndex: 2, profile: 3 }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.profile, 3);
    assert.equal(res.body.stageIndex, 2);
    assert.ok(res.body.packetHex.startsWith('035131090003'));
  });

  await t.test('Lifecycle API: /api/commit-and-exit safely persists NVRAM in test environment', async () => {
    const res = await makeRequest({
      path: '/api/commit-and-exit',
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:5050',
        Host: `127.0.0.1:${TEST_PORT}`
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'saved_and_terminated');
  });

  await new Promise((resolve) => testServer.close(resolve));
});
