/* Mock homebridge objects for testing. */
import { vi } from "vitest";

// Mock Characteristic values that mirror HAP's enum values.
export const MockCharacteristic = {

  ConfiguredName: "ConfiguredName",

  ContactSensorState: {
    CONTACT_DETECTED: 0,
    CONTACT_NOT_DETECTED: 1
  },

  CurrentDoorState: {
    CLOSED: 1,
    CLOSING: 3,
    OPEN: 0,
    OPENING: 2,
    STOPPED: 4
  },

  FirmwareRevision: "FirmwareRevision",

  LockCurrentState: {
    JAMMED: 2,
    SECURED: 1,
    UNKNOWN: 3,
    UNSECURED: 0
  },

  LockTargetState: {
    SECURED: 1,
    UNSECURED: 0
  },

  Manufacturer: "Manufacturer",
  Model: "Model",
  MotionDetected: "MotionDetected",
  Name: "Name",
  OccupancyDetected: "OccupancyDetected",
  ObstructionDetected: "ObstructionDetected",
  On: "On",

  ProgrammableSwitchEvent: {
    SINGLE_PRESS: 0
  },

  SerialNumber: "SerialNumber",
  StatusActive: "StatusActive",

  StatusTampered: {
    NOT_TAMPERED: 0,
    TAMPERED: 1
  },

  TargetDoorState: {
    CLOSED: 1,
    OPEN: 0
  }
};

// Mock Service types.
export const MockService = {

  AccessoryInformation: "AccessoryInformation",
  ContactSensor: "ContactSensor",
  Doorbell: "Doorbell",
  GarageDoorOpener: "GarageDoorOpener",
  LockMechanism: "LockMechanism",
  MotionSensor: "MotionSensor",
  OccupancySensor: "OccupancySensor",
  Switch: "Switch"
};

// Mock HAP object.
export const createMockHAP = () => ({

  Characteristic: MockCharacteristic,
  Service: MockService,
  uuid: { generate: (input: string) => "uuid-" + input }
});

// Create a mock characteristic with get/set/onGet/onSet.
export function createMockCharacteristic(initialValue: unknown = null) {

  return {
    onGet: vi.fn().mockReturnThis(),
    onSet: vi.fn().mockReturnThis(),
    updateValue: vi.fn(),
    value: initialValue
  };
}

// Create a mock service.
export function createMockService(serviceType: string, subtype?: string) {

  const characteristics = new Map<string, ReturnType<typeof createMockCharacteristic>>();

  const service = {
    UUID: serviceType,
    addOptionalCharacteristic: vi.fn(),
    displayName: "",
    getCharacteristic: vi.fn((charType: string) => {

      if(!characteristics.has(charType)) {

        characteristics.set(charType, createMockCharacteristic());
      }

      return characteristics.get(charType)!;
    }),
    subtype,
    testCharacteristic: vi.fn().mockReturnValue(false),
    updateCharacteristic: vi.fn((charType: string, value: unknown) => {

      if(!characteristics.has(charType)) {

        characteristics.set(charType, createMockCharacteristic());
      }

      characteristics.get(charType)!.value = value;

      return service;
    })
  };

  return service;
}

// Create a mock PlatformAccessory.
export function createMockAccessory(uuid = "test-uuid") {

  const services = new Map<string, ReturnType<typeof createMockService>>();

  // Pre-add AccessoryInformation service.
  services.set(MockService.AccessoryInformation, createMockService(MockService.AccessoryInformation));

  const accessory = {

    UUID: uuid,

    _associatedHAPAccessory: { displayName: "" },

    addService: vi.fn((service: ReturnType<typeof createMockService>) => {

      return service;
    }),

    context: {} as Record<string, unknown>,

    displayName: "Test Accessory",

    getService: vi.fn((serviceType: string) => services.get(serviceType)),

    getServiceById: vi.fn((serviceType: string, subtype: string) => {

      const key = serviceType + "." + subtype;

      return services.get(key);
    }),

    removeService: vi.fn(),

    services: Array.from(services.values())
  };

  return accessory;
}

// Create a mock API.
export function createMockAPI() {

  const hap = createMockHAP();

  return {

    hap,

    on: vi.fn(),

    platformAccessory: vi.fn().mockImplementation((name: string, uuid: string) => createMockAccessory(uuid)),

    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
    updatePlatformAccessories: vi.fn()
  };
}
