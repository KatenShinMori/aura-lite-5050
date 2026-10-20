/**
 * ASUS ROG Device Manager & Smart HID Enumerator
 * - Handles 0x0B05 device discovery
 * - Resolves Omni Receiver (0x1ACE) / SpeedNova (0x1A72) / Wired (0x1A70) interface routing
 * - Iterates candidate interfaces to automatically lock onto working writable endpoints
 * - Guards against Windows exclusive-lock collections (skips 0x0001 / 0x000C)
 * - Queries Motherboard config table (0xEC 0xB0) on startup
 * - Manages graceful fallback & mock mode with detailed debug diagnostics (/api/debug-hid)
 * - Maintains real-time 65-byte packet ring buffer for UI inspector
 */

import HID from 'node-hid';
import { B550FAuraController } from './b550fAura.js';
import { GladiusAimpointController, parseBatteryResponse } from './gladiusAimpoint.js';

// ASUS Vendor ID
export const ASUS_VID = 0x0B05;

// Target Product IDs
export const MOTHERBOARD_PIDS = [0x19AF, 0x1939, 0x18F3, 0x1AA6, 0x1BED];
export const MOUSE_PIDS = {
  OMNI_RECEIVER: 0x1ACE,
  SPEEDNOVA_2_4G: 0x1A72,
  USB_C_WIRED: 0x1A70
};

export class DeviceManager {
  constructor(options = {}) {
    this.forceMock = !!options.mock;
    this.packetHistory = [];
    this.maxPacketHistory = 50;

    // Controllers
    this.motherboard = new B550FAuraController(null, true);
    this.mouse = new GladiusAimpointController(null, 0x03, MOUSE_PIDS.OMNI_RECEIVER, true);

    this.rawMbHandle = null;
    this.rawMouseHandle = null;
    this.mbLockedPath = null;
    this.mbPid = null;
    this.mouseLockedPath = null;

    this.allAsusDevices = [];
    this.scanResults = [];

    this.mouseFallbackReason = null;
    this.motherboardFallbackReason = null;
    this.mouseProbedCandidates = [];
    this.motherboardProbedCandidates = [];
  }

  /**
   * Log packet to history buffer & console
   */
  recordPacket(packetInfo) {
    this.packetHistory.unshift(packetInfo);
    if (this.packetHistory.length > this.maxPacketHistory) {
      this.packetHistory.pop();
    }
    const tag = (packetInfo.direction === 'RX' || (packetInfo.device && packetInfo.device.includes('RX')))
      ? 'PACKET-RX'
      : 'PACKET-TX';
    console.log(`[${tag}] [${packetInfo.device}] ${packetInfo.description}\n  HEX: ${packetInfo.bytes}`);
  }

  /**
   * Enumerate all connected 0x0B05 HID devices, printing EVERY interface to console
   */
  scanDevices(logVerbose = true) {
    let allDevices = [];
    try {
      allDevices = HID.devices();
    } catch (err) {
      console.error(`[DeviceManager] HID.devices() failed: ${err.message}`);
      return [];
    }

    const asusAll = allDevices.filter(d => d.vendorId === ASUS_VID);
    this.allAsusDevices = asusAll;

    if (logVerbose) {
      console.log('\n=================== ASUS ROG HID INTERFACE SCAN ===================');
      console.log(`Found ${asusAll.length} ASUS HID interfaces (VID 0x0B05):`);
      asusAll.forEach((d, idx) => {
        const pidHex = '0x' + (d.productId || 0).toString(16).toUpperCase().padStart(4, '0');
        const upHex = (d.usagePage !== undefined && d.usagePage !== null)
          ? '0x' + d.usagePage.toString(16).toUpperCase().padStart(4, '0')
          : 'N/A';
        const uHex = (d.usage !== undefined && d.usage !== null)
          ? '0x' + d.usage.toString(16).toUpperCase().padStart(4, '0')
          : 'N/A';
        console.log(` [${idx + 1}] PID: ${pidHex} | UsagePage: ${upHex.padEnd(8)} | Usage: ${uHex.padEnd(8)} | Interface: ${d.interface} | Path: ${d.path}`);
      });
      console.log('===================================================================\n');
    }

    // Windows OS Exclusive-Lock Prevention:
    // Skip 0x0001 (Generic Desktop) and 0x000C (Consumer Control) to avoid access violations
    const asusVendorDevices = asusAll.filter(d => {
      if (d.usagePage === 0x0001 || d.usagePage === 0x000C) return false;
      return !d.usagePage || d.usagePage >= 0xFF00;
    });

    this.scanResults = asusVendorDevices;
    return asusVendorDevices;
  }

