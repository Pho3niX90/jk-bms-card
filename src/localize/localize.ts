import * as en from './languages/en.json';
// import * as vi from './languages/vi.json';
import {globalData} from '../helpers/globals';

const languages: any = {
    en: en,
    // vi: vi,
};

export function localize(string: string, search = '', replace = '') {
    try {
        const langFromLocalStorage = (localStorage.getItem('selectedLanguage') || 'en')
            .replace(/['"]+/g, '')
            .replace('-', '_');

        const lang = `${globalData.hass?.selectedLanguage || globalData.hass?.locale?.language || globalData.hass?.language || langFromLocalStorage}`;

        let translated: string;

        try {
            translated = string?.split('.').reduce((o, i) => o[i], languages[lang]);
        } catch (e) {
            translated = string?.split('.')?.reduce((o, i) => o[i], languages['en']);
        }

        if (translated === undefined) {
            translated = string?.split('.')?.reduce((o, i) => o[i], languages['en']);
        }

        if (search !== '' && replace !== '') {
            translated = translated.replace(search, replace);
        }
        return translated;
    } catch (e) {
        return string
    }
}
