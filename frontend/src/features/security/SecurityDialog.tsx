import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Plus, RefreshCw, Search, ShieldCheck, ShieldPlus, Trash2, User, Users } from 'lucide-react'
import { ApplyPrivilegeChange, ListDatabasePrincipals, PreviewPrivilegeChange } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'
import PrincipalEditorDialog from './PrincipalEditorDialog'

export default function SecurityDialog({ connId, connectionName, currentUser, engine, readOnly, onClose, onError }: {
    connId: string
    connectionName: string
    currentUser: string
    engine: string
    readOnly: boolean
    onClose: () => void
    onError: (message: string) => void
}) {
    const [principals, setPrincipals] = useState<drivers.DatabasePrincipal[]>([])
    const [selectedName, setSelectedName] = useState('')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(false)
    const [editing, setEditing] = useState(false)
    const [action, setAction] = useState('grant')
    const [scope, setScope] = useState(engine === 'mysql' ? 'global' : 'schema')
    const [privilege, setPrivilege] = useState(engine === 'mysql' ? 'SELECT' : 'USAGE')
    const [schema, setSchema] = useState('')
    const [object, setObject] = useState('')
    const [preview, setPreview] = useState('')
    const [confirm, setConfirm] = useState(false)
    const [applying, setApplying] = useState(false)
    const [principalEditor, setPrincipalEditor] = useState<'create' | 'membership' | 'password' | 'drop' | null>(null)
    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            const result = await ListDatabasePrincipals(connId) ?? []
            setPrincipals(result)
            setSelectedName(current => result.some(item => `${item.name}@${item.host}` === current) ? current : result.length ? `${result[0].name}@${result[0].host}` : '')
        } catch (error) {
            onError(String(error))
        } finally {
            setLoading(false)
        }
    }, [connId, onError])
    useEffect(() => { void refresh() }, [refresh])
    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return principals.filter(item => !needle || [item.name, item.host, ...item.attributes, ...item.grants].some(value => value.toLowerCase().includes(needle)))
    }, [principals, search])
    const selected = principals.find(item => `${item.name}@${item.host}` === selectedName)
    const privileges = engine === 'mysql'
        ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES', 'EXECUTE']
        : scope === 'schema' ? ['USAGE', 'CREATE'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    const change = () => drivers.PrivilegeChange.createFrom({ action, principal: selected?.name ?? '', host: selected?.host ?? '', privilege, scope, schema, object })
    const generatePreview = async () => {
        try { setPreview(await PreviewPrivilegeChange(connId, change())) }
        catch (error) { onError(String(error)) }
    }
    const apply = async () => {
        setApplying(true)
        try {
            await ApplyPrivilegeChange(connId, change())
            setEditing(false)
            setPreview('')
            await refresh()
        } catch (error) { onError(String(error)) }
        finally { setApplying(false); setConfirm(false) }
    }

    return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
        <div className="modal security-dialog">
            <div className="security-title"><div><h2>Roles and Privileges</h2><span>{connectionName}</span></div><button className="icon-btn" onClick={onClose} title="Close">x</button></div>
            <div className="security-toolbar">
                <label><Search size={13} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Filter principals or grants" /></label>
                <div className="tb-spacer" /><span>{shown.length} principals</span><button onClick={() => setPrincipalEditor('create')} disabled={readOnly}><Plus size={13} /> New</button><button onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} /> Refresh</button>
            </div>
            <div className="security-body">
                <div className="principal-list">
                    {shown.map(item => { const key = `${item.name}@${item.host}`; return <button key={key} className={key === selectedName ? 'active' : ''} onClick={() => setSelectedName(key)}>
                        {item.admin ? <ShieldCheck size={14} /> : <User size={14} />}<span><strong>{item.name}</strong><small>{item.host || (item.login ? 'login role' : 'group role')}</small></span>
                    </button> })}
                    {!loading && shown.length === 0 && <div className="security-empty">No visible principals.</div>}
                </div>
                <div className="principal-detail">
                    {selected ? <>
                        <div className="principal-heading"><div><h3>{selected.name}</h3><span>{selected.host && `Host ${selected.host}`}</span></div>{selected.admin && <span className="principal-admin"><ShieldCheck size={13} /> Administrator</span>}<button className="icon-btn" onClick={() => setPrincipalEditor('password')} disabled={readOnly || !selected.login} title="Rotate password"><KeyRound size={13} /></button><button className="icon-btn" onClick={() => setPrincipalEditor('drop')} disabled={readOnly || selected.name === currentUser} title="Remove principal"><Trash2 size={13} /></button><button onClick={() => setPrincipalEditor('membership')} disabled={readOnly}><Users size={13} /> Membership</button><button onClick={() => { setEditing(value => !value); setPreview('') }} disabled={readOnly}><ShieldPlus size={13} /> Privilege</button></div>
                        <section><h4>Attributes</h4><div className="principal-chips"><span>{selected.login ? 'Can login' : 'Cannot login'}</span>{selected.attributes.map(attribute => <span key={attribute}>{attribute}</span>)}</div></section>
                        <section className="principal-grants"><h4>Effective visible grants <span>{selected.grants.length}</span></h4>{selected.grants.length ? selected.grants.map((grant, index) => <code key={`${grant}-${index}`}>{grant}</code>) : <p>No object grants visible to this connection.</p>}</section>
                        {editing && <section className="privilege-editor"><h4>Grant or revoke privilege</h4>
                            <div className="privilege-fields">
                                <label>Action<select value={action} onChange={event => { setAction(event.target.value); setPreview('') }}><option value="grant">Grant</option><option value="revoke">Revoke</option></select></label>
                                <label>Scope<select value={scope} onChange={event => { const value = event.target.value; setScope(value); setPrivilege(engine === 'postgres' && value === 'schema' ? 'USAGE' : 'SELECT'); setPreview('') }}>{engine === 'mysql' && <option value="global">Global</option>}<option value="schema">Schema</option><option value="table">Table</option></select></label>
                                <label>Privilege<select value={privilege} onChange={event => { setPrivilege(event.target.value); setPreview('') }}>{privileges.map(value => <option key={value}>{value}</option>)}</select></label>
                                {scope !== 'global' && <label>Schema<input value={schema} onChange={event => { setSchema(event.target.value); setPreview('') }} /></label>}
                                {scope === 'table' && <label>Table<input value={object} onChange={event => { setObject(event.target.value); setPreview('') }} /></label>}
                            </div>
                            {preview && <pre>{preview}</pre>}
                            <div className="privilege-actions"><span>{readOnly ? 'Connection is read-only.' : 'Server permissions still apply.'}</span><div className="tb-spacer" /><button onClick={() => void generatePreview()} disabled={!selected || (scope !== 'global' && !schema) || (scope === 'table' && !object)}>Preview SQL</button><button className="primary" onClick={() => setConfirm(true)} disabled={!preview || applying}>Apply</button></div>
                        </section>}
                    </> : <div className="security-empty">Select a principal.</div>}
                </div>
            </div>
            <div className="modal-buttons"><span>Privilege visibility depends on the connected account.</span><div className="spacer" /><button onClick={onClose}>Close</button></div>
        </div>
        {confirm && <ConfirmDialog title={`${action === 'grant' ? 'Grant' : 'Revoke'} privilege?`} message={`Apply this privilege change for ${selected?.name}? Review the generated SQL before continuing.`} confirmLabel={action === 'grant' ? 'Grant' : 'Revoke'} danger={action === 'revoke'} onCancel={() => setConfirm(false)} onConfirm={apply} />}
        {principalEditor && <PrincipalEditorDialog connId={connId} engine={engine} mode={principalEditor} principal={principalEditor === 'create' ? undefined : selected} principals={principals} onClose={() => setPrincipalEditor(null)} onApplied={refresh} onError={onError} />}
    </div>
}
