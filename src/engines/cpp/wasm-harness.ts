import type { JsonValue, ProgramCase, ProgramTarget } from '../../core/types';

function quoted(value: string): string { return JSON.stringify(value); }

function arrayElementType(values: JsonValue[]): string {
  const sample = values.find(value => value !== null);
  if (Array.isArray(sample)) return `std::vector<${arrayElementType(sample)}>`;
  if (typeof sample === 'string') return 'std::string';
  if (typeof sample === 'boolean') return 'bool';
  return values.some(value => typeof value === 'number' && !Number.isInteger(value)) ? 'double' : 'int';
}

function initializer(value: JsonValue): string {
  if (typeof value === 'string') return `std::string(${quoted(value)})`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    if (value.some(item => item === null || (typeof item === 'object' && !Array.isArray(item))))
      throw new Error('C++ harness object arguments are not supported');
    const element = arrayElementType(value);
    return `std::vector<${element}>{${value.map(initializer).join(',')}}`;
  }
  throw new Error('C++ harness argument is not representable');
}

/** Append a small observation harness without changing the submitted source. */
export function buildWasmSource(source: string, target: ProgramTarget, testCase: ProgramCase): string {
  if (target.harness.kind === 'program') return source;
  const functionName = target.harness.function;
  if (!/^[A-Za-z_]\w*$/.test(functionName)) throw new Error('Invalid C++ harness function name');
  const args = testCase.args ?? [];
  const declarations = args.map((arg, index) => {
    const value = initializer(arg);
    return `using hkoi_value${index} = std::remove_cv_t<std::remove_reference_t<typename hkoi_traits<decltype(&${functionName})>::template arg<${index}>>>;\n  hkoi_holder<hkoi_value${index}> hkoi_arg${index}(${value});`;
  }).join('\n  ');
  const passed = args.map((_, index) => `hkoi_arg${index}.get()`).join(', ');
  const after = args.map((_, index) => `hkoi_arg${index}.json()`).join(' << "," << ');
  const afterOutput = args.length ? `std::cerr << ${after};` : '';
  return `#include <type_traits>\n#include <tuple>\n#include <utility>\n#include <memory>\n#include <vector>\n#include <string>\n#include <iostream>\n#include <sstream>\n#include <iomanip>\n#define main hkoi_original_main\n${source}\n#undef main
template<class T> struct hkoi_traits;
template<class R, class... A> struct hkoi_traits<R (*)(A...)> { template<std::size_t I> using arg = typename std::tuple_element<I, std::tuple<A...>>::type; };
std::string hkoi_json(const std::string& value) {
  std::ostringstream out; out << '"';
  for (unsigned char c : value) {
    if (c == '"' || c == '\\\\') out << '\\\\' << c;
    else if (c == '\\n') out << "\\\\n";
    else if (c == '\\r') out << "\\\\r";
    else if (c == '\\t') out << "\\\\t";
    else if (c < 32) { out << "\\\\u" << std::hex << std::setw(4) << std::setfill('0') << int(c) << std::dec; }
    else out << c;
  }
  out << '"'; return out.str();
}
std::string hkoi_json(char value) { return std::to_string(int(value)); }
std::string hkoi_json(signed char value) { return std::to_string(int(value)); }
std::string hkoi_json(unsigned char value) { return std::to_string(unsigned(value)); }
template<class T> std::string hkoi_json(const T& value) {
  std::ostringstream out; out << std::setprecision(17) << value; return out.str();
}
template<class T> std::string hkoi_json(const std::vector<T>& values) {
  std::string out = "[";
  for (std::size_t i = 0; i < values.size(); ++i) { if (i) out += ","; out += hkoi_json(values[i]); }
  return out + "]";
}
template<class T> struct hkoi_holder {
  T value;
  explicit hkoi_holder(T initial): value(std::move(initial)) {}
  T& get() { return value; }
  std::string json() const { return hkoi_json(value); }
};
template<class T> struct hkoi_holder<T*> {
  using element = std::remove_cv_t<T>;
  std::unique_ptr<element[]> value;
  std::size_t length;
  template<class U> explicit hkoi_holder(const std::vector<U>& initial): value(new element[initial.size() ? initial.size() : 1]), length(initial.size()) {
    for (std::size_t i = 0; i < length; ++i) value[i] = initial[i];
  }
  T* get() { return value.get(); }
  std::string json() const {
    std::string out = "[";
    for (std::size_t i = 0; i < length; ++i) { if (i) out += ","; out += hkoi_json(value[i]); }
    return out + "]";
  }
};
template<class F, class... A> void hkoi_invoke(F function, A&&... args) {
  if constexpr (std::is_void_v<std::invoke_result_t<F, A...>>) {
    function(std::forward<A>(args)...); std::cerr << "null";
  } else {
    auto result = function(std::forward<A>(args)...); std::cerr << hkoi_json(result);
  }
}
int main() {
  ${declarations}
  std::cerr << "\\n__HKOI_OBS_BEGIN__";
  hkoi_invoke(&${functionName}${passed ? `, ${passed}` : ''});
  std::cerr << "__HKOI_ARGS_BEGIN__[";
  ${afterOutput}
  std::cerr << "]__HKOI_OBS_END__\\n";
}
`;
}

export function readWasmObservation(stdout: string, stderr: string, target: ProgramTarget): { returnValue?: JsonValue; stdout: string; argsAfter?: JsonValue[] } {
  if (target.harness.kind === 'program') return { stdout };
  const match = /__HKOI_OBS_BEGIN__(.*?)__HKOI_ARGS_BEGIN__(\[.*?\])__HKOI_OBS_END__/s.exec(stderr);
  if (!match) throw new Error('C++ observation marker was not produced');
  const returnValue = JSON.parse(match[1]) as JsonValue;
  const argsAfter = JSON.parse(match[2]) as JsonValue[];
  return { ...(returnValue === null ? {} : { returnValue }), stdout, argsAfter };
}
