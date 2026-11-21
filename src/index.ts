import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { EDITOR_NAME, EntityKey, MAIN_NAME } from './const';
import { JkBmsCardConfig } from './interfaces';
import { localize } from './localize/localize';

import { version } from '../package.json';
import { globalData } from './helpers/globals';
import './layouts/default';
import './layouts/core-reactor';
import './layouts/bank-overview';

export const CARD_VERSION = version;

console.groupCollapsed(
    `%c🔋 JK-BMS Battery Card%c   ready!  🚀 (v${CARD_VERSION})`,
    'background: linear-gradient(to right, #41cd52, #3090c7); color: white; font-weight: bold; padding: 2px 8px; border-radius: 6px;',
    'background: none; color: #AAA; font-style: italic;'
);
console.log('%c📖 Docs:', 'color: #41cd52; font-weight: bold;', 'https://github.com/Pho3niX90/jk-bms-card');
console.groupEnd();

@customElement(MAIN_NAME)
export class JkBmsCard extends LitElement {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @property({ attribute: false }) private _config?: JkBmsCardConfig;

    public setConfig(config: JkBmsCardConfig): void {
        if (!config) {
            throw new Error('Invalid jk-bms-card configuration');
        }

        if (config.packs !== undefined) {
            if (!Array.isArray(config.packs)) {
                throw new Error('`packs` must be an array of pack configurations');
            }
            config.packs.forEach((pack, index) => {
                if (!pack || typeof pack !== 'object') {
                    throw new Error(`packs[${index}] must be an object`);
                }
                if (typeof pack.prefix !== 'string' || pack.prefix.trim().length === 0) {
                    throw new Error(`packs[${index}] must define a non-empty \`prefix\``);
                }
            });
        }

        this._config = JkBmsCard.getStubConfig();
        this._config = { ...this._config, ...config };
        globalData.cardConfig = this._config;
    }

    static getStubConfig() {
        return {
            language: 'auto',
            title: localize('title'),
            bmsModel: 'jk',
            prefix: 'jk_bms',
            batteryName: '',
            cellCount: 16,
            cellColumns: 2,
            cellLayout: 'bankMode',
            deltaVoltageUnit: 'V',
            resistanceUnit: 'Ω',
            deltaWarningMv: 30,
            tempSensorsCount: 0,
            hasHeater: 0,
            socDecimals: 2,
            customDecimals: 2,
            titleAction: 'more-info',
            showTitle: true,
            showButtons: true,
            showMain: true,
            showCondensed: true,
            showMainStats: true,
            showCells: true,
            showResistances: true,
            showCardVersion: false,
            entities: Object.keys(EntityKey).reduce((acc, key) => {
                acc[key as EntityKey] = '';
                return acc;
            }, {} as Record<EntityKey, string>),
        } as unknown as JkBmsCardConfig;
    }

    public static async getConfigElement() {
        await import('./editor');
        return document.createElement(EDITOR_NAME) as LovelaceCardEditor;
    }

    public getCardSize(): number {
        if (this._config?.layout === 'bank-overview') {
            const packCount = Math.max(this._config.packs?.length ?? 1, 1);
            return 3 + Math.ceil(packCount * 1.2);
        }
        return 3;
    }

    public getGridOptions() {
        if (this._config?.layout === 'bank-overview') {
            const packCount = Math.max(this._config.packs?.length ?? 1, 1);
            return {
                columns: 12,
                min_columns: 6,
                rows: Math.min(4 + packCount, 12),
                min_rows: 3,
            };
        }
        return {
            columns: 12,
            min_columns: 6,
        };
    }

    render() {
        globalData.hass = this.hass;
        if (!this.hass || !this._config) return html``;

        if (this._config.layout === 'core-reactor') {
            return html`<jk-bms-core-reactor-layout .hass=${this.hass} .config=${this._config}></jk-bms-core-reactor-layout>`;
        }

        if (this._config.layout === 'bank-overview') {
            return html`<jk-bms-bank-overview-layout .hass=${this.hass} .config=${this._config}></jk-bms-bank-overview-layout>`;
        }

        return html`<jk-bms-default-layout .hass=${this.hass} .config=${this._config}></jk-bms-default-layout>`;
    }
}

const customWindow = window as unknown as { customCards?: Array<Record<string, unknown>> };
customWindow.customCards = customWindow.customCards || [];
customWindow.customCards.push({
    type: MAIN_NAME,
    name: 'JK BMS Card',
    preview: true,
    description: localize('common.description'),
    configurable: true,
});
