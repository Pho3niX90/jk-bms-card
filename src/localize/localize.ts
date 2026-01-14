import * as en from './languages/en.json';
import * as uk from './languages/uk.json';
import { globalData } from '../helpers/globals';

const languages: any = {
  en: en,
  uk: uk,
};

export function localize(string: string, search = '', replace = '') {
  try {
    // localStorage.getItem('selectedLanguage') == null // but the system is set to Ukrainian, WTF?
    // localStorage.getItem('assist_debug_language') == "\"uk\"" // Ukraine, its ok.
    // localStorage.getItem('editor-language') == "ru" // but the system is set to Ukrainian, WTF?
    //
    let langFromLocalStorage = localStorage.getItem('selectedLanguage');
    if (langFromLocalStorage === null)
      langFromLocalStorage = localStorage.getItem('assist_debug_language');
    if (langFromLocalStorage === null)
      langFromLocalStorage = localStorage.getItem('editor-language');
    if (langFromLocalStorage === null)
      langFromLocalStorage = 'en';
    langFromLocalStorage = langFromLocalStorage
      .replace(/['"]+/g, '')
      .replace('-', '_');

    console.log("globalData.hass?.selectedLanguage" + globalData.hass?.selectedLanguage);
    console.log("globalData.hass?.locale?.language" + globalData.hass?.locale?.language);
    console.log("globalData.hass?.language" + globalData.hass?.language);
    console.log("langFromLocalStorage" + langFromLocalStorage);

    const lang = `${globalData.hass?.selectedLanguage || globalData.hass?.locale?.language || globalData.hass?.language || langFromLocalStorage}`;

    console.log("lang" + lang);

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
