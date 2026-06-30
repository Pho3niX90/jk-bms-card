import { HomeAssistant, LovelaceCardEditor, LovelaceConfig } from 'custom-card-helpers';
import { html, LitElement, TemplateResult, css } from 'lit';
import { EDITOR_NAME, EntityKey } from './const';
import { customElement, property, state } from 'lit/decorators.js';
import { JkBmsCardConfig } from './interfaces';
import { localize } from './localize/localize';
import { fireEvent } from './helpers/utils';

@customElement(EDITOR_NAME)
export class JkBmsCardEditor extends LitElement implements LovelaceCardEditor {
    @property() public hass!: HomeAssistant;
    @property() private _config!: JkBmsCardConfig;
    @property() lovelace?: LovelaceConfig;

    @state() private _dynamicEntitySchema: any[] = [];

    static get styles() {
        return css`
            .boolean-wrapper {
                display: block;
                padding: 12px 0;
            }
            .boolean-row {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                margin-bottom: 16px;
                gap: 6px;
            }
            .label {
                font-size: 14px;
                color: var(--primary-text-color);
                line-height: 1.3;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
                max-height: 2.6em;
                word-break: break-word;
            }
        `;
    }
    
    private readonly _fixedEntities = Object.values(EntityKey).filter(key => 
        !key.startsWith('cell_voltage_') && 
        !key.startsWith('cell_resistance_')
    );

    public setConfig(config: JkBmsCardConfig): void {
        this._config = { ...config };
        this._updateDynamicEntitySchema();
    }

    private _updateDynamicEntitySchema(): void {
        const cellCount = Math.min(this._config?.cellCount ?? 16, 96);

        const dynamic: any[] = [];

        // Cell Voltages 1 → cellCount
        for (let i = 1; i <= cellCount; i++) {
            const key = `cell_voltage_${i}`;
            if (key in EntityKey) {
                dynamic.push({
                    name: key,
                    selector: { entity: {} }
                });
            }
        }

        // Cell Resistances 1 → cellCount
        for (let i = 1; i <= cellCount; i++) {
            const key = `cell_resistance_${i}`;
            if (key in EntityKey) {
                dynamic.push({
                    name: key,
                    selector: { entity: {} }
                });
            }
        }

        this._dynamicEntitySchema = dynamic;
    }

    protected willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
        super.willUpdate(changedProperties);

