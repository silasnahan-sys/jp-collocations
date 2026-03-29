import type { SurferCollocationEntry, DiscourseCategory, DiscoursePosition } from '../surfer-types.ts';

// ── Exported types ──────────────────────────────────────────────────────────

export interface BarChartData {
  title: string;
  labels: string[];
  values: number[];
  colors?: string[];
}

export interface CoOccurrenceCell {
  row: string;
  col: string;
  count: number;
  strength: number;
}

export interface CoOccurrenceMatrix {
  labels: string[];
  cells: CoOccurrenceCell[];
  maxCount: number;
}

export interface TimelinePoint {
  date: string;
  surface: string;
  category: string;
  count: number;
}

export interface TimelineData {
  points: TimelinePoint[];
  categories: string[];
  dateRange: { start: string; end: string } | null;
}

export interface TreeNode {
  id: string;
  label: string;
  category?: string;
  children: TreeNode[];
  count?: number;
}

export interface WordCloudItem {
  surface: string;
  reading?: string;
  weight: number;
  category?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  'topic-initiation': '#4A90D9',
  'reasoning': '#E67E22',
  'modality': '#9B59B6',
  'connective': '#27AE60',
  'confirmation': '#F39C12',
  'rephrasing': '#1ABC9C',
  'filler': '#95A5A6',
  'quotation': '#E74C3C',
};

const ALL_CATEGORIES: DiscourseCategory[] = [
  'topic-initiation',
  'reasoning',
  'modality',
  'connective',
  'confirmation',
  'rephrasing',
  'filler',
  'quotation',
];

const ALL_POSITIONS: DiscoursePosition[] = [
  'utterance-initial',
  'utterance-final',
  'mid-utterance',
  'any',
];

const POSITION_COLORS: Record<string, string> = {
  'utterance-initial': '#3498DB',
  'utterance-final': '#E74C3C',
  'mid-utterance': '#2ECC71',
  'any': '#95A5A6',
};

// ── DiscourseVisualizer ─────────────────────────────────────────────────────

export class DiscourseVisualizer {
  /** Count entries per discourseCategory */
  static buildCategoryChart(entries: SurferCollocationEntry[]): BarChartData {
    const counts: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) {
      counts[cat] = 0;
    }
    for (const entry of entries) {
      const cat = entry.discourseCategory ?? 'unknown';
      counts[cat] = (counts[cat] ?? 0) + 1;
    }

    const labels = Object.keys(counts);
    const values = labels.map((l) => counts[l]);
    const colors = labels.map((l) => CATEGORY_COLORS[l] ?? '#CCCCCC');

