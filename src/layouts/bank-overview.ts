import { css, html, LitElement, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, navigate as navigatePath } from 'custom-card-helpers';
import { JkBmsCardConfig, JkBmsPackConfig } from '../interfaces';
import { localize } from '../localize/localize';
import { globalData } from '../helpers/globals';
import { formatValue, getTemperatureColor, navigateEntityId } from '../helpers/utils';
import {
    aggregateBankMetrics,
    BankSnapshot,
    buildPackConfig,
    CellSnapshot,
    collectWatchedEntityIds,
    computeStablePackKeys,
    FetState,
    formatEta,
    PackSnapshot,
    readPackSnapshot,
    resolveEffectivePacks,
} from '../helpers/bank-metrics';
import { version } from '../../package.json';

type HassEntitiesMap = Record<string, { device_id?: string }>;

@customElement('jk-bms-bank-overview-layout')
export class JkBmsBankOverviewLayout extends LitElement {
    @property({ attribute: false }) public hass!: HomeAssistant;
    @property({ attribute: false }) public config!: JkBmsCardConfig;

    @state() private _expandedPacks: Set<string> = new Set();

    private _watchedEntityIds: string[] = [];
    private _effectivePacks: JkBmsPackConfig[] = [];
    private _isFallback = false;
    private _stableKeys: string[] = [];
    private _cachedPackConfigs: JkBmsCardConfig[] = [];
    private readonly VERSION = version;