  /**
   * Initialize hardware handles and configure controller instances
   */
  async init() {
    console.log('[DeviceManager] Initializing AURA-Lite hardware links...');
    this.closeAll();

    const onPacket = (pkt) => this.recordPacket(pkt);

    this.mouseProbedCandidates = [];
    this.motherboardProbedCandidates = [];

    if (this.forceMock) {
      console.log('[DeviceManager] --mock flag active. Running entirely in simulated fallback mode.');
      this.motherboard.setHandle(null, ASUS_VID, 0x19AF);
      this.mouse.setConnection(null, 0x03, MOUSE_PIDS.OMNI_RECEIVER, ASUS_VID);
      this.mouseFallbackReason = 'Started with --mock flag';
      this.motherboardFallbackReason = 'Started with --mock flag';
      return;
    }

    this.scanDevices(true);

    // -------------------------------------------------------------------------
    // 1. Resolve Motherboard Controller (PID 0x19AF, 0x1939, etc.)
    // -------------------------------------------------------------------------
    const mbCandidates = this.allAsusDevices.filter(d =>
      MOTHERBOARD_PIDS.includes(d.productId) &&
      (!d.usagePage || d.usagePage >= 0xFF00)
    );

    let mbHandle = null;

    for (const cand of mbCandidates) {
      let h = null;
      try {
        console.log(`[DeviceManager] Probing Motherboard interface at ${cand.path}...`);
        h = new HID.HID(cand.path);
        this.motherboard.setHandle(h, cand.vendorId || ASUS_VID, cand.productId);
        this.motherboard.init(onPacket);

        if (this.motherboard.isMock) {
          throw new Error('Motherboard write failed during init');
        }

        mbHandle = h;
        this.rawMbHandle = h;
        this.mbLockedPath = cand.path;
        this.mbPid = cand.productId;
        this.motherboardFallbackReason = null;
        console.log(`[DeviceManager] Motherboard online: PID 0x${cand.productId.toString(16).toUpperCase()}`);
        break;
      } catch (err) {
        console.warn(`[DeviceManager] Motherboard probe failed on ${cand.path} (${err.message}).`);
        this.motherboardProbedCandidates.push({
          path: cand.path,
          error: err.message
        });
        if (h) {
          try { h.close(); } catch (e) {}
        }
      }
    }

    if (!mbHandle) {
      this.motherboardFallbackReason = mbCandidates.length === 0
        ? 'No supported ASUS Motherboard detected (PID 0x19AF/0x1939)'
        : `All candidate Motherboard interfaces failed probe: ${this.motherboardProbedCandidates.map(c => c.error).join('; ')}`;
      console.log(`[DeviceManager] Motherboard fallback to mock: ${this.motherboardFallbackReason}`);
      this.motherboard.setHandle(null, ASUS_VID, 0x19AF);
    }

    // -------------------------------------------------------------------------
    // 2. Resolve Mouse Controller (Omni 0x1ACE > Wireless 0x1A72 > Wired 0x1A70)
    // Automatically iterate through all candidate vendor interfaces (>= 0xFF00)
    // across all supported models and probe non-destructively to lock onto
    // the working writable endpoint.
    // -------------------------------------------------------------------------
    const mouseGroups = [
      {
        name: 'ROG Omni Receiver',
        pid: MOUSE_PIDS.OMNI_RECEIVER,
        reportId: 0x03,
        candidates: this.allAsusDevices.filter(d =>
          d.productId === MOUSE_PIDS.OMNI_RECEIVER &&
          (!d.usagePage || d.usagePage >= 0xFF00)
        )
      },
      {
        name: 'SpeedNova 2.4G',
        pid: MOUSE_PIDS.SPEEDNOVA_2_4G,
        reportId: 0x00,
        candidates: this.allAsusDevices.filter(d =>
          d.productId === MOUSE_PIDS.SPEEDNOVA_2_4G &&
          (!d.usagePage || d.usagePage >= 0xFF00)
        )
      },
      {
        name: 'Gladius III Wired',
        pid: MOUSE_PIDS.USB_C_WIRED,
        reportId: 0x00,
        candidates: this.allAsusDevices.filter(d =>
          d.productId === MOUSE_PIDS.USB_C_WIRED &&
          (!d.usagePage || d.usagePage >= 0xFF00)
        )
      }
    ];

    let mouseHandle = null;
    let selectedPid = MOUSE_PIDS.OMNI_RECEIVER;
    let selectedReportId = 0x03;

    for (const group of mouseGroups) {
      if (group.candidates.length === 0) continue;
      console.log(`[DeviceManager] Probing ${group.candidates.length} candidate interfaces for ${group.name} (0x${group.pid.toString(16).toUpperCase()})...`);

      for (const cand of group.candidates) {
        let h = null;
        try {
          h = new HID.HID(cand.path);
          // Non-destructive probe: query battery status [reportId, 0x12, 0x07, ...]
          const probeBuf = Buffer.alloc(65, 0);
          probeBuf[0] = group.reportId;
          probeBuf[1] = 0x12;
          probeBuf[2] = 0x07;

          const bytesWritten = h.write(probeBuf);
          if (bytesWritten > 0) {
            const resp = h.readTimeout(500);
            this.mouseProbedCandidates.push({
              path: cand.path,
              interface: cand.interface,
              usagePage: cand.usagePage,
              pid: group.pid,
              success: true,
              bytesWritten,
              responseHex: resp ? Buffer.from(resp).toString('hex') : null
            });

            mouseHandle = h;
            selectedPid = group.pid;
            selectedReportId = group.reportId;
            this.rawMouseHandle = h;
            this.mouseLockedPath = cand.path;
            this.mouseFallbackReason = null;

            this.mouse.setConnection(h, group.reportId, group.pid, cand.vendorId || ASUS_VID);
            this.mouse.queryBattery(onPacket);

            // Probe signature / serial
            const sig = this.mouse.probeSignature(onPacket);
            if (sig && sig.signature) {
              this.mouse.signature = sig.signature;
            }

            const upDisplay = cand.usagePage ? '0x' + cand.usagePage.toString(16).toUpperCase() : 'N/A';
            console.log(`[DeviceManager] Successfully locked onto writable mouse interface: ${cand.path} (UsagePage: ${upDisplay})`);
            break;
          } else {
            this.mouseProbedCandidates.push({
              path: cand.path,
              interface: cand.interface,
              usagePage: cand.usagePage,
              pid: group.pid,
              success: false,
              error: 'WriteFile returned 0 bytes written'
            });
            try { h.close(); } catch (e) {}
          }
        } catch (err) {
          this.mouseProbedCandidates.push({
            path: cand.path,
            interface: cand.interface,
            usagePage: cand.usagePage,
            pid: group.pid,
            success: false,
            error: err.message
          });
          if (h) {
            try { h.close(); } catch (e) {}
          }
        }
      }

      if (mouseHandle) {
        break; // Successfully locked onto a device in this group
      }
    }

    if (!mouseHandle) {
      const totalCandidates = mouseGroups.reduce((acc, g) => acc + g.candidates.length, 0);
      this.mouseFallbackReason = totalCandidates === 0
        ? 'No supported ASUS Gladius III / Omni Receiver detected in USB scan'
        : `Candidate interfaces failed write probe: ${this.mouseProbedCandidates.map(c => `${c.path} (${c.error || 'no response'})`).join('; ')}`;
      console.log(`[DeviceManager] Mouse fallback to mock: ${this.mouseFallbackReason}`);
      this.mouse.setConnection(null, selectedReportId, selectedPid, ASUS_VID);
    }
  }

