import { ArrowRight, ShieldCheck } from 'iconoir-react'
import { modules, type View } from './modules'
import { t } from './i18n'

export function AppLauncher({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <div className="launcher">
      <div className="eyebrow">{t('ODEE / WORKSPACE')}</div>
      <h1>{t('Good work starts here.')}</h1>
      <p className="lead">{t('One workspace for your business. Open by design.')}</p>
      <div className="launcher-grid">
        {modules.map((module) => {
          const Icon = module.icon
          return module.status === 'active' ? (
            <button
              className="tile enabled"
              key={module.id}
              onClick={() => onNavigate(module.entryView)}
            >
              <div className={`app-icon${module.iconClassName ? ` ${module.iconClassName}` : ''}`}>
                <Icon />
              </div>
              <h2>{t(module.name)}</h2>
              <p>{t(module.description)}</p>
              <span className="tile-link">
                {t(module.openLabel)} <ArrowRight />
              </span>
            </button>
          ) : (
            <div className="tile planned" key={module.id}>
              <div className="planned-icon">
                <Icon />
              </div>
              <h2>{t(module.name)}</h2>
              <p>{t(module.description)}</p>
              <span className="badge">{t('Planned')}</span>
            </div>
          )
        })}
      </div>
      <div className="launcher-note">
        <ShieldCheck />
        <div>
          <strong>{t('Built on open foundations.')}</strong>
          <p>{t('MongoDB-backed accounting. No hidden spreadsheets, no vendor lock-in.')}</p>
        </div>
        <span>v0.1</span>
      </div>
    </div>
  )
}
