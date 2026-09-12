import { isRecord, type DisplayOptions } from '../shared/types.ts';
import Display from '../shared/display.ts';
import FormulaTypesetter, { type Typesetter } from './typesetter.ts';
import { $ } from './dom.ts';
import type { ClockFace } from './types.ts';

export interface SettingsDeps {
  settingsDialog: HTMLDialogElement;
  shareButton: HTMLButtonElement;
  sharedState: Pick<DisplayOptions, 'font' | 'numerals' | 'division'> | null;
  leaveShared(keepFormula: boolean): void;
  invalidate(): void;
  kick(): void;
  setEngineError(message: string | null): void;
}

export interface Settings {
  readonly current: DisplayOptions;
  view(): DisplayOptions;
  engine(): Typesetter;
  face(font: DisplayOptions['font'], numerals: DisplayOptions['numerals']): ClockFace | undefined;
  prepareFace(): void;
  setDisplay(changes: Partial<DisplayOptions>): Promise<void>;
  adoptView(view: Pick<DisplayOptions, 'font' | 'numerals' | 'division'>): void;
}

export function createSettings(deps: SettingsDeps): Settings {
  function savedDisplay(): Record<string, unknown> {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('formula-clock-display-v2') || '{}');
      return isRecord(saved) ? saved : {};
    } catch {
      return {};
    }
  }
  const saved = savedDisplay();
  let displaySettings: DisplayOptions = {
    font: Display.isFont(saved.font) ? saved.font : Display.DEFAULTS.font,
    // Preserve the appearance of settings saved before numeral styles were independent.
    numerals: Display.isNumerals(saved.numerals)
      ? saved.numerals
      : saved.font === 'euler'
        ? 'lining'
        : Display.DEFAULTS.numerals,
    division: Display.isDivision(saved.division) ? saved.division : Display.DEFAULTS.division,
    symbolMotion: saved.symbolMotion === false ? false : Display.DEFAULTS.symbolMotion,
    structureMotion: saved.structureMotion === false ? false : Display.DEFAULTS.structureMotion,
    symbolMorph: saved.symbolMorph === false ? false : Display.DEFAULTS.symbolMorph,
  };
  // Restore before selecting an engine; opening a link never saves preferences.
  if (deps.sharedState) {
    const { font, numerals, division } = deps.sharedState;
    Object.assign(displaySettings, { font, numerals, division });
  }
  // MathJax computes the layout; persistent digits and equality display it.
  // The four HHMM objects are never recreated, including ordinary clock mode.
  const engines = new Map<string, Typesetter>(),
    clockFaces = new Map<string, ClockFace>(),
    requestedFaces = new Set<string>();
  const typographyKey = (font: DisplayOptions['font'], numerals: DisplayOptions['numerals']) =>
    `${font}:${numerals}`;
  function engineFor(
    font: DisplayOptions['font'],
    numerals: DisplayOptions['numerals'],
  ): Typesetter {
    const key = typographyKey(font, numerals);
    const selected = () => typographyKey(displaySettings.font, displaySettings.numerals) === key;
    if (!engines.has(key)) {
      const engine = new FormulaTypesetter.Typesetter(font, numerals);
      engines.set(key, engine);
      engine.boot
        .then(() => {
          if (selected()) {
            deps.invalidate();
            deps.kick();
          }
        })
        .catch((error) => {
          if (selected()) {
            deps.setEngineError(String(error));
            deps.invalidate();
            deps.kick();
          }
        });
    }
    return engines.get(key)!;
  }
  function prepareFace() {
    const { font, numerals } = displaySettings;
    const key = typographyKey(font, numerals);
    if (requestedFaces.has(key)) return;
    requestedFaces.add(key);
    typesetter
      .clockFace()
      .then((face) => {
        clockFaces.set(key, face);
        if (typographyKey(displaySettings.font, displaySettings.numerals) === key) {
          deps.invalidate();
          deps.kick();
        }
      })
      .catch((error) => console.warn('[Formula Clock] Small clock font unavailable.', error));
  }
  let typesetter = engineFor(displaySettings.font, displaySettings.numerals);
  const segmentedChoices = [
    ...deps.settingsDialog.querySelectorAll<HTMLInputElement>('.segmented-control input'),
  ];
  function syncMotionControls() {
    $<HTMLInputElement>('#symbol-motion').checked = displaySettings.symbolMotion;
    $<HTMLInputElement>('#structure-motion').checked = displaySettings.structureMotion;
    $<HTMLInputElement>('#structure-motion').disabled = !displaySettings.symbolMotion;
    $<HTMLInputElement>('#symbol-morph').checked = displaySettings.symbolMorph;
    $<HTMLInputElement>('#symbol-morph').disabled = !displaySettings.symbolMotion;
  }
  async function setDisplay(changes: Partial<DisplayOptions>) {
    const next = { ...displaySettings, ...changes };
    if (!Display.isDisplay(next)) throw new TypeError('Invalid display options');
    deps.leaveShared(true); // Restyle the saved formula until the user changes time.
    displaySettings = {
      font: next.font,
      numerals: next.numerals,
      division: next.division,
      symbolMotion: next.symbolMotion,
      structureMotion: next.structureMotion,
      symbolMorph: next.symbolMorph,
    };
    deps.shareButton.disabled = true;
    syncMotionControls();
    $<HTMLSelectElement>('#font-choice').value = next.font;
    segmentedChoices.forEach((input) => {
      input.checked = input.value === next[input.name as keyof DisplayOptions];
    });
    try {
      localStorage.setItem('formula-clock-display-v2', JSON.stringify(displaySettings));
    } catch {}
    typesetter = engineFor(next.font, next.numerals);
    deps.setEngineError(null);
    deps.invalidate();
    deps.kick();
    await typesetter.boot;
  }
  syncMotionControls();
  $<HTMLInputElement>('#symbol-motion').addEventListener('change', (e) => {
    setDisplay({ symbolMotion: (e.target as HTMLInputElement).checked }).catch(() => {});
  });
  $<HTMLInputElement>('#structure-motion').addEventListener('change', (e) => {
    setDisplay({ structureMotion: (e.target as HTMLInputElement).checked }).catch(() => {});
  });
  $<HTMLInputElement>('#symbol-morph').addEventListener('change', (e) => {
    setDisplay({ symbolMorph: (e.target as HTMLInputElement).checked }).catch(() => {});
  });
  $<HTMLSelectElement>('#font-choice').value = displaySettings.font;
  segmentedChoices.forEach((input) => {
    input.checked = input.value === displaySettings[input.name as keyof DisplayOptions];
  });
  $<HTMLSelectElement>('#font-choice').addEventListener('change', (e) => {
    setDisplay({ font: (e.target as HTMLSelectElement).value as DisplayOptions['font'] }).catch(
      () => {},
    );
  });
  $('#numeral-choice').addEventListener('change', (e) => {
    setDisplay({
      numerals: (e.target as HTMLInputElement).value as DisplayOptions['numerals'],
    }).catch(() => {});
  });
  $('#division-choice').addEventListener('change', (e) => {
    setDisplay({
      division: (e.target as HTMLInputElement).value as DisplayOptions['division'],
    }).catch(() => {});
  });
  return {
    get current() {
      return displaySettings;
    },
    view: () => Display.activeDisplay(displaySettings),
    engine: () => typesetter,
    face: (font, numerals) => clockFaces.get(typographyKey(font, numerals)),
    prepareFace,
    setDisplay,
    adoptView(view) {
      Object.assign(displaySettings, view);
    },
  };
}
