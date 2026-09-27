import type { PaperConfig } from '../core/types';
import { validatePaper } from '../core/validate';

const bundled = import.meta.glob('../../papers/*.json', { eager: true, import: 'default' });

/** Only committed paper JSON is bundled; private imports remain browser memory only. */
export const bundledPapers: PaperConfig[] = Object.values(bundled)
  .map(value => validatePaper(value))
  .sort((a, b) => b.paper.season.localeCompare(a.paper.season) || a.paper.division.localeCompare(b.paper.division));
