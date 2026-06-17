import type { RawSourceReport } from "../src/intel/types";
import { rawSourceReportSchema } from "../src/schemas/intelIngest";
import { ingestPayload } from "../src/intel/ingest";
import { appendIngestFacts } from "./intelIngestStore";

export type StreamIngestConfig = {
  enabled: boolean;
  brokers: string[];
  topic: string;
  groupId: string;
  clientId: string;
  fromBeginning: boolean;
};

export type StreamIngestStatus = {
  enabled: boolean;
  running: boolean;
  brokers: string[];
  topic?: string;
  groupId?: string;
  clientId?: string;
  messagesConsumed: number;
  messagesAccepted: number;
  lastError?: string;
  lastMessageAt?: string;
};

let status: StreamIngestStatus = {
  enabled: false,
  running: false,
  brokers: [],
  messagesConsumed: 0,
  messagesAccepted: 0,
};

let stopConsumer: (() => Promise<void>) | null = null;

export function resolveStreamIngestConfig(
  env: NodeJS.ProcessEnv = process.env
): StreamIngestConfig {
  const brokers = (env.KAFKA_BROKERS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const enabled =
    env.KAFKA_INGEST_ENABLED === "true" ||
    (env.KAFKA_INGEST_ENABLED !== "false" && brokers.length > 0);
  return {
    enabled: enabled && brokers.length > 0,
    brokers,
    topic: env.KAFKA_TOPIC ?? "intel.raw",
    groupId: env.KAFKA_GROUP_ID ?? "coda2-ingest",
    clientId: env.KAFKA_CLIENT_ID ?? "coda2-ingest",
    fromBeginning: env.KAFKA_FROM_BEGINNING === "true",
  };
}

export function getStreamIngestStatus(): StreamIngestStatus {
  return { ...status };
}

function parseKafkaPayload(raw: string): { reports?: RawSourceReport[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.reports)) {
      return { reports: record.reports as RawSourceReport[] };
    }
    const single = rawSourceReportSchema.safeParse(parsed);
    if (single.success) {
      return { reports: [single.data] };
    }
    return null;
  }

  if (Array.isArray(parsed)) {
    const reports: RawSourceReport[] = [];
    for (const item of parsed) {
      const result = rawSourceReportSchema.safeParse(item);
      if (!result.success) return null;
      reports.push(result.data);
    }
    return { reports };
  }

  return null;
}

export async function startStreamIngest(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = resolveStreamIngestConfig(env);
  status = {
    ...status,
    enabled: config.enabled,
    brokers: config.brokers,
    topic: config.topic,
    groupId: config.groupId,
    clientId: config.clientId,
    running: false,
    lastError: undefined,
  };

  if (!config.enabled) return;
  if (stopConsumer) return;

  const { Kafka, logLevel } = await import("kafkajs");
  const kafka = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
    logLevel: logLevel.WARN,
  });
  const consumer = kafka.consumer({ groupId: config.groupId });
  await consumer.connect();
  await consumer.subscribe({
    topic: config.topic,
    fromBeginning: config.fromBeginning,
  });

  status.running = true;

  void consumer
    .run({
      eachMessage: async ({ message }) => {
        status.messagesConsumed += 1;
        const raw = message.value?.toString("utf8") ?? "";
        if (!raw.trim()) return;

        const payload = parseKafkaPayload(raw);
        if (!payload?.reports?.length) {
          status.lastError = "Unrecognized Kafka message shape";
          return;
        }

        const facts = ingestPayload(payload);
        const result = appendIngestFacts(facts);
        status.messagesAccepted += result.added.length;
        status.lastMessageAt = new Date().toISOString();
        status.lastError = undefined;
      },
    })
    .catch((err: unknown) => {
      status.running = false;
      status.lastError = err instanceof Error ? err.message : String(err);
    });

  stopConsumer = async () => {
    status.running = false;
    await consumer.disconnect();
    stopConsumer = null;
  };
}

export async function stopStreamIngest(): Promise<void> {
  if (stopConsumer) {
    await stopConsumer();
  }
}
