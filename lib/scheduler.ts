// Agendamento de disparos futuros via Google Cloud Tasks.
// Cria UMA task por step com scheduleTime = agora + delay.
// No horario, o Cloud Tasks chama POST {APP_BASE_URL}/api/dispatch/{jobId}.
import { CloudTasksClient } from "@google-cloud/tasks";
import type { DelayUnit } from "@/types";

// Init preguiçosa: nao instanciar no load do modulo (sem credenciais GCP,
// derruba qualquer rota que importe este arquivo, ex.: o webhook).
let _client: CloudTasksClient | null = null;
function client(): CloudTasksClient {
  if (!_client) _client = new CloudTasksClient();
  return _client;
}

const MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function delayToMs(d: { value: number; unit: DelayUnit }): number {
  return d.value * MS[d.unit];
}

export async function scheduleDispatch(params: {
  jobId: string;
  storeId: string;
  delay: { value: number; unit: DelayUnit };
}): Promise<string> {
  const project = process.env.GCP_PROJECT_ID!;
  const location = process.env.GCP_LOCATION!;
  const queue = process.env.CLOUD_TASKS_QUEUE!;
  const parent = client().queuePath(project, location, queue);

  const runAtSeconds = Math.floor((Date.now() + delayToMs(params.delay)) / 1000);

  const [response] = await client().createTask({
    parent,
    task: {
      scheduleTime: { seconds: runAtSeconds },
      httpRequest: {
        httpMethod: "POST",
        url: `${process.env.APP_BASE_URL}/api/dispatch/${params.jobId}?storeId=${params.storeId}`,
        headers: {
          "Content-Type": "application/json",
          // Segredo compartilhado: o dispatch so aceita chamadas com este header.
          "x-dispatch-secret": process.env.INTERNAL_DISPATCH_SECRET ?? "",
        },
        // Autentica o callback com OIDC para que /api/dispatch confie na origem.
        oidcToken: {
          serviceAccountEmail: process.env.DISPATCH_SERVICE_ACCOUNT_EMAIL!,
        },
      },
    },
  });

  return response.name ?? "";
}
