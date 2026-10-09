# HKOI Heat FITB

Requires Node.js 22 or newer.

## Run locally

```sh
npm ci --legacy-peer-deps
npm run dev
```

Open the URL printed by Vite. To check a production build locally, run `npm run build`.

## Offline commands

Validate the bundled paper files, or a directory of private paper JSON files:

```sh
npm run validate:papers
npm run validate:papers -- ./private
```

Judge submissions from a CSV file:

```sh
npm run judge:csv -- papers/2024-25-senior.json submissions.csv scores.csv paper1 python
npx tsx src/cli/judge-csv.ts --paper papers/2024-25-senior.json --input submissions.csv --output scores.csv --tracks paper1,python --python-fallback true
```

Use one input column per answer, named `<question-id>.<blank-id>`. For example:

```csv
id,paper1-a.A
001,"2,1,2"
```

The optional track arguments select which parts to score (`paper1 python` or `paper1 cpp` for recent papers). A `tracks` column can override them per row, with comma-separated track IDs such as `"paper1,cpp"`. Without either, the command uses required tracks and the first language choice. The output CSV retains the input columns and adds each question's score and status, plus totals.

The custom Python runner is used by default. Pass `--python-fallback true` in the named-argument form to use Pyodide when it cannot run a case. The browser has the same option as a checkbox for Python papers.

Run the test suite with `npm test`.

Measure solver discovery against the bundled checkers:

```sh
npx tsx src/solver/benchmark.ts --max-candidates 1000 --max-ms 2000 --out ../solver-benchmark.json
```

The benchmark reports answers that pass configured cases; it does not prove correctness beyond those cases.
