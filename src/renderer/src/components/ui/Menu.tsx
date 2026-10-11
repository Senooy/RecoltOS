/**
 * `Menu` (DESIGN §3.9, §1.9) : menus Radix stylés, DropdownMenu et ContextMenu (jamais de menu
 * natif). Items `default` / `danger` / `checkbox` / `sub`. Gabarit : 200 px min, padding 5, rayon 10,
 * items de 28 px (rayon 6, gap 10, icône 15 px, libellé 13,5 px), sans séparateurs par défaut.
 * Animation : opacity + scale .97→1 depuis l'origine Radix (140 ms / 100 ms) ; fondu seul en
 * mouvement réduit (`ui.css`). Le contenu est explicitement `app-no-drag` (§2.1).
 *
 * Usage : `<Menu.Dropdown.Root> … <Menu.Dropdown.Content> <Menu.Dropdown.Item icon={…}>…`.
 */
import { Check, ChevronRight } from 'lucide-react'
import { ContextMenu as CtxPrimitive, DropdownMenu as DdPrimitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Kbd } from './Kbd'
import { usePortalContainer } from './portal-container'
import './ui.css'

export type MenuItemTone = 'default' | 'danger'

const CONTENT =
  'ui-pop app-no-drag z-[60] min-w-[200px] overflow-hidden rounded-lg bg-surface p-[5px] shadow-[var(--shadow-popover)]'
const ITEM =
  'ui-menu-item flex h-7 cursor-default select-none items-center gap-2.5 rounded-sm px-2 text-[13.5px] leading-5 outline-none'
const ICON = '[&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]'
const LABEL = 'px-2 pb-1 pt-1.5 text-micro uppercase text-fg-faint'
const SEPARATOR = 'mx-1 my-[5px] h-px bg-border-subtle'

function itemClass(tone: MenuItemTone | undefined, className?: string): string {
  return cn(
    ITEM,
    ICON,
    tone === 'danger'
      ? 'ui-menu-item-danger text-danger [&_svg]:text-danger'
      : 'text-fg [&_svg]:text-fg-subtle',
    className,
  )
}

interface ItemExtras {
  /** Icône de 15 px à gauche. */
  icon?: ReactNode
  /** Raccourci affiché à droite. */
  shortcut?: readonly string[]
  tone?: MenuItemTone
}

function ItemBody({
  icon,
  shortcut,
  children,
}: Pick<ItemExtras, 'icon' | 'shortcut'> & { children?: ReactNode }) {
  return (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && shortcut.length > 0 ? <Kbd keys={shortcut} size="xs" tone="light" /> : null}
    </>
  )
}

const checkIndicator = (
  <Check
    aria-hidden="true"
    className="ml-auto h-[15px] w-[15px] shrink-0 text-fg"
    strokeWidth={2}
  />
)
const subChevron = (
  <ChevronRight
    aria-hidden="true"
    className="ml-auto h-3.5 w-3.5 shrink-0"
    style={{ color: 'var(--fg-faint)' }}
    strokeWidth={1.75}
  />
)

// ---- DropdownMenu ---------------------------------------------------------------------------

function DdContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof DdPrimitive.Content>) {
  return (
    <DdPrimitive.Portal container={usePortalContainer()}>
      <DdPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(CONTENT, className)}
        {...rest}
      />
    </DdPrimitive.Portal>
  )
}
function DdItem({
  icon,
  shortcut,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof DdPrimitive.Item> & ItemExtras) {
  return (
    <DdPrimitive.Item className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </DdPrimitive.Item>
  )
}
function DdCheckboxItem({
  icon,
  shortcut,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof DdPrimitive.CheckboxItem> & ItemExtras) {
  return (
    <DdPrimitive.CheckboxItem className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
      <DdPrimitive.ItemIndicator asChild>{checkIndicator}</DdPrimitive.ItemIndicator>
    </DdPrimitive.CheckboxItem>
  )
}
function DdSubTrigger({
  icon,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof DdPrimitive.SubTrigger> & Omit<ItemExtras, 'shortcut'>) {
  return (
    <DdPrimitive.SubTrigger className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon}>{children}</ItemBody>
      {subChevron}
    </DdPrimitive.SubTrigger>
  )
}
function DdSubContent({
  className,
  sideOffset = 4,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof DdPrimitive.SubContent>) {
  return (
    <DdPrimitive.Portal container={usePortalContainer()}>
      <DdPrimitive.SubContent
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(CONTENT, className)}
        {...rest}
      />
    </DdPrimitive.Portal>
  )
}
function DdLabel({ className, ...rest }: ComponentProps<typeof DdPrimitive.Label>) {
  return <DdPrimitive.Label className={cn(LABEL, className)} {...rest} />
}
function DdSeparator({ className, ...rest }: ComponentProps<typeof DdPrimitive.Separator>) {
  return <DdPrimitive.Separator className={cn(SEPARATOR, className)} {...rest} />
}

// ---- ContextMenu ----------------------------------------------------------------------------

function CtxContent({
  className,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof CtxPrimitive.Content>) {
  return (
    <CtxPrimitive.Portal container={usePortalContainer()}>
      <CtxPrimitive.Content
        collisionPadding={collisionPadding}
        className={cn(CONTENT, className)}
        {...rest}
      />
    </CtxPrimitive.Portal>
  )
}
function CtxItem({
  icon,
  shortcut,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof CtxPrimitive.Item> & ItemExtras) {
  return (
    <CtxPrimitive.Item className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </CtxPrimitive.Item>
  )
}
function CtxCheckboxItem({
  icon,
  shortcut,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof CtxPrimitive.CheckboxItem> & ItemExtras) {
  return (
    <CtxPrimitive.CheckboxItem className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
      <CtxPrimitive.ItemIndicator asChild>{checkIndicator}</CtxPrimitive.ItemIndicator>
    </CtxPrimitive.CheckboxItem>
  )
}
function CtxSubTrigger({
  icon,
  tone,
  className,
  children,
  ...rest
}: ComponentProps<typeof CtxPrimitive.SubTrigger> & Omit<ItemExtras, 'shortcut'>) {
  return (
    <CtxPrimitive.SubTrigger className={itemClass(tone, className)} {...rest}>
      <ItemBody icon={icon}>{children}</ItemBody>
      {subChevron}
    </CtxPrimitive.SubTrigger>
  )
}
function CtxSubContent({
  className,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof CtxPrimitive.SubContent>) {
  return (
    <CtxPrimitive.Portal container={usePortalContainer()}>
      <CtxPrimitive.SubContent
        collisionPadding={collisionPadding}
        className={cn(CONTENT, className)}
        {...rest}
      />
    </CtxPrimitive.Portal>
  )
}
function CtxLabel({ className, ...rest }: ComponentProps<typeof CtxPrimitive.Label>) {
  return <CtxPrimitive.Label className={cn(LABEL, className)} {...rest} />
}
function CtxSeparator({ className, ...rest }: ComponentProps<typeof CtxPrimitive.Separator>) {
  return <CtxPrimitive.Separator className={cn(SEPARATOR, className)} {...rest} />
}

export const Menu = {
  /** Menu déroulant ancré à un déclencheur (FAB, tri, sélecteur de bibliothèque…). */
  Dropdown: {
    Root: DdPrimitive.Root,
    Trigger: DdPrimitive.Trigger,
    Content: DdContent,
    Item: DdItem,
    CheckboxItem: DdCheckboxItem,
    Sub: DdPrimitive.Sub,
    SubTrigger: DdSubTrigger,
    SubContent: DdSubContent,
    Label: DdLabel,
    Separator: DdSeparator,
    Group: DdPrimitive.Group,
  },
  /** Menu contextuel (clic droit). */
  Context: {
    Root: CtxPrimitive.Root,
    Trigger: CtxPrimitive.Trigger,
    Content: CtxContent,
    Item: CtxItem,
    CheckboxItem: CtxCheckboxItem,
    Sub: CtxPrimitive.Sub,
    SubTrigger: CtxSubTrigger,
    SubContent: CtxSubContent,
    Label: CtxLabel,
    Separator: CtxSeparator,
    Group: CtxPrimitive.Group,
  },
} as const
