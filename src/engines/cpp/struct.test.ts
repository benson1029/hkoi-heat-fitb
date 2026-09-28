import { expect, it } from 'vitest';
import { runCpp } from './index';
import type { ProgramTarget } from '../../core/types';

const reverse = `typedef struct Node *pNode;
struct Node { int data; pNode next; };
pNode reverse(pNode src) {
  pNode dst,temp;
  dst=NULL;
  while (src!=NULL) {
    temp=src->next;
    src->next=dst;
    dst=src;
    src=temp;
  }
  return dst;
}`;

const main = `int main() {
  int n,x0,x1,x2,x3;
  scanf("%d%d%d%d%d",&n,&x0,&x1,&x2,&x3);
  struct Node a,b,c,d;
  a.data=x0; b.data=x1; c.data=x2; d.data=x3;
  pNode head=NULL;
  if(n>=1){head=&a;a.next=NULL;}
  if(n>=2){a.next=&b;b.next=NULL;}
  if(n>=3){b.next=&c;c.next=NULL;}
  if(n>=4){c.next=&d;d.next=NULL;}
  pNode out=reverse(head);
  for(int i=0;i<n;i++){
    if(out==NULL){printf("SHORT");return 0;}
    printf("%d,",out->data);
    out=out->next;
  }
  if(out==NULL)printf("END");else printf("EXTRA");
  return 0;
}`;

function run(source: string, stdin = '3 7 4 9 2') {
  const target: ProgramTarget = { language: 'c', source, harness: { kind: 'program' } };
  return runCpp(source, target, { id: 'struct', stdin, expected: {}, maxSteps: 10000 });
}

it('executes the printed 2004 Senior reversal on real linked nodes', () => {
  for (const [stdin, stdout] of [
    ['0 7 4 9 2', 'END'],
    ['1 7 4 9 2', '7,END'],
    ['2 7 4 9 2', '4,7,END'],
    ['3 7 4 9 2', '9,4,7,END'],
    ['4 7 4 9 2', '2,9,4,7,END'],
    ['4 5 5 5 5', '5,5,5,5,END']
  ]) expect(run(`${reverse}\n${main}`, stdin)).toMatchObject({ kind: 'ok', observation: { stdout } });
});

it('rejects wrong rewiring and invalid pointer access', () => {
  expect(run(`${reverse.replace('src->next=dst;', 'src->next=NULL;')}\n${main}`)).not.toMatchObject({ observation: { stdout: '9,4,7,END' } });
  expect(run(`${reverse.replace('dst=src;', 'dst=dst;')}\n${main}`)).not.toMatchObject({ observation: { stdout: '9,4,7,END' } });
  expect(run(`${reverse}\nint main(){pNode p=NULL;return p->data;}`)).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('Null') });
  expect(run(`${reverse}\nint main(){pNode p;return p->data;}`)).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('uninitialized') });
  expect(run(`${reverse}\nint main(){struct Node a;return a.missing;}`)).toMatchObject({ kind: 'compile-error', message: expect.stringContaining('Unknown field') });
  expect(run(`${reverse}\nint main(){struct Node a;return a.data;}`)).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('uninitialized') });
  expect(run(`${reverse}\npNode bad(){struct Node a;return &a;}int main(){pNode p=bad();return p->data;}`))
    .toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('expired') });
});

it('accepts a direct struct-pointer declaration and field access', () => {
  const source = 'struct Node {int data;struct Node *next;};int f(){struct Node a;struct Node *p=&a;p->data=42;p->next=NULL;return p->data;}';
  const target: ProgramTarget = { language: 'c', source, harness: { kind: 'call', function: 'f' } };
  expect(runCpp(source, target, { id: 'field', expected: {}, maxSteps: 1000 }))
    .toMatchObject({ kind: 'ok', observation: { returnValue: 42 } });
});
