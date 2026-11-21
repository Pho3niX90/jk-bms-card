import { HomeAssistant, LovelaceCardEditor, LovelaceConfig } from 'custom-card-helpers';
import { html, LitElement, TemplateResult, css } from 'lit';
import { EDITOR_NAME, EntityKey } from './const';
import { customElement, property, state } from 'lit/decorators.js';
import { JkBmsCardConfig } from './interfaces';
import { localize } from './localize/localize';
import { fireEvent } from './helpers/utils';
import { applyModelDefaults, BMS_PRESETS, BmsModel } from './presets';
import { countMatchedPackEntities } from './helpers/bank-metrics';
import {
    addPackToConfig,
    applyPackEdit,
    buildPackFormSchema,
    getBmsModelOptions,
    normalizeShowHideFlags,
} from './helpers/editor-helpers';

@customElement(EDITOR_NAME)
export class JkBmsCardEditor extends LitElement implements LovelaceCardEditor {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @property({ attribute: false }) private _config!: JkBmsCardConfig;
    @property({ attribute: false }) lovelace?: LovelaceConfig;

    @state() private _dynamicEntitySchema: Array<Record<string, unknown>> = [];
    @state() private _openPackPanels: Set<number> = new Set();

    private _cachedPackSchema?: Array<Record<string, unknown>>;
    private _cachedPackSchemaLang?: string;
    private _lastStatesRef?: HomeAssistant['states'];
    private _lastPacksRef?: JkBmsCardConfig['packs'];
    private _cachedMatchCounts: number[] = [];

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
            .packs-section {
                margin-top: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .packs-section-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-weight: 500;
                font-size: 14px;
                padding: 4px 0;
            }
            .pack-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 6px 8px 6px 12px;
                width: 100%;
                box-sizing: border-box;
            }
            .pack-header-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .pack-header-title {
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .pack-header-prefix {
                font-size: 12px;
                color: var(--secondary-text-color);
                font-family: monospace;
            }
            .entity-count-pill {
                font-size: 11px;
                padding: 2px 7px;
                border-radius: 999px;
                background: var(--secondary-background-color, rgba(127, 127, 127, 0.14));
                color: var(--secondary-text-color);
                white-space: nowrap;
            }
            .entity-count-pill.found {
                color: var(--success-color, #41cd52);
                background: rgba(65, 205, 82, 0.14);
            }
            .pack-form-body {
                padding: 12px 16px 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .pack-actions-footer {
                display: flex;
                justify-content: flex-end;
                border-top: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
                padding-top: 10px;
            }
            .action-btn {
                border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
                background: var(--secondary-background-color, transparent);
                color: var(--primary-text-color);
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 13px;
                cursor: pointer;
            }
            .action-btn:hover {
                border-color: var(--primary-color, #3090c7);
            }
            .remove-btn {
                border: 1px solid rgba(244, 67, 54, 0.4);
                background: transparent;
                color: var(--error-color, #f44336);
                cursor: pointer;
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 12px;
            }
            .packs-empty-hint {
                font-size: 12.5px;
                color: var(--secondary-text-color);
                padding: 8px 12px;
                border: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.35));
                border-radius: 8px;
            }
        `;
    }

    private readonly _fixedEntities = Object.values(EntityKey).filter(
        key => !key.startsWith('cell_voltage_') && !key.startsWith('cell_resistance_')
    );

    private readonly _computeLabel = (data: { name: string }) => localize(`config.${data.name}`) ?? data.name;

    public setConfig(config: JkBmsCardConfig): void {
        this._config = { ...config };
        this._updateDynamicEntitySchema();
    }

    private _updateDynamicEntitySchema(): void {
        const cellCount = Math.min(this._config?.cellCount ?? 16, 96);
        const dynamic: Array<Record<string, unknown>> = [];

        for (let i = 1; i <= cellCount; i++) {
            const key = `cell_voltage_${i}`;
            if (key in EntityKey) {
                dynamic.push({
                    name: key,
                    selector: { entity: {} },
                });
            }
        }

        for (let i = 1; i <= cellCount; i++) {
            const key = `cell_resistance_${i}`;
            if (key in EntityKey) {
                dynamic.push({
                    name: key,
                    selector: { entity: {} },
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

    private _emitConfig(config: JkBmsCardConfig): void {
        const normalized = normalizeShowHideFlags(config);
        this._config = normalized;
        fireEvent(this, 'config-changed', { config: this._config });
    }

    private renderBoolean(label: string, configKey: keyof JkBmsCardConfig, defaultValue = false) {
        const raw = this._config?.[configKey];
        const checked = raw === undefined ? defaultValue : Boolean(raw);
        return html`
            <div class="boolean-row">
                <span class="label">${label}</span>
                <ha-switch
                    .checked=${checked}
                    @change=${(ev: Event) => this._handleSwitchChange(configKey, ev)}
                ></ha-switch>
            </div>
        `;
    }

    private _handleSwitchChange(key: keyof JkBmsCardConfig, ev: Event): void {
        const target = ev.target as HTMLInputElement;
        const newValue = !!target.checked;

        const config: JkBmsCardConfig = { ...this._config!, [key]: newValue };
        this._emitConfig(config);
    }

    private _addPack(): void {
        const { config, newIndex } = addPackToConfig(this._config);
        const nextOpen = new Set(this._openPackPanels);
        nextOpen.add(newIndex);
        this._openPackPanels = nextOpen;
        this._emitConfig(config);
    }

    private _removePack(index: number): void {
        const currentPacks = Array.isArray(this._config.packs) ? this._config.packs : [];
        const nextPacks = currentPacks.filter((_, i) => i !== index);
        const nextOpen = new Set<number>();
        for (const openIdx of this._openPackPanels) {
            if (openIdx < index) nextOpen.add(openIdx);
            else if (openIdx > index) nextOpen.add(openIdx - 1);
        }
        this._openPackPanels = nextOpen;

        const nextConfig: JkBmsCardConfig = { ...this._config };
        if (nextPacks.length === 0) {
            delete nextConfig.packs;
        } else {
            nextConfig.packs = nextPacks;
        }
        this._emitConfig(nextConfig);
    }

    private _togglePackPanel(index: number, expanded: boolean): void {
        if (this._openPackPanels.has(index) === expanded) return;
        const next = new Set(this._openPackPanels);
        if (expanded) next.add(index);
        else next.delete(index);
        this._openPackPanels = next;
    }

    private _packValueChanged(index: number, ev: CustomEvent): void {
        const incoming = ev.detail.value as Record<string, unknown>;
        const updated = applyPackEdit(this._config, index, incoming, this.hass);
        this._emitConfig(updated);
    }

    private _getPackFormSchema(): Array<Record<string, unknown>> {
        const langKey = `${this._config?.language ?? 'auto'}:${this.hass?.language ?? ''}`;
        if (!this._cachedPackSchema || this._cachedPackSchemaLang !== langKey) {
            const options = getBmsModelOptions(localize('config.inheritModel'));
            this._cachedPackSchema = buildPackFormSchema(options);
            this._cachedPackSchemaLang = langKey;
        }
        return this._cachedPackSchema;
    }

    private _getPackMatchCounts(): number[] {
        const packs = Array.isArray(this._config.packs) ? this._config.packs : [];
        if (this._lastStatesRef === this.hass?.states && this._lastPacksRef === this._config.packs) {
            return this._cachedMatchCounts;
        }
        this._lastStatesRef = this.hass?.states;
        this._lastPacksRef = this._config.packs;
        this._cachedMatchCounts = packs.map((pack, index) =>
            countMatchedPackEntities(this.hass, this._config, pack, index)
        );
        return this._cachedMatchCounts;
    }

    private _renderPacksEditor(): TemplateResult {
        const packs = Array.isArray(this._config.packs) ? this._config.packs : [];
        const packSchema = this._getPackFormSchema();
        const matchCounts = this._getPackMatchCounts();

        return html`
            <div class="packs-section">
                <div class="packs-section-header">
                    <span>${localize('config.packs')} (${packs.length})</span>
                    <button type="button" class="action-btn" @click=${() => this._addPack()}>
                        + ${localize('config.addPack')}
                    </button>
                </div>

                ${packs.length === 0
                    ? html`<div class="packs-empty-hint">${localize('config.packsEmptyHint')}</div>`
                    : packs.map((pack, index) => {
                          const isOpen = this._openPackPanels.has(index);
                          const matched = matchCounts[index] ?? 0;
                          const formData = {
                              ...pack,
                              bmsModel: pack.bmsModel ?? '__inherit__',
                          };

                          return html`
                              <ha-expansion-panel
                                  outlined
                                  .expanded=${isOpen}
                                  @expanded-changed=${(e: CustomEvent) =>
                                      this._togglePackPanel(
                                          index,
                                          Boolean(e.detail?.expanded ?? e.detail?.value)
                                      )}
                              >
                                  <div slot="header" class="pack-panel-header">
                                      <div class="pack-header-meta">
                                          <span class="pack-header-title">
                                              ${pack.name?.trim() || `Pack ${index + 1}`}
                                          </span>
                                          <span class="pack-header-prefix">${pack.prefix}</span>
                                      </div>
                                      <span class="entity-count-pill ${matched > 0 ? 'found' : ''}">
                                          ${matched} ${localize('config.entitiesFound')}
                                      </span>
                                  </div>
                                  ${isOpen
                                      ? html`
                                            <div class="pack-form-body">
                                                <ha-form
                                                    .hass=${this.hass}
                                                    .data=${formData}
                                                    .computeLabel=${this._computeLabel}
                                                    .schema=${packSchema}
                                                    @value-changed=${(e: CustomEvent) =>
                                                        this._packValueChanged(index, e)}
                                                ></ha-form>
                                                <div class="pack-actions-footer">
                                                    <button
                                                        type="button"
                                                        class="remove-btn"
                                                        @click=${() => this._removePack(index)}
                                                    >
                                                        ${localize('config.removePack')}
                                                    </button>
                                                </div>
                                            </div>
                                        `
                                      : ''}
                              </ha-expansion-panel>
                          `;
                      })}
            </div>
        `;
    }

    protected render(): TemplateResult | void {
        if (!this._config || !this.hass) {
            return html``;
        }

        const layout = this._config.layout ?? 'default';
        const isBankOverview = layout === 'bank-overview';
        const hasConfiguredPacks = isBankOverview && Array.isArray(this._config.packs) && this._config.packs.length > 0;
        const effectiveShowMain = this._config.showMain !== false;
        const effectiveShowCells = this._config.showCells !== false;

        const entityConfigs = [
            { name: 'cell_prefix', selector: { text: {} } },
            { name: 'cell_resistance_prefix', selector: { text: {} } },
            ...this._fixedEntities.map(key => ({
                name: key,
                selector: { entity: {} },
            })),
            ...this._dynamicEntitySchema,
        ];

        const schema: Array<Record<string, unknown>> = [
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
                                            { label: 'English', value: 'en' },
                                            { label: 'Română', value: 'ro' },
                                            { label: 'Українська', value: 'uk' },
                                            { label: 'German', value: 'de' },
                                            { label: 'Русский', value: 'ru' },
                                            { label: 'Polski', value: 'pl' },
                                            { label: 'Français', value: 'fr' },
                                            { label: 'Español', value: 'es' },
                                            { label: '中文', value: 'zh' },
                                        ],
                                        mode: 'dropdown',
                                    },
                                },
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
                            ...(!isBankOverview
                                ? [
                                      {
                                          name: 'titleAction',
                                          selector: {
                                              select: {
                                                  options: [
                                                      { label: 'Device page', value: 'device' },
                                                      { label: 'Runtime history', value: 'more-info' },
                                                  ],
                                              },
                                          },
                                      },
                                  ]
                                : []),
                        ],
                    },
                ],
            },
            {
                type: 'grid',
                title: hasConfiguredPacks ? localize('config.defaultModel') : localize('config.prefix'),
                schema: [
                    {
                        type: 'grid',
                        column_min_width: '200px',
                        schema: [
                            {
                                name: 'bmsModel',
                                selector: {
                                    select: {
                                        mode: 'dropdown',
                                        options: Object.entries(BMS_PRESETS).map(([value, preset]) => ({
                                            label: preset.label,
                                            value,
                                        })),
                                    },
                                },
                            },
                            ...(!hasConfiguredPacks
                                ? [
                                      { name: 'prefix', selector: { text: {} } },
                                      { name: 'batteryName', selector: { text: {} } },
                                      ...(this._config.bmsModel === 'seplos_v3_ble'
                                          ? [
                                                {
                                                    name: 'packIndex',
                                                    selector: { number: { min: 1, max: 16, step: 1, mode: 'box' } },
                                                },
                                            ]
                                          : []),
                                      { name: 'deviceId', selector: { text: {} } },
                                  ]
                                : []),
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
                                            { label: 'Core Reactor', value: 'core-reactor' },
                                            { label: 'Bank Overview', value: 'bank-overview' },
                                        ],
                                    },
                                },
                            },
                            {
                                name: 'deltaVoltageUnit',
                                selector: {
                                    select: {
                                        options: [
                                            { label: 'Volts (V)', value: 'V' },
                                            { label: 'Millivolts (mV)', value: 'mV' },
                                        ],
                                    },
                                },
                            },
                            {
                                name: 'resistanceUnit',
                                selector: {
                                    select: {
                                        options: [
                                            { label: 'Ohms (Ω)', value: 'Ω' },
                                            { label: 'MilliOhms (mΩ)', value: 'mΩ' },
                                        ],
                                    },
                                },
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
                                            { label: 'Voltage Gradient', value: 'gradient' },
                                        ],
                                    },
                                },
                            },
                            ...(isBankOverview
                                ? [
                                      {
                                          name: 'deltaWarningMv',
                                          selector: { number: { min: 1, max: 500, step: 1, mode: 'box' } },
                                      },
                                  ]
                                : [
                                      {
                                          name: 'cellOrientation',
                                          selector: {
                                              select: {
                                                  options: [
                                                      { label: 'Vertical', value: 'vertical' },
                                                      { label: 'Horizontal', value: 'horizontal' },
                                                  ],
                                              },
                                          },
                                      },
                                  ]),
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
                            { name: 'cellColumns', selector: { number: { min: 1, max: 8, step: 1 } } },
                        ],
                    },
                ],
            },
            {
                type: 'grid',
                schema: [
                    {
                        name: 'cellLayout',
                        selector: {
                            select: {
                                options: [
                                    { label: 'Incremental', value: 'incremental' },
                                    { label: 'Bank Mode', value: 'bankMode' },
                                ],
                            },
                        },
                    },
                    {
                        name: 'socDecimals',
                        title: localize('config.socDecimals'),
                        selector: { number: { min: 0, max: 2, step: 1 } },
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
                                selector: { number: { min: 0, max: 2, step: 1 } },
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
                                name: 'hasHeater',
                                selector: {
                                    select: {
                                        multiple: false,
                                        mode: 'list',
                                        options: [
                                            { label: 'Yes', value: '1' },
                                            { label: 'No', value: '0' },
                                        ],
                                    },
                                },
                            },
                        ],
                    },
                ],
            },
        ];

        if (!isBankOverview) {
            schema.push({
                type: 'expandable',
                title: localize('config.manualAssignment'),
                schema: [
                    {
                        name: 'entities',
                        type: 'grid',
                        schema: entityConfigs,
                    },
                ],
            });
        }

        const showButtonsToggle =
            layout === 'default' ||
            layout === 'bank-overview' ||
            (effectiveShowMain && layout === 'core-reactor');
        const showMainStatsToggle =
            effectiveShowMain && (layout === 'core-reactor' || layout === 'bank-overview');

        return html`
            <ha-form
                .hass=${this.hass}
                .data=${this._config}
                .computeLabel=${this._computeLabel}
                .schema=${schema}
                @value-changed=${this._valueChanged.bind(this)}
            ></ha-form>

            ${isBankOverview ? this._renderPacksEditor() : ''}

            <ha-expansion-panel outlined style="margin-top: 10px;">
                <div slot="header" style="padding: 8px 16px; font-weight: 500;">
                    ${localize('config.titleShowHide')}
                </div>
                <div
                    style="padding: 16px;
                                display: grid;
                                grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
                                gap: 16px;"
                >
                    ${this.renderBoolean(localize('config.showTitle'), 'showTitle', true)}
                    ${showButtonsToggle ? this.renderBoolean(localize('config.showButtons'), 'showButtons', true) : ''}
                    ${this.renderBoolean(localize('config.showMain'), 'showMain', true)}
                    ${effectiveShowMain && layout === 'default'
                        ? this.renderBoolean(localize('config.showCondensed'), 'showCondensed', true)
                        : ''}
                    ${showMainStatsToggle
                        ? this.renderBoolean(localize('config.showMainStats'), 'showMainStats', true)
                        : ''}
                    ${this.renderBoolean(localize('config.showCells'), 'showCells', true)}
                    ${effectiveShowCells
                        ? this.renderBoolean(localize('config.showResistances'), 'showResistances', true)
                        : ''}
                    ${this.renderBoolean(localize('config.showCardVersion'), 'showCardVersion', false)}
                </div>
            </ha-expansion-panel>
        `;
    }

    private _valueChanged(ev: CustomEvent): void {
        const previousModel = this._config?.bmsModel as BmsModel | undefined;
        let config: JkBmsCardConfig = { ...this._config, ...ev.detail.value };

        if (config.bmsModel !== previousModel) {
            config = applyModelDefaults(config, previousModel);
        }

        if ('cellCount' in ev.detail.value) {
            this._updateDynamicEntitySchema();
        }

        this._emitConfig(config);
    }
}
