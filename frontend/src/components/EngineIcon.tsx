import { siPostgresql, siMysql, siRedis } from 'simple-icons'

// Brand SVG logos per engine (from simple-icons), rendered in the engine's
// brand color. MariaDB shares the MySQL driver, so it uses the MySQL logo.
const ICONS: Record<string, { path: string; hex: string }> = {
    postgres: siPostgresql,
    mysql: siMysql,
    redis: siRedis,
}

export default function EngineIcon({ engine, size = 15 }: { engine: string; size?: number }) {
    const icon = ICONS[engine]
    if (!icon) return <span className="engine-icon-fallback">DB</span>
    return (
        <svg
            className="engine-icon"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={`#${icon.hex}`}
            role="img"
            aria-label={engine}
        >
            <path d={icon.path} />
        </svg>
    )
}
