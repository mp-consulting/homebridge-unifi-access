/* Shared event schema definitions for the UniFi Access API.
 *
 * This file is the single source of truth for event payload schemas. It is used by:
 *   - tests/access-event-schemas.test.ts (static schema validation tests)
 *   - scripts/event-schema-monitor.ts (live event monitoring against a real controller)
 *
 * When the UniFi Access API changes, update schemas here and both consumers pick up the changes automatically.
 */
import type { AccessEventDoorbellCancel, AccessEventDoorbellRing, AccessEventPacket } from "unifi-access";
import type { AccessEventDeviceUpdateV2, AccessEventLocationDataUpdate, AccessEventLocationUpdate } from "../src/hub/access-hub-types.js";

// ---- Schema definition types ----

export interface FieldSchema {

  required: boolean;
  type: string;
}

export type SchemaDefinition = Record<string, FieldSchema>;

export interface SchemaIssue {

  field: string;
  issue: "missing_required" | "unexpected_field" | "type_mismatch";
  detail: string;
}

// ---- Schema definitions ----

// Top-level event packet envelope.
export const packetEnvelopeSchema: SchemaDefinition = {

  "data":                     { required: true,  type: "object" },
  "event":                    { required: true,  type: "string" },
  "event_object_id":          { required: true,  type: "string" },
  "meta":                     { required: false, type: "object" },
  "meta.all_field":           { required: false, type: "boolean" },
  "meta.id":                  { required: false, type: "string" },
  "meta.object_type":         { required: false, type: "string" },
  "meta.source":              { required: false, type: "string" },
  "meta.target_field":        { required: false, type: "array" },
  "receiver_id":              { required: false, type: "string" },
  "save_to_history":          { required: false, type: "boolean" }
};

// access.remote_view (doorbell ring).
export const doorbellRingSchema: SchemaDefinition = {

  "channel":                  { required: true,  type: "string" },
  "clear_request_id":         { required: true,  type: "string" },
  "connected_uah_id":         { required: true,  type: "string" },
  "connected_uah_type":       { required: true,  type: "string" },
  "controller_id":            { required: true,  type: "string" },
  "create_time":              { required: true,  type: "number" },
  "device_id":                { required: true,  type: "string" },
  "device_name":              { required: true,  type: "string" },
  "device_type":              { required: true,  type: "string" },
  "door_guard_ids":           { required: true,  type: "array" },
  "door_name":                { required: true,  type: "string" },
  "floor_name":               { required: true,  type: "string" },
  "host_device_mac":          { required: true,  type: "string" },
  "in_or_out":                { required: true,  type: "string" },
  "reason_code":              { required: true,  type: "number" },
  "request_id":               { required: true,  type: "string" },
  "room_id":                  { required: true,  type: "string" },
  "support_feature":          { required: true,  type: "array" },
  "token":                    { required: true,  type: "string" }
};

// access.remote_view.change (doorbell cancel).
export const doorbellCancelSchema: SchemaDefinition = {

  "reason_code":              { required: true,  type: "number" },
  "remote_call_request_id":   { required: true,  type: "string" }
};

// access.data.v2.device.update — access_method sub-object.
export const deviceUpdateV2AccessMethodSchema: SchemaDefinition = {

  "apple_pass":               { required: false, type: "string" },
  "bt_button":                { required: false, type: "string" },
  "face":                     { required: false, type: "string" },
  "nfc":                      { required: false, type: "string" },
  "pin_code":                 { required: false, type: "string" },
  "qr_code":                  { required: false, type: "string" },
  "wave":                     { required: false, type: "string" }
};

// access.data.v2.device.update — location_states[] element.
export const locationStateElementSchema: SchemaDefinition = {

  "alarms":                             { required: false, type: "array" },
  "dps":                                { required: true,  type: "string" },
  "dps_connected":                      { required: true,  type: "boolean" },
  "emergency":                          { required: false, type: "object" },
  "enable":                             { required: true,  type: "boolean" },
  "hub_gate_door_mode":                 { required: false, type: "string" },
  "is_unavailable":                     { required: true,  type: "boolean" },
  "location_id":                        { required: true,  type: "string" },
  "lock":                               { required: true,  type: "string" },
  "manually_action_button_number":      { required: false, type: "number" }
};

// access.data.location.update (location metadata/configuration changes).
export const locationDataUpdateSchema: SchemaDefinition = {

  "extras":                   { required: false, type: "object" },
  "extra_type":               { required: false, type: "string" },
  "full_name":                { required: false, type: "string" },
  "level":                    { required: false, type: "number" },
  "location_type":            { required: false, type: "string" },
  "name":                     { required: true,  type: "string" },
  "previous_name":            { required: false, type: "string|array" },
  "timezone":                 { required: false, type: "string" },
  "unique_id":                { required: true,  type: "string" },
  "up_id":                    { required: false, type: "string" },
  "work_time":                { required: false, type: "string" },
  "work_time_id":             { required: false, type: "string" }
};

