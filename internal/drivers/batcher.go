package drivers

// Batch sizing shared by SQL drivers (design §4): flush at ~500 rows or
// 256 KB, whichever comes first.
const (
	BatchMaxRows  = 500
	BatchMaxBytes = 256 * 1024
)

// Batcher accumulates encoded rows and flushes RowBatches to a sink.
type Batcher struct {
	sink    RowSink
	queryID QueryID
	batch   RowBatch
	bytes   int
}

// NewBatcher creates a batcher whose first flushed batch carries columns.
func NewBatcher(queryID QueryID, columns []Column, sink RowSink) *Batcher {
	return &Batcher{
		sink:    sink,
		queryID: queryID,
		batch:   RowBatch{QueryID: queryID, Columns: columns, Seq: 0},
	}
}

// Add appends one encoded row, flushing when the batch is full.
func (b *Batcher) Add(row []any) {
	for _, cell := range row {
		if v, ok := cell.(Value); ok {
			b.bytes += v.ApproxSize()
		}
	}
	b.batch.Rows = append(b.batch.Rows, row)
	if len(b.batch.Rows) >= BatchMaxRows || b.bytes >= BatchMaxBytes {
		b.Flush()
	}
}

// Flush emits the pending batch. The first batch (Seq 0) is always emitted,
// even when empty, so the frontend learns the column set.
func (b *Batcher) Flush() {
	if b.batch.Seq == 0 || len(b.batch.Rows) > 0 {
		b.sink(b.batch)
	}
	b.batch = RowBatch{QueryID: b.queryID, Seq: b.batch.Seq + 1}
	b.bytes = 0
}
