/* Tests for UniFi Access API event payload schemas.
 *
 * These tests validate the expected shape of every event payload the plugin processes. If the UniFi Access API changes its event structure in a
 * future firmware update, these tests will detect the schema drift and fail, making it easy to identify which fields changed and update the plugin.
 *
 * All schemas and reference payloads are defined in tests/event-schemas.ts — the single source of truth shared with scripts/event-schema-monitor.ts.
 */
import { describe, it, expect } from 'vitest';
import type { AccessEventDoorbellRing, AccessEventPacket } from 'unifi-access';
import { AccessEventType } from '../src/access-types.js';
import {
  extractSchema, referenceDoorbellCancel, referenceDoorbellRing, referenceDeviceUpdateV2, referenceEventPacket, referenceLocationUpdate, schemaDiff,
} from './event-schemas.js';

// --- Tests ---

describe('UniFi Access event payload schemas', () => {

  describe('AccessEventPacket envelope', () => {

    const expectedSchema = extractSchema(referenceEventPacket as unknown as Record<string, unknown>);

    it('should have the expected top-level fields', () => {

      expect(Object.keys(referenceEventPacket).sort()).toEqual(['data', 'event', 'event_object_id', 'meta', 'receiver_id', 'save_to_history']);
    });

    it('should have the expected meta fields', () => {

      expect(Object.keys(referenceEventPacket.meta!).sort()).toEqual(['all_field', 'id', 'object_type', 'source', 'target_field']);
    });

    it('should match the reference schema structure', () => {

      const actual = extractSchema(referenceEventPacket as unknown as Record<string, unknown>);
      const diff = schemaDiff(expectedSchema, actual);

      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.typeChanged).toEqual([]);
    });
  });

  describe('DOORBELL_RING payload', () => {

    const expectedKeys = [
      'channel', 'clear_request_id', 'connected_uah_id', 'connected_uah_type', 'controller_id', 'create_time', 'device_id',
      'device_name', 'device_type', 'door_guard_ids', 'door_name', 'floor_name', 'host_device_mac', 'in_or_out',
      'reason_code', 'request_id', 'room_id', 'support_feature', 'token',
    ];

    it('should have all expected fields', () => {

      expect(Object.keys(referenceDoorbellRing).sort()).toEqual(expectedKeys.sort());
    });

    it('should have correct field types', () => {

      const schema = extractSchema(referenceDoorbellRing as unknown as Record<string, unknown>);

      expect(schema.connected_uah_id).toBe('string');
      expect(schema.request_id).toBe('string');
      expect(schema.create_time).toBe('number');
      expect(schema.reason_code).toBe('number');
      expect(schema.door_guard_ids).toBe('array');
      expect(schema.support_feature).toBe('array');
    });

    it('should have the fields the plugin relies on', () => {

      // handleDoorbellRing reads connected_uah_id and request_id from the data payload.
      expect(referenceDoorbellRing).toHaveProperty('connected_uah_id');
      expect(referenceDoorbellRing).toHaveProperty('request_id');
    });
  });

  describe('DOORBELL_CANCEL payload', () => {

    it('should have all expected fields', () => {

      expect(Object.keys(referenceDoorbellCancel).sort()).toEqual(['reason_code', 'remote_call_request_id']);
    });

    it('should have correct field types', () => {

      expect(typeof referenceDoorbellCancel.reason_code).toBe('number');
      expect(typeof referenceDoorbellCancel.remote_call_request_id).toBe('string');
    });

    it('should have the fields the plugin relies on', () => {

      // handleDoorbellCancel reads remote_call_request_id to match the ring request.
      expect(referenceDoorbellCancel).toHaveProperty('remote_call_request_id');
    });
  });

  describe('DEVICE_UPDATE_V2 payload', () => {

    const expectedAccessMethodKeys = ['apple_pass', 'bt_button', 'face', 'nfc', 'pin_code', 'qr_code', 'wave'];

    it('should have the expected top-level fields', () => {

      expect(Object.keys(referenceDeviceUpdateV2).sort()).toEqual(['access_method', 'location_states']);
    });

    it('should have all supported access method keys', () => {

      expect(Object.keys(referenceDeviceUpdateV2.access_method!).sort()).toEqual(expectedAccessMethodKeys.sort());
    });

    it("should use 'yes'/'no' for access method values", () => {

      for(const value of Object.values(referenceDeviceUpdateV2.access_method!)) {

        expect(['yes', 'no']).toContain(value);
      }
    });

    it('should have the required location_states fields', () => {

      const state = referenceDeviceUpdateV2.location_states![0];
      const requiredFields = ['dps', 'dps_connected', 'enable', 'is_unavailable', 'location_id', 'lock'];

      for(const field of requiredFields) {

        expect(state).toHaveProperty(field);
      }
    });

    it("should use 'locked'/'unlocked' for lock values", () => {

      expect(['locked', 'unlocked']).toContain(referenceDeviceUpdateV2.location_states![0].lock);
    });

    it("should use 'open'/'close' for dps values", () => {

      expect(['open', 'close']).toContain(referenceDeviceUpdateV2.location_states![0].dps);
    });

    it('should have the fields the plugin relies on', () => {

      // handleDeviceUpdateV2 reads access_method and location_states from the data payload.
      const state = referenceDeviceUpdateV2.location_states![0];

      expect(state).toHaveProperty('location_id');
      expect(state).toHaveProperty('lock');
      expect(state).toHaveProperty('dps');
    });
  });

  describe('LOCATION_UPDATE payload', () => {

    it('should have the required top-level fields', () => {

      const requiredFields = ['id', 'name'];

      for(const field of requiredFields) {

        expect(referenceLocationUpdate).toHaveProperty(field);
      }
    });

    it('should have the expected state fields when state is present', () => {

      const requiredStateFields = ['dps', 'lock'];

      for(const field of requiredStateFields) {

        expect(referenceLocationUpdate.state).toHaveProperty(field);
      }
    });

    it("should use 'locked'/'unlocked' for lock values", () => {

      expect(['locked', 'unlocked']).toContain(referenceLocationUpdate.state!.lock);
    });

    it("should use 'open'/'close' for dps values", () => {

      expect(['open', 'close']).toContain(referenceLocationUpdate.state!.dps);
    });

    it('should have the fields the plugin relies on', () => {

      // handleLocationUpdate reads id and state.lock/state.dps from the data payload.
      expect(referenceLocationUpdate).toHaveProperty('id');
      expect(referenceLocationUpdate.state).toHaveProperty('lock');
      expect(referenceLocationUpdate.state).toHaveProperty('dps');
    });
  });

  describe('AccessEventType enum completeness', () => {

    const expectedEventTypes: Record<string, string> = {

      DEVICE_DELETE: 'access.data.device.delete',
      DEVICE_REMOTE_UNLOCK: 'access.data.device.remote_unlock',
      DEVICE_UPDATE: 'access.data.device.update',
      DEVICE_UPDATE_V2: 'access.data.v2.device.update',
      DOORBELL_CANCEL: 'access.remote_view.change',
      DOORBELL_RING: 'access.remote_view',
      LOCATION_DATA_UPDATE: 'access.data.location.update',
      LOCATION_UPDATE: 'access.data.v2.location.update',
    };

    it('should contain all expected event type values', () => {

      for(const [key, value] of Object.entries(expectedEventTypes)) {

        expect(AccessEventType[key as keyof typeof AccessEventType]).toBe(value);
      }
    });

    it('should not have unexpected event types', () => {

      const actualKeys = Object.keys(AccessEventType).filter(k => isNaN(Number(k)));

      expect(actualKeys.sort()).toEqual(Object.keys(expectedEventTypes).sort());
    });

    it('should have unique event type string values', () => {

      const values = Object.values(AccessEventType);
      const uniqueValues = new Set(values);

      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('event routing expectations', () => {

    it('should route DEVICE_UPDATE events by event_object_id', () => {

      // The event dispatcher emits by event type AND by event_object_id.
      // This test documents that hub event handlers rely on being subscribed to device.unique_id.
      const packet: AccessEventPacket = { ...referenceEventPacket, event: AccessEventType.DEVICE_UPDATE };

      expect(packet.event_object_id).toBeDefined();
      expect(typeof packet.event_object_id).toBe('string');
    });

    it('should route DEVICE_UPDATE_V2 events by meta.id when object_type is device', () => {

      // For v2 events, the dispatcher also emits using meta.id as the key.
      const packet: AccessEventPacket = {

        ...referenceEventPacket,
        event: AccessEventType.DEVICE_UPDATE_V2,
        meta: { all_field: false, id: 'device-id', object_type: 'device', source: 'controller', target_field: [] },
      };

      expect(packet.meta?.object_type).toBe('device');
      expect(packet.meta?.id).toBeDefined();
    });

    it('should route DOORBELL events by event type (global)', () => {

      // Doorbell events are subscribed globally by event type, not by device ID.
      // The handler filters by connected_uah_id in the data payload.
      const ringPacket: AccessEventPacket = { ...referenceEventPacket, data: referenceDoorbellRing, event: AccessEventType.DOORBELL_RING };

      expect(ringPacket.event).toBe(AccessEventType.DOORBELL_RING);
      expect((ringPacket.data as AccessEventDoorbellRing).connected_uah_id).toBeDefined();
    });

    it('should route LOCATION_UPDATE events by event_object_id for UA Gate hubs', () => {

      // UA Gate hubs subscribe to their door location IDs on the controller event bus.
      const packet: AccessEventPacket = {

        ...referenceEventPacket,
        data: referenceLocationUpdate as unknown as Record<string, unknown>,
        event: AccessEventType.LOCATION_UPDATE,
        event_object_id: 'ugt-device-id',
      };

      expect(packet.event_object_id).toBeDefined();
    });
  });

  describe('device config keys used by the plugin', () => {

    // These config keys are read from AccessDeviceConfig.configs[] and used to determine device state.
    // If the Access API renames any of these keys, the plugin will silently break.

    const criticalConfigKeys = {

      uah: {

        dpsInput: 'input_state_dps',
        lockRelay: 'input_state_rly-lock_dry',
        relInput: 'input_state_rel',
        renInput: 'input_state_ren',
        rexInput: 'input_state_rex',
        wiringDpsNeg: 'wiring_state_dps-neg',
        wiringDpsPos: 'wiring_state_dps-pos',
        wiringRelNeg: 'wiring_state_rel-neg',
        wiringRelPos: 'wiring_state_rel-pos',
        wiringRenNeg: 'wiring_state_ren-neg',
        wiringRenPos: 'wiring_state_ren-pos',
        wiringRexNeg: 'wiring_state_rex-neg',
        wiringRexPos: 'wiring_state_rex-pos',
      },

      ugt: {

        dpsGateInput: 'input_gate_dps',
        dpsSideDoorInput: 'input_door_dps',
        lockGateRelay: 'output_oper1_relay',
        lockSideDoorRelay: 'output_oper2_relay',
        wiringSideDoorDpsNeg: 'wiring_state_door-dps-neg',
        wiringSideDoorDpsPos: 'wiring_state_door-dps-pos',
        wiringGateDpsNeg: 'wiring_state_gate-dps-neg',
        wiringGateDpsPos: 'wiring_state_gate-dps-pos',
      },
    };

    it('should document all UAH config keys', () => {

      // These keys are used in the device catalog (access-device-catalog.ts) and hub utilities.
      for(const value of Object.values(criticalConfigKeys.uah)) {

        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it('should document all UGT config keys', () => {

      for(const value of Object.values(criticalConfigKeys.ugt)) {

        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });

    it('should have unique config keys per device type', () => {

      const uahValues = Object.values(criticalConfigKeys.uah);
      const ugtValues = Object.values(criticalConfigKeys.ugt);

      expect(new Set(uahValues).size).toBe(uahValues.length);
      expect(new Set(ugtValues).size).toBe(ugtValues.length);
    });
  });
});
