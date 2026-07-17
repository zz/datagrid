import { useState } from 'react'
import { ApplyPrincipalChange, PreviewPrincipalChange } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import ConfirmDialog from '../../components/ConfirmDialog'

export default function PrincipalEditorDialog({ connId, engine, mode, principal, principals, onClose, onApplied, onError }: {
    connId: string
    engine: string
    mode: 'create' | 'membership' | 'password' | 'drop'
    principal?: drivers.DatabasePrincipal
    principals: drivers.DatabasePrincipal[]
    onClose: () => void
    onApplied: () => Promise<void>
    onError: (message: string) => void
}) {
    const [name, setName] = useState(principal?.name ?? '')
    const [host, setHost] = useState(principal?.host || '%')
    const [login, setLogin] = useState(true)
    const [password, setPassword] = useState('')
    const [membershipAction, setMembershipAction] = useState('grant_role')
    const roleOptions = principals.filter(item => `${item.name}@${item.host}` !== `${principal?.name}@${principal?.host}`)
    const [roleKey, setRoleKey] = useState(() => roleOptions.length ? `${roleOptions[0].name}@${roleOptions[0].host}` : '')
    const [preview, setPreview] = useState('')
    const [confirm, setConfirm] = useState(false)
    const [busy, setBusy] = useState(false)
    const role = roleOptions.find(item => `${item.name}@${item.host}` === roleKey)
    const change = () => drivers.PrincipalChange.createFrom({
        action: mode === 'membership' ? membershipAction : mode,
        name, host: engine === 'mysql' ? host : '', login, password,
        role: role?.name ?? '', roleHost: role?.host ?? '',
    })
    const generate = async () => {
        try { setPreview(await PreviewPrincipalChange(connId, change())) }
        catch (error) { onError(String(error)) }
    }
    const apply = async () => {
        setBusy(true)
        try {
            await ApplyPrincipalChange(connId, change())
            await onApplied()
            onClose()
        } catch (error) { onError(String(error)) }
        finally { setBusy(false); setConfirm(false) }
    }
    return <div className="modal-backdrop principal-editor-backdrop" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
        <div className="modal principal-editor-dialog">
            <h2>{mode === 'create' ? `Create ${engine === 'mysql' ? 'Account' : 'Role'}` : mode === 'membership' ? 'Role Membership' : mode === 'password' ? 'Rotate Password' : 'Remove Principal'}</h2>
            {mode === 'create' ? <div className="principal-editor-fields">
                <label>Name<input value={name} onChange={event => { setName(event.target.value); setPreview('') }} autoFocus /></label>
                {engine === 'mysql' && <label>Host<input value={host} onChange={event => { setHost(event.target.value); setPreview('') }} placeholder="%" /></label>}
                {engine === 'postgres' && <label className="principal-login"><input type="checkbox" checked={login} onChange={event => { setLogin(event.target.checked); setPreview('') }} /> Can login</label>}
                {(engine === 'mysql' || login) && <label>Password<input type="password" value={password} onChange={event => { setPassword(event.target.value); setPreview('') }} autoComplete="new-password" /></label>}
            </div> : mode === 'membership' ? <div className="principal-editor-fields">
                <label>Member<input value={name} readOnly /></label>
                <label>Action<select value={membershipAction} onChange={event => { setMembershipAction(event.target.value); setPreview('') }}><option value="grant_role">Grant role</option><option value="revoke_role">Revoke role</option></select></label>
                <label>Role<select value={roleKey} onChange={event => { setRoleKey(event.target.value); setPreview('') }}>{roleOptions.map(item => { const key = `${item.name}@${item.host}`; return <option value={key} key={key}>{item.name}{item.host ? ` @ ${item.host}` : ''}</option> })}</select></label>
            </div> : mode === 'password' ? <div className="principal-editor-fields">
                <label>Principal<input value={name} readOnly /></label>
                <label>New password<input type="password" value={password} onChange={event => { setPassword(event.target.value); setPreview('') }} autoFocus autoComplete="new-password" /></label>
            </div> : <p className="principal-drop-warning">Remove <strong>{name}</strong>? Existing ownership, grants, or role memberships may prevent removal. No cascading cleanup will be attempted.</p>}
            {preview && <pre className="principal-preview">{preview}</pre>}
            <div className="modal-buttons"><div className="spacer" /><button onClick={onClose} disabled={busy}>Cancel</button><button onClick={() => void generate()} disabled={!name || (mode === 'membership' && !role) || (mode === 'password' && !password)}>Preview SQL</button><button className={mode === 'drop' ? 'danger' : 'primary'} disabled={!preview || busy} onClick={() => setConfirm(true)}>Apply</button></div>
        </div>
        {confirm && <ConfirmDialog title={mode === 'create' ? 'Create principal?' : mode === 'membership' ? 'Change role membership?' : mode === 'password' ? 'Rotate password?' : 'Remove principal?'} message={mode === 'drop' ? 'This removes the principal without cascading ownership or privilege cleanup. This cannot be undone.' : 'Apply the previewed security statement? Database permissions and policies still apply.'} confirmLabel={mode === 'drop' ? 'Remove' : 'Apply'} danger={mode === 'drop' || membershipAction === 'revoke_role'} onCancel={() => setConfirm(false)} onConfirm={apply} />}
    </div>
}
