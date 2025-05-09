import {fireEvent, HomeAssistant, LovelaceCardEditor, LovelaceConfig} from 'custom-card-helpers';
import {html, LitElement, TemplateResult} from 'lit';
import {EDITOR_NAME, EntityKey} from './const';
import {customElement, property} from 'lit/decorators.js';
import {JkBmsCardConfig} from './interfaces';
import {localize} from './localize/localize';

@customElement(EDITOR_NAME)
export class JkBmsCardEditor extends LitElement implements LovelaceCardEditor {
    @property() public hass!: HomeAssistant;
    @property() private _config!: JkBmsCardConfig;
    @property() lovelace?: LovelaceConfig;

    public setConfig(config: JkBmsCardConfig): void {
        this._config = {...this._config, ...config};
    }

    protected render(): TemplateResult | void {
        if (!this._config || !this.hass) {
            return html``;
        }

        const entityConfigs = Object.values(EntityKey).map((key: string) => ({name: key, selector: {entity: {}}}))

        return html`
			<ha-form
				.hass=${this.hass}
				.data=${this._config}
				.computeLabel=${this._computeLabelCallback.bind(this)}
				.schema=${[
                    {
                        type: 'grid',
                        title: localize('config.title'),
                        schema: [
                            {
                                type: 'grid',
                                schema: [
                                    {name: 'title', selector: {text: {}}},
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
                                schema: [
                                    {name: 'prefix', selector: {text: {}}},
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
                                    {name: 'cellCount', selector: {number: {min: 2, max: 48, step: 2}}},
                                    {name: 'cellColumns', selector: {number: {min: 1, max: 8, step: 1}}},
                                    {name: 'cellLayout', selector: { select: {
                                                options: [
                                                    { label: 'Incremental', value: 'incremental' },
                                                    { label: 'Bank Mode', value: 'bankMode' },
                                                ]
                                            } }}
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
                    }
                ]}
				@value-changed=${this._valueChanged.bind(this)}
			></ha-form>
		`;
    }
    private _computeLabelCallback = (data) => localize(`config.${data.name}`) ?? data.name;
    private _valueChanged(ev: CustomEvent): void {
        fireEvent(this, 'config-changed', {config: ev.detail.value});
    }
}