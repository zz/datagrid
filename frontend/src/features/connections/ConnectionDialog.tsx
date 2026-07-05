import { useState } from 'react'
import { SaveConnection, TestConnection } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'

const DEFAULT_PORTS: Record<string, string> = { postgres: '5432', mysql: '3306', redis: '6379' }

const emptyForm = {
    name: '',
    engine: 'postgres',
    host: 'localhost',
    port: '5432',
    database: '',
    user: '',
    password: '',
    tlsMode: 'prefer',
    envLabel: 'dev',
    sshEnabled: false,
    sshHost: '',
    sshPort: '22',
    sshUser: '',
    sshKeyPath: '',
}

type Form = typeof emptyForm

function toConfig(form: Form, id: string): drivers.ConnectionConfig {
    return drivers.ConnectionConfig.createFrom({
        id,
        name: form.name || `${form.database}@${form.host}`,
        engine: form.engine,
        host: form.host,
        port: parseInt(form.port, 10) || parseInt(DEFAULT_PORTS[form.engine], 10),
        database: form.database,
        user: form.user,
        tlsMode: form.tlsMode,
        readOnly: false,
        envLabel: form.envLabel,
        colorTag: '',
        ssh: form.sshEnabled
            ? {
                  host: form.sshHost,
                  port: parseInt(form.sshPort, 10) || 22,
                  user: form.sshUser,
                  keyPath: form.sshKeyPath,
              }
            : undefined,
    })
}

export default function ConnectionDialog() {
    const { dialog, closeDialog, loadConnections } = useApp()
    const editing = dialog.editing
    const [form, setForm] = useState<Form>(() =>
        editing
            ? {
                  ...emptyForm,
                  name: editing.name,
                  engine: editing.engine || 'postgres',
                  host: editing.host,
                  port: String(editing.port || 5432),
                  database: editing.database,
                  user: editing.user,
                  tlsMode: editing.tlsMode || 'prefer',
                  envLabel: editing.envLabel || 'dev',
                  sshEnabled: !!editing.ssh,
                  sshHost: editing.ssh?.host ?? '',
                  sshPort: String(editing.ssh?.port || 22),
                  sshUser: editing.ssh?.user ?? '',
                  sshKeyPath: editing.ssh?.keyPath ?? '',
              }
            : emptyForm,
    )
    const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; msg: string }>({
        kind: 'idle',
        msg: '',
    })

    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(f => ({
            ...f,
            [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value,
        }))

    const setEngine = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const engine = e.target.value
        setForm(f => ({
            ...f,
            engine,
            // Follow the engine's default port unless the user changed it.
            port: f.port === DEFAULT_PORTS[f.engine] ? DEFAULT_PORTS[engine] : f.port,
        }))
    }

    const test = async () => {
        setStatus({ kind: 'busy', msg: 'Testing…' })
        try {
            await TestConnection(toConfig(form, editing?.id ?? ''), form.password)
            setStatus({ kind: 'ok', msg: 'Connection OK' })
        } catch (err) {
            setStatus({ kind: 'err', msg: String(err) })
        }
    }

    const save = async () => {
        setStatus({ kind: 'busy', msg: 'Saving…' })
        try {
            await SaveConnection(toConfig(form, editing?.id ?? ''), form.password)
            await loadConnections()
            closeDialog()
        } catch (err) {
            setStatus({ kind: 'err', msg: String(err) })
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && closeDialog()}>
            <div className="modal">
                <h2>{editing ? 'Edit Connection' : 'New Connection'}</h2>
                <div className="form-grid">
                    <label>Engine</label>
                    <select value={form.engine} onChange={setEngine}>
                        <option value="postgres">PostgreSQL</option>
                        <option value="mysql">MySQL / MariaDB</option>
                        <option value="redis">Redis / Valkey</option>
                    </select>
                    <label>Name</label>
                    <input value={form.name} onChange={set('name')} placeholder="My database" />
                    <label>Host</label>
                    <input value={form.host} onChange={set('host')} />
                    <label>Port</label>
                    <input value={form.port} onChange={set('port')} />
                    <label>Database</label>
                    <input value={form.database} onChange={set('database')} />
                    <label>User</label>
                    <input value={form.user} onChange={set('user')} />
                    <label>Password</label>
                    <input
                        type="password"
                        value={form.password}
                        onChange={set('password')}
                        placeholder={editing ? '(unchanged)' : ''}
                    />
                    <label>TLS</label>
                    <select value={form.tlsMode} onChange={set('tlsMode')}>
                        <option value="disable">disable</option>
                        <option value="prefer">prefer</option>
                        <option value="require">require</option>
                        <option value="verify-full">verify-full</option>
                    </select>
                    <label>Environment</label>
                    <select value={form.envLabel} onChange={set('envLabel')}>
                        <option value="dev">dev</option>
                        <option value="staging">staging</option>
                        <option value="prod">prod</option>
                    </select>
                    <label className="ssh-toggle">
                        <input type="checkbox" checked={form.sshEnabled} onChange={set('sshEnabled')} /> SSH tunnel
                    </label>
                    <span />
                    {form.sshEnabled && (
                        <>
                            <label>SSH host</label>
                            <input value={form.sshHost} onChange={set('sshHost')} />
                            <label>SSH port</label>
                            <input value={form.sshPort} onChange={set('sshPort')} />
                            <label>SSH user</label>
                            <input value={form.sshUser} onChange={set('sshUser')} />
                            <label>SSH key file</label>
                            <input
                                value={form.sshKeyPath}
                                onChange={set('sshKeyPath')}
                                placeholder="(empty = use ssh-agent)"
                            />
                        </>
                    )}
                </div>
                {status.kind !== 'idle' && <div className={`dialog-status ${status.kind}`}>{status.msg}</div>}
                <div className="modal-buttons">
                    <button onClick={test} disabled={status.kind === 'busy'}>
                        Test
                    </button>
                    <div className="spacer" />
                    <button onClick={closeDialog}>Cancel</button>
                    <button className="primary" onClick={save} disabled={status.kind === 'busy'}>
                        Save
                    </button>
                </div>
            </div>
        </div>
    )
}
