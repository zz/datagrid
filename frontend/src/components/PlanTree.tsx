import { useState } from 'react'
import { drivers } from '../../wailsjs/go/models'

function PlanNodeRow({ node, depth }: { node: drivers.PlanNode; depth: number }) {
    const [open, setOpen] = useState(true)
    const hasChildren = (node.children?.length ?? 0) > 0
    return (
        <div className="plan-node">
            <div className="plan-row" style={{ paddingLeft: depth * 18 }} onClick={() => hasChildren && setOpen(o => !o)}>
                <span className="plan-arrow">{hasChildren ? (open ? '▾' : '▸') : '·'}</span>
                <span className="plan-label">{node.label}</span>
                {node.detail && <span className="plan-detail">{node.detail}</span>}
            </div>
            {open &&
                node.children?.map((c, i) => <PlanNodeRow key={i} node={c} depth={depth + 1} />)}
        </div>
    )
}

export default function PlanTree({ plan }: { plan: drivers.PlanNode }) {
    return (
        <div className="plan-tree">
            <PlanNodeRow node={plan} depth={0} />
        </div>
    )
}
