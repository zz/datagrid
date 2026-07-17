import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import ResultColumnFormatControl from './ResultColumnFormatControl'
import { resultColumnIds } from './resultColumnLayout'
import type { ResultColumnFormats } from './resultColumnFormatting'

const columns = [
    { name: 'total', typeName: 'numeric' },
    { name: 'note', typeName: 'text' },
]
const columnIds = resultColumnIds(columns)

afterEach(cleanup)

function Harness({ initial = {} }: { initial?: ResultColumnFormats }) {
    const [formats, setFormats] = useState(initial)
    return <>
        <ResultColumnFormatControl columns={columns} columnIds={columnIds} formats={formats} onChange={setFormats} />
        <output aria-label="formats">{JSON.stringify(formats)}</output>
    </>
}

describe('ResultColumnFormatControl', () => {
    it('configures a numeric column and persists general display options', () => {
        render(<Harness />)
        fireEvent.click(screen.getByTitle('Column display formats'))
        fireEvent.change(screen.getByLabelText('Number'), { target: { value: 'fixed' } })
        fireEvent.change(screen.getByLabelText('Decimal places'), { target: { value: '3' } })
        fireEvent.change(screen.getByLabelText('NULL label'), { target: { value: '(null)' } })
        fireEvent.change(screen.getByLabelText('Maximum characters'), { target: { value: '24' } })

        expect(screen.getByLabelText('formats').textContent).toBe(JSON.stringify({
            'total#0': { number: 'fixed', decimals: 3, nullText: '(null)', maxLength: 24 },
        }))
    })

    it('switches columns and resets one column without affecting another', () => {
        render(<Harness initial={{ 'total#0': { number: 'fixed' }, 'note#0': { maxLength: 40 } }} />)
        fireEvent.click(screen.getByTitle('Column display formats'))
        fireEvent.change(screen.getByLabelText('Column'), { target: { value: '1' } })
        fireEvent.click(screen.getByText('Reset column'))

        expect(screen.getByLabelText('formats').textContent).toBe(JSON.stringify({ 'total#0': { number: 'fixed' } }))
    })
})
