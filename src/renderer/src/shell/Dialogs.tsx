/** Rendu des dialogues `askConfirm` / `askName` (`state/dialogs.ts`). */
import { useEffect, useState } from 'react'
import { Button, Dialog, Input } from '../components/ui'
import { tr } from '../i18n'
import { useDialogs } from '../state/dialogs'

export function Dialogs() {
  const current = useDialogs((s) => s.current)
  const set = useDialogs((s) => s.set)
  const [value, setValue] = useState('')
  useEffect(() => {
    if (current?.kind === 'name') setValue(current.initial)
  }, [current])
  if (!current) return null
  const close = (ok: boolean) => {
    set(null)
    if (current.kind === 'confirm') current.resolve(ok)
    else current.resolve(ok ? value.trim() || null : null)
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close(false)}>
      <Dialog.Content
        title={current.title}
        {...(current.kind === 'confirm' && current.body ? { description: current.body } : {})}
        showClose={false}
        data-testid="app-dialog"
      >
        <form
          className="flex flex-col gap-4 px-5 pb-5 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            close(true)
          }}
        >
          {current.kind === 'name' ? (
            <Input
              autoFocus
              aria-label={tr.shell.name}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>
              {tr.confirm.cancel}
            </Button>
            <Button
              type="submit"
              variant={current.kind === 'confirm' && current.danger ? 'danger' : 'primary'}
              disabled={current.kind === 'name' && value.trim() === ''}
            >
              {current.confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
