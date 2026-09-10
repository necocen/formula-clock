/* UI language is a browser preference, independent of shared clock state. */
(function (root) {
  'use strict';
  const messages = {
    // Settings and dialog controls, including accessible names for icon buttons.
    settings: {ja:'設定',en:'Settings'},
    close: {ja:'閉じる',en:'Close'},
    closeSettings: {ja:'設定を閉じる',en:'Close settings'},
    font: {ja:'フォント',en:'Font'},
    mathFont: {ja:'数式のフォント',en:'Formula font'},
    numerals: {ja:'数字のスタイル',en:'Numeral style'},
    division: {ja:'除算のスタイル',en:'Division style'},
    fraction: {ja:'分数',en:'Fraction'},
    volume: {ja:'音量',en:'Volume'},
    signalVolume: {ja:'時報の音量',en:'Time signal volume'},
    setTime: {ja:'時刻を指定',en:'Set time'},
    show: {ja:'表示',en:'Show'},
    advanced: {ja:'詳細',en:'Advanced'},
    symbolMotion: {ja:'記号をなめらかに動かす',en:'Move symbols smoothly'},
    structureMotion: {ja:'分数・√・括弧も動かす',en:'Move fractions, roots & brackets'},
    symbolMorph: {ja:'四則記号を変形する',en:'Morph arithmetic symbols'},
    shortcuts: {ja:'M 時報 / F 全画面 / L 現在時刻へ / Space 再生・一時停止',en:'M Sound / F Fullscreen / L Current time / Space Play or pause preview'},
    shortcut: {ja:'{label}（{key}）',en:'{label} ({key})'},
    licenses: {ja:'LICENSE',en:'LICENSE'},
    closeLicenses: {ja:'ライセンスを閉じる',en:'Close licenses'},
    // Sharing: button/dialog labels and the copy notification.
    share: {ja:'現在の表示を共有',en:'Share this view'},
    shareTitle: {ja:'Share',en:'Share this view'},
    shareHelp: {ja:'このURLをコピーして共有できます。',en:'Copy this link to share the current view.'},
    shareUrl: {ja:'共有URL',en:'Share link'},
    shareCopied: {ja:'共有URLをコピーしました',en:'Share link copied'},
    // Sound/fullscreen icon labels and hover titles; failure is a visible notice.
    soundOff: {ja:'時報 OFF',en:'Time signals off'},
    soundOn: {ja:'時報 ON',en:'Time signals on'},
    soundError: {ja:'時報 ON（再生できません）',en:'Time signals on (audio unavailable)'},
    soundPending: {ja:'時報 ON（画面を操作すると再開）',en:'Time signals on (tap to start)'},
    fullscreen: {ja:'全画面表示',en:'Fullscreen'},
    exitFullscreen: {ja:'全画面表示を終了',en:'Exit fullscreen'},
    fullscreenFailed: {ja:'全画面表示に切り替えられませんでした',en:'Could not switch fullscreen mode'},
    // Second ruler: accessible names and per-second hover titles.
    chooseSecond: {ja:'秒を選んでプレビュー',en:'Choose a second to preview'},
    previewSecond: {ja:'{seconds}秒をプレビュー',en:'Preview second {seconds}'},
    secondStatus: {ja:'{seconds}秒 · {status}',en:'{seconds}s · {status}'},
    formulaAvailable: {ja:'式あり',en:'Formula available'},
    noFormula: {ja:'式なし',en:'No formula'},
    loading: {ja:'Loading',en:'Loading'},
    dataFailed: {ja:'データ取得失敗',en:'Data unavailable'},
    // Visible preview controls and their hover titles.
    play: {ja:'Play',en:'Play'},
    pause: {ja:'Pause',en:'Pause'},
    playShortcut: {ja:'再生／一時停止（Space）',en:'Play or pause (Space)'},
    goLive: {ja:'現在時刻へ',en:'Current time'},
    goLiveShortcut: {ja:'現在時刻に戻る（L）',en:'Return to current time (L)'},
    // Accessible descriptions of the SVG clocks; never drawn as visual text.
    clockTime: {ja:'{hours}時{minutes}分{seconds}秒',en:'{hours} hours, {minutes} minutes, {seconds} seconds'},
    clockEquation: {ja:'{time}。{expression} = {seconds}',en:'{time}. {expression} = {seconds}'},
    // Status text inside Settings > Advanced: loading, failures, and midnight.
    preparing: {ja:'Loading',en:'Preparing the clock.'},
    typesettingFailed: {ja:'組版を読み込めなかった。通常の時計を表示中。',en:'Could not load the formula display. Showing the clock.'},
    formulaFailed: {ja:'この式を組版できなかった。通常の時計を表示中。',en:'Could not display this formula. Showing the clock.'},
    loadingData: {ja:'Loading',en:'Loading formula data.'},
    dataClockFallback: {ja:'式データを読み込めなかった。通常の時計を表示中。',en:'Could not load formula data. Showing the clock.'},
    newDayIn: {ja:'新しい一日まで、{seconds}',en:'A new day in {seconds}'},
    newDay: {ja:'新しい一日。',en:'A new day.'}
  };
  Object.values(messages).forEach(Object.freeze);
  Object.freeze(messages);
  function resolveLanguage(language) {
    return typeof language === 'string' && /^ja(?:-|$)/i.test(language.trim()) ? 'ja' : 'en';
  }
  function create(language) {
    const locale = resolveLanguage(language);
    function t(key, values = {}) {
      const message = messages[key]?.[locale] ?? messages[key]?.en ?? key;
      return message.replace(/\{(\w+)\}/g,(placeholder,name) => Object.hasOwn(values,name) ? String(values[name]) : placeholder);
    }
    function apply(document) {
      document.documentElement.lang = locale;
      for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
      for (const attribute of ['title','aria-label']) {
        for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
          element.setAttribute(attribute,t(element.getAttribute(`data-i18n-${attribute}`)));
        }
      }
    }
    return Object.freeze({locale,t,apply});
  }
  const api = Object.freeze({resolveLanguage,create,messages});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaI18n = api;
})(typeof window === 'undefined' ? globalThis : window);
