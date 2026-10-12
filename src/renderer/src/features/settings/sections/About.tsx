/** Settings › About. */
import { useEffect, useState } from 'react'
import { RecoltLogo } from '../../../components/icons'
import { tr } from '../../../i18n'
import { rpc } from '../../../lib/rpc'

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  const [licenses, setLicenses] = useState(false)
  useEffect(() => {
    void rpc('system.appInfo')
      .then((i) => setVersion(i.version))
      .catch(() => setVersion(null))
  }, [])
  return (
    <div className="flex flex-col items-start gap-3">
      <RecoltLogo size={56} />
      <div>
        <div className="text-[21px] leading-7 font-bold">RecoltOS</div>
        {version ? (
          <div className="text-[11.5px] text-fg-muted">{tr.settings.about.version(version)}</div>
        ) : null}
      </div>
      <p className="select-text max-w-[470px] text-[12px] leading-[19.5px] text-fg-muted">
        {tr.settings.about.body}
      </p>
      <div className="flex gap-4">
        <button
          type="button"
          className="text-[11.5px] text-fg underline-offset-2 hover:underline"
          onClick={() => void rpc('system.openLogs').catch(() => undefined)}
        >
          {tr.settings.about.logs}
        </button>
        <button
          type="button"
          data-testid="about-licenses"
          aria-expanded={licenses}
          className="text-[11.5px] text-fg underline-offset-2 hover:underline"
          onClick={() => setLicenses((v) => !v)}
        >
          {tr.settings.about.licenses}
        </button>
      </div>
      {licenses ? (
        <p className="select-text max-w-[470px] rounded-[10px] border border-[var(--set-box-border)] bg-[var(--surface-info)] px-4 py-3 text-[11px] leading-[18px] text-fg-muted">
          {tr.settingsMoreUi.licensesBody}
        </p>
      ) : null}
    </div>
  )
}
