import { KeyRound, Link2, ListTree } from 'lucide-react'
import { drivers } from '../../../wailsjs/go/models'

export type TableDetailSection = 'structure' | 'keys' | 'indexes'

export default function TableDetails({ info, section }: { info: drivers.TableInfo; section: TableDetailSection }) {
    if (section === 'structure') {
        return (
            <div className="object-details">
                <div className="object-details-heading">
                    <ListTree size={16} /> Columns
                    <span>{info.columns.length}</span>
                </div>
                <div className="object-detail-table">
                    <div className="object-detail-row header"><span>Name</span><span>Type</span><span>Nullable</span><span>Default</span></div>
                    {info.columns.map(column => (
                        <div className="object-detail-row" key={column.name}>
                            <code>{column.name}</code><code>{column.typeName}</code>
                            <span>{column.nullable ? 'Yes' : 'No'}</span><code>{column.default || '—'}</code>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (section === 'keys') {
        return (
            <div className="object-details">
                <div className="object-details-heading"><KeyRound size={16} /> Constraints</div>
                {(info.constraints ?? []).length === 0 ? <div className="object-detail-empty">No constraints.</div> :
                    (info.constraints ?? []).map(constraint => (
                        <div className="object-key" key={constraint.name}>
                            <div><strong>{constraint.name}</strong><span className="object-kind">{constraint.kind.replaceAll('_', ' ')}</span></div>
                            <code>{constraint.definition || (constraint.columns ?? []).join(', ')}</code>
                        </div>
                    ))}
                <div className="object-details-heading"><Link2 size={16} /> Foreign Keys</div>
                {(info.foreignKeys ?? []).length === 0 ? <div className="object-detail-empty">No outbound foreign keys.</div> :
                    (info.foreignKeys ?? []).map(key => (
                        <div className="object-key" key={key.name}>
                            <div><strong>{key.name}</strong><span className="object-kind">{key.onUpdate} / {key.onDelete}</span></div>
                            <code>{(key.columns ?? []).join(', ')} → {key.referencedSchema}.{key.referencedTable} ({(key.referencedColumns ?? []).join(', ')})</code>
                        </div>
                    ))}
            </div>
        )
    }

    return (
        <div className="object-details">
            <div className="object-details-heading">Indexes <span>{(info.indexes ?? []).length}</span></div>
            {(info.indexes ?? []).length === 0 ? <div className="object-detail-empty">No indexes.</div> :
                (info.indexes ?? []).map(index => (
                    <div className="object-key" key={index.name}>
                        <div><strong>{index.name}</strong>{index.unique && <span className="object-kind">unique</span>}</div>
                        <code>({(index.columns ?? []).join(', ')})</code>
                    </div>
                ))}
        </div>
    )
}
