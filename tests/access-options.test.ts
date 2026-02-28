import { describe, expect, it } from "vitest";
import { featureOptionCategories, featureOptions } from "../src/access-options.js";
import { modelsDps, modelsDefaultGarageDoor, modelsDefaultLock, modelsRel, modelsRen, modelsRex, modelsSideDoor, deviceCatalog } from "../src/access-device-catalog.js";

// All valid display model names from the device catalog.
const allDisplayModels = Object.values(deviceCatalog).map(entry => entry.displayModel);

describe("Feature option categories", () => {

  const expectedCategories = ["Device", "Controller", "Hub", "AccessMethod", "Log"];

  it("should have exactly 5 categories", () => {

    expect(featureOptionCategories).toHaveLength(5);
  });

  it.each(expectedCategories)("should include the '%s' category", (name) => {

    expect(featureOptionCategories.find(cat => cat.name === name)).toBeDefined();
  });

  it("should have required fields on every category", () => {

    for(const category of featureOptionCategories) {

      expect(category).toHaveProperty("name");
      expect(category).toHaveProperty("description");
      expect(category).toHaveProperty("modelKey");
      expect(typeof category.name).toBe("string");
      expect(typeof category.description).toBe("string");
      expect(category.name.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
      expect(Array.isArray(category.modelKey)).toBe(true);
      expect(category.modelKey.length).toBeGreaterThan(0);
    }
  });
});

describe("Feature options", () => {

  const categoryNames = Object.keys(featureOptions);

  it("should have entries for every expected category", () => {

    expect(categoryNames).toContain("Device");
    expect(categoryNames).toContain("Controller");
    expect(categoryNames).toContain("Hub");
    expect(categoryNames).toContain("AccessMethod");
    expect(categoryNames).toContain("Log");
  });

  describe.each(categoryNames)("'%s' category options", (category) => {

    const options = featureOptions[category];

    it("should have at least one option", () => {

      expect(options.length).toBeGreaterThan(0);
    });

    it("should have required fields on every option", () => {

      for(const option of options) {

        expect(option).toHaveProperty("name");
        expect(option).toHaveProperty("description");
        expect(option).toHaveProperty("default");
        expect(typeof option.name).toBe("string");
        expect(typeof option.description).toBe("string");
        expect(typeof option.default).toBe("boolean");
        expect(option.description.length).toBeGreaterThan(0);
      }
    });

    it("should have no duplicate option names", () => {

      const names = options.map(opt => opt.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("modelKey references", () => {

    it("should reference valid display model names in modelKey arrays", () => {

      for(const [category, options] of Object.entries(featureOptions)) {

        for(const option of options) {

          if(option.modelKey && option.modelKey.length > 0) {

            for(const model of option.modelKey) {

              expect(allDisplayModels).toContain(model);
            }
          }
        }
      }
    });

    it("should use the correct catalog arrays for DPS options", () => {

      expect(modelsDps.length).toBeGreaterThan(0);

      for(const model of modelsDps) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for REL options", () => {

      expect(modelsRel.length).toBeGreaterThan(0);

      for(const model of modelsRel) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for REN options", () => {

      expect(modelsRen.length).toBeGreaterThan(0);

      for(const model of modelsRen) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for REX options", () => {

      expect(modelsRex.length).toBeGreaterThan(0);

      for(const model of modelsRex) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for side door options", () => {

      expect(modelsSideDoor.length).toBeGreaterThan(0);

      for(const model of modelsSideDoor) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for default garage door options", () => {

      expect(modelsDefaultGarageDoor.length).toBeGreaterThan(0);

      for(const model of modelsDefaultGarageDoor) {

        expect(allDisplayModels).toContain(model);
      }
    });

    it("should use the correct catalog arrays for default lock options", () => {

      expect(modelsDefaultLock.length).toBeGreaterThan(0);

      for(const model of modelsDefaultLock) {

        expect(allDisplayModels).toContain(model);
      }
    });
  });
});