    return {
      title: 'Discourse Category Distribution',
      labels,
      values,
      colors,
    };
  }

  /** Count entries per discoursePosition */
  static buildPositionChart(entries: SurferCollocationEntry[]): BarChartData {
    const counts: Record<string, number> = {};
    for (const pos of ALL_POSITIONS) {
      counts[pos] = 0;
    }
    for (const entry of entries) {
      const pos = entry.discoursePosition ?? 'any';
      counts[pos] = (counts[pos] ?? 0) + 1;
    }

    const labels = Object.keys(counts);
    const values = labels.map((l) => counts[l]);
    const colors = labels.map((l) => POSITION_COLORS[l] ?? '#CCCCCC');

    return {
      title: 'Discourse Position Distribution',
      labels,
      values,
      colors,
    };
  }

  /** Build symmetric co-occurrence matrix from entries with coOccurrences */
  static buildCoOccurrenceMatrix(entries: SurferCollocationEntry[]): CoOccurrenceMatrix {
    const surfaceById = new Map<string, string>();
    for (const entry of entries) {
      surfaceById.set(entry.id, entry.surface);
    }

    const pairCounts = new Map<string, number>();
    const allSurfaces = new Set<string>();

    for (const entry of entries) {
      if (!entry.coOccurrences || entry.coOccurrences.length === 0) continue;
      const aSurface = entry.surface;
      allSurfaces.add(aSurface);

      for (const coId of entry.coOccurrences) {
        const bSurface = surfaceById.get(coId);
        if (!bSurface) continue;
        allSurfaces.add(bSurface);

        // Canonical key (alphabetical order for symmetry)
        const key = aSurface <= bSurface ? `${aSurface}\0${bSurface}` : `${bSurface}\0${aSurface}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    const labels = [...allSurfaces].sort();
    let maxCount = 0;
    const cells: CoOccurrenceCell[] = [];

    for (const [key, count] of pairCounts) {
      const [row, col] = key.split('\0');
      if (count > maxCount) maxCount = count;
      cells.push({ row, col, count, strength: 0 });
      if (row !== col) {
        cells.push({ row: col, col: row, count, strength: 0 });
      }
    }

    // Normalise strength
    for (const cell of cells) {
      cell.strength = maxCount > 0 ? cell.count / maxCount : 0;
    }

    return { labels, cells, maxCount };
  }

  /** Group entries by capturedAt date and count per day per category */
  static buildFrequencyTimeline(entries: SurferCollocationEntry[]): TimelineData {
    const buckets = new Map<string, Map<string, number>>(); // date → category → count
    const categorySet = new Set<string>();

    for (const entry of entries) {
      if (!entry.capturedAt) continue;
      const day = entry.capturedAt.slice(0, 10); // ISO day "YYYY-MM-DD"
      const cat = entry.discourseCategory ?? 'unknown';
      categorySet.add(cat);

      if (!buckets.has(day)) buckets.set(day, new Map());
      const dayCounts = buckets.get(day)!;
      dayCounts.set(cat, (dayCounts.get(cat) ?? 0) + 1);
    }

    const sortedDays = [...buckets.keys()].sort();
    const categories = [...categorySet].sort();
    const points: TimelinePoint[] = [];

    for (const day of sortedDays) {
      const dayCounts = buckets.get(day)!;
      for (const cat of categories) {
        const count = dayCounts.get(cat) ?? 0;
        if (count > 0) {
          points.push({ date: day, surface: '', category: cat, count });
        }
      }
    }

    const dateRange =
      sortedDays.length > 0
        ? { start: sortedDays[0], end: sortedDays[sortedDays.length - 1] }
        : null;

    return { points, categories, dateRange };
  }

  /** Build a 3-level tree: root → category nodes → surface form leaf nodes */
  static buildDiscourseTree(entries: SurferCollocationEntry[]): TreeNode {
    const byCat = new Map<string, SurferCollocationEntry[]>();

    for (const entry of entries) {
      const cat = entry.discourseCategory ?? 'unknown';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(entry);
    }

    const categoryNodes: TreeNode[] = [];
    for (const [cat, catEntries] of byCat) {
      const leaves: TreeNode[] = catEntries.map((e) => ({
        id: e.id,
        label: e.surface,
        category: cat,
        children: [],
      }));
      categoryNodes.push({
        id: `category-${cat}`,
        label: cat,
        category: cat,
        children: leaves,
        count: catEntries.length,
      });
    }

    return {
      id: 'root',
      label: '談話マーカー',
      children: categoryNodes,
      count: entries.length,
    };
  }

  /** Map each entry to a WordCloudItem with normalised weight */
  static buildMarkerCloud(entries: SurferCollocationEntry[]): WordCloudItem[] {
    if (entries.length === 0) return [];

    const items: WordCloudItem[] = entries.map((e) => {
      const rawWeight =
        (e.exampleSentences?.length ?? 0) * 10 +
        (e.coOccurrences?.length ?? 0) * 5 +
        1;
      return {
        surface: e.surface,
        reading: e.reading,
        weight: rawWeight,
        category: e.discourseCategory,
      };
    });

    // Normalise to 1–100 (single-pass min/max)
    let minRaw = items[0].weight;
    let maxRaw = items[0].weight;
    for (const item of items) {
      if (item.weight < minRaw) minRaw = item.weight;
      if (item.weight > maxRaw) maxRaw = item.weight;
    }
    const range = maxRaw - minRaw;

    for (const item of items) {
      item.weight = range > 0 ? Math.round(((item.weight - minRaw) / range) * 99) + 1 : 50;
    }

    items.sort((a, b) => b.weight - a.weight);
    return items;
  }

  /** Count entries per register value */
  static buildRegisterChart(entries: SurferCollocationEntry[]): BarChartData {
    const registerLabels = ['formal', 'informal', 'neutral', 'undefined'];
    const counts: Record<string, number> = {};
    for (const label of registerLabels) {
      counts[label] = 0;
    }
    for (const entry of entries) {
      const reg = entry.register ?? 'undefined';
      counts[reg] = (counts[reg] ?? 0) + 1;
    }

    const labels = Object.keys(counts);
    const values = labels.map((l) => counts[l]);
    const colors = ['#2980B9', '#E74C3C', '#7F8C8D', '#BDC3C7'];

    return {
      title: 'Register Distribution',
      labels,
      values,
      colors,
    };
  }

  /** Count entries per granularity value */
  static buildGranularityChart(entries: SurferCollocationEntry[]): BarChartData {
    const granularities = [
      'morpheme',
      'bunsetsu',
      'clause',
      'utterance',
      'turn',
      'exchange',
      'episode',
    ];
    const counts: Record<string, number> = {};
    for (const g of granularities) {
      counts[g] = 0;
    }
    for (const entry of entries) {
      const g = entry.granularity ?? 'unknown';
      counts[g] = (counts[g] ?? 0) + 1;
    }

    const labels = Object.keys(counts);
    const values = labels.map((l) => counts[l]);

    return {
      title: 'Granularity Distribution',
      labels,
      values,
    };
  }
}
