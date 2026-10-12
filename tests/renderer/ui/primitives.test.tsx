// @vitest-environment happy-dom
import './_setup'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Avatar, hashHue, initials } from '../../../src/renderer/src/components/ui/Avatar'
import { Button } from '../../../src/renderer/src/components/ui/Button'
import { Chip } from '../../../src/renderer/src/components/ui/Chip'
import { EmptyState } from '../../../src/renderer/src/components/ui/EmptyState'
import { FormatBadge } from '../../../src/renderer/src/components/ui/FormatBadge'
import { IconButton } from '../../../src/renderer/src/components/ui/IconButton'
import { Input } from '../../../src/renderer/src/components/ui/Input'
import { Kbd } from '../../../src/renderer/src/components/ui/Kbd'
import { MediaBadge } from '../../../src/renderer/src/components/ui/MediaBadge'
import { TOOLTIP_DELAY_MS } from '../../../src/renderer/src/components/ui/motion'
import { PillBar } from '../../../src/renderer/src/components/ui/PillBar'
import { SegmentedSmall } from '../../../src/renderer/src/components/ui/SegmentedSmall'
import { Slider } from '../../../src/renderer/src/components/ui/Slider'
import { Spinner } from '../../../src/renderer/src/components/ui/Spinner'
import { Switch } from '../../../src/renderer/src/components/ui/Switch'
import { Tooltip } from '../../../src/renderer/src/components/ui/Tooltip'
import { XGlyph } from '../../../src/renderer/src/components/icons'