    static styles = css`
        :host {
            display: block;
            --bank-success: var(--success-color, #41cd52);
            --bank-info: var(--info-color, #3090c7);
            --bank-warning: var(--warning-color, #ff9800);
            --bank-danger: var(--error-color, #f44336);
            --bank-pill-bg: var(--primary-color, #195569);
            --bank-panel-bg: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
            --bank-border: var(--ha-card-border-width, 1px) solid
                var(--ha-card-border-color, var(--divider-color, rgba(127, 127, 127, 0.2)));
        }

        ha-card {
            container-type: inline-size;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-sizing: border-box;
            color: var(--primary-text-color);
            border-radius: var(--ha-card-border-radius, 12px);
        }

        /* Header */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            flex-wrap: wrap;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }

        .bank-icon {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            background: rgba(65, 205, 82, 0.14);
            border: 1px solid rgba(65, 205, 82, 0.32);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--bank-success);
            flex-shrink: 0;
        }

        .bank-icon.discharging {
            background: rgba(48, 144, 199, 0.14);
            border-color: rgba(48, 144, 199, 0.32);
            color: var(--bank-info);
        }

        .bank-icon.fault {
            background: rgba(244, 67, 54, 0.14);
            border-color: rgba(244, 67, 54, 0.35);
            color: var(--bank-danger);
        }

        .bank-icon.idle,
        .bank-icon.offline {
            background: var(--bank-panel-bg);
            border-color: var(--divider-color, rgba(127, 127, 127, 0.25));
            color: var(--secondary-text-color);
        }

        .bank-icon ha-icon {
            --mdc-icon-size: 20px;
        }

        .title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--primary-text-color);
            line-height: 1.25;
        }

        .subtitle {
            font-size: 0.78rem;
            color: var(--secondary-text-color);
        }

        .header-badges {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }

        .badge {
            font-size: 0.7rem;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 999px;
            letter-spacing: 0.03em;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            text-transform: uppercase;
            border: 1px solid transparent;
        }

        .badge-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: currentColor;
        }

        .badge-charging {
            color: var(--bank-success);
            background: rgba(65, 205, 82, 0.14);
            border-color: rgba(65, 205, 82, 0.3);
        }

        .badge-discharging {
            color: var(--bank-info);
            background: rgba(48, 144, 199, 0.14);
            border-color: rgba(48, 144, 199, 0.3);
        }

        .badge-idle,
        .badge-online {
            color: var(--secondary-text-color);
            background: var(--bank-panel-bg);
            border-color: var(--divider-color, rgba(127, 127, 127, 0.2));
        }

        .badge-balancing,
        .badge-partial {
            color: var(--bank-warning);
            background: rgba(255, 152, 0, 0.14);
            border-color: rgba(255, 152, 0, 0.35);
        }

        .badge-fault,
        .badge-offline {
            color: var(--bank-danger);
            background: rgba(244, 67, 54, 0.14);
            border-color: rgba(244, 67, 54, 0.35);
        }

        /* Aggregate Hero */
        .hero {
            background: var(--bank-panel-bg);
            border: var(--bank-border);
            border-radius: 10px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .hero-top {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
        }

        .soc-block {
            display: flex;
            align-items: baseline;
            gap: 10px;
            flex-wrap: wrap;
        }

        .soc-big {
            font-size: 2rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            line-height: 1.1;
            font-variant-numeric: tabular-nums;
            color: var(--bank-success);
        }

        .soc-big.low {
            color: var(--bank-danger);
        }

        .soc-big.warn {
            color: var(--bank-warning);
        }

        .cap-sub {
            font-size: 0.8rem;
            color: var(--secondary-text-color);
            font-variant-numeric: tabular-nums;
        }

        .power-block {
            text-align: right;
            margin-left: auto;
        }

        .power-main {
            font-size: 1.25rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }

        .power-sub {
            font-size: 0.78rem;
            color: var(--secondary-text-color);
            font-variant-numeric: tabular-nums;
        }

        .soc-track {
            width: 100%;
            height: 9px;
            border-radius: 999px;
            background: rgba(127, 127, 127, 0.18);
            overflow: hidden;
        }

        .soc-fill {
            height: 100%;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--bank-info), var(--bank-success));
            transition: width 0.4s ease-out;
        }

        .soc-fill.low {
            background: var(--bank-danger);
        }

        /* Diagnostic KPI Strip */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }

        @container (max-width: 520px) {
            .kpi-grid {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        .kpi {
            background: var(--bank-panel-bg);
            border: var(--bank-border);
            border-radius: 8px;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            text-align: left;
            font: inherit;
            color: inherit;
        }

        button.kpi {
            cursor: pointer;
        }

        button.kpi:hover {
            border-color: var(--bank-info);
        }

        button.kpi:focus-visible {
            outline: 2px solid var(--bank-info);
            outline-offset: 1px;
        }

        .kpi-label {
            font-size: 0.68rem;
            color: var(--secondary-text-color);
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .kpi-val {
            font-size: 0.95rem;
            font-weight: 700;
            font-family: monospace;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .kpi-meta {
            font-size: 0.72rem;
            color: var(--secondary-text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Pack Stack */
        .packs-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.72rem;
            font-weight: 600;
            color: var(--secondary-text-color);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0 2px;
        }

        .packs-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .pack-card {
            background: var(--bank-panel-bg);
            border: var(--bank-border);
            border-radius: 10px;
            overflow: hidden;
            transition: border-color 0.15s ease;
        }

        .pack-card.balancing {
            border-color: rgba(255, 152, 0, 0.55);
        }

        .pack-card.fault {
            border-color: rgba(244, 67, 54, 0.6);
        }

        .pack-card.offline {
            opacity: 0.65;
        }

        .pack-row {
            padding: 10px 12px;
            display: grid;
            grid-template-columns: minmax(105px, 1.1fr) minmax(120px, 1.4fr) auto auto;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        }

        .pack-row:hover {
            background: rgba(127, 127, 127, 0.06);
        }

        @container (max-width: 520px) {
            .pack-row {
                grid-template-columns: 1fr auto;
                gap: 8px;
            }
            .expand-btn {
                grid-row: 1;
                grid-column: 2;
                align-self: start;
            }
            .pack-bar-col,
            .pack-metrics {
                grid-column: 1 / -1;
            }
            .pack-metrics {
                justify-content: space-between;
            }
        }

        .pack-id {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }

        .pack-name-line {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            font-size: 0.88rem;
            min-width: 0;
        }

        .pack-name-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .inline-btn {
            background: none;
            border: none;
            padding: 0;
            margin: 0;
            font: inherit;
            color: inherit;
            cursor: pointer;
            text-align: inherit;
        }

        .inline-btn:focus-visible {
            outline: 2px solid var(--bank-info);
            outline-offset: 2px;
            border-radius: 3px;
        }

        .pack-name-btn {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-decoration: underline;
            text-decoration-color: rgba(127, 127, 127, 0.45);
            text-underline-offset: 2px;
        }

        .pack-name-btn:hover {
            color: var(--bank-info);
            text-decoration-color: var(--bank-info);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
            background: var(--bank-success);
        }

        .status-dot.balancing {
            background: var(--bank-warning);
        }

        .status-dot.fault,
        .status-dot.offline {
            background: var(--bank-danger);
        }

        .fets {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
        }

        .fet {
            font-size: 0.62rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 4px;
            letter-spacing: 0.04em;
            border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
            color: var(--secondary-text-color);
            background: transparent;
            cursor: pointer;
            line-height: 1.4;
        }

        .fet.on {
            color: var(--bank-success);
            border-color: rgba(65, 205, 82, 0.42);
            background: rgba(65, 205, 82, 0.12);
        }

        .fet.off {
            color: var(--bank-danger);
            border-color: rgba(244, 67, 54, 0.4);
            background: rgba(244, 67, 54, 0.1);
        }

        .fet.unavailable {
            color: var(--secondary-text-color);
            border-style: dashed;
            opacity: 0.7;
        }

        .fet.bal {
            color: var(--bank-warning);
            border-color: rgba(255, 152, 0, 0.45);
            background: rgba(255, 152, 0, 0.14);
        }

        .pack-bar-col {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }

        .pack-bar-top {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 0.78rem;
            font-family: monospace;
            font-variant-numeric: tabular-nums;
        }

        .pack-soc-val {
            font-weight: 700;
            color: var(--primary-text-color);
        }

        .mini-track {
            height: 6px;
            border-radius: 999px;
            background: rgba(127, 127, 127, 0.18);
            overflow: hidden;
        }

        .mini-fill {
            height: 100%;
            border-radius: 999px;
            background: var(--bank-success);
            transition: width 0.4s ease-out;
        }

        .mini-fill.balancing {
            background: linear-gradient(90deg, var(--bank-success), var(--bank-warning));
        }

        .mini-fill.low {
            background: var(--bank-danger);
        }

        .pack-metrics {
            display: flex;
            gap: 10px;
            font-family: monospace;
            font-size: 0.78rem;
            font-variant-numeric: tabular-nums;
            align-items: center;
        }

        .pm-item {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            min-width: 48px;
        }

        .pm-label {
            font-family: inherit;
            font-size: 0.65rem;
            color: var(--secondary-text-color);
        }

        .expand-btn {
            background: none;
            border: none;
            padding: 4px;
            margin: -4px;
            color: var(--secondary-text-color);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            transition: transform 0.15s ease, background 0.15s ease;
        }

        .expand-btn:hover {
            background: rgba(127, 127, 127, 0.12);
        }

        .expand-btn:focus-visible {
            outline: 2px solid var(--bank-info);
            outline-offset: 1px;
        }

        .expand-btn ha-icon {
            --mdc-icon-size: 20px;
        }

        .pack-card.open .expand-btn {
            transform: rotate(180deg);
        }

        /* Inline Pack Error Strip (centered) */
        .pack-error {
            width: 100%;
            padding: 6px 12px;
            text-align: center;
            font-size: 0.78rem;
            font-weight: 500;
            color: var(--bank-danger);
            background: rgba(244, 67, 54, 0.1);
            border: none;
            border-top: 1px solid rgba(244, 67, 54, 0.25);
        }

        /* Pack Detail Drawer */
        .pack-drawer {
            border-top: var(--bank-border);
            padding: 12px;
            background: var(--card-background-color, transparent);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .drawer-meta {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 14px;
            font-size: 0.76rem;
            color: var(--secondary-text-color);
        }

        .drawer-meta strong {
            color: var(--primary-text-color);
            font-weight: 600;
        }

        .cell-grid {
            display: grid;
            gap: 5px;
            width: 100%;
        }

        .grid-1 {
            grid-template-columns: minmax(0, 1fr);
        }
        .grid-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .grid-3 {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .grid-4 {
            grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .grid-5 {
            grid-template-columns: repeat(5, minmax(0, 1fr));
        }
        .grid-6 {
            grid-template-columns: repeat(6, minmax(0, 1fr));
        }
        .grid-7 {
            grid-template-columns: repeat(7, minmax(0, 1fr));
        }
        .grid-8 {
            grid-template-columns: repeat(8, minmax(0, 1fr));
        }

        @container (max-width: 500px) {
            .grid-3,
            .grid-4,
            .grid-5,
            .grid-6,
            .grid-7,
            .grid-8 {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        .cell-item {
            position: relative;
            overflow: hidden;
            background: var(--bank-panel-bg);
            border: var(--bank-border);
            border-radius: 6px;
            padding: 4px 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            font-family: monospace;
            font-size: 0.78rem;
            z-index: 0;
            min-width: 0;
        }

        .cell-item.is-min {
            border-color: rgba(255, 152, 0, 0.65);
        }

        .cell-item.is-max {
            border-color: rgba(48, 144, 199, 0.7);
        }

        .cell-item.is-balancing {
            border-color: rgba(65, 205, 82, 0.75);
        }

        .cell-bg {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(48, 144, 199, 0.18);
            z-index: -1;
            transition: width 0.4s ease-out;
        }

        .cell-num {
            font-size: 0.68rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 999px;
            background: var(--bank-pill-bg);
            color: var(--text-primary-color, #e4f3f8);
            flex-shrink: 0;
        }

        .cell-item.is-balancing .cell-num {
            background: var(--bank-success);
            color: #0b2410;
        }

        .cell-values {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            min-width: 0;
        }

        .cell-res {
            font-size: 0.68rem;
            color: var(--secondary-text-color);
        }

        .c-success {
            color: var(--bank-success);
        }
        .c-info {
            color: var(--bank-info);
        }
        .c-warning {
            color: var(--bank-warning);
        }
        .c-danger {
            color: var(--bank-danger);
        }
        .c-muted {
            color: var(--secondary-text-color);
        }

        .card-version {
            text-align: right;
            font-style: italic;
            font-size: 0.75rem;
            color: var(--secondary-text-color);
        }
    `;

