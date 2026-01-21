import {HomeAssistant} from 'custom-card-helpers';
import {EntityKey} from '../const';
import {JkBmsCardConfig} from '../interfaces';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fireEvent(node: HTMLElement, type: string, detail: any, options?: any) {
    options = options || {};
    detail = detail === null || detail === undefined ? {} : detail;
    const event = new Event(type, {
        bubbles: options.bubbles === undefined ? true : options.bubbles,
        cancelable: Boolean(options.cancelable),
        composed: options.composed === undefined ? true : options.composed,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event as any).detail = detail;
    node.dispatchEvent(event);
    return event;
}

export const configOrEnum = (config: JkBmsCardConfig, entityId: EntityKey) => {
    const configValue = config?.entities[entityId]?.toString()?.trim();
    return configValue && configValue.length > 1 ? configValue : entityId?.toString();
}

export const navigate = (event, config: JkBmsCardConfig, entityId: EntityKey, type: "sensor" | "switch" | "number" | "binary_sensor" = "sensor") => {
    if (!event) {
        return;
    }

    event.stopPropagation();

    const configValue = configOrEnum(config, entityId);
    const fullEntityId = configValue.includes('sensor.') || configValue.includes('switch.') || configValue.includes('number.') || configValue.includes('binary_sensor.') ? configValue : type + "." + config?.prefix + "_" + configValue;
    let customEvent = new CustomEvent('hass-more-info', {
        detail: {entityId: fullEntityId},
        composed: true,
    })
    event.target.dispatchEvent(customEvent);
}

export const getState = (hass: HomeAssistant, config: JkBmsCardConfig, entityKey: EntityKey, precision: number = 2, defaultValue = '', type: "sensor" | "switch" | "number" | "binary_sensor" = "sensor"): string => {
    const configValue = configOrEnum(config, entityKey)
    if (!configValue)
        return defaultValue;

    const entityId = configValue.includes('sensor.') || configValue.includes('switch.') || configValue.includes('number.') || configValue.includes('binary_sensor.') ? configValue : `${type}.${config!.prefix}_${configValue}`;
    const entity = hass?.states[entityId];
    const state = entity?.state;
    const stateNumeric = Number(state);

    if (!isNaN(stateNumeric))
        return stateNumeric.toFixed(precision);

    return state ?? defaultValue;
}

export const formatDeltaVoltage = (
    unit: 'V' | 'mV' = 'V',
    maxDeltaV: number | string
): string => {
    const valInVolts = typeof maxDeltaV === 'string'
        ? parseFloat(maxDeltaV)
        : maxDeltaV;

    if (isNaN(valInVolts)) return '-';

    if (unit === 'mV') {
        return `${(valInVolts * 1000).toFixed(0)} mV`;
    }

    const formattedVolts = valInVolts.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
    });

    return `${formattedVolts} V`;
}
