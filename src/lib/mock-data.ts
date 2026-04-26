// Placeholder data drawn from the actual Excel — replace with build_data.ts output later.

export type Component = 'Economic' | 'Ecology' | 'Social';

export const COMPONENTS: { code: Component; label: string; tone: string }[] = [
  { code: 'Economic', label: 'Economic', tone: 'econ' },
  { code: 'Ecology', label: 'Ecology', tone: 'eco' },
  { code: 'Social', label: 'Social', tone: 'soc' }
];

export const INDICATORS = [
  { code: 'distress-migration', label: 'Distress Migration', component: 'Economic' as const },
  { code: 'export-import', label: 'Export/Import', component: 'Economic' as const },
  { code: 'hh-income', label: 'HH Income', component: 'Economic' as const },
  { code: 'livelihood-basket', label: 'Livelihood Basket', component: 'Economic' as const },
  { code: 'youth-employment', label: 'Youth Employment', component: 'Economic' as const },
  { code: 'agro-ecology', label: 'Agro Ecology', component: 'Ecology' as const },
  { code: 'energy', label: 'Energy', component: 'Ecology' as const },
  { code: 'forest', label: 'Forest', component: 'Ecology' as const },
  { code: 'soil', label: 'Soil', component: 'Ecology' as const },
  { code: 'water', label: 'Water', component: 'Ecology' as const },
  { code: 'gender-inclusion', label: 'Gender & Inclusion', component: 'Social' as const },
  { code: 'health-nutrition', label: 'Health & Nutrition', component: 'Social' as const },
  { code: 'institution', label: 'Institution', component: 'Social' as const },
  { code: 'wash', label: 'WASH', component: 'Social' as const }
];

export type Village = {
  code: string;
  name: string;
  district: string;
  state: 'CG' | 'JH' | 'OD';
  households: number;
  lat: number;
  lon: number;
  scores: Record<string, number>;
};

// Seven real villages from the Excel — enough to see the layout work.
// Scores from Spider Plot Scores; lat/lon are approximate placeholders.
export const VILLAGES: Village[] = [
  {
    code: 'harry',
    name: 'Harry',
    district: 'Balrampur',
    state: 'CG',
    households: 215,
    lat: 23.4,
    lon: 83.6,
    scores: {
      'distress-migration': 61,
      'export-import': 20,
      'hh-income': 19,
      'livelihood-basket': 31,
      'youth-employment': 54,
      'agro-ecology': 35,
      energy: 16,
      forest: 53,
      soil: 61,
      water: 36,
      'gender-inclusion': 33,
      'health-nutrition': 57,
      institution: 41,
      wash: 20
    }
  },
  {
    code: 'ghughari-khurd',
    name: 'Ghughari Khurd',
    district: 'Balrampur',
    state: 'CG',
    households: 140,
    lat: 23.6,
    lon: 83.8,
    scores: {
      'distress-migration': 50,
      'export-import': 40,
      'hh-income': 19,
      'livelihood-basket': 31,
      'youth-employment': 52,
      'agro-ecology': 36,
      energy: 15,
      forest: 38,
      soil: 63,
      water: 37,
      'gender-inclusion': 32,
      'health-nutrition': 46,
      institution: 37,
      wash: 25
    }
  },
  {
    code: 'kondrunj',
    name: 'Kondrunj',
    district: 'Kanker',
    state: 'CG',
    households: 149,
    lat: 20.3,
    lon: 81.5,
    scores: {
      'distress-migration': 88,
      'export-import': 72,
      'hh-income': 41,
      'livelihood-basket': 55,
      'youth-employment': 12,
      'agro-ecology': 42,
      energy: 11,
      forest: 64,
      soil: 58,
      water: 33,
      'gender-inclusion': 41,
      'health-nutrition': 52,
      institution: 47,
      wash: 50
    }
  },
  {
    code: 'chandwa',
    name: 'Chandwa',
    district: 'Lohardaga',
    state: 'JH',
    households: 124,
    lat: 23.4,
    lon: 84.5,
    scores: {
      'distress-migration': 78,
      'export-import': 35,
      'hh-income': 38,
      'livelihood-basket': 49,
      'youth-employment': 18,
      'agro-ecology': 40,
      energy: 12,
      forest: 60,
      soil: 55,
      water: 30,
      'gender-inclusion': 42,
      'health-nutrition': 55,
      institution: 44,
      wash: 47
    }
  },
  {
    code: 'litiput',
    name: 'Litiput',
    district: 'Koraput',
    state: 'OD',
    households: 56,
    lat: 18.8,
    lon: 82.7,
    scores: {
      'distress-migration': 72,
      'export-import': 30,
      'hh-income': 28,
      'livelihood-basket': 41,
      'youth-employment': 10,
      'agro-ecology': 48,
      energy: 14,
      forest: 70,
      soil: 60,
      water: 25,
      'gender-inclusion': 38,
      'health-nutrition': 49,
      institution: 35,
      wash: 32
    }
  },
  {
    code: 'aamajhola',
    name: 'Aamajhola',
    district: 'Kanker',
    state: 'CG',
    households: 75,
    lat: 20.4,
    lon: 81.6,
    scores: {
      'distress-migration': 80,
      'export-import': 45,
      'hh-income': 44,
      'livelihood-basket': 50,
      'youth-employment': 22,
      'agro-ecology': 38,
      energy: 18,
      forest: 56,
      soil: 50,
      water: 35,
      'gender-inclusion': 40,
      'health-nutrition': 50,
      institution: 42,
      wash: 28
    }
  },
  {
    code: 'podha',
    name: 'Podha',
    district: 'Gumla',
    state: 'JH',
    households: 92,
    lat: 22.9,
    lon: 84.5,
    scores: {
      'distress-migration': 75,
      'export-import': 38,
      'hh-income': 32,
      'livelihood-basket': 44,
      'youth-employment': 15,
      'agro-ecology': 36,
      energy: 14,
      forest: 52,
      soil: 48,
      water: 28,
      'gender-inclusion': 36,
      'health-nutrition': 44,
      institution: 39,
      wash: 41
    }
  }
];

export function avgScore(v: Village): number {
  const vals = Object.values(v.scores);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function weakestIndicator(v: Village): { code: string; score: number } {
  const entries = Object.entries(v.scores);
  const [code, score] = entries.reduce((min, e) => (e[1] < min[1] ? e : min));
  return { code, score };
}