    protected willUpdate(changedProps: PropertyValues): void {
        if (changedProps.has('config') && this.config) {
            const { packs, isFallback } = resolveEffectivePacks(this.config);
            this._effectivePacks = packs;
            this._isFallback = isFallback;
            this._stableKeys = computeStablePackKeys(packs);
            this._cachedPackConfigs = packs.map((pack, idx) =>
                buildPackConfig(this.config, pack, idx, isFallback)
            );
            this._watchedEntityIds = collectWatchedEntityIds(this.config);
        }
    }

    protected shouldUpdate(changedProps: PropertyValues): boolean {
        if (changedProps.size === 1 && changedProps.has('hass')) {
            const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
            if (!oldHass || !this.hass || this._watchedEntityIds.length === 0) {
                return true;
            }

            const oldEntities = (oldHass as unknown as { entities?: HassEntitiesMap })?.entities;
            const newEntities = (this.hass as unknown as { entities?: HassEntitiesMap })?.entities;
            if (oldEntities !== newEntities) {
                for (let i = 0; i < this._watchedEntityIds.length; i++) {
                    const id = this._watchedEntityIds[i];
                    if (oldEntities?.[id]?.device_id !== newEntities?.[id]?.device_id) {
                        return true;
                    }
                }
            }

            const oldStates = oldHass.states;
            const newStates = this.hass.states;
            if (oldStates === newStates) return false;
            for (let i = 0; i < this._watchedEntityIds.length; i++) {
                const id = this._watchedEntityIds[i];
                if (oldStates[id] !== newStates[id]) {
                    return true;
                }
            }
            return false;
        }
        return true;
    }

