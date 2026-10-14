/** Textes du domaine `updates` (mises à jour automatiques depuis GitHub Releases, en tutoiement). */
const NB = ' '

export const updates = {
  updatesUi: {
    title: 'Mises à jour',
    current: (v: string) => `Tu utilises RecoltOS ${v}.`,
    check: 'Rechercher les mises à jour',
    auto: 'Rechercher les mises à jour automatiquement',
    autoDesc: `Au lancement puis toutes les 6${NB}heures. La mise à jour se télécharge en arrière-plan et s’installe au prochain redémarrage.`,
    restart: 'Redémarrer',
    state: {
      unsupported: 'Les mises à jour automatiques ne sont pas disponibles pour cette version.',
      idle: 'Pas encore vérifié.',
      checking: 'Recherche en cours…',
      upToDate: 'RecoltOS est à jour.',
      downloading: (v: string, p: number) =>
        `Téléchargement de RecoltOS${v ? ` ${v}` : ''}… ${p}${NB}%`,
      ready: (v: string) => `RecoltOS ${v} est prête. Elle s’installera au redémarrage.`,
      error: 'Impossible de rechercher les mises à jour. Réessaie plus tard.',
    },
    toast: {
      ready: (v: string) => `RecoltOS ${v} est prête`,
      restart: 'Redémarrer',
    },
  },
}
