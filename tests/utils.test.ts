import { describe, it, expect, vi } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { EntityKey } from '../src/const';
import { JkBmsCardConfig } from '../src/interfaces';
import {
    candidateEntityIds,
    configOrEnum,
    formatValue,
    getNumericState,
    getRawState,
    getState,
    getTemperatureColor,
    getUnit,
    isCellBalancing,
    isCellBalancingFromMask,
    navigate,
    parseBalancerBitmask,
    resolveEntityId,
    toCelsius,
    toMillivolts,
    toVolts,
} from '../src/helpers/utils';

const config = (overrides: Partial<JkBmsCardConfig> = {}) =>
    ({ prefix: 'jk_bms', cellCount: 16, entities: {}, ...overrides }) as JkBmsCardConfig;

const hassWith = (states: Record<string, { state: string; unit?: string }>) =>
    ({
        states: Object.fromEntries(
            Object.entries(states).map(([id, s]) => [id, { state: s.state, attributes: { unit_of_measurement: s.unit } }])
        ),
    }) as unknown as HomeAssistant;

describe('candidateEntityIds & resolveEntityId', () => {
    it('follows precedence: manual override -> preset -> ESPHome v3 aliases -> legacy key', () => {
        const cfg = config({
            bmsModel: 'seplos_v3_modbus',
            prefix: 'seplos',
            entities: { power_tube_temperature: 'custom_mos' },
        });
        expect(candidateEntityIds(cfg, EntityKey.power_tube_temperature)).toEqual([
            'sensor.seplos_custom_mos',
            'sensor.seplos_mosfet_temperature',
            'sensor.seplos_power_tube_temperature',
        ]);
    });

    it('resolves ESPHome v3 alias when present in hass.states', () => {
        const hass = hassWith({
            'sensor.jk_bms_mosfet_temperature': { state: '31.2', unit: '°C' },
        });
        expect(resolveEntityId(hass, config(), EntityKey.power_tube_temperature)).toBe(
            'sensor.jk_bms_mosfet_temperature'
        );
    });

    it('suppresses alias and legacy fallback when preset explicitly marks an entity empty', () => {
        const hass = hassWith({
            'sensor.seplos_min_voltage_cell': { state: '7' },
        });
        const cfg = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos' });
        expect(candidateEntityIds(cfg, EntityKey.min_voltage_cell)).toEqual([]);
        expect(resolveEntityId(hass, cfg, EntityKey.min_voltage_cell)).toBeUndefined();
    });

    it('allows manual override even when preset marks an entity empty', () => {
        const cfg = config({
            bmsModel: 'seplos_v3_ble',
            prefix: 'seplos',
            entities: { min_voltage_cell: 'sensor.custom_min_cell' },
        });
        expect(candidateEntityIds(cfg, EntityKey.min_voltage_cell)).toContain('sensor.custom_min_cell');
    });

    it('substitutes {prefix} and {pack} placeholders from packIndex or batteryNumber', () => {
        const cfg = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos', packIndex: 3 });
        expect(resolveEntityId(undefined, cfg, EntityKey.cell_voltage_1)).toBe('sensor.seplos_pack_2_cell_1_voltage');
        expect(resolveEntityId(undefined, cfg, EntityKey.charging, 'switch')).toBe('binary_sensor.seplos_charging');

        const clamped = config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos', batteryNumber: 0 });
        expect(resolveEntityId(undefined, clamped, EntityKey.cell_voltage_1)).toBe('sensor.seplos_pack_0_cell_1_voltage');
    });

    it('supports cells[] and cell_prefix overrides with placeholders', () => {
        const cfgArr = config({ cells: ['sensor.pack_c1', 'sensor.pack_c2'] });
        expect(candidateEntityIds(cfgArr, EntityKey.cell_voltage_2)).toEqual(['sensor.pack_c2']);

        const cfgPrefix = config({ prefix: 'bat1', entities: { cell_prefix: 'sensor.{prefix}_v_' } });
        expect(candidateEntityIds(cfgPrefix, EntityKey.cell_voltage_5)).toEqual(['sensor.bat1_v_5']);
    });
});

