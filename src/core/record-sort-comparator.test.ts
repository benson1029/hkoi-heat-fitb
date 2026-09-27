import { expect, it } from 'vitest';
import { checkRecordSortComparator } from './record-sort-comparator';
import type { RecordSortComparatorGrading } from './types';

const spec: RecordSortComparatorGrading = {
  kind: 'record-sort-comparator', answerBlank: 'J', arrayName: 'A', indexName: 'j',
  fields: ['height', 'weight'], order: 'descending'
};

it('checks equivalent C comparisons over both sort keys', () => {
  expect(checkRecordSortComparator(spec,
    'A[j].height<A[j+1].height || A[j].height==A[j+1].height && A[j].weight<A[j+1].weight')).toBeNull();
  expect(checkRecordSortComparator(spec,
    'A[j+1].height>A[j].height || (A[j+1].height==A[j].height && A[j+1].weight>A[j].weight)')).toBeNull();
  expect(checkRecordSortComparator(spec, 'A[j].height<A[j+1].height')).not.toBeNull();
  expect(checkRecordSortComparator(spec, 'A[j].height>A[j+1].height')).not.toBeNull();
  expect(checkRecordSortComparator(spec, 'A[j].height<A[j+1].width')).not.toBeNull();
});
