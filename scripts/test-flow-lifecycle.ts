// Gerenciamento de ciclo de vida de fluxos (Editar | Pausar/Ativar | Excluir).
// Segue o padrao dos demais testes deste repo (ex.: test-uninstall-job-blocking.ts):
// um modelo em memoria que espelha a semantica transacional real de
// lib/flows/repo.ts, lib/rules/process.ts e lib/dispatch.ts, MAIS grep no
// codigo-fonte para garantir que a implementacao real contem as guardas
// verificadas aqui (nao so a simulacao).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type FlowStatus = "active" | "paused" | "draft";
type JobStatus = "scheduled" | "processing" | "cancelled" | "sent";

interface FlowRec {
  flowId: string;
  storeId: string;
  status: FlowStatus;
  deletedAt?: number;
  stats: { enrolled: number; sent: number };
}
interface JobRec {
  jobId: string;
  storeId: string;
  flowId: string;
  status: JobStatus;
}

class FakeDb {
  flows = new Map<string, FlowRec>();
  jobs = new Map<string, JobRec>();

  key(storeId: string, id: string) {
    return `${storeId}/${id}`;
  }

  addFlow(f: FlowRec) {
    this.flows.set(this.key(f.storeId, f.flowId), f);
  }
  addJob(j: JobRec) {
    this.jobs.set(this.key(j.storeId, j.jobId), j);
  }

  // Espelha lib/flows/repo.ts:listFlows — exclui deletedAt.
  listFlows(storeId: string): FlowRec[] {
    return [...this.flows.values()].filter((f) => f.storeId === storeId && !f.deletedAt);
  }

  // Espelha cancelPendingJobsOfFlow: cancela scheduled/processing do fluxo.
  private cancelPendingJobsOfFlow(storeId: string, flowId: string): number {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.storeId === storeId && j.flowId === flowId && (j.status === "scheduled" || j.status === "processing")) {
        j.status = "cancelled";
        n++;
      }
    }
    return n;
  }

  // Espelha lib/flows/repo.ts:updateFlowStatus — reativar NAO recria jobs
  // cancelados pela pausa.
  updateFlowStatus(storeId: string, flowId: string, status: FlowStatus) {
    const f = this.flows.get(this.key(storeId, flowId));
    if (!f || f.deletedAt) throw new Error("fluxo_nao_encontrado");
    f.status = status;
    if (status === "paused") this.cancelPendingJobsOfFlow(storeId, flowId);
  }

  // Espelha lib/flows/repo.ts:softDeleteFlow — preserva doc/stats/historico.
  softDeleteFlow(storeId: string, flowId: string, now: number) {
    const f = this.flows.get(this.key(storeId, flowId));
    if (!f || f.deletedAt) throw new Error("fluxo_nao_encontrado");
    f.deletedAt = now;
    this.cancelPendingJobsOfFlow(storeId, flowId);
  }

  // Espelha o gate de inscricao em lib/rules/process.ts (status active E sem deletedAt).
  tryEnroll(storeId: string, flowId: string): boolean {
    const f = this.flows.get(this.key(storeId, flowId));
    if (!f || f.status !== "active" || f.deletedAt) return false;
    const jobId = `job-${this.jobs.size}`;
    this.addJob({ jobId, storeId, flowId, status: "scheduled" });
    f.stats.enrolled++;
    return true;
  }

  // Espelha a defesa explicita adicionada em lib/dispatch.ts:dispatchJob —
  // !flow || flow.deletedAt || flow.status !== "active" => cancela, nao envia.
  dispatch(storeId: string, jobId: string): "sent" | "cancelled" | "noop" {
    const j = this.jobs.get(this.key(storeId, jobId));
    if (!j || j.status !== "scheduled") return "noop";
    const f = this.flows.get(this.key(storeId, j.flowId));
    if (!f || f.deletedAt || f.status !== "active") {
      j.status = "cancelled";
      return "cancelled";
    }
    j.status = "sent";
    const flow = this.flows.get(this.key(storeId, j.flowId))!;
    flow.stats.sent++;
    return "sent";
  }
}

