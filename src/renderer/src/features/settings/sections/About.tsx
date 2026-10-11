/** Réglages › À propos (DESIGN §3.10). */
import { useEffect, useState } from 'react'
import { RecoltLogo } from '../../../components/icons'
import { fr } from '../../../i18n/fr'
import { rpc } from '../../../lib/rpc'

export function AboutSection() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    void rpc('system.appInfo')
      .then((i) => setVersion(i.version))
      .catch(() => setVersion(null))
  }, [])
  return (
    <div className="flex flex-col items-start gap-3">
      <RecoltLogo size={56} />
      <div>
        <div className="text-display font-bold">RecoltOS</div>
        {version ? (
          <div className="text-small text-fg-muted">{fr.settings.about.version(version)}</div>
        ) : null}
      </div>
      <p className="select-text max-w-[470px] text-[13.5px] leading-[19.5px] text-fg-muted">
        {fr.settings.about.body}
      </p>
      <button
        type="button"
        className="text-small text-fg underline-offset-2 hover:underline"
        onClick={() => void rpc('system.openLogs').catch(() => undefined)}
      >
        {fr.settings.about.logs}
      </button>
    </div>
  )
}
