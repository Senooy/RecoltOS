/**
 * `UrlPopover` : champ URL ancré au FAB, validation `new URL()` http(s), états
 * chargement / erreur « Impossible de récupérer cette page ».
 */
import { useState } from 'react'
import { Button, Popover } from '../../components/ui'
import { fr } from '../../i18n/fr'
import { importUrl, reportImport } from './import-actions'

export function isWebUrl(v: string): boolean {
  try {
    const u = new URL(v.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function UrlPopoverContent({
  collection,
  onDone,
}: {
  collection: { uuid: string; name: string } | null
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'invalid' | 'failed'>('idle')
  const submit = async () => {
    if (!isWebUrl(value)) {
      setState('invalid')
      return
    }
    setState('loading')
    try {
      const r = await importUrl(value.trim(), collection?.uuid)
      if (r.failed.length > 0 && r.added.length === 0 && r.duplicates.length === 0) {
        setState('failed')
        return
      }
      reportImport(r)
      setValue('')
      setState('idle')
      onDone()
    } catch {
      setState('failed')
    }
  }
  return (
    <Popover.Content
      side="top"
      align="end"
      className="w-[320px]"
      data-testid="url-popover"
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).querySelector('input')?.focus()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="mb-1.5 block text-[12px] text-fg-muted" htmlFor="url-input">
          {fr.importUiMore.urlLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="url-input"
            data-testid="url-input"
            className="h-[34px] min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-2.5 text-[13.5px] outline-none focus:border-border-strong"
            placeholder={fr.importUiMore.urlPlaceholder}
            value={value}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              if (state !== 'loading') setState('idle')
            }}
          />
          <Button
            type="submit"
            variant="primary"
            loading={state === 'loading'}
            className="h-[34px]"
          >
            {fr.importUiMore.urlAdd}
          </Button>
        </div>
        {state === 'invalid' || state === 'failed' ? (
          <p className="mt-1.5 text-[12px] text-danger" role="alert" data-testid="url-error">
            {state === 'invalid' ? fr.importUiMore.urlInvalid : fr.importUiMore.urlFailed}
          </p>
        ) : null}
      </form>
    </Popover.Content>
  )
}
