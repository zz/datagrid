import { useState } from 'react'
import { SaveConnection, TestConnection } from '../../../wailsjs/go/api/App'
import { drivers } from '../../../wailsjs/go/models'
import { useApp } from '../../store'
import CopyButton from '../../components/CopyButton'

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
    readOnly: false,
    colorTag: '',
    sshEnabled: false,
    sshHost: '',
    sshPort: '',
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
        // Prod connections are read-only unless explicitly unlocked (design §5).
        readOnly: form.readOnly || form.envLabel === 'prod',
        envLabel: form.envLabel,
        colorTag: form.colorTag,
        ssh: form.sshEnabled
            ? {
                  host: form.sshHost,
                  // 0 = inherit from ~/.ssh/config (or default to 22 backend-side).
                  port: parseInt(form.sshPort, 10) || 0,
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
                  readOnly: editing.readOnly,
                  colorTag: editing.colorTag || '',
                  sshEnabled: !!editing.ssh,
                  sshHost: editing.ssh?.host ?? '',
                  sshPort: editing.ssh?.port ? String(editing.ssh.port) : '',
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
                    <label>Color</label>
                    <div className="color-tags">
                        {['', 'blue', 'green', 'orange', 'red', 'purple'].map(c => (
                            <button
                                key={c || 'none'}
                                type="button"
                                className={`color-swatch ${c || 'none'} ${form.colorTag === c ? 'selected' : ''}`}
                                title={c || 'none'}
                                onClick={() => setForm(f => ({ ...f, colorTag: c }))}
                            />
                        ))}
                    </div>
                    <label className="ssh-toggle">
                        <input
                            type="checkbox"
                            checked={form.readOnly || form.envLabel === 'prod'}
                            disabled={form.envLabel === 'prod'}
                            onChange={set('readOnly')}
                        />{' '}
                        Read-only{form.envLabel === 'prod' && ' (forced for prod)'}
                    </label>
                    <label className="ssh-toggle">
                        <input type="checkbox" checked={form.sshEnabled} onChange={set('sshEnabled')} /> SSH tunnel
                    </label>
                    {form.sshEnabled && (
                        <>
                            <label>SSH host</label>
                            <input
                                value={form.sshHost}
                                onChange={set('sshHost')}
                                placeholder="hostname or ~/.ssh/config alias"
                            />
                            <label>SSH port</label>
                            <input value={form.sshPort} onChange={set('sshPort')} placeholder="(from config, or 22)" />
                            <label>SSH user</label>
                            <input value={form.sshUser} onChange={set('sshUser')} placeholder="(from config, or current user)" />
                            <label>SSH key file</label>
                            <input
                                value={form.sshKeyPath}
                                onChange={set('sshKeyPath')}
                                placeholder="(from config / ssh-agent)"
                            />
                            <span />
                            <div className="ssh-config-hint">
                                Enter a <code>~/.ssh/config</code> host alias to inherit HostName, User, Port,
                                IdentityFile, and ProxyJump. Blank fields fall back to your ssh config.
                            </div>
                        </>
                    )}
                </div>
                {status.kind !== 'idle' && (
                    <div className={`dialog-status ${status.kind}`}>
                        <span className="dialog-status-msg">{status.msg}</span>
                        {status.kind === 'err' && <CopyButton text={status.msg} />}
                    </div>
                )}
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