describe('Button', () => {
  it('type="button" by default and variant classes', () => {
    render(<Button variant="primary">Importer</Button>)
    const b = screen.getByRole('button', { name: 'Importer' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toContain('bg-accent')
    expect(b.className).toContain('rounded-full')
  })

  it('loading: spinner, disabled, aria-busy; click is ignored', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Charger
      </Button>,
    )
    const b = screen.getByRole('button', { name: /Charger/ })
    expect((b as HTMLButtonElement).disabled).toBe(true)
    expect(b.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('sizes and shapes', () => {
    render(
      <>
        <Button size="sm" shape="rounded">
          a
        </Button>
        <Button size="lg">b</Button>
      </>,
    )
    expect(screen.getByText('a').className).toContain('h-7')
    expect(screen.getByText('a').className).toContain('rounded-lg')
    expect(screen.getByText('b').className).toContain('h-9')
  })

  it('asChild renders the child with the button style', () => {
    render(
      <Button asChild variant="primary">
        <a href="https://example.test">Lien</a>
      </Button>,
    )
    const a = screen.getByRole('link', { name: 'Lien' })
    expect(a.className).toContain('bg-accent')
  })
})

describe('IconButton', () => {
  it('has aria-label = label (FR) and triggers it on click', () => {
    const onClick = vi.fn()
    render(<IconButton icon={<XGlyph />} label="Fermer" onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Fermer' })
    expect(b.getAttribute('aria-label')).toBe('Fermer')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('tones and sizes', () => {
    render(
      <>
        <IconButton icon={<XGlyph />} label="a" size="sm" />
        <IconButton icon={<XGlyph />} label="b" size="lg" tone="glass" />
        <IconButton icon={<XGlyph />} label="c" tone="viewer" />
      </>,
    )
    expect(screen.getByLabelText('a').className).toContain('h-6')
    expect(screen.getByLabelText('b').className).toContain('glass')
    expect(screen.getByLabelText('c').className).toContain('--viewer-btn')
  })
})

describe('Tooltip (600 ms)', () => {
  it('appears after 600 ms of hover, not before', async () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Réglages" shortcut={['⌘', ',']}>
        <button type="button">cible</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'cible' })
    fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOOLTIP_DELAY_MS - 50)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByRole('tooltip').textContent).toContain('Réglages')
    expect(TOOLTIP_DELAY_MS).toBe(600)
  })

  it('disabled: only renders the trigger', () => {
    render(
      <Tooltip content="x" disabled>
        <button type="button">cible</button>
      </Tooltip>,
    )
    fireEvent.focus(screen.getByRole('button', { name: 'cible' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Kbd', () => {
  it('xs: a single <kbd> with the keys joined', () => {
    const { container } = render(<Kbd keys={['⌘', 'K']} />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds).toHaveLength(1)
    expect(kbds[0]?.textContent).toBe('⌘K')
  })
  it('md: one box per key, announced as a shortcut', () => {
    const { container } = render(<Kbd keys={['⌘', '⇧', 'S']} size="md" />)
    expect(container.querySelectorAll('kbd')).toHaveLength(3)
    expect(screen.getByRole('img', { name: '⌘ ⇧ S' })).toBeTruthy()
  })
  it('monospace font for letter keys', () => {
    const { container } = render(<Kbd keys={['esc']} size="sm" />)
    expect(container.querySelector('kbd')?.className).toContain('font-mono')
  })
})

describe('Switch', () => {
  it('toggles and stays accessible', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Lire au survol" checked={false} onCheckedChange={onChange} />)
    const s = screen.getByRole('switch', { name: 'Lire au survol' })
    expect(s.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(s)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Slider', () => {
  it('exposes value, bounds and accessible name; the keyboard changes the value', () => {
    const onChange = vi.fn()
    render(
      <Slider
        variant="columns"
        label="Taille des colonnes"
        min={2}
        max={8}
        value={4}
        onValueChange={onChange}
        valueText="4 colonnes"
      />,
    )
    const thumb = screen.getByRole('slider', { name: 'Taille des colonnes' })
    expect(thumb.getAttribute('aria-valuenow')).toBe('4')
    expect(thumb.getAttribute('aria-valuemin')).toBe('2')
    expect(thumb.getAttribute('aria-valuemax')).toBe('8')
    expect(thumb.getAttribute('aria-valuetext')).toBe('4 colonnes')
    fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(5)
  })
  it.each(['columns', 'zoom', 'settings'] as const)('variant %s renders', (variant) => {
    render(<Slider variant={variant} label={variant} min={0} max={10} value={3} />)
    expect(screen.getByRole('slider', { name: variant })).toBeTruthy()
  })
})

describe('SegmentedSmall', () => {
  it('selects an option and never deselects', () => {
    const onChange = vi.fn()
    render(
      <SegmentedSmall
        label="Thème"
        value="light"
        onChange={onChange}
        options={[
          { value: 'light', label: 'Clair' },
          { value: 'dark', label: 'Sombre' },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }))
    expect(onChange).toHaveBeenCalledWith('dark')
    onChange.mockClear()
    fireEvent.click(screen.getByRole('radio', { name: 'Clair' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Input', () => {
  it('invalid sets aria-invalid; viewer variant', () => {
    render(<Input aria-label="Nom" invalid variant="viewer" />)
    const i = screen.getByLabelText('Nom')
    expect(i.getAttribute('aria-invalid')).toBe('true')
    expect(i.className).toContain('--viewer-input')
  })
})

describe('Chip', () => {
  it('static: no button; tag prefixed with #', () => {
    const { container } = render(<Chip variant="tag" label="design" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('#design')
  })
  it('clickable: aria-pressed; removable: named cross', () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    render(<Chip label="Images" selected onClick={onClick} onRemove={onRemove} />)
    const main = screen.getByRole('button', { name: 'Images' })
    expect(main.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(main)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer Images' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })
  it('never nests a button', () => {
    const { container } = render(
      <Chip label="Dev" onClick={() => undefined} onRemove={() => undefined} />,
    )
    expect(container.querySelector('button button')).toBeNull()
  })
})

describe('EmptyState, Spinner, PillBar', () => {
  it('EmptyState: title, description, action', () => {
    render(
      <EmptyState
        title="La corbeille est vide"
        description="Rien ici."
        action={<Button>Faire</Button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'La corbeille est vide' })).toBeTruthy()
    expect(screen.getByText('Rien ici.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Faire' })).toBeTruthy()
  })
  it('Spinner: role=status named in French; decorative on request', () => {
    const { container } = render(
      <>
        <Spinner />
        <Spinner label={null} />
      </>,
    )
    expect(screen.getByRole('status', { name: 'Chargement…' })).toBeTruthy()
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
  it('PillBar: 40 px pill, action as a black pill', () => {
    render(
      <PillBar floating aria-label="Sélection">
        Ajouté à Gaming
        <PillBar.Action>Annuler</PillBar.Action>
      </PillBar>,
    )
    const group = screen.getByRole('group')
    expect(group.className).toContain('h-10')
    expect(group.className).toContain('rounded-full')
    expect(group.className).toContain('fixed')
    expect(screen.getByRole('button', { name: 'Annuler' }).className).toContain('h-7')
  })
})

describe('Avatar', () => {
  it('hashHue is deterministic, case-insensitive and ignores @', () => {
    expect(hashHue('ClaudeDevs')).toBe(hashHue('@claudedevs'))
    expect(hashHue('a')).not.toBe(hashHue('b'))
    expect(hashHue('x')).toBeGreaterThanOrEqual(0)
    expect(hashHue('x')).toBeLessThan(360)
  })
  it('initials', () => {
    expect(initials('Claude Devs')).toBe('CD')
    expect(initials('GamesLover with a Preference')).toBe('GP')
    expect(initials('martin')).toBe('M')
    expect(initials('', '@tofi')).toBe('T')
    expect(initials('', '')).toBe('?')
    expect(initials('🔥 Léa Dupont')).toBe('LD')
  })
  it('fallback to initials on handle hue, without image', () => {
    const { container } = render(<Avatar name="Claude Devs" handle="ClaudeDevs" />)
    const a = container.querySelector('[data-avatar]') as HTMLElement
    expect(a.textContent).toBe('CD')
    expect(a.style.getPropertyValue('--avatar-hue')).toBe(String(hashHue('ClaudeDevs')))
    expect(container.querySelector('img')).toBeNull()
  })
  it('same handle → same hue; different handles → distinct hues', () => {
    const { container } = render(
      <>
        <Avatar name="A" handle="same" />
        <Avatar name="B" handle="same" />
        <Avatar name="C" handle="other-handle" />
      </>,
    )
    const hues = [...container.querySelectorAll<HTMLElement>('[data-avatar]')].map((e) =>
      e.style.getPropertyValue('--avatar-hue'),
    )
    expect(hues[0]).toBe(hues[1])
    expect(hues[0]).not.toBe(hues[2])
  })
  it('recolt:// image displayed, then fallback to initials if it fails', () => {
    const { container } = render(
      <Avatar name="Claude Devs" handle="cd" src="recolt://lib/avatars/x/1.jpg" />,
    )
    const img = container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('recolt://lib/avatars/x/1.jpg')
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-avatar]')?.textContent).toBe('CD')
  })
})

describe('MediaBadge and FormatBadge', () => {
  it('video: accessible name "Vidéo"; carousel: "1/6"; gif: "GIF"', () => {
    render(
      <>
        <MediaBadge kind="video" />
        <MediaBadge kind="carousel" label="1/6" />
        <MediaBadge kind="gif" />
      </>,
    )
    expect(screen.getByRole('img', { name: 'Vidéo' })).toBeTruthy()
    expect(screen.getByText('1/6')).toBeTruthy()
    expect(screen.getByText('GIF')).toBeTruthy()
  })
  it('FormatBadge in capitals', () => {
    render(<FormatBadge format="mp4" />)
    expect(screen.getByText('MP4')).toBeTruthy()
  })
})

describe('Tooltip disabled: stable tree', () => {
  it('toggling disabled does not unmount the trigger (focus and node kept)', () => {
    const { rerender } = render(
      <Tooltip content="Réglages">
        <button type="button">Ouvrir</button>
      </Tooltip>,
    )
    const before = screen.getByRole('button', { name: 'Ouvrir' })
    before.focus()
    rerender(
      <Tooltip content="Réglages" disabled>
        <button type="button">Ouvrir</button>
      </Tooltip>,
    )
    expect(screen.getByRole('button', { name: 'Ouvrir' })).toBe(before)
    expect(document.activeElement).toBe(before)
  })

  it('toggling disabled both ways logs no React/Radix warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const tree = (disabled: boolean) => (
      <Tooltip content="Réglages" disabled={disabled}>
        <button type="button">Ouvrir</button>
      </Tooltip>
    )
    const { rerender } = render(tree(false))
    rerender(tree(true))
    rerender(tree(false))
    rerender(tree(true))
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    warn.mockRestore()
    error.mockRestore()
  })
})

describe('IconButton: label required and non-empty', () => {
  it('rejects an empty or blank label', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<IconButton icon={<XGlyph />} label="  " />)).toThrow(/label/)
    spy.mockRestore()
  })
})
