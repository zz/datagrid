import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import ResultColumnLayoutControl from './ResultColumnLayoutControl'
import { resultColumnIds, type ResultColumnLayout } from './resultColumnLayout'

const columns = [
    { name: 'id', typeName: 'bigint' },
    { name: 'name', typeName: 'text' },
    { name: 'email', typeName: 'text' },
]
const columnIds = resultColumnIds(columns)
const initial = { order: columnIds, hidden: [], frozen: 0 }

afterEach(cleanup)

function Harness() {
    const [layout, setLayout] = useState<ResultColumnLayout>(initial)
    return <>
        <ResultColumnLayoutControl columns={columns} columnIds={columnIds} layout={layout} presetContextKey="layout-test" onChange={setLayout} />
        <output aria-label="layout">{JSON.stringify(layout)}</output>
    </>
}

describe('ResultColumnLayoutControl', () => {
    it('searches and hides matching columns without losing order', () => {
        render(<Harness />)
        fireEvent.click(screen.getByTitle('Result column layout'))
        fireEvent.change(screen.getByPlaceholderText('Search columns'), { target: { value: 'email' } })
        fireEvent.click(screen.getByTitle('Hide matching columns'))

        expect(screen.getByLabelText('layout').textContent).toBe(JSON.stringify({ ...initial, hidden: ['email#0'] }))
    })

    it('pins a column and resets the complete layout', () => {
        render(<Harness />)
        fireEvent.click(screen.getByTitle('Result column layout'))
        const nameRow = screen.getByText('name').closest('.result-layout-row')
        expect(nameRow).not.toBeNull()
        fireEvent.click(within(nameRow as HTMLElement).getByTitle('Pin column'))
        expect(screen.getByLabelText('layout').textContent).toBe(JSON.stringify({ order: ['name#0', 'id#0', 'email#0'], hidden: [], frozen: 1 }))

        fireEvent.click(screen.getByTitle('Reset column layout'))
        expect(screen.getByLabelText('layout').textContent).toBe(JSON.stringify(initial))
    })
})
