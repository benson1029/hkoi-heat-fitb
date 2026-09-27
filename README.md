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
```

Use one input column per answer, named `<question-id>.<blank-id>`. For example:

```csv
id,paper1-a.A
001,"2,1,2"
```

The optional track arguments select which parts to score (`paper1 python` or `paper1 cpp` for recent papers). A `tracks` column can override them per row, with comma-separated track IDs such as `"paper1,cpp"`. Without either, the command uses required tracks and the first language choice. The output CSV retains the input columns and adds each question's score and status, plus totals.

Run the test suite with `npm test`.
