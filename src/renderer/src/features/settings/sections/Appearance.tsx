/**
 * Réglages › Apparence : thème, langue, colonnes et tri par défaut, vidéos au survol, animations.
 * La langue s'applique tout de suite (renderer remonté, menu natif reconstruit par main).
 */
import type { SortMode } from '../../../../../shared/enums'
import type { LanguagePref } from '../../../../../shared/i18n/lang'
import { SegmentedSmall, Slider, Switch } from '../../../components/ui'
import { tr } from '../../../i18n'
import { usePrefs } from '../../../state/prefs'
import { useUi } from '../../../state/ui'
import { sortOptions } from '../../library/SortMenu'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

export function AppearanceSection() {
  const prefs = usePrefs((s) => s.prefs)
  const update = (patch: Parameters<ReturnType<typeof usePrefs.getState>['update']>[0]) =>
    void usePrefs
      .getState()
      .update(patch)
      .catch(() => undefined)
  return (
    <>
      <SettingsTitle>{tr.settings.nav.appearance}</SettingsTitle>
      <div className="mt-4">
        <SettingsRow
          label={tr.settings.appearance.theme}
          control={
            <SegmentedSmall
              label={tr.settings.appearance.theme}
              value={prefs.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'light', label: tr.settings.appearance.light },
                { value: 'dark', label: tr.settings.appearance.dark },
                { value: 'system', label: tr.settings.appearance.system },
              ]}
            />
          }
        />
        <SettingsRow
          label={tr.settings.appearance.language}
          control={
            <select
              aria-label={tr.settings.appearance.language}
              data-testid="settings-language"
              className="h-[34px] rounded-[10px] border border-[var(--set-field-border)] bg-[var(--set-field-bg)] px-3 text-[12.5px]"
              value={prefs.ui.language}
              onChange={(e) => update({ ui: { language: e.target.value as LanguagePref } })}
            >
              <option value="system">{tr.settings.appearance.languageSystem}</option>
              <option value="fr" lang="fr">
                {tr.settings.appearance.languageFr}
              </option>
              <option value="en" lang="en">
                {tr.settings.appearance.languageEn}
              </option>
            </select>
          }
        />
        <SettingsRow
          label={tr.settings.appearance.defaultColumns}
          control={
            <div className="flex items-center gap-3">
              <Slider
                label={tr.settings.appearance.defaultColumns}
                min={2}
                max={8}
                value={prefs.defaultColumns}
                onValueChange={(defaultColumns) => {
                  useUi.getState().resetColumns()
                  update({ defaultColumns })
                }}
              />
              <span className="w-4 text-right text-[11.5px] tnum">{prefs.defaultColumns}</span>
            </div>
          }
        />
        <SettingsRow
          label={tr.settings.appearance.defaultSort}
          control={
            <select
              aria-label={tr.settings.appearance.defaultSort}
              className="h-[34px] rounded-[10px] border border-[var(--set-field-border)] bg-[var(--set-field-bg)] px-3 text-[12.5px]"
              value={prefs.defaultSort}
              onChange={(e) => update({ defaultSort: e.target.value as SortMode })}
            >
              {sortOptions().map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={tr.settings.appearance.hoverPlay}
          control={
            <Switch
              aria-label={tr.settings.appearance.hoverPlay}
              checked={prefs.hoverPlay}
              onCheckedChange={(hoverPlay) => update({ hoverPlay })}
            />
          }
        />
        <SettingsRow
          label={tr.settings.appearance.reduceMotion}
          control={
            <SegmentedSmall
              label={tr.settings.appearance.reduceMotion}
              value={prefs.reduceMotion}
              onChange={(reduceMotion) => update({ reduceMotion })}
              options={[
                { value: 'system', label: tr.settings.appearance.system },
                { value: 'always', label: tr.settings.appearance.always },
              ]}
            />
          }
        />
      </div>
    </>
  )
}