  /**
   * Closes all open HID handles cleanly
   */
  closeAll() {
    console.log('[DeviceManager] Closing all hardware HID handles...');
    if (this.rawMbHandle) {
      try {
        this.rawMbHandle.close();
      } catch (e) {
        // ignore
      }
      this.rawMbHandle = null;
    }
    if (this.rawMouseHandle) {
      try {
        this.rawMouseHandle.close();
      } catch (e) {
        // ignore
      }
      this.rawMouseHandle = null;
    }
    this.motherboard.setHandle(null, ASUS_VID, this.mbPid || 0x19AF);
    this.mouse.setConnection(null, this.mouse.reportId, this.mouse.pid, ASUS_VID);
  }

  /**
   * Detailed debug diagnostics for /api/debug-hid endpoint
   */
  getDebugInfo() {
    return {
      scanTimestamp: new Date().toISOString(),
      mockModeForced: this.forceMock,
      totalAsusInterfaces: this.allAsusDevices.length,
      allAsusDevices: this.allAsusDevices.map(d => ({
        productId: '0x' + (d.productId || 0).toString(16).toUpperCase().padStart(4, '0'),
        product: d.product || 'ASUS Device',
        usagePage: d.usagePage !== undefined && d.usagePage !== null ? '0x' + d.usagePage.toString(16).toUpperCase() : 'N/A',
        usage: d.usage !== undefined && d.usage !== null ? '0x' + d.usage.toString(16).toUpperCase() : 'N/A',
        interface: d.interface,
        path: d.path
      })),
      mouse: {
        isMock: this.mouse.isMock,
        name: this.mouse.name,
        signature: this.mouse.signature || null,
        pid: '0x' + (this.mouse.pid || 0).toString(16).toUpperCase(),
        reportId: '0x' + (this.mouse.reportId || 0).toString(16).padStart(2, '0').toUpperCase(),
        lockedPath: this.rawMouseHandle ? this.mouseLockedPath : null,
        fallbackReason: this.mouseFallbackReason || this.mouse.lastError || null,
        lastError: this.mouse.lastError || null,
        probedCandidates: this.mouseProbedCandidates
      },
      motherboard: {
        isMock: this.motherboard.isMock,
        name: this.motherboard.name,
        pid: this.rawMbHandle ? '0x' + (this.mbPid || 0).toString(16).toUpperCase() : null,
        lockedPath: this.rawMbHandle ? this.mbLockedPath : null,
        fallbackReason: this.motherboardFallbackReason || this.motherboard.lastError || null,
        lastError: this.motherboard.lastError || null,
        probedCandidates: this.motherboardProbedCandidates,
        config: this.motherboard.config
      }
    };
  }

