/* Copyright(C) 2017-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * homebridge-ui-option-state.test.ts: Tests for the webUI feature option counts shown in each category header.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module of the custom UI, no type declarations
import { categoryStats } from '../homebridge-ui/public/modules/feature-options/option-state.js';
// @ts-expect-error -- plain ESM module of the custom UI, no type declarations
import { state } from '../homebridge-ui/public/modules/state.js';

const option = (name: string, enabled: boolean) => ({ default: enabled, description: name + ' option.', name });
const globalScope = { device: null, id: null, type: 'global' };

describe('categoryStats', () => {
  it('counts enabled and modified options against the options it is given', () => {
    state.pluginConfig = [{ options: ['Enable.Hub.Two', 'Disable.Hub.Three'] }];

    // The category has more options; the device and search leave these three listed.
    const listed = [option('One', true), option('Two', false), option('Three', true)];

    expect(categoryStats('Hub', listed, globalScope)).toEqual({ enabled: 2, fraction: 2 / 3, modified: 2, total: 3 });
  });

  it('reports an empty fraction when no option is listed', () => {
    state.pluginConfig = [{ options: [] }];

    expect(categoryStats('Hub', [], globalScope)).toEqual({ enabled: 0, fraction: 0, modified: 0, total: 0 });
  });
});