describe('getNumericState & getRawState', () => {
    const hass = hassWith({
        'sensor.jk_bms_total_voltage': { state: '53.25', unit: 'V' },
        'sensor.jk_bms_current': { state: 'unavailable', unit: 'A' },
        'sensor.jk_bms_power': { state: 'unknown', unit: 'W' },
        'sensor.jk_bms_state_of_charge': { state: '', unit: '%' },
        'sensor.jk_bms_errors': { state: 'Cell overvoltage' },
        'switch.jk_bms_charging': { state: 'on' },
    });

    it('returns numeric value and unit for valid sensors', () => {
        expect(getNumericState(hass, config(), EntityKey.total_voltage)).toEqual({
            value: 53.25,
            unit: 'V',
            entityId: 'sensor.jk_bms_total_voltage',
            exists: true,
        });
    });

    it('returns null (not 0) for unavailable, unknown, empty, or missing sensors', () => {
        expect(getNumericState(hass, config(), EntityKey.current)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.power)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.state_of_charge)).toMatchObject({ value: null, exists: true });
        expect(getNumericState(hass, config(), EntityKey.balancing_current)).toMatchObject({
            value: null,
            exists: false,
        });
    });

    it('reads non-numeric states and distinguishes missing vs unavailable', () => {
        expect(getRawState(hass, config(), EntityKey.errors)).toMatchObject({
            state: 'Cell overvoltage',
            exists: true,
        });
        expect(getRawState(hass, config(), EntityKey.charging, 'switch')).toMatchObject({
            state: 'on',
            exists: true,
        });
        expect(getRawState(hass, config(), EntityKey.heater, 'switch')).toMatchObject({
            state: null,
            exists: false,
        });
    });

    it('keeps getState backwards-compatible without coercing empty string to 0.00', () => {
        expect(getState(hass, config(), EntityKey.total_voltage, 2)).toBe('53.25');
        expect(getState(hass, config(), EntityKey.state_of_charge, 2)).toBe('');
        expect(getUnit(hass, config(), EntityKey.total_voltage)).toBe('V');
    });
});

describe('balancer bitmask parsing', () => {
    it('parses binary, hex, and decimal bitmasks once per pack', () => {
        const hass = hassWith({
            'sensor.jk_bms_balancer_status_bitmask': { state: '0x0005' },
        });
        const mask = parseBalancerBitmask(hass, config());
        expect(mask).toBe(5n);
        expect(isCellBalancingFromMask(mask, 1)).toBe(true);
        expect(isCellBalancingFromMask(mask, 2)).toBe(false);
        expect(isCellBalancingFromMask(mask, 3)).toBe(true);
        expect(isCellBalancing(hass, config(), 3)).toBe(true);
    });

    it('returns 0n for unavailable or malformed bitmasks', () => {
        const hass = hassWith({
            'sensor.jk_bms_balancer_status_bitmask': { state: 'unavailable' },
        });
        expect(parseBalancerBitmask(hass, config())).toBe(0n);
    });
});

describe('unit normalization & formatting', () => {
    it('normalizes volts, millivolts, and Celsius', () => {
        expect(toVolts(3312, 'mV')).toBeCloseTo(3.312);
        expect(toVolts(3.312, 'V')).toBeCloseTo(3.312);
        expect(toMillivolts(0.015, 'V')).toBeCloseTo(15);
        expect(toMillivolts(15, 'mV')).toBeCloseTo(15);
        expect(toCelsius(86, '°F')).toBeCloseTo(30);
        expect(toCelsius(30, '°C')).toBeCloseTo(30);
        expect(getTemperatureColor(68, '°F')).toBe(getTemperatureColor(20, '°C'));
    });

    it('formats V/mV and Ω/mΩ cleanly', () => {
        expect(formatValue('V', 'mV', 0.0123)).toBe('12 mV');
        expect(formatValue('mV', 'V', 12)).toBe('0.012 V');
        expect(formatValue('ohm', 'mΩ', 0.25)).toBe('250 mΩ');
        expect(formatValue('V', 'mV', 'unavailable')).toBe('-');
    });
});

describe('navigate & configOrEnum', () => {
    it('does nothing when preset suppresses an entity', () => {
        const dispatchEvent = vi.fn();
        const event = { stopPropagation: vi.fn(), target: { dispatchEvent } };
        navigate(event, config({ bmsModel: 'seplos_v3_ble', prefix: 'seplos' }), EntityKey.min_voltage_cell);
        expect(dispatchEvent).not.toHaveBeenCalled();
    });

    it('returns preset value from configOrEnum', () => {
        expect(configOrEnum(config({ bmsModel: 'seplos_v3_ble' }), EntityKey.min_voltage_cell)).toBe('');
        expect(configOrEnum(config({ bmsModel: 'seplos_v3_modbus' }), EntityKey.charging_cycles)).toBe('cycle');
    });
});