// access.data.v2.location.update.
export const locationUpdateSchema: SchemaDefinition = {

  "device_ids":               { required: false, type: "array" },
  "extras":                   { required: false, type: "object" },
  "id":                       { required: true,  type: "string" },
  "last_activity":            { required: false, type: "number" },
  "location_type":            { required: false, type: "string" },
  "name":                     { required: true,  type: "string" },
  "state":                    { required: false, type: "object" },
  "state.dps":                { required: false, type: "string" },
  "state.dps_connected":      { required: false, type: "boolean" },
  "state.enable":             { required: false, type: "boolean" },
  "state.is_unavailable":     { required: false, type: "boolean" },
  "state.lock":               { required: false, type: "string" },
  "thumbnail":                { required: false, type: "object" },
  "up_id":                    { required: false, type: "string" }
};

// access.base.info (controller heartbeat / status).
export const baseInfoSchema: SchemaDefinition = {

  "top_log_count":            { required: true,  type: "number" }
};

// access.data.top_log.update (log/analytics summary).
export const topLogUpdateSchema: SchemaDefinition = {

  "buckets":                  { required: false, type: "object" },
  "hits":                     { required: true,  type: "object|array" }
};

// access.logs.add (activity log entry).
export const logsAddSchema: SchemaDefinition = {

  "_id":                      { required: true,  type: "string" },
  "@timestamp":               { required: true,  type: "string" },
  "_source":                  { required: true,  type: "object" },
  "tag":                      { required: true,  type: "string" }
};

// access.logs.insights.add (insight log entry).
export const logsInsightsAddSchema: SchemaDefinition = {

  "event_type":               { required: true,  type: "string" },
  "log_key":                  { required: true,  type: "string" },
  "message":                  { required: true,  type: "string" },
  "metadata":                 { required: false, type: "object" },
  "published":                { required: true,  type: "number" },
  "result":                   { required: true,  type: "string" }
};

// Map event types to their data payload schemas.
export const eventSchemas: Record<string, { name: string; schema: SchemaDefinition; subSchemas?: { path: string; isArray: boolean; schema: SchemaDefinition }[] }> = {

  "access.base.info":                   { name: "BASE_INFO", schema: baseInfoSchema },
  "access.data.device.remote_unlock":   { name: "DEVICE_REMOTE_UNLOCK", schema: {} },
  "access.data.device.update":          { name: "DEVICE_UPDATE", schema: {} },
  "access.data.v2.device.update":       { name: "DEVICE_UPDATE_V2", schema: {},

    subSchemas: [
      { isArray: false, path: "access_method", schema: deviceUpdateV2AccessMethodSchema },
      { isArray: true,  path: "location_states", schema: locationStateElementSchema }
    ]
  },

  "access.data.location.update":        { name: "LOCATION_DATA_UPDATE", schema: locationDataUpdateSchema },
  "access.data.top_log.update":        { name: "TOP_LOG_UPDATE", schema: topLogUpdateSchema },
  "access.data.v2.location.update":     { name: "LOCATION_UPDATE", schema: locationUpdateSchema },
  "access.logs.add":                    { name: "LOGS_ADD", schema: logsAddSchema },
  "access.logs.insights.add":          { name: "LOGS_INSIGHTS_ADD", schema: logsInsightsAddSchema },
  "access.remote_view":                 { name: "DOORBELL_RING", schema: doorbellRingSchema },
  "access.remote_view.change":          { name: "DOORBELL_CANCEL", schema: doorbellCancelSchema }
};

// ---- Schema validation helpers ----

// Get the effective type of a value (distinguishes "array" from "object").
export function effectiveType(value: unknown): string {

  if(Array.isArray(value)) {

    return "array";
  }

  return typeof value;
}

