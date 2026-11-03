import { ArrowRight, ShieldCheck } from 'iconoir-react'
import { modules, type View } from './modules'

export function AppLauncher({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <div className="launcher">
      <div className="eyebrow">ODEE / WORKSPACE</div>
      <h1>Good work starts here.</h1>
      <p className="lead">One workspace for your business. Open by design.</p>
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
              <h2>{module.name}</h2>
              <p>{module.description}</p>
              <span className="tile-link">
                {module.openLabel} <ArrowRight />
              </span>
            </button>
          ) : (
            <div className="tile planned" key={module.id}>
              <div className="planned-icon">
                <Icon />
              </div>
              <h2>{module.name}</h2>
              <p>{module.description}</p>
              <span className="badge">Planned</span>
            </div>
          )
        })}
      </div>
      <div className="launcher-note">
        <ShieldCheck />
        <div>
          <strong>Built on open foundations.</strong>
          <p>MongoDB-backed accounting. No hidden spreadsheets, no vendor lock-in.</p>
        </div>
        <span>v0.1</span>
      </div>
    </div>
  )
}
