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
  it('type="button" par défaut et classes de variante', () => {
    render(<Button variant="primary">Importer</Button>)
    const b = screen.getByRole('button', { name: 'Importer' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toContain('bg-accent')
    expect(b.className).toContain('rounded-full')
  })

  it('loading : spinner, désactivé, aria-busy ; le clic est ignoré', () => {
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

  it('tailles et formes', () => {
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

  it('asChild rend l’enfant avec le style du bouton', () => {
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
  it('porte aria-label = label (FR) et le déclenche au clic', () => {
    const onClick = vi.fn()
    render(<IconButton icon={<XGlyph />} label="Fermer" onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Fermer' })
    expect(b.getAttribute('aria-label')).toBe('Fermer')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('tones et tailles', () => {
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
  it('apparaît après 600 ms de survol, pas avant', async () => {
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

  it('désactivé : rend seulement le déclencheur', () => {
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
  it('xs : un seul <kbd> avec les touches jointes', () => {
    const { container } = render(<Kbd keys={['⌘', 'K']} />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds).toHaveLength(1)
    expect(kbds[0]?.textContent).toBe('⌘K')
  })
  it('md : une boîte par touche, annoncée comme un raccourci', () => {
    const { container } = render(<Kbd keys={['⌘', '⇧', 'S']} size="md" />)
    expect(container.querySelectorAll('kbd')).toHaveLength(3)
    expect(screen.getByRole('img', { name: '⌘ ⇧ S' })).toBeTruthy()
  })
  it('police mono pour les touches en lettres', () => {
    const { container } = render(<Kbd keys={['esc']} size="sm" />)
    expect(container.querySelector('kbd')?.className).toContain('font-mono')
  })
})

describe('Switch', () => {
  it('bascule et reste accessible', () => {
    const onChange = vi.fn()
    render(<Switch aria-label="Lire au survol" checked={false} onCheckedChange={onChange} />)
    const s = screen.getByRole('switch', { name: 'Lire au survol' })
    expect(s.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(s)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Slider', () => {
  it('expose valeur, bornes et nom accessible ; le clavier change la valeur', () => {
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
  it.each(['columns', 'zoom', 'settings'] as const)('variante %s se rend', (variant) => {
    render(<Slider variant={variant} label={variant} min={0} max={10} value={3} />)
    expect(screen.getByRole('slider', { name: variant })).toBeTruthy()
  })
})

describe('SegmentedSmall', () => {
  it('sélectionne une option et ne désélectionne jamais', () => {
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
  it('invalid pose aria-invalid ; variante viewer', () => {
    render(<Input aria-label="Nom" invalid variant="viewer" />)
    const i = screen.getByLabelText('Nom')
    expect(i.getAttribute('aria-invalid')).toBe('true')
    expect(i.className).toContain('--viewer-input')
  })
})

describe('Chip', () => {
  it('statique : pas de bouton ; tag préfixé par #', () => {
    const { container } = render(<Chip variant="tag" label="design" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('#design')
  })
  it('cliquable : aria-pressed ; retirable : croix nommée', () => {
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
  it('jamais de bouton imbriqué', () => {
    const { container } = render(
      <Chip label="Dev" onClick={() => undefined} onRemove={() => undefined} />,
    )
    expect(container.querySelector('button button')).toBeNull()
  })
})

describe('EmptyState, Spinner, PillBar', () => {
  it('EmptyState : titre, description, action', () => {
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
  it('Spinner : role=status nommé en français ; décoratif sur demande', () => {
    const { container } = render(
      <>
        <Spinner />
        <Spinner label={null} />
      </>,
    )
    expect(screen.getByRole('status', { name: 'Chargement…' })).toBeTruthy()
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0)
  })
  it('PillBar : pilule de 40 px, action en pilule noire', () => {
    render(
      <PillBar floating>
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
  it('hashHue est déterministe, insensible à la casse et au @', () => {
    expect(hashHue('ClaudeDevs')).toBe(hashHue('@claudedevs'))
    expect(hashHue('a')).not.toBe(hashHue('b'))
    expect(hashHue('x')).toBeGreaterThanOrEqual(0)
    expect(hashHue('x')).toBeLessThan(360)
  })
  it('initiales', () => {
    expect(initials('Claude Devs')).toBe('CD')
    expect(initials('GamesLover with a Preference')).toBe('GP')
    expect(initials('martin')).toBe('M')
    expect(initials('', '@tofi')).toBe('T')
    expect(initials('', '')).toBe('?')
    expect(initials('🔥 Léa Dupont')).toBe('LD')
  })
  it('repli par initiales sur teinte du handle, sans image', () => {
    const { container } = render(<Avatar name="Claude Devs" handle="ClaudeDevs" />)
    const a = container.querySelector('[data-avatar]') as HTMLElement
    expect(a.textContent).toBe('CD')
    expect(a.style.getPropertyValue('--avatar-hue')).toBe(String(hashHue('ClaudeDevs')))
    expect(container.querySelector('img')).toBeNull()
  })
  it('même handle → même teinte ; handles différents → teintes distinctes', () => {
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
  it('image recolt:// affichée, puis repli aux initiales si elle échoue', () => {
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

describe('MediaBadge et FormatBadge', () => {
  it('vidéo : nom accessible « Vidéo » ; carrousel : « 1/6 » ; gif : « GIF »', () => {
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
  it('FormatBadge en capitales', () => {
    render(<FormatBadge format="mp4" />)
    expect(screen.getByText('MP4')).toBeTruthy()
  })
})
