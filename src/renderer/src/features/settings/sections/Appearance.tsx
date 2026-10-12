/** Réglages › Apparence : thème, colonnes et tri par défaut, vidéos au survol, animations. */
import type { SortMode } from '../../../../../shared/enums'
import { SegmentedSmall, Slider, Switch } from '../../../components/ui'
import { fr } from '../../../i18n/fr'
import { usePrefs } from '../../../state/prefs'
import { useUi } from '../../../state/ui'
import { SettingsRow, SettingsTitle } from '../SettingsDialog'

const SORTS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: fr.sort.recent },
  { value: 'oldest', label: fr.sort.oldest },
  { value: 'viewed', label: fr.sort.recentlyViewed },
  { value: 'mostViewed', label: fr.sort.mostViewed },
  { value: 'name', label: fr.sort.name },
  { value: 'color', label: fr.sort.color },
  { value: 'random', label: fr.sort.random },
]

export function AppearanceSection() {
  const prefs = usePrefs((s) => s.prefs)
  const update = (patch: Parameters<ReturnType<typeof usePrefs.getState>['update']>[0]) =>
    void usePrefs
      .getState()
      .update(patch)
      .catch(() => undefined)
  return (
    <>
      <SettingsTitle>{fr.settings.nav.appearance}</SettingsTitle>
      <div className="mt-4">
        <SettingsRow
          label={fr.settings.appearance.theme}
          control={
            <SegmentedSmall
              label={fr.settings.appearance.theme}
              value={prefs.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'light', label: fr.settings.appearance.light },
                { value: 'dark', label: fr.settings.appearance.dark },
                { value: 'system', label: fr.settings.appearance.system },
              ]}
            />
          }
        />
        <SettingsRow
          label={fr.settings.appearance.defaultColumns}
          control={
            <div className="flex items-center gap-3">
              <Slider
                label={fr.settings.appearance.defaultColumns}
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
          label={fr.settings.appearance.defaultSort}
          control={
            <select
              aria-label={fr.settings.appearance.defaultSort}
              className="h-[34px] rounded-[10px] border border-[var(--set-field-border)] bg-[var(--set-field-bg)] px-3 text-[12.5px]"
              value={prefs.defaultSort}
              onChange={(e) => update({ defaultSort: e.target.value as SortMode })}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={fr.settings.appearance.hoverPlay}
          control={
            <Switch
              aria-label={fr.settings.appearance.hoverPlay}
              checked={prefs.hoverPlay}
              onCheckedChange={(hoverPlay) => update({ hoverPlay })}
            />
          }
        />
        <SettingsRow
          label={fr.settings.appearance.reduceMotion}
          control={
            <SegmentedSmall
              label={fr.settings.appearance.reduceMotion}
              value={prefs.reduceMotion}
              onChange={(reduceMotion) => update({ reduceMotion })}
              options={[
                { value: 'system', label: fr.settings.appearance.system },
                { value: 'always', label: fr.settings.appearance.always },
              ]}
            />
          }
        />
      </div>
    </>
  )
}
