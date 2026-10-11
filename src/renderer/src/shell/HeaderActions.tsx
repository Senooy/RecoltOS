/**
 * `HeaderActions` (DESIGN §2.5) : « Rechercher ⌘K » 112×30 (icône seule sous 1100 px), Redécouvrir,
 * bascule clair / sombre, Réglages ; centres espacés de 36 px, marge droite 28.
 */
import { Compass, Moon, Search, Settings, Sun } from 'lucide-react'
import { IconButton, Kbd } from '../components/ui'
import { fr } from '../i18n/fr'
import { cn } from '../lib/cn'

export function HeaderActions({
  compact,
  dark,
  onSearch,
  onRediscover,
  onToggleTheme,
  onSettings,
}: {
  compact: boolean
  dark: boolean
  onSearch: () => void
  onRediscover: () => void
  onToggleTheme: () => void
  onSettings: () => void
}) {
  return (
    <div className="app-no-drag absolute right-6 top-[41px] flex h-7 items-center gap-2">
      {compact ? (
        <IconButton
          icon={<Search size={14} strokeWidth={1.75} />}
          label={`${fr.nav.searchButton} ⌘K`}
          tone="outline"
          className="mr-2 h-[30px] w-[30px] rounded-full"
          onClick={onSearch}
        />
      ) : (
        <button
          type="button"
          data-testid="btn-search"
          className={cn(
            'mr-2 flex h-[30px] min-w-[112px] items-center whitespace-nowrap rounded-full border border-border pl-[10px] pr-[5px] text-ui text-fg-subtle',
            'transition-colors hover:border-border-strong hover:text-fg',
          )}
          onClick={onSearch}
        >
          <Search size={14} strokeWidth={1.75} />
          <span className="ml-1.5 mr-2">{fr.nav.searchButton}</span>
          <Kbd keys={['⌘', 'K']} size="xs" tone="light" className="ml-auto" />
        </button>
      )}
      <IconButton
        data-testid="btn-rediscover"
        icon={<Compass size={18} strokeWidth={1.75} />}
        label={fr.nav.rediscover}
        shortcut={['⇧', '⌘', 'R']}
        onClick={onRediscover}
      />
      <IconButton
        data-testid="btn-theme"
        icon={dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
        label={dark ? fr.nav.themeLight : fr.nav.themeDark}
        shortcut={['⇧', '⌘', 'L']}
        onClick={onToggleTheme}
      />
      <IconButton
        data-testid="btn-settings"
        icon={<Settings size={18} strokeWidth={1.75} />}
        label={fr.nav.settings}
        shortcut={['⌘', ',']}
        onClick={onSettings}
      />
    </div>
  )
}