let pass = 0;
let fail = 0;
function check(label: string, got: boolean) {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  got ? pass++ : fail++;
}

function main() {
  // 1) active -> paused
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.updateFlowStatus("s1", "f1", "paused");
    check("active -> paused", db.flows.get("s1/f1")!.status === "paused");
  }

  // 2) paused bloqueia nova inscricao
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.updateFlowStatus("s1", "f1", "paused");
    const enrolled = db.tryEnroll("s1", "f1");
    check("paused bloqueia nova inscricao", enrolled === false);
    check("paused: stats.enrolled nao incrementa", db.flows.get("s1/f1")!.stats.enrolled === 0);
  }

  // 3) paused impede job pendente de disparar (e cancela liberando cota — aqui: status)
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.tryEnroll("s1", "f1"); // cria job-0 scheduled
    const jobId = [...db.jobs.values()].find((j) => j.flowId === "f1")!.jobId;
    check("job agendado antes da pausa", db.jobs.get(`s1/${jobId}`)!.status === "scheduled");
    db.updateFlowStatus("s1", "f1", "paused"); // deve cancelar o job pendente
    check("pausar cancela job pendente ja agendado", db.jobs.get(`s1/${jobId}`)!.status === "cancelled");
    const result = db.dispatch("s1", jobId);
    check("dispatch de job cancelado pela pausa nao dispara", result !== "sent");
  }

  // 3b) job agendado ANTES de o flow ser pausado, mas cuja query de cancelamento
  // nao o pegou (simula corrida) — a defesa em dispatch() TAMBEM bloqueia.
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.addJob({ jobId: "j-race", storeId: "s1", flowId: "f1", status: "scheduled" });
    db.flows.get("s1/f1")!.status = "paused"; // muda o status sem passar pelo cancelamento (corrida)
    const result = db.dispatch("s1", "j-race");
    check("defesa no dispatch bloqueia mesmo sem cancelamento previo", result === "cancelled");
  }

  // 4) paused -> active volta a aceitar novas inscricoes (sem recriar jobs cancelados)
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.tryEnroll("s1", "f1");
    const cancelledJobId = [...db.jobs.values()].find((j) => j.flowId === "f1")!.jobId;
    db.updateFlowStatus("s1", "f1", "paused");
    check("job cancelado pela pausa", db.jobs.get(`s1/${cancelledJobId}`)!.status === "cancelled");
    db.updateFlowStatus("s1", "f1", "active");
    const enrolled = db.tryEnroll("s1", "f1");
    check("reativado aceita nova inscricao", enrolled === true);
    check("job cancelado pela pausa NAO e recriado", db.jobs.get(`s1/${cancelledJobId}`)!.status === "cancelled");
    check("stats.enrolled reflete apenas as inscricoes reais (2)", db.flows.get("s1/f1")!.stats.enrolled === 2);
  }

  // 5) excluir remove da listagem
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    check("listagem tem 1 fluxo antes da exclusao", db.listFlows("s1").length === 1);
    db.softDeleteFlow("s1", "f1", Date.now());
    check("listagem fica vazia apos soft delete", db.listFlows("s1").length === 0);
  }

  // 6) excluir impede inscricao e disparo
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.tryEnroll("s1", "f1");
    const jobId = [...db.jobs.values()].find((j) => j.flowId === "f1")!.jobId;
    db.softDeleteFlow("s1", "f1", Date.now());
    check("excluir cancela job pendente", db.jobs.get(`s1/${jobId}`)!.status === "cancelled");
    const enrolled = db.tryEnroll("s1", "f1");
    check("excluido impede nova inscricao", enrolled === false);
    // Mesmo que um job escape do cancelamento em lote (corrida), o dispatch bloqueia.
    db.addJob({ jobId: "j-race2", storeId: "s1", flowId: "f1", status: "scheduled" });
    check("excluido impede disparo (defesa no dispatch)", db.dispatch("s1", "j-race2") === "cancelled");
  }

  // 7) historico/stats permanecem apos soft delete
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "s1", status: "active", stats: { enrolled: 3, sent: 7 } });
    db.softDeleteFlow("s1", "f1", Date.now());
    const raw = db.flows.get("s1/f1")!;
    check("documento preservado apos soft delete", raw !== undefined);
    check("stats.enrolled preservado", raw.stats.enrolled === 3);
    check("stats.sent preservado", raw.stats.sent === 7);
    check("deletedAt preenchido (nao usa status=deleted)", typeof raw.deletedAt === "number");
    check("status continua um dos 3 valores validos", ["active", "paused", "draft"].includes(raw.status));
  }

  // 8) isolamento entre lojas
  {
    const db = new FakeDb();
    db.addFlow({ flowId: "f1", storeId: "store-a", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.addFlow({ flowId: "f1", storeId: "store-b", status: "active", stats: { enrolled: 0, sent: 0 } });
    db.updateFlowStatus("store-a", "f1", "paused");
    check("pausar na loja A nao afeta loja B", db.flows.get("store-b/f1")!.status === "active");
    db.softDeleteFlow("store-a", "f1", Date.now());
    check("excluir na loja A nao afeta listagem da loja B", db.listFlows("store-b").length === 1);
    check("loja A fica sem fluxos na listagem", db.listFlows("store-a").length === 0);
  }

  // ---- Ata a implementacao real: garante que as guardas simuladas acima
  // existem de fato no codigo-fonte (nao so nesta simulacao).
  const repoSource = readFileSync(new URL("../lib/flows/repo.ts", import.meta.url), "utf8");
  const processSource = readFileSync(new URL("../lib/rules/process.ts", import.meta.url), "utf8");
  const dispatchSource = readFileSync(new URL("../lib/dispatch.ts", import.meta.url), "utf8");
  const typesSource = readFileSync(new URL("../types/index.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../app/api/flows/[id]/route.ts", import.meta.url), "utf8");

  check("repo.ts exporta updateFlowStatus", /export async function updateFlowStatus/.test(repoSource));
  check("repo.ts exporta softDeleteFlow", /export async function softDeleteFlow/.test(repoSource));
  check("repo.ts: pausar cancela jobs pendentes", /status === "paused"[\s\S]{0,80}cancelPendingJobsOfFlow/.test(repoSource));
  check("repo.ts: listFlows filtra deletedAt", /filter\(\(f\) => !f\.deletedAt\)/.test(repoSource));
  check("process.ts filtra flow.deletedAt antes de inscrever", (processSource.match(/if \(flow\.deletedAt\) continue/g) ?? []).length === 2);
  check("dispatch.ts bloqueia flow inexistente/deletado/nao-ativo antes do envio", /!flow \|\| flow\.deletedAt \|\| flow\.status !== "active"/.test(dispatchSource));
  check("dispatch.ts usa cancelJobAndReleaseQuota na defesa nova", /reason: !flow[\s\S]{0,120}cancelJobAndReleaseQuota|cancelJobAndReleaseQuota\(\{\s*storeId,\s*jobRef,\s*reason: !flow/.test(dispatchSource));
  check("types: Flow.status continua sem \"deleted\"", !/status:\s*"active"\s*\|\s*"paused"\s*\|\s*"draft"\s*\|\s*"deleted"/.test(typesSource));
  check("types: Flow tem deletedAt opcional", /deletedAt\?:\s*number/.test(typesSource));
  check("route PATCH valida status", /FLOW_STATUSES/.test(routeSource) && /PATCH/.test(routeSource));
  check("route DELETE chama softDeleteFlow", /export async function DELETE[\s\S]*softDeleteFlow/.test(routeSource));

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
