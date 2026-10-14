/**
 * `HeaderActions`: "Search ⌘K" 112×30 (icon only under 1100 px), Rediscover,
 * light / dark toggle, Settings; centers spaced 36 px apart, right margin 28.
 */
import { Compass, Moon, Search, Settings, Sun } from 'lucide-react'
import { IconButton, Kbd } from '../components/ui'
import { tr } from '../i18n'
import { cn } from '../lib/cn'
import { AiStatusPill } from '../features/ai/AiStatusPill'

/**
 * Sun / moon glyph with two tinted copies: while the theme changes they swing on each side of
 * the glyph and fade, as it settles sharp (`styles/theme-transition.css`).
 */
function ThemeGlyph({ dark }: { dark: boolean }) {
  const Icon = dark ? Sun : Moon
  return (
    <span className="theme-glyph">
      <Icon size={18} strokeWidth={1.75} className="theme-glyph__core" />
      <Icon size={18} strokeWidth={1.75} className="theme-glyph__ghost" data-side="left" />
      <Icon size={18} strokeWidth={1.75} className="theme-glyph__ghost" data-side="right" />
    </span>
  )
}

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
  onToggleTheme: (origin: Element) => void
  onSettings: () => void
}) {
  return (
    <div className="app-no-drag absolute right-6 top-[41px] flex h-7 items-center gap-2">
      <AiStatusPill />
      {compact ? (
        <IconButton
          icon={<Search size={14} strokeWidth={1.75} />}
          label={`${tr.nav.searchButton} ⌘K`}
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
          <span className="ml-1.5 mr-2">{tr.nav.searchButton}</span>
          <Kbd keys={['⌘', 'K']} size="xs" tone="light" className="ml-auto" />
        </button>
      )}
      <IconButton
        data-testid="btn-rediscover"
        icon={<Compass size={18} strokeWidth={1.75} />}
        label={tr.nav.rediscover}
        shortcut={['⇧', '⌘', 'R']}
        onClick={onRediscover}
      />
      <IconButton
        data-testid="btn-theme"
        icon={<ThemeGlyph dark={dark} />}
        label={dark ? tr.nav.themeLight : tr.nav.themeDark}
        shortcut={['⇧', '⌘', 'L']}
        onClick={(e) => onToggleTheme(e.currentTarget)}
      />
      <IconButton
        data-testid="btn-settings"
        icon={<Settings size={18} strokeWidth={1.75} />}
        label={tr.nav.settings}
        shortcut={['⌘', ',']}
        onClick={onSettings}
      />
    </div>
  )
}