    private _togglePack(packKey: string): void {
        const next = new Set(this._expandedPacks);
        if (next.has(packKey)) {
            next.delete(packKey);
        } else {
            next.add(packKey);
        }
        this._expandedPacks = next;
    }

    private _handleRowClick(ev: Event, packKey: string): void {
        const target = ev.target as HTMLElement | null;
        if (target?.closest('button, a, [role="button"]')) {
            return;
        }
        this._togglePack(packKey);
    }

    private _handlePackNameClick(ev: Event, pack: PackSnapshot): void {
        ev.stopPropagation();
        if (pack.navigationPath) {
            navigatePath(ev.currentTarget as HTMLElement, pack.navigationPath);
            return;
        }
        if (pack.deviceId) {
            navigatePath(ev.currentTarget as HTMLElement, `/config/devices/device/${pack.deviceId}`);
            return;
        }
        this._togglePack(pack.key);
    }

    private _formatSigned(value: number, decimals: number): string {
        const prefix = value > 0 ? '+' : '';
        return `${prefix}${value.toFixed(decimals)}`;
    }

    private _formatDelta(deltaMv: number | null): string {
        if (deltaMv === null) return '—';
        const targetUnit = this.config.deltaVoltageUnit ?? 'mV';
        return formatValue('mV', targetUnit, deltaMv);
    }

    private _powerClass(value: number | null, deadband = 0): string {
        if (value === null) return 'c-muted';
        if (value > deadband) return 'c-success';
        if (value < -deadband) return 'c-info';
        return 'c-muted';
    }

    private _renderInteractiveValue(
        content: string | TemplateResult,
        entityId: string | undefined,
        extraClass = '',
        style = ''
    ): TemplateResult {
        if (!entityId) {
            return html`<span class="${extraClass}" style="${style}">${content}</span>`;
        }
        return html`
            <button
                type="button"
                class="inline-btn ${extraClass}"
                style="${style}"
                @click=${(e: Event) => navigateEntityId(e, entityId)}
            >
                ${content}
            </button>
        `;
    }

    private _renderFetBadge(
        fet: FetState,
        label: string,
        fullName: string,
        isBalancingActive = false
    ): TemplateResult {
        if (!fet.exists) return html``;
        const statusText = fet.isUnavailable ? 'unavailable' : fet.isOn ? 'on' : 'off';
        const cls = fet.isUnavailable ? 'unavailable' : isBalancingActive ? 'bal' : fet.isOn ? 'on' : 'off';
        return html`
            <button
                type="button"
                class="fet ${cls}"
                aria-label="${fullName}: ${statusText}"
                @click=${(e: Event) => navigateEntityId(e, fet.entityId)}
            >
                ${label}
            </button>
        `;
    }

    private _orderedCells(pack: PackSnapshot): CellSnapshot[] {
        const cells = pack.cells;
        if (pack.packConfig.cellLayout !== 'bankMode' || cells.length === 0) {
            return cells;
        }
        const total = cells.length;
        const cols = Math.max(pack.packConfig.cellColumns || 2, 1);
        const bankOffset = Math.floor(total / cols);
        const rows = Math.ceil(total / cols);
        const uneven = total % cols;
        const ordered: CellSnapshot[] = [];

        for (let r = 1; r <= rows; r++) {
            if (uneven && r === rows) {
                ordered.push(cells[total - 1]);
            } else {
                for (let c = 0; c < cols; c++) {
                    const idx = r + bankOffset * c;
                    if (idx <= total) {
                        ordered.push(cells[idx - 1]);
                    }
                }
            }
        }
        return ordered;
    }

    private _cellGradientStyle(percent: number): string {
        const colors = [
            { r: 180, g: 60, b: 60 },
            { r: 180, g: 180, b: 50 },
            { r: 60, g: 180, b: 60 },
            { r: 60, g: 120, b: 200 },
            { r: 90, g: 60, b: 200 },
        ];
        const idx = Math.min(Math.floor(percent / 25), 3);
        const local = (percent % 25) / 25;
        const c1 = colors[idx];
        const c2 = colors[idx + 1];
        const r = Math.round(c1.r + (c2.r - c1.r) * local);
        const g = Math.round(c1.g + (c2.g - c1.g) * local);
        const b = Math.round(c1.b + (c2.b - c1.b) * local);
        return `background: rgba(${r}, ${g}, ${b}, 0.45);`;
    }

