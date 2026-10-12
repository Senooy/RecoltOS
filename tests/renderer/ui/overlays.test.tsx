// @vitest-environment happy-dom
import './_setup'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../../src/renderer/src/components/ui/Dialog'
import { Menu } from '../../../src/renderer/src/components/ui/Menu'
import { Popover } from '../../../src/renderer/src/components/ui/Popover'
import { PortalContainerProvider } from '../../../src/renderer/src/components/ui/portal-container'

describe('Menu.Dropdown', () => {
  const renderMenu = (onDelete = vi.fn(), onCheck = vi.fn()) =>
    render(
      <Menu.Dropdown.Root open modal={false}>
        <Menu.Dropdown.Trigger>Ouvrir</Menu.Dropdown.Trigger>
        <Menu.Dropdown.Content>
          <Menu.Dropdown.Item>Télécharger</Menu.Dropdown.Item>
          <Menu.Dropdown.Item tone="danger" onSelect={onDelete}>
            Supprimer
          </Menu.Dropdown.Item>
          <Menu.Dropdown.CheckboxItem checked onCheckedChange={onCheck}>
            Gaming
          </Menu.Dropdown.CheckboxItem>
          <Menu.Dropdown.Sub>
            <Menu.Dropdown.SubTrigger>Ajouter à une collection</Menu.Dropdown.SubTrigger>
          </Menu.Dropdown.Sub>
        </Menu.Dropdown.Content>
      </Menu.Dropdown.Root>,
    )

  it('role=menu, explicit no-drag, Radix animation (.ui-pop)', () => {
    renderMenu()
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('app-no-drag')
    expect(menu.className).toContain('ui-pop')
    expect(menu.className).toContain('rounded-lg')
    expect(menu.className).toContain('min-w-[200px]')
  })

  it('items: default, danger, checkbox, submenu', () => {
    const onDelete = vi.fn()
    renderMenu(onDelete)
    const del = screen.getByRole('menuitem', { name: 'Supprimer' })
    expect(del.className).toContain('ui-menu-item-danger')
    expect(del.className).toContain('text-danger')
    expect(del.className).toContain('h-7')
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Gaming' }).getAttribute('aria-checked'),
    ).toBe('true')
    const sub = screen.getByRole('menuitem', { name: 'Ajouter à une collection' })
    expect(sub.getAttribute('aria-haspopup')).toBe('menu')
  })
})

describe('Menu.Context', () => {
  it('opens on right-click with the same styles', async () => {
    render(
      <Menu.Context.Root>
        <Menu.Context.Trigger>
          <div>zone</div>
        </Menu.Context.Trigger>
        <Menu.Context.Content>
          <Menu.Context.Item>Copier l’image</Menu.Context.Item>
          <Menu.Context.Item tone="danger">Supprimer</Menu.Context.Item>
        </Menu.Context.Content>
      </Menu.Context.Root>,
    )
    fireEvent.contextMenu(screen.getByText('zone'), { clientX: 10, clientY: 10 })
    const menu = await screen.findByRole('menu')
    expect(menu.className).toContain('app-no-drag')
    expect(screen.getByRole('menuitem', { name: 'Supprimer' }).className).toContain('text-danger')
  })
})

describe('Dialog', () => {
  it('title announced, description linked, "Fermer" close button, no-drag scrim', () => {
    render(
      <Dialog.Root open>
        <Dialog.Content title="Supprimer « Dev » ?" description="Les éléments restent.">
          <p>corps</p>
        </Dialog.Content>
      </Dialog.Root>,
    )
    const dlg = screen.getByRole('dialog', { name: 'Supprimer « Dev » ?' })
    expect(dlg.className).toContain('app-no-drag')
    expect(dlg.className).toContain('ui-dialog')
    expect(dlg.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy()
    const overlay = document.querySelector('.ui-scrim')
    expect(overlay?.className).toContain('overlay')
    expect(overlay?.className).toContain('ui-scrim-modal')
  })

  it('hideTitle: title still in the accessibility tree; palette scrim without blur', () => {
    render(
      <Dialog.Root open>
        <Dialog.Content title="Réglages" hideTitle showClose={false} scrim="palette" />
      </Dialog.Root>,
    )
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fermer' })).toBeNull()
    expect(document.querySelector('.ui-scrim')?.className).toContain('ui-scrim-palette')
  })

  it('close button closes', () => {
    const onOpenChange = vi.fn()
    render(
      <Dialog.Root open onOpenChange={onOpenChange}>
        <Dialog.Content title="T" />
      </Dialog.Root>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('portals into the provided container (local theme, viewer)', () => {
    const host = document.createElement('div')
    host.setAttribute('data-theme', 'dark')
    document.body.appendChild(host)
    render(
      <PortalContainerProvider container={host}>
        <Dialog.Root open>
          <Dialog.Content title="T" />
        </Dialog.Root>
      </PortalContainerProvider>,
    )
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
  })
})

describe('Popover', () => {
  it('styled content, no-drag, radius 12', () => {
    render(
      <Popover.Root open>
        <Popover.Trigger>Filtres</Popover.Trigger>
        <Popover.Content>contenu</Popover.Content>
      </Popover.Root>,
    )
    const c = screen.getByText('contenu')
    expect(c.className).toContain('app-no-drag')
    expect(c.className).toContain('rounded-xl')
    expect(c.className).toContain('ui-pop')
  })
})
