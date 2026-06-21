// Agendamento de disparos futuros via Google Cloud Tasks.
// Cria UMA task por step com scheduleTime = agora + delay.
// No horario, o Cloud Tasks chama POST {APP_BASE_URL}/api/dispatch/{jobId}.
// NAO USADO no runtime atual: o agendamento usa Vercel Cron (ver lib/dispatch.ts
// e app/api/cron/dispatch). Este arquivo fica como base para migrar para Cloud
// Tasks no futuro (precisao maior em escala). Nada o importa hoje.
import { CloudTasksClient } from "@google-cloud/tasks";
import type { DelayUnit } from "@/types";
import { delayToMs } from "@/lib/time";

// Init preguiçosa: nunca instanciar no load do modulo.
let _client: CloudTasksClient | null = null;
function client(): CloudTasksClient {
  if (!_client) _client = new CloudTasksClient();
  return _client;
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