    private _renderCell(cell: CellSnapshot): TemplateResult {
        const minLimit = this.config.minCellVoltage ?? 2.8;
        const maxLimit = this.config.maxCellVoltage ?? 3.65;
        const span = Math.max(maxLimit - minLimit, 0.01);
        const percent =
            cell.voltageV !== null
                ? Math.max(0, Math.min(100, ((cell.voltageV - minLimit) / span) * 100))
                : 0;

        const colorMode = this.config.cellColorMode || 'progress';
        const style = colorMode === 'gradient' ? this._cellGradientStyle(percent) : '';
        const classes = [
            'cell-item',
            cell.isMin ? 'is-min' : '',
            cell.isMax ? 'is-max' : '',
            cell.isBalancing ? 'is-balancing' : '',
        ]
            .filter(Boolean)
            .join(' ');

        const voltClass = cell.isMin ? 'c-warning' : cell.isMax ? 'c-info' : '';
        const showRes = this.config.showResistances === true && cell.resistance !== null;
        const resUnit = this.config.resistanceUnit ?? cell.resistanceUnit;
        const voltText =
            cell.voltageV !== null ? `${cell.voltageV.toFixed(3)} ${localize('html_texts.volt')}` : '—';

        return html`
            <div class="${classes}" style="${style}">
                ${colorMode === 'progress'
                    ? html`<div class="cell-bg" style="width: ${percent}%;"></div>`
                    : ''}
                <span class="cell-num">${String(cell.index).padStart(2, '0')}</span>
                <div class="cell-values">
                    ${this._renderInteractiveValue(voltText, cell.voltageEntityId, voltClass)}
                    ${showRes
                        ? this._renderInteractiveValue(
                              formatValue(cell.resistanceUnit, resUnit, cell.resistance!),
                              cell.resistanceEntityId,
                              'cell-res'
                          )
                        : ''}
                </div>
            </div>
        `;
    }

    private _renderPackDrawer(pack: PackSnapshot, drawerId: string): TemplateResult {
        const customDecimals = this.config.customDecimals ?? 1;
        const showCells = this.config.showCells !== false;
        const cols = Math.min(Math.max(this.config.cellColumns ?? 4, 1), 8);

        return html`
            <div class="pack-drawer" id="${drawerId}">
                <div class="drawer-meta">
                    ${pack.remainingAh !== null || pack.capacityAh !== null
                        ? html`
                              <span>
                                  ${localize('html_texts.remaining')}:
                                  <strong>
                                      ${this._renderInteractiveValue(
                                          `${pack.remainingAh !== null ? pack.remainingAh.toFixed(customDecimals) : '—'}${pack.capacityAh !== null ? ` / ${pack.capacityAh.toFixed(0)}` : ''} Ah`,
                                          pack.remainingAhEntityId
                                      )}
                                  </strong>
                              </span>
                          `
                        : ''}
                    ${pack.cycles !== null
                        ? html`
                              <span>
                                  ${localize('stats.cycles')}
                                  <strong>
                                      ${this._renderInteractiveValue(pack.cycles.toFixed(0), pack.cyclesEntityId)}
                                  </strong>
                              </span>
                          `
                        : ''}
                    ${pack.averageCellV !== null
                        ? html`
                              <span>
                                  ${localize('stats.averageCellV')}
                                  <strong>${pack.averageCellV.toFixed(3)} ${localize('html_texts.volt')}</strong>
                              </span>
                          `
                        : ''}
                    ${pack.isBalancing && pack.balancingCurrent !== null
                        ? html`
                              <span>
                                  ${localize('html_texts.balancing')}:
                                  <strong class="c-warning">
                                      ${this._renderInteractiveValue(
                                          `${this._formatSigned(pack.balancingCurrent, 1)} A${
                                              pack.maxCellId && pack.minCellId
                                                  ? ` (C${String(pack.maxCellId).padStart(2, '0')} → C${String(pack.minCellId).padStart(2, '0')})`
                                                  : ''
                                          }`,
                                          pack.balancingCurrentEntityId,
                                          'c-warning'
                                      )}
                                  </strong>
                              </span>
                          `
                        : ''}
                    ${pack.tempSensors.map(
                        t => html`
                            <span>
                                ${t.label}:
                                <strong>
                                    ${this._renderInteractiveValue(
                                        `${t.value.toFixed(1)} ${t.unit}`,
                                        t.entityId,
                                        '',
                                        `color: ${getTemperatureColor(t.value, t.unit)};`
                                    )}
                                </strong>
                            </span>
                        `
                    )}
                </div>

                ${showCells && pack.cells.length > 0
                    ? html`
                          <div class="cell-grid grid-${cols}">
                              ${this._orderedCells(pack).map(cell => this._renderCell(cell))}
                          </div>
                      `
                    : ''}
            </div>
        `;
    }

