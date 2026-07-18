import { describe, expect, it } from 'vitest'
import { constrainContextMenuPosition, gridContextMenuCoordinates } from './ContextMenu'

describe('context menu positioning', () => {
    it('uses the grid viewport bounds without adding the grid offset twice', () => {
        expect(gridContextMenuCoordinates({ bounds: { x: 120, y: 240 }, localEventX: 14, localEventY: 9 })).toEqual({ x: 134, y: 249 })
    })

    it('keeps the measured menu inside every viewport edge', () => {
        expect(constrainContextMenuPosition(300, 200, 180, 120, 800, 600)).toEqual({ left: 300, top: 200 })
        expect(constrainContextMenuPosition(790, 590, 200, 160, 800, 600)).toEqual({ left: 592, top: 432 })
        expect(constrainContextMenuPosition(-20, -30, 180, 120, 800, 600)).toEqual({ left: 8, top: 8 })
    })
})