        if (changedProperties.has('_config')) {
            const oldConfig = changedProperties.get('_config') as JkBmsCardConfig | undefined;
            if (oldConfig?.cellCount !== this._config?.cellCount) {
                this._updateDynamicEntitySchema();
            }
        }
    }

    private renderBoolean(label: string, configKey: keyof JkBmsCardConfig) {
        return html`
            <div class="boolean-row">
                <span class="label">${label}</span>
                <ha-switch
                    .checked=${Boolean(this._config?.[configKey] ?? false)}
                    @change=${(ev: Event) => this._handleSwitchChange(configKey, ev)}
                ></ha-switch>
            </div>
        `;
    }

    private _handleSwitchChange(key: keyof JkBmsCardConfig, ev: Event): void {
        const target = ev.target as any;
        const newValue = !!target.checked;

        const config = { ...this._config! };
        config[key] = newValue as any;

        const shouldShowMainStats = config.showMain === true && config.layout === 'core-reactor';

        if (!shouldShowMainStats && config.showMainStats !== undefined) {
            delete config.showMainStats;
        }
        if (shouldShowMainStats && config.showMainStats === undefined) {
            config.showMainStats = true;
        }

        this._config = config;

        fireEvent(this, 'config-changed', { config: this._config });
    }

    protected render(): TemplateResult | void {
        if (!this._config || !this.hass) {
            return html``;
        }

        const entityConfigs = [
            {
                name: 'cell_prefix',
                selector: { text: {} }
            },
            {
                name: 'cell_resistance_prefix',
                selector: { text: {} }
            },
            ...this._fixedEntities.map(key => ({
                name: key,
                selector: { entity: {} }
            })),
            ...this._dynamicEntitySchema
        ];

        return html`
			<ha-form
				.hass=${this.hass}
				.data=${this._config}
				.computeLabel=${this._computeLabelCallback.bind(this)}
				.schema=${[
                {
                    type: 'grid',
                    title: localize('config.language'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                {
                                name: 'language',
                                selector: {
                                    select: {
                                    options: [
                                        { label: 'Auto (follow HA)', value: 'auto' },
                                        { label: 'English',          value: 'en' },
                                        { label: 'Română',           value: 'ro' },
                                        { label: 'Українська',       value: 'uk' },
                                        { label: 'German',           value: 'de' },
										{ label: 'Русский',			 value: 'ru' },
										{ label: 'Polski',           value: 'pl' },
    									{ label: 'Français',         value: 'fr' },
    									{ label: 'Español',          value: 'es' },
    									{ label: '中文',              value: 'zh' }
                                    ],
                                    mode: 'dropdown',
                                    }
                                }
                                },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.title'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                { name: 'title', selector: { text: {} } },
                                {
                                    name: 'titleAction',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Device page', value: 'device' },
                                                { label: 'Runtime history', value: 'more-info' }
                                            ]
                                        }
                                    }
                                },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.prefix'),
                    schema: [
                        {
                            type: 'grid',
                            column_min_width: '200px',
                            schema: [
                                { name: 'prefix', selector: { text: {} } },
                                { name: 'batteryName', selector: { text: {} } },
                                { name: 'deviceId', selector: { text: {} } },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.layout'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                {
                                    name: 'layout',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Default', value: 'default' },
                                                { label: 'Core Reactor', value: 'core-reactor' }
                                            ]
                                        }
                                    }
                                },
                                {
                                    name: 'deltaVoltageUnit',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Volts (V)', value: 'V' },
                                                { label: 'Millivolts (mV)', value: 'mV' }
                                            ]
                                        }
                                    }
                                },                                
                                {
                                    name: 'resistanceUnit',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Ohms (Ω)', value: 'Ω' },
                                                { label: 'MilliOhms (mΩ)', value: 'mΩ' }
                                            ]
                                        }
                                    }
                                },                                
                            ],
                        },
                        {
                            type: 'grid',
                            column_min_width: '200px',
                            schema: [
                                {
                                    name: 'cellColorMode',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Progress Bar', value: 'progress' },
                                                { label: 'Voltage Gradient', value: 'gradient' }
                                            ]
                                        }
                                    }
                                },
                                {
                                    name: 'cellOrientation',
                                    selector: {
                                        select: {
                                            options: [
                                                { label: 'Vertical', value: 'vertical' },
                                                { label: 'Horizontal', value: 'horizontal' }
                                            ]
                                        }
                                    }
                                },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    schema: [
                        {
                            type: 'grid',
                            column_min_width: '200px',
                            schema: [
                                { name: 'minCellVoltage', selector: { number: { min: 2.0, max: 4.0, step: 0.01, mode: 'box' } } },
                                { name: 'maxCellVoltage', selector: { number: { min: 2.0, max: 4.0, step: 0.01, mode: 'box' } } },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.cellCount'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                { name: 'cellCount', selector: { number: { min: 2, max: 48, step: 2 } } },
                                { name: 'cellColumns', selector: { number: { min: 1, max: 8, step: 1 } } }
                            ]
                        },
                    ],
                },
                {
                    type: 'grid',
                    schema: [
                        {
                            name: 'cellLayout', selector: {
                                select: {
                                    options: [
                                        { label: 'Incremental', value: 'incremental' },
                                        { label: 'Bank Mode', value: 'bankMode' },
                                    ]
                                }
                            }
                        },
                        {
                            name: 'socDecimals', 
                            title: localize('config.socDecimals'), 
                            selector: { number: { min: 0, max: 2, step: 1 } }
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.tempSensorsCount'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                { name: 'tempSensorsCount', selector: { number: { min: 0, max: 4, step: 2 } } },
                                {
                                    name: 'customDecimals', 
                                    title: localize('config.customDecimals'),
                                    selector: { number: { min: 0, max: 2, step: 1 } }
                                },
                            ],
                        },
                    ],
                },
                {
                    type: 'grid',
                    title: localize('config.hasHeater'),
                    schema: [
                        {
                            type: 'grid',
                            schema: [
                                {
                                    name: 'hasHeater', selector: {
                                        select: {
                                            multiple: false, mode: "list", options: [
                                                { label: "Yes", value: "1" },
                                                { label: "No", value: "0" }
                                            ]
                                        }
                                    }
                                },
                            ],
                        },
                    ],
                },
                {
                    type: 'expandable',
                    title: localize('config.manualAssignment'),
                    schema: [
                        {
                            name: 'entities',
                            type: 'grid',
                            schema: entityConfigs,
                        },
                    ],
                },
            ]}
				@value-changed=${this._valueChanged.bind(this)}
			></ha-form>

            ${html`
                <ha-expansion-panel outlined style="margin-top: 10px;">
                    <div slot="header" style="padding: 8px 16px; font-weight: 500;">
                        ${localize('config.titleShowHide')}
                    </div>
                    <div style="padding: 16px; 
                                display: grid; 
                                grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); 
                                gap: 16px;">
                        ${this.renderBoolean(localize('config.showTitle'), 'showTitle')}
                        ${(this._config?.showMain === true && this._config?.layout === 'core-reactor') || 
                            this._config?.layout === 'default'
                            ? this.renderBoolean(localize('config.showButtons'), 'showButtons')
                            : ''}
                        ${this.renderBoolean(localize('config.showMain'), 'showMain')}
                        ${(this._config?.showMain === true && this._config?.layout === 'default')
                            ? this.renderBoolean(localize('config.showCondensed'), 'showCondensed')
                            : ''}
                        ${this._config?.showMain === true && this._config?.layout === 'core-reactor'
                            ? this.renderBoolean(localize('config.showMainStats'), 'showMainStats')
                            : ''}

                        ${this.renderBoolean(localize('config.showCells'), 'showCells')}
                        ${this._config?.showCells === true ?
                            this.renderBoolean(localize('config.showResistances'), 'showResistances') 
                            : ''}
                        ${this.renderBoolean(localize('config.showCardVersion'), 'showCardVersion')}
                    </div>
                </ha-expansion-panel>
            `}
		`;
    }
    private _computeLabelCallback = (data) => localize(`config.${data.name}`) ?? data.name;
    
    private _valueChanged(ev: CustomEvent): void {
        const config = { ...this._config };           // copy
        Object.assign(config, ev.detail.value);       // merge shallow

        this._config = config;

        if ('cellCount' in ev.detail.value) {
            this._updateDynamicEntitySchema();
        }
        const shouldShowMainStats =
            config?.showMain === true &&
            config?.layout === 'core-reactor';

        const shouldShowCellsResistances = 
            config?.showCells === true;

        if (!shouldShowMainStats && config.showMainStats !== undefined) {
            delete config.showMainStats;
        }
        if (shouldShowMainStats && config.showMainStats === undefined) {
            config.showMainStats = true;
        }

        if(!shouldShowCellsResistances && config.showResistances !== undefined) {
            delete config.showResistances
        }
        if(shouldShowCellsResistances && config.showResistances === undefined) {
            config.showResistances = true;
        }

        fireEvent(this, 'config-changed', { config: this._config });
    }
}