    private _renderPackRow(pack: PackSnapshot, deltaWarningMv: number): TemplateResult {
        const isOpen = this._expandedPacks.has(pack.key);
        const drawerId = `pack-drawer-${pack.index}`;
        const socDecimals = this.config.socDecimals ?? 1;
        const showButtons = this.config.showButtons !== false;
        const socPct = pack.soc !== null ? Math.max(0, Math.min(100, pack.soc)) : 0;
        const hasLink = Boolean(pack.navigationPath || pack.deviceId);
        const isDeltaWarn = pack.deltaMv !== null && pack.deltaMv >= deltaWarningMv;
        const isLowSoc = pack.soc !== null && pack.soc <= 15;

        const cardClasses = [
            'pack-card',
            isOpen ? 'open' : '',
            !pack.isOnline ? 'offline' : '',
            pack.errorMessage ? 'fault' : pack.isBalancing ? 'balancing' : '',
        ]
            .filter(Boolean)
            .join(' ');

        const dotClass = !pack.isOnline
            ? 'offline'
            : pack.errorMessage
              ? 'fault'
              : pack.isBalancing
                ? 'balancing'
                : '';

        const balLabel =
            pack.isBalancing && pack.balancingCurrent !== null && Math.abs(pack.balancingCurrent) > 0.01
                ? `${localize('bank.fetBal')} ${this._formatSigned(pack.balancingCurrent, 1)}A`
                : localize('bank.fetBal');

        const socText =
            pack.soc !== null
                ? `${pack.soc.toFixed(socDecimals)}%`
                : pack.isOnline
                  ? '—'
                  : localize('bank.offline');

        const powerText = `${pack.power !== null ? `${this._formatSigned(pack.power, 0)} W` : '—'}${
            pack.current !== null ? ` · ${this._formatSigned(pack.current, 1)} A` : ''
        }`;

        return html`
            <div class="${cardClasses}">
                <div class="pack-row" @click=${(e: Event) => this._handleRowClick(e, pack.key)}>
                    <div class="pack-id">
                        <div class="pack-name-line">
                            <span class="status-dot ${dotClass}"></span>
                            ${hasLink
                                ? html`
                                      <button
                                          type="button"
                                          class="inline-btn pack-name-btn"
                                          @click=${(e: Event) => this._handlePackNameClick(e, pack)}
                                      >
                                          ${pack.name}
                                      </button>
                                  `
                                : html`<span class="pack-name-text">${pack.name}</span>`}
                        </div>
                        ${showButtons
                            ? html`
                                  <div class="fets">
                                      ${this._renderFetBadge(
                                          pack.fets.charging,
                                          localize('bank.fetChg'),
                                          localize('switches.charge')
                                      )}
                                      ${this._renderFetBadge(
                                          pack.fets.discharging,
                                          localize('bank.fetDsg'),
                                          localize('switches.discharge')
                                      )}
                                      ${this._renderFetBadge(
                                          pack.fets.balancer,
                                          balLabel,
                                          localize('switches.balance'),
                                          pack.isBalancing && pack.fets.balancer.exists
                                      )}
                                      ${this._renderFetBadge(
                                          pack.fets.heater,
                                          localize('bank.fetHtr'),
                                          localize('switches.heater')
                                      )}
                                  </div>
                              `
                            : ''}
                    </div>

                    <div class="pack-bar-col">
                        <div class="pack-bar-top">
                            ${this._renderInteractiveValue(socText, pack.socEntityId, 'pack-soc-val')}
                            ${this._renderInteractiveValue(
                                powerText,
                                pack.powerDerived ? pack.currentEntityId : pack.powerEntityId,
                                this._powerClass(pack.current, 0.2)
                            )}
                        </div>
                        <div class="mini-track">
                            <div
                                class="mini-fill ${isLowSoc ? 'low' : pack.isBalancing ? 'balancing' : ''}"
                                style="width: ${socPct}%;"
                            ></div>
                        </div>
                    </div>

                    <div class="pack-metrics">
                        <div class="pm-item">
                            <span class="pm-label">${localize('bank.voltShort')}</span>
                            ${this._renderInteractiveValue(
                                pack.voltage !== null
                                    ? `${pack.voltage.toFixed(2)} ${localize('html_texts.volt')}`
                                    : '—',
                                pack.voltageEntityId
                            )}
                        </div>
                        <div class="pm-item">
                            <span class="pm-label">${localize('html_texts.delta')}</span>
                            ${this._renderInteractiveValue(
                                this._formatDelta(pack.deltaMv),
                                pack.deltaEntityId,
                                isDeltaWarn ? 'c-warning' : pack.deltaMv !== null ? 'c-success' : 'c-muted'
                            )}
                        </div>
                        <div class="pm-item">
                            <span class="pm-label">${localize('html_texts.temperature_sensor')}</span>
                            ${this._renderInteractiveValue(
                                pack.peakTemp ? `${pack.peakTemp.value.toFixed(1)} ${pack.peakTemp.unit}` : '—',
                                pack.peakTemp?.entityId,
                                '',
                                pack.peakTemp
                                    ? `color: ${getTemperatureColor(pack.peakTemp.value, pack.peakTemp.unit)};`
                                    : ''
                            )}
                        </div>
                    </div>

                    <button
                        type="button"
                        class="expand-btn"
                        aria-expanded="${String(isOpen)}"
                        aria-controls="${drawerId}"
                        aria-label="${pack.name}"
                        @click=${(e: Event) => {
                            e.stopPropagation();
                            this._togglePack(pack.key);
                        }}
                    >
                        <ha-icon icon="mdi:chevron-down"></ha-icon>
                    </button>
                </div>

                ${pack.errorMessage
                    ? pack.errorEntityId
                        ? html`
                              <button
                                  type="button"
                                  class="pack-error inline-btn"
                                  @click=${(e: Event) => navigateEntityId(e, pack.errorEntityId)}
                              >
                                  ${pack.errorMessage}
                              </button>
                          `
                        : html`<div class="pack-error">${pack.errorMessage}</div>`
                    : ''}

                ${isOpen ? this._renderPackDrawer(pack, drawerId) : ''}
            </div>
        `;
    }

