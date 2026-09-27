/** Executed inside Pyodide. Payload and response cross the JS/Python boundary as JSON. */
export const PYTHON_HARNESS = String.raw`
import ast
import builtins
import io
import json
import sys

class _HKOIStepLimit(BaseException):
    pass

class _HKOIOutputLimit(BaseException):
    pass

class _HKOIUnsupportedImport(BaseException):
    pass

class _HKOIBoundedOutput(io.StringIO):
    def __init__(self, maximum):
        super().__init__()
        self.maximum = maximum
        self.length = 0

    def write(self, text):
        self.length += len(text.encode('utf-8'))
        if self.length > self.maximum:
            raise _HKOIOutputLimit()
        return super().write(text)

def _hkoi_execute(payload):
    source = payload['source']
    target = payload['target']
    test_case = payload['testCase']
    maximum = test_case['maxSteps']
    steps = 0
    stdout = _HKOIBoundedOutput(100000)
    original_stdin, original_stdout = sys.stdin, sys.stdout
    original_trace = sys.gettrace()

    try:
        ast.parse(source, filename='<candidate>')
        compiled = compile(source, '<candidate>', 'exec')
    except (SyntaxError, IndentationError) as error:
        return {'kind': 'compile-error', 'message': f'{type(error).__name__}: {error.msg}', 'steps': 0}

    permitted_modules = {'math', 'itertools', 'functools', 'collections', 'bisect', 'heapq', 'string'}
    original_import = builtins.__import__

    def limited_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level or name.split('.')[0] not in permitted_modules:
            raise _HKOIUnsupportedImport(name)
        return original_import(name, globals, locals, fromlist, level)

    safe_builtins = builtins.__dict__.copy()
    safe_builtins['__import__'] = limited_import
    for forbidden in ('open', 'eval', 'exec', 'compile', 'breakpoint'):
        safe_builtins.pop(forbidden, None)
    namespace = {'__name__': '__main__', '__builtins__': safe_builtins}

    def trace(frame, event, arg):
        nonlocal steps
        if frame.f_code.co_filename == '<candidate>':
            if event == 'call':
                frame.f_trace_opcodes = True
            elif event == 'opcode':
                steps += 1
                if steps > maximum:
                    raise _HKOIStepLimit()
        return trace

    try:
        sys.stdin = io.StringIO(test_case.get('stdin', ''))
        sys.stdout = stdout
        sys.settrace(trace)
        exec(compiled, namespace)
        if target['harness']['kind'] == 'call':
            symbol = target['harness']['function']
            function = namespace[symbol]
            args = test_case.get('args', [])
            result = function(*args)
            observation = {'returnValue': result, 'argsAfter': args, 'stdout': stdout.getvalue()}
        else:
            observation = {'stdout': stdout.getvalue()}
        sys.settrace(None)
        try:
            json.dumps(observation, allow_nan=False)
        except (TypeError, ValueError):
            return {'kind': 'unsupported', 'message': 'The result is not a finite JSON value', 'steps': steps}
        return {'kind': 'ok', 'observation': observation, 'steps': steps}
    except _HKOIStepLimit:
        return {'kind': 'step-limit', 'message': f'Python opcode limit exceeded ({maximum})', 'steps': steps}
    except _HKOIOutputLimit:
        return {'kind': 'step-limit', 'message': 'Output byte limit exceeded', 'steps': steps}
    except _HKOIUnsupportedImport as error:
        return {'kind': 'unsupported', 'message': f'Import of {error} is outside the supported Python subset', 'steps': steps}
    except BaseException as error:
        return {'kind': 'runtime-error', 'message': f'{type(error).__name__}: {error}', 'steps': steps}
    finally:
        sys.settrace(original_trace)
        sys.stdin, sys.stdout = original_stdin, original_stdout

json.dumps(_hkoi_execute(json.loads(__hkoi_payload)), ensure_ascii=False, allow_nan=False)
`;
