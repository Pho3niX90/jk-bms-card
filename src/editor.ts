import { HomeAssistant, LovelaceCardEditor, LovelaceConfig } from 'custom-card-helpers';
import { html, LitElement, TemplateResult, css } from 'lit';
import { EDITOR_NAME, EntityKey } from './const';
import { customElement, property, state } from 'lit/decorators.js';
import { JkBmsCardConfig, JkBmsPackConfig } from './interfaces';
import { localize } from './localize/localize';
import { fireEvent } from './helpers/utils';
import { applyModelDefaults, applyPackModelDefaults, BMS_PRESETS, BmsModel } from './presets';
import { countMatchedPackEntities } from './helpers/bank-metrics';

const KNOWN_SENSOR_SUFFIXES = [
    '_total_voltage',
    '_state_of_charge',
    '_delta_cell_voltage',
    '_delta_voltage',
    '_cell_voltage_1',
    '_pack_0_cell_1_voltage',
    '_mosfet_temperature',
    '_power_tube_temperature',
];

@customElement(EDITOR_NAME)
export class JkBmsCardEditor extends LitElement implements LovelaceCardEditor {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @property({ attribute: false }) private _config!: JkBmsCardConfig;
    @property({ attribute: false }) lovelace?: LovelaceConfig;

    @state() private _dynamicEntitySchema: Array<Record<string, unknown>> = [];
    @state() private _openPackPanels: Set<number> = new Set();

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
                color: #41cd52;
                background: rgba(65, 205, 82, 0.14);
            }
            .pack-form-body {
                padding: 12px 16px 16px;
            }
            .btn-row {
                display: flex;
                align-items: center;
                gap: 6px;
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
                border: none;
                background: transparent;
                color: var(--error-color, #f44336);
                cursor: pointer;
                padding: 4px 6px;
                border-radius: 4px;
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

    private _normalizeShowHideFlags(config: JkBmsCardConfig): void {
        const layout = config.layout ?? 'default';
        const shouldShowMainStats =
            config.showMain === true && (layout === 'core-reactor' || layout === 'bank-overview');
        const shouldShowCellsResistances = config.showCells === true;

        if (!shouldShowMainStats && config.showMainStats !== undefined) {
            delete config.showMainStats;
        }
        if (shouldShowMainStats && config.showMainStats === undefined) {
            config.showMainStats = true;
        }

        if (!shouldShowCellsResistances && config.showResistances !== undefined) {
            delete config.showResistances;
        }
        if (shouldShowCellsResistances && config.showResistances === undefined) {
            config.showResistances = true;
        }
    }

    private _emitConfig(config: JkBmsCardConfig): void {
        this._normalizeShowHideFlags(config);
        this._config = config;
        fireEvent(this, 'config-changed', { config: this._config });
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
        const target = ev.target as HTMLInputElement;
        const newValue = !!target.checked;

        const config: JkBmsCardConfig = { ...this._config!, [key]: newValue };
        this._emitConfig(config);
    }

    private _inferPrefixFromDevice(deviceId: string): string | undefined {
        const entities = (this.hass as unknown as { entities?: Record<string, { device_id?: string }> })?.entities;
        if (!entities || !deviceId) return undefined;

        for (const [entityId, meta] of Object.entries(entities)) {
            if (meta?.device_id !== deviceId) continue;
            const dotIdx = entityId.indexOf('.');
            if (dotIdx === -1) continue;
            const objectId = entityId.slice(dotIdx + 1);
            for (const suffix of KNOWN_SENSOR_SUFFIXES) {
                if (objectId.endsWith(suffix)) {
                    const candidate = objectId.slice(0, -suffix.length);
                    if (candidate.length > 0) return candidate;
                }
            }
        }
        return undefined;
    }

    private _suggestNextPrefix(existing: JkBmsPackConfig[]): string {
        const last = existing[existing.length - 1]?.prefix?.trim();
        const nextNum = existing.length + 1;
        if (!last) {
            const base = this._config?.prefix?.trim() || 'jk_bms';
            return `${base}_${nextNum}`;
        }
        const trailingNumber = last.match(/^(.*?)(\d+)$/);
        if (trailingNumber) {
            return `${trailingNumber[1]}${Number(trailingNumber[2]) + 1}`;
        }
        return `${last}_${nextNum}`;
    }

    private _addPack(): void {
        const currentPacks = Array.isArray(this._config.packs) ? [...this._config.packs] : [];

        // Zero-config transition: seed Pack 1 from root config so the first pack isn't lost.
        if (currentPacks.length === 0 && this._config.prefix?.trim()) {
            const rootHasHeater =
                this._config.hasHeater === true || this._config.hasHeater === 1 || this._config.hasHeater === '1';
            currentPacks.push({
                name: this._config.batteryName?.trim() || 'Pack 1',
                prefix: this._config.prefix.trim(),
                bmsModel: this._config.bmsModel,
                packIndex: this._config.packIndex ?? this._config.batteryNumber ?? 1,
                cellCount: this._config.cellCount,
                tempSensorsCount: this._config.tempSensorsCount,
                hasHeater: rootHasHeater,
                deviceId: this._config.deviceId,
            });
        }

        const nextIndex = currentPacks.length + 1;
        currentPacks.push({
            name: `Pack ${nextIndex}`,
            prefix: this._suggestNextPrefix(currentPacks),
            packIndex: nextIndex,
        });

        const nextOpen = new Set(this._openPackPanels);
        nextOpen.add(currentPacks.length - 1);
        this._openPackPanels = nextOpen;

        this._emitConfig({ ...this._config, packs: currentPacks });
    }

    private _removePack(index: number, ev: Event): void {
        ev.stopPropagation();
        const currentPacks = Array.isArray(this._config.packs) ? this._config.packs : [];
        const nextPacks = currentPacks.filter((_, i) => i !== index);
        const nextOpen = new Set<number>();
        for (const openIdx of this._openPackPanels) {
            if (openIdx < index) nextOpen.add(openIdx);
            else if (openIdx > index) nextOpen.add(openIdx - 1);
        }
        this._openPackPanels = nextOpen;
        this._emitConfig({ ...this._config, packs: nextPacks });
    }

    private _togglePackPanel(index: number, expanded: boolean): void {
        const next = new Set(this._openPackPanels);
        if (expanded) next.add(index);
        else next.delete(index);
        this._openPackPanels = next;
    }

    private _packValueChanged(index: number, ev: CustomEvent): void {
        const currentPacks = Array.isArray(this._config.packs) ? this._config.packs : [];
        const prevPack = currentPacks[index];
        if (!prevPack) return;

        const incoming = ev.detail.value as Record<string, unknown>;
        let updated: JkBmsPackConfig = { ...prevPack, ...(incoming as Partial<JkBmsPackConfig>) };

        if (incoming.bmsModel === '__inherit__') {
            delete updated.bmsModel;
        } else if (updated.bmsModel && updated.bmsModel !== prevPack.bmsModel) {
            updated = applyPackModelDefaults(updated, prevPack.bmsModel);
        }

        if (typeof incoming.deviceId === 'string' && incoming.deviceId && incoming.deviceId !== prevPack.deviceId) {
            const inferred = this._inferPrefixFromDevice(incoming.deviceId);
            if (inferred) {
                updated = { ...updated, prefix: inferred };
            }
        }

        if (!updated.prefix?.trim()) {
            updated = { ...updated, prefix: prevPack.prefix };
        }

        const nextPacks = currentPacks.map((p, i) => (i === index ? updated : p));
        this._emitConfig({ ...this._config, packs: nextPacks });
    }

    private _renderPacksEditor(): TemplateResult {
        const packs = Array.isArray(this._config.packs) ? this._config.packs : [];
        const modelOptions = [
            { label: localize('config.inheritModel'), value: '__inherit__' },
            ...Object.entries(BMS_PRESETS).map(([value, preset]) => ({ label: preset.label, value })),
        ];

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
                          const matched = countMatchedPackEntities(this.hass, this._config, pack, index);
                          const formData = {
                              ...pack,
                              bmsModel: pack.bmsModel ?? '__inherit__',
                          };

                          return html`
                              <ha-expansion-panel
                                  outlined
                                  .expanded=${isOpen}
                                  @expanded-changed=${(e: CustomEvent) =>
                                      this._togglePackPanel(index, Boolean(e.detail?.value))}
                              >
                                  <div slot="header" class="pack-panel-header">
                                      <div class="pack-header-meta">
                                          <span class="pack-header-title">
                                              ${pack.name?.trim() || `Pack ${index + 1}`}
                                          </span>
                                          <span class="pack-header-prefix">${pack.prefix}</span>
                                      </div>
                                      <div class="btn-row">
                                          <span class="entity-count-pill ${matched > 0 ? 'found' : ''}">
                                              ${matched} ${localize('config.entitiesFound')}
                                          </span>
                                          <button
                                              type="button"
                                              class="remove-btn"
                                              @click=${(e: Event) => this._removePack(index, e)}
                                          >
                                              ${localize('config.removePack')}
                                          </button>
                                      </div>
                                  </div>
                                  ${isOpen
                                      ? html`
                                            <div class="pack-form-body">
                                                <ha-form
                                                    .hass=${this.hass}
                                                    .data=${formData}
                                                    .computeLabel=${this._computeLabelCallback.bind(this)}
                                                    .schema=${[
                                                        {
                                                            type: 'grid',
                                                            column_min_width: '180px',
                                                            schema: [
                                                                { name: 'name', selector: { text: {} } },
                                                                { name: 'prefix', selector: { text: {} } },
                                                            ],
                                                        },
                                                        {
                                                            type: 'grid',
                                                            column_min_width: '180px',
                                                            schema: [
                                                                {
                                                                    name: 'bmsModel',
                                                                    selector: {
                                                                        select: {
                                                                            mode: 'dropdown',
                                                                            options: modelOptions,
                                                                        },
                                                                    },
                                                                },
                                                                {
                                                                    name: 'packIndex',
                                                                    selector: {
                                                                        number: { min: 1, max: 16, step: 1, mode: 'box' },
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                        {
                                                            type: 'grid',
                                                            column_min_width: '180px',
                                                            schema: [
                                                                { name: 'deviceId', selector: { device: {} } },
                                                                { name: 'navigationPath', selector: { text: {} } },
                                                            ],
                                                        },
                                                        {
                                                            type: 'grid',
                                                            column_min_width: '140px',
                                                            schema: [
                                                                {
                                                                    name: 'cellCount',
                                                                    selector: {
                                                                        number: { min: 2, max: 48, step: 1, mode: 'box' },
                                                                    },
                                                                },
                                                                {
                                                                    name: 'tempSensorsCount',
                                                                    selector: {
                                                                        number: { min: 0, max: 4, step: 1, mode: 'box' },
                                                                    },
                                                                },
                                                                { name: 'hasHeater', selector: { boolean: {} } },
                                                            ],
                                                        },
                                                    ]}
                                                    @value-changed=${(e: CustomEvent) =>
                                                        this._packValueChanged(index, e)}
                                                ></ha-form>
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
            (this._config?.showMain === true && layout === 'core-reactor');
        const showMainStatsToggle =
            this._config?.showMain === true && (layout === 'core-reactor' || layout === 'bank-overview');

        return html`
            <ha-form
                .hass=${this.hass}
                .data=${this._config}
                .computeLabel=${this._computeLabelCallback.bind(this)}
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
                    ${this.renderBoolean(localize('config.showTitle'), 'showTitle')}
                    ${showButtonsToggle ? this.renderBoolean(localize('config.showButtons'), 'showButtons') : ''}
                    ${this.renderBoolean(localize('config.showMain'), 'showMain')}
                    ${this._config?.showMain === true && layout === 'default'
                        ? this.renderBoolean(localize('config.showCondensed'), 'showCondensed')
                        : ''}
                    ${showMainStatsToggle ? this.renderBoolean(localize('config.showMainStats'), 'showMainStats') : ''}
                    ${this.renderBoolean(localize('config.showCells'), 'showCells')}
                    ${this._config?.showCells === true
                        ? this.renderBoolean(localize('config.showResistances'), 'showResistances')
                        : ''}
                    ${this.renderBoolean(localize('config.showCardVersion'), 'showCardVersion')}
                </div>
            </ha-expansion-panel>
        `;
    }

    private _computeLabelCallback = (data: { name: string }) => localize(`config.${data.name}`) ?? data.name;

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
