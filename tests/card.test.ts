import { describe, it, expect } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { JkBmsCardConfig } from '../src/interfaces';
import { JkBmsCard, validateCardConfig } from '../src/index';
import { JkBmsBankOverviewLayout } from '../src/layouts/bank-overview';
import { JkBmsCardEditor } from '../src/editor';

describe('validateCardConfig', () => {
    const valid = (overrides: Partial<JkBmsCardConfig> = {}) =>
        ({
            type: 'custom:jk-bms-card',
            layout: 'bank-overview',
            prefix: 'jk_bms',
            ...overrides,
        }) as JkBmsCardConfig;

    it('accepts valid packs including empty prefix (e.g. full-ID or mid-edit)', () => {
        expect(() => validateCardConfig(valid({ packs: [{ prefix: '' }] }))).not.toThrow();
        expect(() =>
            validateCardConfig(valid({ packs: [{ id: 'p1', name: 'Pack 1', prefix: 'jk_1', packIndex: 1 }] }))
        ).not.toThrow();
    });

    it('throws on non-array packs or non-object pack entry', () => {
        expect(() => validateCardConfig(valid({ packs: 'bad' as unknown as JkBmsCardConfig['packs'] }))).toThrow();
        expect(() => validateCardConfig(valid({ packs: [null as unknown as never] }))).toThrow();
    });

    it('throws on malformed optional string fields or invalid packIndex', () => {
        expect(() =>
            validateCardConfig(valid({ packs: [{ id: 123 as unknown as string, prefix: 'jk_1' }] }))
        ).toThrow();
        expect(() => validateCardConfig(valid({ packs: [{ prefix: 'jk_1', packIndex: 0 }] }))).toThrow();
        expect(() => validateCardConfig(valid({ packs: [{ prefix: 'jk_1', packIndex: 1.5 }] }))).toThrow();
        expect(() =>
            validateCardConfig(valid({ packs: [{ prefix: 'jk_1', batteryNumber: 'abc' as unknown as number }] }))
        ).toThrow();
    });
});

describe('JkBmsCard sizing & grid options', () => {
    it('scales getCardSize with pack count and omits fixed rows in getGridOptions', () => {
        const card = Object.create(JkBmsCard.prototype) as JkBmsCard;
        Object.defineProperty(card, '_config', {
            value: {
                type: 'custom:jk-bms-card',
                layout: 'bank-overview',
                title: 'Bank',
                prefix: 'jk',
                cellCount: 16,
                cellColumns: 4,
                cellLayout: 'incremental',
                entities: {},
                packs: [{ prefix: 'jk_1' }, { prefix: 'jk_2' }, { prefix: 'jk_3' }],
            } as JkBmsCardConfig,
            configurable: true,
        });

        expect(card.getCardSize()).toBe(7);
        const grid = card.getGridOptions();
        expect(grid).toEqual({ columns: 12, min_columns: 6, min_rows: 3 });
        expect('rows' in grid).toBe(false);
    });
});

describe('JkBmsBankOverviewLayout shouldUpdate gating', () => {
    it('skips unrelated state updates, wakes on watched state changes, and wakes on registry-only device_id updates', () => {
        const layout = Object.create(JkBmsBankOverviewLayout.prototype) as unknown as {
            hass: HomeAssistant;
            config: JkBmsCardConfig;
            _watchedEntityIds: string[];
            requestUpdate: () => void;
            willUpdate: (changed: Map<string, unknown>) => void;
            shouldUpdate: (changed: Map<string, unknown>) => boolean;
        };
        layout.requestUpdate = () => {};

        layout.config = {
            type: 'custom:jk-bms-card',
            layout: 'bank-overview',
            title: 'Bank',
            prefix: 'jk_1',
            cellCount: 2,
            cellColumns: 2,
            cellLayout: 'incremental',
            entities: {},
            packs: [{ prefix: 'jk_1' }],
        };
        layout.willUpdate(new Map([['config', undefined]]));

        const watchedState = { state: '53.2', attributes: { unit_of_measurement: 'V' } };
        const oldHass = {
            states: {
                'sensor.jk_1_total_voltage': watchedState,
                'sensor.unrelated_kitchen_temp': { state: '20' },
            },
            entities: {
                'sensor.jk_1_total_voltage': { device_id: 'dev-1' },
            },
        } as unknown as HomeAssistant;

        // 1. Unrelated entity changes -> shouldUpdate MUST return false
        layout.hass = {
            states: {
                'sensor.jk_1_total_voltage': watchedState,
                'sensor.unrelated_kitchen_temp': { state: '21' },
            },
            entities: (oldHass as unknown as { entities: Record<string, { device_id: string }> }).entities,
        } as unknown as HomeAssistant;
        expect(layout.shouldUpdate(new Map([['hass', oldHass]]))).toBe(false);

        // 2. Watched entity state changes -> shouldUpdate returns true
        layout.hass = {
            states: {
                'sensor.jk_1_total_voltage': { state: '53.3', attributes: { unit_of_measurement: 'V' } },
                'sensor.unrelated_kitchen_temp': { state: '20' },
            },
            entities: (oldHass as unknown as { entities: Record<string, { device_id: string }> }).entities,
        } as unknown as HomeAssistant;
        expect(layout.shouldUpdate(new Map([['hass', oldHass]]))).toBe(true);

        // 3. Registry-only update (device_id changes, states identical) -> shouldUpdate returns true
        layout.hass = {
            states: oldHass.states,
            entities: {
                'sensor.jk_1_total_voltage': { device_id: 'dev-2' },
            },
        } as unknown as HomeAssistant;
        expect(layout.shouldUpdate(new Map([['hass', oldHass]]))).toBe(true);
    });
});

describe('JkBmsCardEditor pack panel expansion', () => {
    it('tracks open/close state from ha-expansion-panel detail.expanded', () => {
        const editor = Object.create(JkBmsCardEditor.prototype) as unknown as {
            _openPackPanels: Set<number>;
            requestUpdate: () => void;
            _togglePackPanel: (idx: number, expanded: boolean) => void;
        };
        editor.requestUpdate = () => {};
        editor._openPackPanels = new Set();

        const openDetail = { expanded: true };
        editor._togglePackPanel(0, Boolean(openDetail.expanded));
        expect(editor._openPackPanels.has(0)).toBe(true);

        const closeDetail = { expanded: false };
        editor._togglePackPanel(0, Boolean(closeDetail.expanded));
        expect(editor._openPackPanels.has(0)).toBe(false);
    });
});
