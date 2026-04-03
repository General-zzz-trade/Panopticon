import { serializeGraph, type CausalGraph } from "./causal-graph";
import * as fs from "fs";
import * as path from "path";

const GRAPH_PATH = path.join(process.cwd(), "artifacts", "causal-graph.json");

export function saveCausalGraph(graph: CausalGraph): void {
  try {
    const dir = path.dirname(GRAPH_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(GRAPH_PATH, serializeGraph(graph), "utf-8");
  } catch {
    // Persistence is optional — never block execution
  }
}

export function getCausalGraphPath(): string {
  return GRAPH_PATH;
}