// Resolve a dotted path on an object, returning undefined if any segment is missing.
export function resolvePath(obj: Record<string, unknown>, path: string): unknown {

  const parts = path.split(".");
  let current: unknown = obj;

  for(const part of parts) {

    if(current === null || current === undefined || typeof current !== "object") {

      return undefined;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// Validate an object against a schema definition. Returns a list of issues found.
export function validateSchema(data: Record<string, unknown>, schema: SchemaDefinition, prefix = ""): SchemaIssue[] {

  const issues: SchemaIssue[] = [];

  // Check all defined fields.
  for(const [field, spec] of Object.entries(schema)) {

    const value = resolvePath(data, field);

    if(value === undefined || value === null) {

      if(spec.required) {

        issues.push({ detail: `Expected ${spec.type}, got undefined`, field: prefix + field, issue: "missing_required" });
      }

      continue;
    }

    const actual = effectiveType(value);

    if(!spec.type.split("|").includes(actual)) {

      issues.push({ detail: `Expected ${spec.type}, got ${actual}`, field: prefix + field, issue: "type_mismatch" });
    }
  }

  // Check for unexpected top-level fields (only for flat schemas, not dotted paths).
  const topLevelExpected = new Set(Object.keys(schema).map(k => k.split(".")[0]));

  for(const key of Object.keys(data)) {

    if(!topLevelExpected.has(key)) {

      issues.push({ detail: `Type: ${effectiveType(data[key])}`, field: prefix + key, issue: "unexpected_field" });
    }
  }

  return issues;
}

// Extract the structure (keys and types) of an object as a flat map for comparison. Recursively processes nested objects.
export function extractSchema(obj: Record<string, unknown>, prefix = ""): Record<string, string> {

  const schema: Record<string, string> = {};

  for(const [key, value] of Object.entries(obj)) {

    const fullKey = prefix ? `${prefix}.${key}` : key;

    if(Array.isArray(value)) {

      schema[fullKey] = "array";

      // If the array has elements, extract the schema of the first element.
      if(value.length > 0 && typeof value[0] === "object" && value[0] !== null) {

        Object.assign(schema, extractSchema(value[0] as Record<string, unknown>, `${fullKey}[]`));
      }
    } else if(typeof value === "object" && value !== null) {

      schema[fullKey] = "object";
      Object.assign(schema, extractSchema(value as Record<string, unknown>, fullKey));
    } else {

      schema[fullKey] = typeof value;
    }
  }

  return schema;
}

// Compare two schemas and return the differences.
export function schemaDiff(expected: Record<string, string>, actual: Record<string, string>): { added: string[]; removed: string[]; typeChanged: string[] } {

  const added = Object.keys(actual).filter(k => !(k in expected));
  const removed = Object.keys(expected).filter(k => !(k in actual));
  const typeChanged = Object.keys(expected).filter(k => (k in actual) && expected[k] !== actual[k]);

  return { added, removed, typeChanged };
}

// ---- Reference payloads: canonical examples of every event type the plugin handles. ----

// AccessEventPacket: the top-level envelope for all events from the Access controller.
export const referenceEventPacket: AccessEventPacket = {

  data: {},
  event: "access.data.device.update",
  event_object_id: "device-unique-id",
  meta: { all_field: false, id: "device-unique-id", object_type: "device", source: "controller", target_field: ["configs"] },
  receiver_id: "controller-id",
  save_to_history: true
};

// DOORBELL_RING data payload.
export const referenceDoorbellRing: AccessEventDoorbellRing = {

  channel: "main",
  clear_request_id: "clear-req-001",
  connected_uah_id: "uah-unique-id",
  connected_uah_type: "UAH",
  controller_id: "ctrl-001",
  create_time: 1700000000,
  device_id: "device-001",
  device_name: "Front Door Hub",
  device_type: "UAH",
  door_guard_ids: ["guard-001"],
  door_name: "Front Door",
  floor_name: "Ground Floor",
  host_device_mac: "AA:BB:CC:DD:EE:FF",
  in_or_out: "in",
  reason_code: 0,
  request_id: "ring-req-001",
  room_id: "room-001",
  support_feature: ["video", "audio"],
  token: "auth-token-123"
};

// DOORBELL_CANCEL data payload.
export const referenceDoorbellCancel: AccessEventDoorbellCancel = {

  reason_code: 0,
  remote_call_request_id: "ring-req-001"
};

// DEVICE_UPDATE_V2 data payload (with access methods and location states).
export const referenceDeviceUpdateV2: AccessEventDeviceUpdateV2 = {

  access_method: {

    apple_pass: "yes",
    bt_button: "yes",
    face: "yes",
    nfc: "yes",
    pin_code: "yes",
    qr_code: "no",
    wave: "no"
  },

  location_states: [{

    dps: "close",
    dps_connected: true,
    enable: true,
    is_unavailable: false,
    location_id: "loc-001",
    lock: "locked"
  }]
};

// LOCATION_DATA_UPDATE data payload.
export const referenceLocationDataUpdate: AccessEventLocationDataUpdate = {

  name: "Main Gate",
  unique_id: "fabbf3cf-5fa4-489d-bf34-a3af49531685"
};

// LOCATION_UPDATE data payload.
export const referenceLocationUpdate: AccessEventLocationUpdate = {

  id: "loc-001",
  name: "Main Gate",

  state: {

    dps: "close",
    dps_connected: true,
    enable: true,
    is_unavailable: false,
    lock: "locked"
  }
};
