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

export const navigate = (event, config: JkBmsCardConfig, entityId: EntityKey, type: "sensor" | "switch" | "number" = "sensor") => {
    if (!event) {
        return;
    }

    event.stopPropagation();

    const configValue = configOrEnum(config, entityId);
    const fullEntityId = configValue.includes('sensor.') || configValue.includes('switch.') || configValue.includes('number.') ? configValue : type + "." + config?.prefix + "_" + configValue;
    let customEvent = new CustomEvent('hass-more-info', {
        detail: {entityId: fullEntityId},
        composed: true,
    })
    event.target.dispatchEvent(customEvent);
}

export const getState = (hass: HomeAssistant, config: JkBmsCardConfig, entityKey: EntityKey, precision: number = 2, defaultValue = '', type: "sensor" | "switch" | "number" = "sensor"): string => {
    const configValue = configOrEnum(config, entityKey)
    if (!configValue)
        return defaultValue;

    const entityId = configValue.includes('sensor.') || configValue.includes('switch.') || configValue.includes('number.') ? configValue : `${type}.${config!.prefix}_${configValue}`;
    const entity = hass?.states[entityId];
    const state = entity?.state;
    const stateNumeric = Number(state);

    if (!isNaN(stateNumeric))
        return stateNumeric.toFixed(precision);

    return state ?? defaultValue;
}
