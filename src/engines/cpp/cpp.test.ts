import { describe, expect, it } from 'vitest';
import type { ProgramCase, ProgramTarget } from '../../core/types';
import { runCpp } from './index';
import junior2025 from '../../../papers/2024-25-junior.json';
import { validatePaper } from '../../core/validate';
import { gradeQuestion } from '../../core/grader';

function call(source: string, name = 'f', args: ProgramCase['args'] = [], maxSteps = 30000) {
  const target: ProgramTarget = { language: 'cpp', source, harness: { kind: 'call', function: name } };
  const testCase: ProgramCase = { id: 'test', args, expected: {}, maxSteps };
  return runCpp(source, target, testCase);
}

function program(source: string, stdin = '', maxSteps = 10000) {
  const target: ProgramTarget = { language: 'cpp', source, harness: { kind: 'program' } };
  const testCase: ProgramCase = { id: 'test', stdin, expected: {}, maxSteps };
  return runCpp(source, target, testCase);
}

describe('checked C/C++ subset', () => {
  it('executes the 2024/25 senior S bitmask question', () => {
    const source = 'int g(int x) { int cnt = 0; for (int i = 1; i <= x; ++i) { if ((i&x) == (i)) { ++cnt; } } return cnt; }';
    for (const [x, expected] of [[1, 1], [2, 1], [3, 3], [5, 3], [26, 7], [255, 255], [1023, 1023]])
      expect(call(source, 'g', [x])).toMatchObject({ kind: 'ok', observation: { returnValue: expected } });
  });
  it('executes the 2024/25 senior T bitmask question', () => {
    const source = 'int h(int x) { int cnt=0; for (int i=0; i<10; ++i) { if ((1<<i)&x) {++cnt;} } return (1<<cnt)-1; }';
    expect(call(source, 'h', [26])).toMatchObject({ kind: 'ok', observation: { returnValue: 7 } });
  });
  it('executes recursion with a deterministic budget', () => {
    expect(call('int f(int n) { if (n <= 1) return 1; return n * f(n-1); }', 'f', [5])).toMatchObject({ kind: 'ok', observation: { returnValue: 120 } });
    expect(call('int f(int n) { return f(n); }', 'f', [1], 100)).toMatchObject({ kind: 'step-limit' });
  });
  it('traps out-of-bounds and uninitialized reads', () => {
    expect(call('int f() { int a[2]={1,2}; return a[2]; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    expect(call('int f() { int x; return x; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('uninitialized') });
    expect(call('int f() { int a[2]; return a[0]; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('uninitialized') });
  });
  it('traps signed overflow, division overflow and invalid shifts', () => {
    expect(call('int f() { int x=2147483647; return x+1; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('overflow') });
    expect(call('int f() { int x=-2147483647-1; return x/-1; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('overflow') });
    expect(call('int f() { return 1<<32; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('shift') });
    expect(call('int f() { return 1<<-1; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('shift') });
  });
  it('preserves long long width and rejects narrowing that loses the value', () => {
    expect(call('long long f() { long long x=4294967296; return x; }')).toMatchObject({ kind: 'ok', observation: { returnValue: 4294967296 } });
    expect(call('int f() { int x=4294967296; return x; }')).toMatchObject({ kind: 'runtime-error' });
  });
  it('runs a basic complete program with local input and stdout', () => {
    expect(program('#include <iostream>\nusing namespace std; int main(){ int x; cin >> x; cout << x+1 << "\\n"; }', '41'))
      .toMatchObject({ kind: 'ok', observation: { stdout: '42\n' } });
    expect(program('#include <stdio.h>\nint main(){ printf("%d%%\\n", 42); }'))
      .toMatchObject({ kind: 'ok', observation: { stdout: '42%\n' } });
  });
  it('streams character values as characters', () => {
    expect(program("int main(){ char c='X'; cout << c << ' ' << 7; }"))
      .toMatchObject({ kind: 'ok', observation: { stdout: 'X 7' } });
  });
  it('passes arrays to functions and checks every index', () => {
    const source = 'int sum(int a[], int n){ int s=0; for(int i=0;i<n;++i) s+=a[i]; return s; }';
    expect(call(source, 'sum', [[1, 2, 3], 3])).toMatchObject({ kind: 'ok', observation: { returnValue: 6 } });
    expect(call(source, 'sum', [[1, 2, 3], 4])).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
  });
  it('checks helper functions defined alongside a question source', () => {
    const helperSource = 'int choose(int i){int a[2]={11,22};return a[i];}';
    const source = `${helperSource}\nint f(int i){return choose(i);}`;
    expect(call(source, 'f', [1])).toMatchObject({ kind: 'ok', observation: { returnValue: 22 } });
    expect(call(source, 'f', [2])).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
  });
  it('rejects an unsequenced read and write', () => {
    expect(call('int f(){ int i=0; return i++ + i; }')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('Unsequenced') });
  });
  it('handles the C subset while rejecting C++-only features in C mode', () => {
    const source = '#include <stdio.h>\nint main(){printf("%d\\n", 2+3);}';
    expect(runCpp(source, { language: 'c', source, harness: { kind: 'program' } }, { id: 'c', expected: {}, maxSteps: 1000 }))
      .toMatchObject({ kind: 'ok', observation: { stdout: '5\n' } });
    const invalid = 'int main(){cout<<1;}';
    expect(runCpp(invalid, { language: 'c', source: invalid, harness: { kind: 'program' } }, { id: 'c', expected: {}, maxSteps: 1000 }))
      .toMatchObject({ kind: 'compile-error' });
    const input = '#include <stdio.h>\nint main(){int x,y;scanf("%d %d",&x,&y);printf("%d\\n",x+y);}';
    expect(runCpp(input, { language: 'c', source: input, harness: { kind: 'program' } }, { id: 'c', stdin: '20 22', expected: {}, maxSteps: 1000 }))
      .toMatchObject({ kind: 'ok', observation: { stdout: '42\n' } });
  });
  it('supports C++ spelled-out logical operators with normal precedence and short-circuiting', () => {
    expect(call('int f(int a,int b,int c){return not a or b and c;}', 'f', [0, 1, 0]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
    expect(call('int f(int a,int b,int c){return not a or b and c;}', 'f', [1, 1, 0]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 0 } });
    expect(call('int f(int a){return a or (1/0);}', 'f', [1]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
    expect(call('int f(int a){return a and (1/0);}', 'f', [0]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 0 } });
    expect(call('int f(int candy){return candy not_eq 0;}', 'f', [3]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
    expect(program('int main(){cout << "and or not";}'))
      .toMatchObject({ kind: 'ok', observation: { stdout: 'and or not' } });
    const cSource = 'int and(int x){return x;}';
    expect(runCpp(cSource, { language: 'c', source: cSource, harness: { kind: 'call', function: 'and' } }, { id: 'c', args: [7], expected: {}, maxSteps: 1000 }))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 7 } });
  });
  it('runs all official Paper 1 D C++ string answers', () => {
    for (const answer of ['aaabbabb', 'aabaabbb', 'aaaababb', 'aababbbb']) {
      const source = `int main(){string s="${answer}";int a=0,b=0;for(int i=0;i<8;++i){if(s[i]=='a')a=a+1;else if(s[i]=='b')b=b+a;}cout<<b;}`;
      expect(program(source)).toMatchObject({ kind: 'ok', observation: { stdout: '14' } });
    }
    expect(program('int main(){string s="abc";cout<<s[3];}'))
      .toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('String index out of bounds') });
  });
  it('runs the official C++ O rotation and range-for program', () => {
    const source = "bool t(char x){return x>='a'&&x<='z';}char s(char x){return (x-'a'+3)%26+'a';}int main(){string str1=\"hkoi easy job\";string str2=\"\";for(char x:str1){if(t(x)){str2+=s(x);}else{str2+=x;}}cout<<str2;}";
    expect(program(source)).toMatchObject({ kind: 'ok', observation: { stdout: 'knrl hdvb mre' } });
  });
  it('returns exact strings for the official C++ Q duration expressions', () => {
    const source = "string f(int t){string s=\"\";s+='0'+t/60;s+=':';s+='0'+t%60/10;s+='0'+t%10;return s;}";
    for (const [minutes, expected] of [[0, '0:00'], [5, '0:05'], [59, '0:59'], [60, '1:00'], [123, '2:03'], [599, '9:59']] as const)
      expect(call(source, 'f', [minutes])).toMatchObject({ kind: 'ok', observation: { returnValue: expected } });
  });
  it('supports qualified std::string and length with exact bounds', () => {
    expect(call('int f(){std::string s="abc";return s.length();}')).toMatchObject({ kind: 'ok', observation: { returnValue: 3 } });
    expect(call('int f(){std::string s="abc";s[1]=\'z\';return s[1];}')).toMatchObject({ kind: 'ok', observation: { returnValue: 122 } });
  });
  it('supports bool(expr) casts in the printed Paper 1 F function', () => {
    const source = 'bool f(int a,int b,int c){return bool((a+b+c)%3==0);}';
    expect(call(source, 'f', [1, 1, 1])).toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
    expect(call(source, 'f', [1, 2, 3])).toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
    expect(call(source, 'f', [1, 1, 2])).toMatchObject({ kind: 'ok', observation: { returnValue: 0 } });
  });
  it('supports functional integer casts in legacy printed code', () => {
    expect(call("int f(){char c='7';return int(c)-int('0');}")).toMatchObject({ kind: 'ok', observation: { returnValue: 7 } });
  });
  it('initializes and prints a C char array from a string literal', () => {
    expect(program('char s[8]="pace";int main(){printf("%s",s);return 0;}', '', 1000))
      .toMatchObject({ kind: 'ok', observation: { stdout: 'pace' } });
    expect(program('char s[3]="pace";int main(){printf("%s",s);}', '', 1000)).toMatchObject({ kind: 'compile-error' });
  });
  it('calls a declared max helper before the built-in max', () => {
    expect(call('int max(int i,int j){return i+j+10;}int f(){return max(1,2);}', 'f'))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 13 } });
  });
  it('prints a square root with the printed C float format', () => {
    expect(program('int main(){int x=2;printf("%.3f",sqrt(x));}', '', 1000))
      .toMatchObject({ kind: 'ok', observation: { stdout: '1.414' } });
  });
  it('constructs vector<int>, copies vector parameters, and checks indices', () => {
    const source = 'int f(vector<int> a){int n=a.size();a[0]=9;return a[0]+a[n-1];}';
    expect(call(source, 'f', [[1, 2, 3]])).toMatchObject({ kind: 'ok', observation: { returnValue: 12 } });
    expect(call('int f(){vector<int>a(3,4);return a[2];}')).toMatchObject({ kind: 'ok', observation: { returnValue: 4 } });
    expect(call('int f(){std::vector<int>a={1,2};return a[2];}')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    expect(call('int f(){vector<int>a(16385);return 0;}')).toMatchObject({ kind: 'unsupported' });
    expect(call('int f(){int a[10001];a[10000]=7;return a[10000];}')).toMatchObject({ kind: 'ok', observation: { returnValue: 7 } });
    expect(call('int f(vector<int>a){return a[0];}int g(){int a[1]={1};return f(a);}', 'g')).toMatchObject({ kind: 'compile-error' });
  });
  it('models size_t underflow and checked abs for the printed vector repair', () => {
    expect(call('int f(){vector<int>a(0);for(int i=0;i<a.size()-1;++i)return abs(a[i]-a[i+1]);return 0;}'))
      .toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    expect(call('int f(){vector<int>a(0);int n=a.size();for(int i=0;i<n-1;++i)return abs(a[i]-a[i+1]);return 0;}'))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 0 } });
    expect(call('int f(){return abs(-2147483647-1);}')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('overflow') });
  });
  it('checks all official sample T repairs against printed inputs', () => {
    const code = (condition: string) => `int main(){int n;cin>>n;vector<int>a(n);for(int i=0;i<a.size();++i)cin>>a[i];int sum=0;for(int i=0;${condition}++i)sum+=abs(a[i]-a[i+1]);cout<<sum;}`;
    expect(program(code('i<a.size()-1;'), '0')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    for (const condition of ['i<n-1;', 'i+1<n;', 'i+1<a.size();'])
      for (const [input, output] of [['0', '0'], ['1 5', '0'], ['3 1 3 4', '3'], ['5 2 0 2 2 3', '5']])
        expect(program(code(condition), input)).toMatchObject({ kind: 'ok', observation: { stdout: output } });
  });
  it('supports nested vector initializer lists and checked two-dimensional indexing', () => {
    const source = 'vector<vector<int>> a={{1,2},{3,4}}; int f(int i,int j){return a[i][j];}';
    expect(call(source, 'f', [1, 0])).toMatchObject({ kind: 'ok', observation: { returnValue: 3 } });
    expect(call(source, 'f', [1, 2])).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    expect(call(source, 'f', [2, 0])).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
    expect(call('int f(vector<vector<int>> a){return a[1][0];}', 'f', [[[1, 2], [3, 4]]]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 3 } });
  });
  it('runs official 2025/26 Paper 1 G and H matrix completions', () => {
    const matrix = 'vector<vector<int>> a={{1,2,3,4},{5,6,7,8},{9,10,11,12},{13,14,15,16}};';
    const code = (row: string, col: string) => `${matrix}int main(){for(int i=0;i<4;++i){for(int j=0;j<4;++j)cout<<a[${row}][${col}]<<" ";cout<<endl;}}`;
    expect(program(code('3-j', 'i'))).toMatchObject({ kind: 'ok', observation: { stdout: '13 9 5 1 \n14 10 6 2 \n15 11 7 3 \n16 12 8 4 \n' } });
    expect(program(code('i/2', 'j%2*2'))).toMatchObject({ kind: 'ok', observation: { stdout: '1 3 1 3 \n1 3 1 3 \n5 7 5 7 \n5 7 5 7 \n' } });
  });
  it('runs official 2025/26 C++ P vector prefix-sum expression with its local helper', () => {
    const source = 'int f(vector<int>a,int x){int i=0;while(i<a.size()&&a[i]<x)++i;return i;}\n'
      + 'int g(vector<int>a,int x){int n=a.size();vector<int>b(n+1,0);b[0]=0;for(int i=1;i<=n;++i)b[i]=b[i-1]+a[i-1];int u=f(a,x);return b[n]-2*b[u]+(2*u-n)*x;}';
    for (const [a, x] of [[[-3, 0, 2, 7], 1], [[1, 2, 3], 10], [[1, 2, 3], -5], [[4], 4]] as const)
      expect(call(source, 'g', [a as unknown as number[], x])).toMatchObject({ kind: 'ok', observation: { returnValue: a.reduce<number>((sum, v) => sum + Math.abs(x - v), 0) } });
  });
  it('runs official 2025/26 C++ R recurrence for the full printed input range', () => {
    const source = 'int g(int n,int k){vector<int>a(n+1);for(int i=0;i<k;++i)a[i]=1;a[k]=k;for(int i=k+1;i<=n;++i)a[i]=2*a[i-1]-a[i-k-1];return a[n];}';
    for (let n = 1; n <= 30; n++) for (let k = 1; k <= n; k++) {
      const a = Array(n + 1).fill(0); for (let i = 0; i < k; i++) a[i] = 1;
      for (let i = k; i <= n; i++) for (let j = i - k; j < i; j++) a[i] += a[j];
      expect(call(source, 'g', [n, k])).toMatchObject({ kind: 'ok', observation: { returnValue: a[n] } });
    }
  });
  it('runs official 2025/26 C++ T recursive rounding with global vector', () => {
    const source = 'vector<int> p={1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000};'
      + 'int r(int x,int n){if(n==0)return x;else if(n==1)return (x+5)/10*10;else return r(r(x,n-1)/p[n-1],1)*p[n-1];}'
      + 'int rnd(int x,int n){return r(x-p[n]/18,n);}';
    for (const [x, n] of [[0,0],[4,1],[5,1],[149,2],[150,2],[1122444669,6],[999999999,9]] as const) {
      if (x > 1000000000) continue;
      const power = 10 ** n;
      const expected = Math.floor((x + power / 2) / power) * power;
      expect(call(source, 'rnd', [x, n])).toMatchObject({ kind: 'ok', observation: { returnValue: expected } });
    }
  });
  it('models max, vector sorting and reference mutation with argsAfter', () => {
    expect(call('int f(){return max(-3,std::max(2,4));}')).toMatchObject({ kind: 'ok', observation: { returnValue: 4 } });
    const source = 'int f(vector<int>& a){sort(a.begin(),a.end());a[0]=9;return a[1];}';
    const target: ProgramTarget = { language: 'cpp', source, harness: { kind: 'call', function: 'f' } };
    expect(runCpp(source, target, { id: 'sort-ref', args: [[3,1,2]], expected: { argsAfter: [[9,2,3]] }, maxSteps: 1000 }))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 2, argsAfter: [[9,2,3]] } });
    expect(call('int f(char c){return c;}', 'f', ['0'])).toMatchObject({ kind: 'ok', observation: { returnValue: 48 } });
  });
  it('reads arrays of strings and evaluates indexed length, characters, and comparisons', () => {
    const source = 'int main(){string a[3];for(int i=0;i<3;++i)cin>>a[i];cout<<a[0].length()<<":"<<(a[1]<a[2])<<":"<<a[2][1];}';
    expect(program(source, 'cat apple banana')).toMatchObject({ kind: 'ok', observation: { stdout: '3:1:a' } });
    expect(program('string a[2]={"hi","bye"};int main(){string ans="";if(a[0]!=a[1])ans=a[1];cout<<ans;}'))
      .toMatchObject({ kind: 'ok', observation: { stdout: 'bye' } });
    expect(program('int main(){string a[1];cin>>a[0];cout<<a[0][3];}', 'abc'))
      .toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('bounds') });
  });
  it('executes the exact 2022/23 Junior F word-pair counter', () => {
    const source = 'int main(){string a[8];for(int i=0;i<8;++i){cin>>a[i];}int count=0;for(int i=0;i<8;++i){for(int j=i+1;j<8;++j){for(int k=0;k<5;++k){if(a[i].length()>k&&a[j].length()>k&&a[i][k]==a[j][k]){++count;}}}}cout<<count;}';
    expect(program(source, 'it is never too late to join hkoi')).toMatchObject({ kind: 'ok', observation: { stdout: '7' } });
    expect(program(source, 'ab ab ab ab ac ac ac ac')).toMatchObject({ kind: 'ok', observation: { stdout: '40' } });
  });
  it('executes the 2024/25 Junior O string-array completion', () => {
    const source = 'string alice[7]={"Chinese","English","Math","Math","CSD","PE","PE"};string bob[7]={"Biology","Biology","Math","Math","Chinese","PE","PE"};int main(){string ans="";for(int i=0;i<7;++i){if(alice[i]==bob[i]){ans=bob[i];break;}}cout<<ans;}';
    expect(program(source)).toMatchObject({ kind: 'ok', observation: { stdout: 'Math' } });
  });
  it('runs the printed 2024/25 Junior U floating cast and division', () => {
    const source = 'int MaxSum(vector<int>& a,int len){int best=-1;for(int i=0;i+len<=a.size();++i){int sum=0;for(int j=i;j<i+len;++j)sum+=a[j];best=max(best,sum);}return best;}'
      + 'double MaxSustainedWind(vector<int>& data_points,int len){return (double)MaxSum(data_points,len)/len;}';
    expect(call(source, 'MaxSustainedWind', [[1, 2, 3, 4], 2]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 3.5 } });
    expect(call(source, 'MaxSustainedWind', [[1], 1]))
      .toMatchObject({ kind: 'ok', observation: { returnValue: 1 } });
  });
  it('grades all printed 2024/25 Junior C++ completions against official answers', async () => {
    const answers: Record<string, Record<string, string>> = {
      'cpp-o': { O: 'break' }, 'cpp-p': { P: 'a[i]>x' }, 'cpp-q': { Q: 'a[n-i]>=i' },
      'cpp-r': { R1: 'x==-1||a[i]>a[x]', R2: 'x=i' },
      'cpp-s': { S1: 'i>=k', S2: 'a[FindMax(a)]', S3: 'FindMax(a)' },
      'cpp-t': { T1: 'len-1', T2: 'i-len+1' }, 'cpp-u': { U: '(double)' }
    };
    const paper = validatePaper(junior2025);
    for (const [id, answer] of Object.entries(answers)) {
      const question = paper.questions.find(q => q.id === id)!;
      const grade = await gradeQuestion(question, answer, 'cpp');
      expect([id, grade.status, grade.cases.find(c => c.status !== 'pass')?.message]).toEqual([id, 'pass', undefined]);
    }
  });
  it('reports unsupported syntax instead of guessing C++ behavior', () => {
    expect(call('int f(){ vector<double> v; return 0; }')).toMatchObject({ kind: 'unsupported' });
    expect(program('#define X 1\nint main(){return X;}')).toMatchObject({ kind: 'unsupported' });
  });
});
