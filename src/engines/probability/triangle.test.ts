import { expect, it } from 'vitest';
import { checkTriangleAffine } from './triangle';

it('proves both affine reflections are uniform on the target triangle', () => {
  expect(checkTriangleAffine('1-x,1-y').status).toBe('pass');
  expect(checkTriangleAffine('1-y,1-x').status).toBe('pass');
});

it('rejects a biased or out-of-range affine map', () => {
  expect(checkTriangleAffine('x,y').status).toBe('fail');
  expect(checkTriangleAffine('0,0').status).toBe('fail');
});

it('does not falsely reject a nonlinear expression outside the proof subset', () => {
  expect(checkTriangleAffine('x*x,y').status).toBe('inconclusive');
});
