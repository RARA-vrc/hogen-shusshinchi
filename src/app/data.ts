// Loads everything the app needs and resolves names for display.

import cellsDoc from '../../data/geo/cells.json';
import regionsDoc from '../../data/geo/regions.json';
import topoUrl from '../../data/geo/japan.topo.json?url';
import site from '../../site.config.json';
import { modelFromJson, type Model, type ModelJson } from '../engine/model.ts';
import creditsDoc from '../generated/credits.json';
import hostDoc from '../generated/host.json';
import modelUrl from '../generated/model.json?url';
import questionsDoc from '../generated/questions.json';
import type { HostData } from './host.ts';

export interface UiQuestion {
  id: string;
  category: string;
  text: string;
  options: { id: string; text: string }[];
}

export interface CreditEntry {
  category: string;
  name: string;
  source_url: string;
  license: string;
  license_url: string;
  credit: string;
  processing: string;
  retrieved: string;
}

export interface CreditPackage {
  name: string;
  version: string;
  license: string;
  url: string;
  bundled: boolean;
}

export interface AppData {
  title: string;
  model: Model;
  modelJson: ModelJson;
  topology: unknown;
  questions: UiQuestion[]; // same order as the model's questions
  host: HostData;
  cellLabels: string[]; // per model cell
  prefNames: string[]; // per model prefecture
  regionNames: string[]; // per model region
  credits: { repoUrl: string; entries: CreditEntry[]; packages: CreditPackage[] };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.json();
}

export async function loadAppData(): Promise<AppData> {
  const loaded = await Promise.all([fetchJson(modelUrl), fetchJson(topoUrl)]);
  const modelJson = loaded[0] as ModelJson;
  const model = modelFromJson(modelJson);

  const cellLabels: string[] = [];
  for (let c = 0; c < modelJson.cellIds.length; c++) {
    let label = modelJson.cellIds[c];
    for (let i = 0; i < cellsDoc.cells.length; i++) {
      if (cellsDoc.cells[i].id === modelJson.cellIds[c]) label = cellsDoc.cells[i].label;
    }
    cellLabels.push(label);
  }
  const prefNames: string[] = [];
  for (let p = 0; p < modelJson.prefCodes.length; p++) {
    let name = modelJson.prefCodes[p];
    for (let i = 0; i < cellsDoc.prefectures.length; i++) {
      if (cellsDoc.prefectures[i].code === modelJson.prefCodes[p]) name = cellsDoc.prefectures[i].name;
    }
    prefNames.push(name);
  }
  const regionNames: string[] = [];
  for (let r = 0; r < modelJson.regionIds.length; r++) {
    let name = modelJson.regionIds[r];
    for (let i = 0; i < regionsDoc.regions.length; i++) {
      if (regionsDoc.regions[i].id === modelJson.regionIds[r]) name = regionsDoc.regions[i].name;
    }
    regionNames.push(name);
  }

  // Question texts in model order.
  const questions: UiQuestion[] = [];
  for (let q = 0; q < modelJson.questions.length; q++) {
    let found: UiQuestion | null = null;
    for (let i = 0; i < questionsDoc.questions.length; i++) {
      if (questionsDoc.questions[i].id === modelJson.questions[q].id) found = questionsDoc.questions[i];
    }
    if (found === null) throw new Error(`no text for question ${modelJson.questions[q].id}`);
    if (found.options.length !== modelJson.questions[q].options) {
      throw new Error(`option count mismatch for question ${found.id}`);
    }
    questions.push(found);
  }

  return {
    title: site.title,
    model,
    modelJson,
    topology: loaded[1],
    questions,
    host: hostDoc as HostData,
    cellLabels,
    prefNames,
    regionNames,
    credits: creditsDoc,
  };
}