    private _renderHeader(bank: BankSnapshot): TemplateResult {
        const customTitle =
            this.config.title &&
            this.config.title.toLocaleLowerCase() !== localize('config.title').toLocaleLowerCase() &&
            this.config.title !== 'title'
                ? this.config.title
                : localize('bank.defaultTitle');

        const capSubtitle =
            bank.totalCapacityAh !== null
                ? ` · ${bank.totalCapacityAh.toFixed(0)} Ah${bank.isPartial || !bank.hasFullCapacityCoverage ? ` (${localize('bank.partial')})` : ''}`
                : '';

        const statusLabelMap = {
            charging: localize('bank.statusCharging'),
            discharging: localize('bank.statusDischarging'),
            idle: localize('bank.statusIdle'),
            offline: localize('bank.statusOffline'),
        };

        const iconClass = bank.hasFault ? 'fault' : bank.status;
        const iconName = bank.hasFault
            ? 'mdi:battery-alert'
            : bank.status === 'charging'
              ? 'mdi:battery-charging'
              : bank.status === 'discharging'
                ? 'mdi:battery-arrow-down'
                : 'mdi:battery-high';

        return html`
            <div class="header">
                <div class="header-left">
                    <div class="bank-icon ${iconClass}">
                        <ha-icon icon="${iconName}"></ha-icon>
                    </div>
                    <div>
                        <div class="title">${customTitle}</div>
                        <div class="subtitle">
                            ${bank.totalCount} ${localize('bank.packsUnit')}${capSubtitle}
                        </div>
                    </div>
                </div>
                <div class="header-badges">
                    <span class="badge badge-${bank.status}">
                        <span class="badge-dot"></span>${statusLabelMap[bank.status]}
                    </span>
                    ${bank.balancingPackCount > 0
                        ? html`<span class="badge badge-balancing">${localize('html_texts.balancing')}</span>`
                        : ''}
                    ${bank.hasFault
                        ? html`<span class="badge badge-fault">${localize('bank.statusFault')}</span>`
                        : ''}
                    <span class="badge ${bank.isPartial ? 'badge-partial' : 'badge-online'}">
                        ${bank.onlineCount}/${bank.totalCount} ${localize('bank.online')}
                    </span>
                </div>
            </div>
        `;
    }

    private _renderHero(bank: BankSnapshot): TemplateResult {
        const socDecimals = this.config.socDecimals ?? 1;
        const socPct = bank.soc !== null ? Math.max(0, Math.min(100, bank.soc)) : 0;
        const socClass = bank.soc !== null && bank.soc <= 15 ? 'low' : bank.soc !== null && bank.soc <= 30 ? 'warn' : '';
        const etaStr = formatEta(bank.etaHours);
        const etaSuffix =
            etaStr && bank.status === 'charging'
                ? ` · ~${etaStr} ${localize('bank.toFull')}`
                : etaStr && bank.status === 'discharging'
                  ? ` · ~${etaStr} ${localize('bank.remainingShort')}`
                  : '';

        const partialTag = bank.isPartial
            ? ` (${bank.onlineCount}/${bank.totalCount})`
            : !bank.hasFullCapacityCoverage && (bank.totalRemainingAh !== null || bank.totalCapacityAh !== null)
              ? ` (${localize('bank.partial')})`
              : '';

        return html`
            <div class="hero">
                <div class="hero-top">
                    <div class="soc-block">
                        <span class="soc-big ${socClass}">
                            ${bank.soc !== null ? `${bank.soc.toFixed(socDecimals)}%` : '—'}
                        </span>
                        <span class="cap-sub">
                            ${bank.totalRemainingAh !== null ? `${bank.totalRemainingAh.toFixed(1)}` : '—'}
                            ${bank.totalCapacityAh !== null ? ` / ${bank.totalCapacityAh.toFixed(0)} Ah` : ' Ah'}
                            ${bank.remainingKwh !== null ? ` · ≈ ${bank.remainingKwh.toFixed(1)} kWh` : ''}
                            ${partialTag}
                        </span>
                    </div>
                    <div class="power-block">
                        <div class="power-main ${this._powerClass(bank.totalCurrent, bank.currentDeadbandA)}">
                            ${bank.totalPower !== null ? `${this._formatSigned(bank.totalPower, 0)} W` : '—'}
                        </div>
                        <div class="power-sub">
                            ${bank.totalCurrent !== null ? `${this._formatSigned(bank.totalCurrent, 1)} A` : '—'}${etaSuffix}
                        </div>
                    </div>
                </div>
                <div class="soc-track">
                    <div class="soc-fill ${socClass}" style="width: ${socPct}%;"></div>
                </div>
            </div>
        `;
    }