  /**
   * Returns current hardware status summary
   */
  getStatus() {
    return {
      motherboard: {
        name: this.motherboard.name,
        isMock: this.motherboard.isMock,
        mockReason: this.motherboard.isMock ? (this.motherboardFallbackReason || this.motherboard.lastError || 'Simulated Fallback Mode') : null,
        controlMode: this.motherboard.controlMode,
        config: this.motherboard.config,
        directSettings: this.motherboard.directSettings,
        settings: this.motherboard.currentSettings
      },
      mouse: {
        name: this.mouse.name,
        signature: this.mouse.signature || null,
        pid: '0x' + (this.mouse.pid || 0).toString(16).toUpperCase(),
        reportId: '0x' + (this.mouse.reportId || 0).toString(16).padStart(2, '0').toUpperCase(),
        isMock: this.mouse.isMock,
        mockReason: this.mouse.isMock ? (this.mouseFallbackReason || this.mouse.lastError || 'Simulated Fallback Mode') : null,
        battery: this.mouse.battery,
        charging: this.mouse.charging,
        status: this.mouse.status || (this.mouse.charging ? 'charging' : (this.mouse.battery > 0 ? 'awake' : 'asleep')),
        settings: this.mouse.currentSettings
      },
      mockMode: this.forceMock,
      totalInterfaces: this.scanResults.length
    };
  }
}

// Standalone scan function for `npm run scan`
export function scanDevices(verbose = true) {
  const dm = new DeviceManager();
  return dm.scanDevices(verbose);
}