    private _renderKpiTile(
        label: string,
        value: string,
        meta: string,
        valClass = '',
        valStyle = '',
        entityId?: string
    ): TemplateResult {
        const inner = html`
            <div class="kpi-label">${label}</div>
            <div class="kpi-val ${valClass}" style="${valStyle}">${value}</div>
            <div class="kpi-meta">${meta}</div>
        `;
        if (!entityId) {
            return html`<div class="kpi">${inner}</div>`;
        }
        return html`
            <button type="button" class="kpi" @click=${(e: Event) => navigateEntityId(e, entityId)}>
                ${inner}
            </button>
        `;
    }

    private _renderKpis(bank: BankSnapshot): TemplateResult {
        const voltUnit = localize('html_texts.volt');
        const spreadText =
            bank.voltageSpreadV !== null
                ? `${localize('bank.packSpread')}: ${bank.voltageSpreadV.toFixed(2)} ${voltUnit}`
                : '—';

        const deltaMeta = bank.worstDelta
            ? `${bank.worstDelta.packName}${
                  bank.worstDelta.maxCellId && bank.worstDelta.minCellId
                      ? ` · C${String(bank.worstDelta.maxCellId).padStart(2, '0')}↔C${String(bank.worstDelta.minCellId).padStart(2, '0')}`
                      : ''
              }`
            : '—';

        const tempColor = bank.peakTemp ? getTemperatureColor(bank.peakTemp.value, bank.peakTemp.unit) : '';

        const cellRange =
            bank.minCell && bank.maxCell
                ? `${bank.minCell.voltageV.toFixed(3)}–${bank.maxCell.voltageV.toFixed(3)}`
                : '—';

        const balanceMeta =
            bank.balancingPackCount > 0
                ? `${bank.balancingPackCount} ${localize('bank.packsBalancing')}`
                : localize('bank.balanced');

        return html`
            <div class="kpi-grid">
                ${this._renderKpiTile(
                    localize('bank.bankVoltage'),
                    bank.avgVoltage !== null ? `${bank.avgVoltage.toFixed(2)} ${voltUnit}` : '—',
                    spreadText
                )}
                ${this._renderKpiTile(
                    localize('bank.worstDelta'),
                    this._formatDelta(bank.worstDelta?.deltaMv ?? null),
                    deltaMeta,
                    bank.worstDelta?.isWarning ? 'c-warning' : bank.worstDelta ? 'c-success' : 'c-muted',
                    '',
                    bank.worstDelta?.entityId
                )}
                ${this._renderKpiTile(
                    localize('bank.peakTemp'),
                    bank.peakTemp ? `${bank.peakTemp.value.toFixed(1)} ${bank.peakTemp.unit}` : '—',
                    bank.peakTemp ? `${bank.peakTemp.packName} · ${bank.peakTemp.label}` : '—',
                    '',
                    tempColor ? `color: ${tempColor};` : '',
                    bank.peakTemp?.entityId
                )}
                ${this._renderKpiTile(localize('bank.cellRange'), cellRange, balanceMeta, 'c-info')}
            </div>
        `;
    }

    protected render(): TemplateResult {
        globalData.hass = this.hass;
        if (!this.hass || !this.config) return html``;

        const deltaWarningMv = this.config.deltaWarningMv ?? 30;
        const snapshots = this._effectivePacks.map((pack, index) => {
            const stableKey = this._stableKeys[index];
            return readPackSnapshot(this.hass, this.config, pack, index, stableKey, {
                isFallbackSinglePack: this._isFallback,
                includeResistances: this._expandedPacks.has(stableKey),
                cachedPackConfig: this._cachedPackConfigs[index],
            });
        });
        const bank = aggregateBankMetrics(snapshots, { deltaWarningMv });

        const showTitle = this.config.showTitle !== false;
        const showMain = this.config.showMain !== false;
        const showMainStats = this.config.showMainStats !== false;
        const showCardVersion = this.config.showCardVersion === true;

        return html`
            <ha-card>
                ${showTitle ? this._renderHeader(bank) : ''}
                ${showMain ? this._renderHero(bank) : ''}
                ${showMain && showMainStats ? this._renderKpis(bank) : ''}

                <div class="packs-header">
                    <span>${localize('bank.batteryPacks')}</span>
                    <span>${localize('bank.inspectHint')}</span>
                </div>

                <div class="packs-list">
                    ${snapshots.map(pack => this._renderPackRow(pack, deltaWarningMv))}
                </div>

                ${showCardVersion ? html`<div class="card-version">v.${this.VERSION}</div>` : ''}
            </ha-card>
        `;
    }
}
